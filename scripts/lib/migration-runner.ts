/**
 * MigrationRunner implementation (Phase 9B).
 *
 * Owns:
 *  - Idempotent rewrite of legacy bare `hooks/run-hook.sh` anchors in the
 *    project's `.claude/settings*.json` files to a canonical anchored form
 *    (`${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.sh ...` for plugin installs,
 *    `${CLAUDE_PROJECT_DIR}/hooks/run-hook.sh ...` for curl installs).
 *  - Hash-based ownership-evidence enforcement against
 *    `.claude/loom-migration.log.toon`.
 *  - Mixed-channel reconciliation: rewrite all anchors to the canonical
 *    form for the declared channel and drop orphan entries.
 *  - `--reset-evidence` recovery for `MIGRATION_OWNERSHIP_DIVERGED`.
 *
 * Pure module — fs / clock / channel resolution are injected.
 */
import * as fsDefault from "node:fs";
import * as path from "node:path";
import type {
  Channel,
  MigrationRunner,
} from "./doctor/migration-runner.interface";
import {
  appendRecord,
  checkOwnership,
  defaultLogPath,
  readLog,
  removeRecordsByCheckId,
  sha256OfContent,
  sha256OfFile,
  type EvidenceDeps,
  type MigrationEvidence,
} from "./ownership-evidence";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Stable check-id every migration record is tagged with. */
export const BARE_ANCHOR_CHECK_ID = "bare-anchor";

const SETTINGS_FILES = ["settings.json", "settings.local.json"];

const PLUGIN_ANCHOR = "${CLAUDE_PLUGIN_ROOT}";
const CURL_ANCHOR = "${CLAUDE_PROJECT_DIR}";

/**
 * Matches a legacy bare anchor: a command string starting with
 * `hooks/run-hook.sh` (no `${...}` prefix). The capture group is the suffix
 * after `hooks/run-hook.sh` so the rewriter can preserve it.
 */
const BARE_ANCHOR_RE = /^hooks\/run-hook\.sh(.*)$/;

/** Match any anchored form for reconciliation. */
const ANCHORED_RE = /^\$\{(CLAUDE_PLUGIN_ROOT|CLAUDE_PROJECT_DIR)\}\/hooks\/run-hook\.sh(.*)$/;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface MigrationRunnerDeps {
  /** Project root containing `.claude/`. Defaults to `process.cwd()`. */
  cwd?: string;
  /**
   * Resolver that returns the active install channel. The runner uses this
   * to pick the canonical anchor. If omitted, defaults to `"curl"` — the
   * safest fallback when no channel can be determined.
   */
  resolveChannel?: () => Channel;
  /** Override the migration-log path. */
  logPath?: string;
  /** ISO clock; defaults to `() => new Date()`. */
  now?: () => Date;
  fs?: Pick<
    typeof fsDefault,
    | "existsSync"
    | "readFileSync"
    | "writeFileSync"
    | "renameSync"
    | "mkdirSync"
  >;
}

export interface RunResult extends MigrationEvidence {
  /** Convenience flag for hook callers. */
  changedFiles: string[];
}

/**
 * Default export AND named export. Phase 9A1's CLI imports the named
 * `MigrationRunnerImpl` (documented in integrationNotes); the default export
 * keeps the module ergonomic for direct `import x from ...` consumers.
 */
export class MigrationRunnerImpl implements MigrationRunner {
  private readonly cwd: string;
  private readonly logPath: string;
  private readonly resolveChannel: () => Channel;
  private readonly now: () => Date;
  private readonly fs: NonNullable<MigrationRunnerDeps["fs"]>;

  constructor(deps: MigrationRunnerDeps = {}) {
    this.cwd = deps.cwd ?? process.cwd();
    this.logPath = deps.logPath ?? defaultLogPath(this.cwd);
    this.resolveChannel = deps.resolveChannel ?? (() => "curl");
    this.now = deps.now ?? (() => new Date());
    this.fs = deps.fs ?? fsDefault;
  }

  /**
   * Walk candidate settings files, rewrite legacy anchors when present,
   * appending one `MigrationEvidence` record per file. Returns the LAST
   * evidence record (the SessionStart hook uses the most recently produced
   * evidence to drive its stderr notice); `changedFiles` enumerates every
   * file actually rewritten in this pass.
   */
  async run(): Promise<RunResult> {
    const channel = this.resolveChannel();
    const anchor = channel === "plugin" ? PLUGIN_ANCHOR : CURL_ANCHOR;
    const changedFiles: string[] = [];
    let lastEvidence: MigrationEvidence | null = null;

    for (const name of SETTINGS_FILES) {
      const filePath = path.join(this.cwd, ".claude", name);
      const evidence = this.processFile(filePath, anchor, channel);
      if (!evidence) continue;
      lastEvidence = evidence;
      if (evidence.outcome === "applied") changedFiles.push(filePath);
    }

    if (!lastEvidence) {
      // No candidate files existed at all; synthesise a not-needed record
      // bound to settings.local.json so downstream consumers see consistent
      // output. The record is NOT persisted — there is nothing to guard.
      lastEvidence = {
        checkId: BARE_ANCHOR_CHECK_ID,
        appliedAt: this.now().toISOString(),
        outcome: "not-needed",
        path: path.join(this.cwd, ".claude", "settings.local.json"),
        reason: "No settings files present",
      };
    }

    return { ...lastEvidence, changedFiles };
  }

  /**
   * Reconcile the project's settings to the canonical anchor form for
   * `channel`. Used by `/loom-doctor --fix --reconcile` when the host
   * straddles both channels. Idempotent.
   */
  async reconcile(channel: Channel): Promise<void> {
    const targetAnchor = channel === "plugin" ? PLUGIN_ANCHOR : CURL_ANCHOR;
    for (const name of SETTINGS_FILES) {
      const filePath = path.join(this.cwd, ".claude", name);
      if (!this.fs.existsSync(filePath)) continue;
      const original = this.fs.readFileSync(filePath, "utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(original);
      } catch {
        continue;
      }
      const result = rewriteCommands(parsed, (cmd) => {
        // Both bare and other-channel anchored forms get coerced.
        const bare = BARE_ANCHOR_RE.exec(cmd);
        if (bare) return `${targetAnchor}/hooks/run-hook.sh${bare[1]}`;
        const m = ANCHORED_RE.exec(cmd);
        if (m && m[1] !== (channel === "plugin" ? "CLAUDE_PLUGIN_ROOT" : "CLAUDE_PROJECT_DIR")) {
          return `${targetAnchor}/hooks/run-hook.sh${m[2]}`;
        }
        return null;
      });
      if (result.changes > 0) {
        const rendered = stableStringify(result.value, original) + (original.endsWith("\n") ? "\n" : "");
        // We don't need to update the migration log for reconcile (that's
        // a separate concern handled by the channel-files check), but we
        // do write atomically.
        this.atomicWrite(filePath, rendered);
      }
    }
  }

  /**
   * Remove every migration-log record carrying `checkId`. Used by
   * `/loom-doctor --reset-evidence <id>` to unstick a refused-ownership
   * guard. Subsequent `run()` invocations will see no prior record for
   * `(checkId, path)` and proceed normally.
   */
  async resetEvidence(checkId: string): Promise<void> {
    const deps: EvidenceDeps = { fs: this.fs, now: this.now };
    removeRecordsByCheckId(this.logPath, checkId, deps);
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private processFile(
    filePath: string,
    anchor: string,
    _channel: Channel
  ): MigrationEvidence | null {
    if (!this.fs.existsSync(filePath)) return null;
    const original = this.fs.readFileSync(filePath, "utf8");
    const beforeHash = sha256OfContent(original);

    const deps: EvidenceDeps = { fs: this.fs, now: this.now };
    const log = readLog(this.logPath, deps);

    // Ownership guard: refuse if a prior record exists and the on-disk
    // hash has drifted from the reference.
    const divergence = checkOwnership(
      log,
      BARE_ANCHOR_CHECK_ID,
      filePath,
      beforeHash
    );
    if (divergence) {
      const record: MigrationEvidence = {
        checkId: BARE_ANCHOR_CHECK_ID,
        appliedAt: this.now().toISOString(),
        outcome: "refused-ownership-guard",
        path: filePath,
        beforeHash,
        reason: `On-disk hash diverged from recorded evidence (recorded=${divergence.recordedHash.slice(0, 12)}..., onDisk=${(beforeHash ?? "missing").slice(0, 12)}...). Run /loom-doctor --reset-evidence ${BARE_ANCHOR_CHECK_ID} to recover.`,
      };
      appendRecord(this.logPath, record, deps);
      return record;
    }

    // Parse + rewrite
    let parsed: unknown;
    try {
      parsed = JSON.parse(original);
    } catch {
      // Corrupt file — record but don't rewrite. Spec calls this `failed`
      // in the schema; for the runtime outcome we map to refused so the
      // hook surfaces a remediation prompt rather than silently passing.
      const record: MigrationEvidence = {
        checkId: BARE_ANCHOR_CHECK_ID,
        appliedAt: this.now().toISOString(),
        outcome: "refused-ownership-guard",
        path: filePath,
        beforeHash,
        reason: "Settings file is not valid JSON; refusing to rewrite",
      };
      appendRecord(this.logPath, record, deps);
      return record;
    }

    const result = rewriteCommands(parsed, (cmd) => {
      const m = BARE_ANCHOR_RE.exec(cmd);
      if (!m) return null;
      return `${anchor}/hooks/run-hook.sh${m[1]}`;
    });

    if (result.changes === 0) {
      // Already canonical — record `not-needed` once so the ownership
      // guard has a reference hash for future runs. If the log already
      // has a `not-needed` record matching the current hash, skip the
      // write to keep the log compact and idempotent.
      const prior = log
        .slice()
        .reverse()
        .find(
          (r) => r.checkId === BARE_ANCHOR_CHECK_ID && r.path === filePath
        );
      if (prior && prior.afterHash === beforeHash && prior.outcome === "not-needed") {
        return prior;
      }
      const record: MigrationEvidence = {
        checkId: BARE_ANCHOR_CHECK_ID,
        appliedAt: this.now().toISOString(),
        outcome: "not-needed",
        path: filePath,
        beforeHash,
        afterHash: beforeHash,
        reason: "Settings file already uses canonical anchors",
      };
      appendRecord(this.logPath, record, deps);
      return record;
    }

    const rendered = stableStringify(result.value, original) + (original.endsWith("\n") ? "\n" : "");
    const afterHash = sha256OfContent(rendered);
    this.atomicWrite(filePath, rendered);
    const record: MigrationEvidence = {
      checkId: BARE_ANCHOR_CHECK_ID,
      appliedAt: this.now().toISOString(),
      outcome: "applied",
      path: filePath,
      beforeHash,
      afterHash,
      reason: `${result.changes} bare-anchor entr${result.changes === 1 ? "y" : "ies"} rewritten to ${anchor} form`,
    };
    appendRecord(this.logPath, record, deps);
    return record;
  }

  private atomicWrite(filePath: string, content: string): void {
    const dir = path.dirname(filePath);
    if (!this.fs.existsSync(dir)) {
      this.fs.mkdirSync(dir, { recursive: true });
    }
    const tmp = `${filePath}.tmp`;
    this.fs.writeFileSync(tmp, content);
    this.fs.renameSync(tmp, filePath);
  }
}

export default MigrationRunnerImpl;

// Production singleton consumed by /loom-doctor's --fix/--reconcile/--reset-evidence
// dispatch (Phase 9A1's `defaultLoadMigrationRunner` reads `migrationRunner` or
// `default` from this module). Constructed with default options + env-based channel
// resolution; instantiated lazily on first import.
export const migrationRunner: MigrationRunner = new MigrationRunnerImpl({
  resolveChannel: () =>
    process.env.CLAUDE_PLUGIN_ROOT && process.env.CLAUDE_PLUGIN_ROOT.length > 0
      ? "plugin"
      : "curl",
});

// ---------------------------------------------------------------------------
// JSON-rewriting helpers
// ---------------------------------------------------------------------------

interface RewriteOutcome {
  value: unknown;
  changes: number;
}

/**
 * Walk a parsed settings JSON tree, applying `rewrite` to every string-typed
 * `command` field found inside `hooks.*[].hooks[].command` paths. Returns a
 * new tree (input is not mutated) plus the change count.
 *
 * Claude Code's settings schema for hooks is:
 *   hooks: { [eventName]: Array<{ matcher?: ...; hooks: Array<{ type, command }> }> }
 *
 * The walker is intentionally tolerant — it recurses into every object/array
 * value so we catch hand-edited / non-canonical shapes too.
 */
export function rewriteCommands(
  node: unknown,
  rewrite: (cmd: string) => string | null
): RewriteOutcome {
  let changes = 0;
  function walk(n: unknown): unknown {
    if (Array.isArray(n)) {
      return n.map((item) => walk(item));
    }
    if (n && typeof n === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
        if (k === "command" && typeof v === "string") {
          const next = rewrite(v);
          if (next !== null && next !== v) {
            changes++;
            out[k] = next;
            continue;
          }
        }
        out[k] = walk(v);
      }
      return out;
    }
    return n;
  }
  const value = walk(node);
  return { value, changes };
}

/**
 * Serialise `value` while preserving the source's indent style as best we
 * can. If the original used 2-space indentation we emit 2-space; otherwise
 * default to 2 spaces. Trailing newline handling is the caller's
 * responsibility.
 */
function stableStringify(value: unknown, original: string): string {
  const indent = detectIndent(original);
  return JSON.stringify(value, null, indent);
}

function detectIndent(text: string): number {
  // Inspect the first indented line; default to 2.
  const m = text.match(/\n([ \t]+)/);
  if (!m) return 2;
  if (m[1].startsWith("\t")) return 2; // we don't emit tabs
  return Math.min(m[1].length, 4);
}
