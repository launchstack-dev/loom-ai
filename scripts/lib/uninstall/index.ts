/**
 * scripts/lib/uninstall/index.ts — orchestrator for `/loom-uninstall`.
 *
 * Pipeline:
 *   1. buildPlan()       — discover paths and settings-file Loom entries.
 *   2. renderPlan()      — produce the human-readable preview (also used by
 *                          --dry-run).
 *   3. runUninstall()    — drive base prompt → typed-literal prompt (when
 *                          --purge-project-state) → mutation.
 *
 * All side-effecting concerns (fs reads/writes, prompt I/O, environment) are
 * injected via `UninstallDeps` so the orchestrator is fully testable without
 * touching the real filesystem.
 *
 * Settings-file cleanup is implemented INLINE here: we don't import from
 * `scripts/register-loom-hooks.ts` because that script doesn't currently
 * export its helpers as a library surface (it's a CLI entry-point). A future
 * wiring pass should expose `purgeLoomEntries`/`commandReferencesHook` from
 * a shared module so both scripts share one canonical purge implementation;
 * for now we keep `LOOM_HOOK_NAMES` in sync manually.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as fsReal from "node:fs";
import * as osReal from "node:os";
import * as pathReal from "node:path";

import {
  confirmBase,
  confirmTypedLiteral,
  type ConfirmDeps,
  type ConfirmResult,
} from "./confirm.js";

// ---------------------------------------------------------------------------
// Loom hook manifest (kept in sync with scripts/register-loom-hooks.ts).
// ---------------------------------------------------------------------------

/**
 * Names of every hook entry register-loom-hooks.ts can write. Any settings
 * entry whose command references `hooks/<name>.ts` (with optional
 * `${CLAUDE_PLUGIN_ROOT}/` or `${CLAUDE_PROJECT_DIR}/` prefix) is treated as
 * a Loom-managed entry and removed by the uninstaller.
 */
export const LOOM_HOOK_NAMES: readonly string[] = [
  "contract-lock",
  "file-ownership",
  "wiki-write-guard",
  "wiki-impact-warner",
  "deploy-guard",
  "context-budget",
  "budget-tracker",
  "typecheck-on-write",
  "wiki-commit-ledger",
  "context-monitor",
  "checkpoint-trigger",
  "status-updater",
  "quality-gate",
  "wiki-session-status",
  "loom-migration",
] as const;

// ---------------------------------------------------------------------------
// Dependency injection types
// ---------------------------------------------------------------------------

export interface FsLike {
  existsSync(p: string): boolean;
  readFileSync(p: string, enc: "utf-8" | BufferEncoding): string;
  writeFileSync(p: string, data: string, enc?: BufferEncoding): void;
  renameSync(from: string, to: string): void;
  rmSync(p: string, opts?: { recursive?: boolean; force?: boolean }): void;
  statSync(p: string): { isDirectory(): boolean };
}

export interface OsLike {
  homedir(): string;
}

export interface UninstallDeps {
  fs?: FsLike;
  os?: OsLike;
  /** `process.env`. Tests inject a controlled object to exercise `LOOM_HOME`. */
  env?: Record<string, string | undefined>;
  /** Project root (used to locate `.claude/settings*.json` and project state). */
  cwd?: string;
  /** Confirm-helper dep injection (stdin/stderr/scheduler mocks). */
  confirm?: ConfirmDeps;
  /** Stdout sink for the removal-plan preview. */
  stdout?: NodeJS.WritableStream;
  /** Stderr sink for prompt copy and timeout message. */
  stderr?: NodeJS.WritableStream;
}

// ---------------------------------------------------------------------------
// Plan model
// ---------------------------------------------------------------------------

export interface SettingsFileMatch {
  /** Absolute path to a `.claude/settings*.json` file containing Loom entries. */
  path: string;
  /** Count of Loom-managed hook entries discovered inside (purge target). */
  loomEntryCount: number;
}

export interface UninstallPlan {
  /** Absolute path to `~/.claude/plugins/loom/` (always present in plan, even if missing on disk). */
  pluginDir: string;
  pluginDirExists: boolean;
  /** Absolute path to `~/.loom/` (honoring `LOOM_HOME` env override). */
  loomHome: string;
  loomHomeExists: boolean;
  /** Project-root settings files with Loom hook entries. */
  settingsFiles: SettingsFileMatch[];
  /** Project state paths cleared only when `--purge-project-state` is set. */
  projectState: {
    wikiDir: { path: string; exists: boolean };
    orchestrationToml: { path: string; exists: boolean };
    planExecutionDir: { path: string; exists: boolean };
  };
  /** Whether the caller asked for `--purge-project-state`. */
  purgeProjectState: boolean;
}

// ---------------------------------------------------------------------------
// Helpers — settings-file inspection
// ---------------------------------------------------------------------------

/**
 * Returns true iff `command` references `hooks/<scriptName>.ts` (with the
 * optional `${CLAUDE_PROJECT_DIR}/` or `${CLAUDE_PLUGIN_ROOT}/` prefix).
 * Mirrors the regex from `scripts/register-loom-hooks.ts` so both stay in
 * sync. Exported for unit tests.
 */
export function commandReferencesHook(
  command: string,
  scriptName: string
): boolean {
  const escaped = scriptName.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  const re = new RegExp(
    `(^|[\\s"'])(\\$\\{CLAUDE_(?:PLUGIN_ROOT|PROJECT_DIR)\\}/)?hooks/${escaped}\\.ts(\\s|$|["'])`
  );
  return re.test(command);
}

/**
 * Count Loom-managed hook entries inside a settings file. Returns 0 for
 * missing files, unparseable JSON, or files with no Loom references.
 */
export function countLoomEntries(fs: FsLike, settingsPath: string): number {
  if (!fs.existsSync(settingsPath)) return 0;
  let content: string;
  try {
    content = fs.readFileSync(settingsPath, "utf-8").trim();
  } catch {
    return 0;
  }
  if (!content) return 0;
  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    return 0;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return 0;
  const hooks = parsed.hooks;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) return 0;
  let count = 0;
  for (const event of Object.keys(hooks)) {
    const bucket = hooks[event];
    if (!Array.isArray(bucket)) continue;
    for (const item of bucket) {
      if (!item || typeof item !== "object") continue;
      const inner = item.hooks;
      if (!Array.isArray(inner)) continue;
      for (const h of inner) {
        if (!h || typeof h !== "object") continue;
        const cmd = String(h.command ?? "");
        if (LOOM_HOOK_NAMES.some((name) => commandReferencesHook(cmd, name))) {
          count++;
        }
      }
    }
  }
  return count;
}

/**
 * Strip all Loom-managed hook entries from the parsed settings object and
 * return the cleaned object. Non-Loom entries are preserved verbatim;
 * buckets that become empty are deleted entirely; if `hooks` itself becomes
 * empty, the key is removed.
 */
export function purgeLoomFromSettings(parsed: any): {
  cleaned: any;
  removed: number;
} {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { cleaned: parsed, removed: 0 };
  }
  const hooks = parsed.hooks;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) {
    return { cleaned: parsed, removed: 0 };
  }
  let removed = 0;
  for (const event of Object.keys(hooks)) {
    const bucket = hooks[event];
    if (!Array.isArray(bucket)) continue;
    const filtered: any[] = [];
    for (const item of bucket) {
      if (!item || typeof item !== "object") continue;
      const inner = Array.isArray(item.hooks) ? item.hooks : [];
      const keptInner = inner.filter((h: any) => {
        if (!h || typeof h !== "object") return true;
        const cmd = String(h.command ?? "");
        const isLoom = LOOM_HOOK_NAMES.some((name) =>
          commandReferencesHook(cmd, name)
        );
        if (isLoom) removed++;
        return !isLoom;
      });
      if (keptInner.length > 0) {
        filtered.push({ ...item, hooks: keptInner });
      }
    }
    if (filtered.length === 0) delete hooks[event];
    else hooks[event] = filtered;
  }
  if (Object.keys(hooks).length === 0) delete parsed.hooks;
  return { cleaned: parsed, removed };
}

// ---------------------------------------------------------------------------
// Plan construction
// ---------------------------------------------------------------------------

function resolveDeps(deps: UninstallDeps | undefined): {
  fs: FsLike;
  os: OsLike;
  env: Record<string, string | undefined>;
  cwd: string;
  confirm: ConfirmDeps | undefined;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
} {
  return {
    fs: deps?.fs ?? (fsReal as unknown as FsLike),
    os: deps?.os ?? osReal,
    env: deps?.env ?? process.env,
    cwd: deps?.cwd ?? process.cwd(),
    confirm: deps?.confirm,
    stdout: deps?.stdout ?? process.stdout,
    stderr: deps?.stderr ?? process.stderr,
  };
}

export interface BuildPlanOptions {
  purgeProjectState: boolean;
}

export function buildPlan(
  opts: BuildPlanOptions,
  deps?: UninstallDeps
): UninstallPlan {
  const d = resolveDeps(deps);
  const home = d.os.homedir();
  const pluginDir = pathReal.join(home, ".claude", "plugins", "loom");
  const loomHome = d.env.LOOM_HOME
    ? pathReal.resolve(d.env.LOOM_HOME)
    : pathReal.join(home, ".loom");

  const settingsDir = pathReal.join(d.cwd, ".claude");
  const settingsCandidates = [
    pathReal.join(settingsDir, "settings.json"),
    pathReal.join(settingsDir, "settings.local.json"),
  ];
  const settingsFiles: SettingsFileMatch[] = [];
  for (const p of settingsCandidates) {
    const n = countLoomEntries(d.fs, p);
    if (n > 0) settingsFiles.push({ path: p, loomEntryCount: n });
  }

  const wikiDir = pathReal.join(d.cwd, ".loom", "wiki");
  const orchestrationToml = pathReal.join(d.cwd, "orchestration.toml");
  const planExecutionDir = pathReal.join(d.cwd, ".plan-execution");

  return {
    pluginDir,
    pluginDirExists: d.fs.existsSync(pluginDir),
    loomHome,
    loomHomeExists: d.fs.existsSync(loomHome),
    settingsFiles,
    projectState: {
      wikiDir: { path: wikiDir, exists: d.fs.existsSync(wikiDir) },
      orchestrationToml: {
        path: orchestrationToml,
        exists: d.fs.existsSync(orchestrationToml),
      },
      planExecutionDir: {
        path: planExecutionDir,
        exists: d.fs.existsSync(planExecutionDir),
      },
    },
    purgeProjectState: opts.purgeProjectState,
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export function renderPlan(plan: UninstallPlan): string {
  const lines: string[] = [];
  lines.push("This will remove Loom:");
  lines.push(`  ${plan.pluginDir}/`);
  lines.push(`  ${plan.loomHome}/`);
  if (plan.settingsFiles.length === 0) {
    lines.push(
      "  Loom hook entries from .claude/settings.json AND .claude/settings.local.json"
    );
  } else if (plan.settingsFiles.length === 1) {
    lines.push(`  Loom hook entries from ${plan.settingsFiles[0].path}`);
  } else {
    // tier-ambiguous: both tiers carry Loom entries; list both explicitly.
    lines.push("  Loom hook entries from BOTH settings tiers:");
    for (const s of plan.settingsFiles) {
      lines.push(`    ${s.path} (${s.loomEntryCount} entries)`);
    }
  }
  lines.push("");
  if (plan.purgeProjectState) {
    lines.push("--purge-project-state will ALSO remove:");
    lines.push(`  ${plan.projectState.wikiDir.path}/`);
    lines.push(`  ${plan.projectState.orchestrationToml.path}`);
    lines.push(`  ${plan.projectState.planExecutionDir.path}/`);
  } else {
    lines.push("Project state preserved:");
    lines.push(`  ${plan.projectState.wikiDir.path}/ (if present)`);
    lines.push(`  ${plan.projectState.orchestrationToml.path} (if present)`);
    lines.push(`  ${plan.projectState.planExecutionDir.path}/ (if present)`);
  }
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Mutation primitives
// ---------------------------------------------------------------------------

function atomicWriteJson(fs: FsLike, p: string, value: unknown): void {
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf-8");
  fs.renameSync(tmp, p);
}

function tryRemoveTree(fs: FsLike, p: string): boolean {
  if (!fs.existsSync(p)) return false;
  fs.rmSync(p, { recursive: true, force: true });
  return true;
}

export interface ExecuteResult {
  removed: {
    pluginDir: boolean;
    loomHome: boolean;
    settingsFiles: { path: string; removedEntries: number }[];
    projectState?: {
      wikiDir: boolean;
      orchestrationToml: boolean;
      planExecutionDir: boolean;
    };
  };
}

/**
 * Mutate the filesystem according to `plan`. Caller is responsible for
 * obtaining confirmation BEFORE invoking this — `executePlan` performs no
 * prompting and assumes consent.
 *
 * When `plan.purgeProjectState` is true, project-state removal happens AFTER
 * settings-file purge so a settings purge failure doesn't leave a half-state
 * with project files already gone.
 */
export function executePlan(
  plan: UninstallPlan,
  deps?: UninstallDeps
): ExecuteResult {
  const d = resolveDeps(deps);
  const result: ExecuteResult = {
    removed: {
      pluginDir: false,
      loomHome: false,
      settingsFiles: [],
    },
  };

  // 1. Purge settings-file entries (atomic per-file).
  for (const s of plan.settingsFiles) {
    if (!d.fs.existsSync(s.path)) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(d.fs.readFileSync(s.path, "utf-8"));
    } catch {
      continue;
    }
    const { cleaned, removed } = purgeLoomFromSettings(parsed);
    atomicWriteJson(d.fs, s.path, cleaned);
    result.removed.settingsFiles.push({ path: s.path, removedEntries: removed });
  }

  // 2. Remove plugin dir + ~/.loom.
  result.removed.pluginDir = tryRemoveTree(d.fs, plan.pluginDir);
  result.removed.loomHome = tryRemoveTree(d.fs, plan.loomHome);

  // 3. Optional project state purge.
  if (plan.purgeProjectState) {
    result.removed.projectState = {
      wikiDir: tryRemoveTree(d.fs, plan.projectState.wikiDir.path),
      orchestrationToml: tryRemoveTree(
        d.fs,
        plan.projectState.orchestrationToml.path
      ),
      planExecutionDir: tryRemoveTree(d.fs, plan.projectState.planExecutionDir.path),
    };
  }

  return result;
}

// ---------------------------------------------------------------------------
// Top-level orchestrator
// ---------------------------------------------------------------------------

export interface RunUninstallArgs {
  purgeProjectState: boolean;
  dryRun: boolean;
  yes: boolean;
}

export type RunUninstallOutcome =
  | { kind: "dry-run"; plan: UninstallPlan; exitCode: 0 }
  | { kind: "completed"; plan: UninstallPlan; result: ExecuteResult; exitCode: 0 }
  | {
      kind: "aborted";
      plan: UninstallPlan;
      stage: "base" | "typed-literal";
      reason: ConfirmResult extends { accepted: false; reason: infer R } ? R : never;
      partial?: ExecuteResult;
      exitCode: 1;
    };

export async function runUninstall(
  args: RunUninstallArgs,
  deps?: UninstallDeps
): Promise<RunUninstallOutcome> {
  const d = resolveDeps(deps);
  const plan = buildPlan({ purgeProjectState: args.purgeProjectState }, deps);

  // Print the plan preview on stdout regardless of mode — both dry-run and
  // interactive flows show the same listing.
  d.stdout.write(renderPlan(plan));

  if (args.dryRun) {
    return { kind: "dry-run", plan, exitCode: 0 };
  }

  if (!args.yes) {
    d.stderr.write("\nType 'y' to confirm ");
    const baseResult = await confirmBase(d.confirm);
    if (!baseResult.accepted) {
      if (baseResult.reason === "timeout") {
        d.stderr.write("\nConfirmation timed out after 60s; no changes made.\n");
      }
      return {
        kind: "aborted",
        plan,
        stage: "base",
        reason: baseResult.reason,
        exitCode: 1,
      } as RunUninstallOutcome;
    }
  }

  // Typed-literal gate for --purge-project-state. We skip this when --yes is
  // set so CI flows aren't blocked.
  if (args.purgeProjectState && !args.yes) {
    d.stderr.write(
      "\n--purge-project-state will ALSO remove project state. " +
        "Type the literal word 'uninstall' to confirm: "
    );
    const typedResult = await confirmTypedLiteral("uninstall", d.confirm);
    if (!typedResult.accepted) {
      // First prompt was accepted, so plugin+~/.loom removal could still
      // proceed safely — but we want a clean abort here that leaves all
      // mutation off. The spec wording ("any other input rejects" for the
      // typed prompt) is ambiguous about the first-prompt mutation; we
      // interpret strictly: typed-literal rejection aborts the WHOLE run
      // before any mutation. This matches the S-02 acceptance criterion
      // ("No project state MUST be removed") most defensively.
      return {
        kind: "aborted",
        plan,
        stage: "typed-literal",
        reason: typedResult.reason,
        exitCode: 1,
      } as RunUninstallOutcome;
    }
  }

  const result = executePlan(plan, deps);
  return { kind: "completed", plan, result, exitCode: 0 };
}
