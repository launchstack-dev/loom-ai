#!/usr/bin/env node
/**
 * scripts/register-loom-hooks.ts — register the full Loom enforcement hook
 * suite into `.claude/settings.json`.
 *
 * This is the generalized successor to `scripts/register-wiki-hooks.ts`. It
 * registers all 14 Loom hooks (enforcement gates + wiki health + non-gating
 * monitors) into a project-local settings.json so curl-install users actually
 * receive README pillar #3 ("Hook-enforced discipline").
 *
 * Per-hook file-existence guard: each candidate is registered only if its
 * source file at hooks/<name>.ts exists on disk. Existing unrelated hook
 * entries are preserved verbatim — the script only appends missing hook
 * entries (or, with --replace, purges existing Loom-hook entries first).
 * Settings file is written atomically (write to .tmp, then rename).
 *
 * The hook manifest below mirrors `.claude/settings.json` in the loom-ai repo:
 *   PreToolUse Write|Edit  : contract-lock, file-ownership, wiki-write-guard,
 *                            wiki-impact-warner
 *   PreToolUse Bash        : deploy-guard
 *   PreToolUse Agent       : context-budget, budget-tracker
 *   PostToolUse Write|Edit : typecheck-on-write
 *   PostToolUse Bash       : wiki-commit-ledger
 *   PostToolUse *          : context-monitor, checkpoint-trigger, status-updater
 *   Stop *                 : quality-gate, context-monitor (re-fires)
 *   SessionStart           : wiki-session-status
 *
 * Installation modes (same as register-wiki-hooks.ts):
 *   plugin — references ${CLAUDE_PLUGIN_ROOT}/hooks/<name>.ts
 *   local  — references project-relative hooks/<name>.ts
 *   auto   — detect from settings file location
 *
 * Usage:
 *   node scripts/register-loom-hooks.ts                           # default
 *   node scripts/register-loom-hooks.ts --settings <path>
 *   node scripts/register-loom-hooks.ts --hooks-root <abs-path>
 *   node scripts/register-loom-hooks.ts --mode local|plugin|auto
 *   node scripts/register-loom-hooks.ts --tier auto|local|project
 *   node scripts/register-loom-hooks.ts --runner bunx|npx|auto
 *   node scripts/register-loom-hooks.ts --command-prefix <prefix>
 *   node scripts/register-loom-hooks.ts --replace
 *   node scripts/register-loom-hooks.ts --dry-run
 *   node scripts/register-loom-hooks.ts --json
 *
 * --mode vs --tier (these solve different problems):
 *   --mode controls how hook COMMANDS resolve at runtime — i.e. whether the
 *     command path is anchored at `${CLAUDE_PLUGIN_ROOT}` (plugin install)
 *     or `${CLAUDE_PROJECT_DIR}` (local dev checkout).
 *   --tier controls which SETTINGS FILE the hook entries get written into —
 *     `.claude/settings.local.json` (per-user, gitignored; the new default)
 *     or `.claude/settings.json` (shared, committed to git). Pass an explicit
 *     `--settings <path>` to bypass tier resolution entirely.
 *
 * Exit codes:
 *   0 — registered (or nothing to do)
 *   1 — settings file unparseable / write failure / no hook .ts files
 *   2 — MIGRATION_TIER_AMBIGUOUS: Loom entries exist in both settings.json
 *       and settings.local.json. Re-run with explicit `--tier local` or
 *       `--tier project` to pick a winner.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { resolveTier, type ExplicitTierFlag, type Tier } from "./lib/tier-resolution";
// The canonical hook manifest lives in a side-effect-free module so tests
// can import it without triggering this CLI's main(). See the manifest
// module header for why entrypoint-detection guards were rejected (note
// 047 + PR #32 review: argv-based guards fail open).
import { LOOM_HOOKS, type EventKind, type HookEntry } from "./lib/loom-hooks-manifest";

type Mode = "local" | "plugin" | "auto";
type RunnerChoice = "bunx" | "npx" | "auto";

interface Options {
  settingsPath: string;
  /** True iff the user passed `--settings <path>` explicitly. When true,
   *  tier resolution is bypassed entirely — the explicit path wins. */
  settingsPathExplicit: boolean;
  hooksRoot: string;
  mode: Mode;
  /** `--tier` flag. `undefined` means flag was omitted (treated as "auto"
   *  by the resolver). Kept distinct from "auto" so callers can tell
   *  apart user-omitted vs. user-explicit-auto for logging. */
  tier: ExplicitTierFlag | undefined;
  runner: RunnerChoice;
  commandPrefixOverride: string | null;
  replace: boolean;
  dryRun: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    // Sentinel — replaced post-tier-resolution when --settings is not passed.
    // Held here only so existing call sites that read opts.settingsPath
    // before resolution still get a sensible-looking default.
    settingsPath: path.join(process.cwd(), ".claude", "settings.json"),
    settingsPathExplicit: false,
    hooksRoot: path.resolve(__dirname, "..", "hooks"),
    mode: "auto",
    tier: undefined,
    runner: "auto",
    commandPrefixOverride: null,
    replace: false,
    dryRun: false,
    json: false,
  };
  const requireValue = (flag: string, value: string | undefined): string => {
    if (value === undefined || value.startsWith("-")) {
      throw new Error(`${flag} requires a value`);
    }
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--settings") {
      opts.settingsPath = path.resolve(requireValue("--settings", argv[++i]));
      opts.settingsPathExplicit = true;
    }
    else if (a === "--hooks-root") opts.hooksRoot = path.resolve(requireValue("--hooks-root", argv[++i]));
    else if (a === "--mode") {
      const v = requireValue("--mode", argv[++i]);
      if (v !== "local" && v !== "plugin" && v !== "auto") {
        throw new Error(`--mode must be one of: local, plugin, auto (got "${v}")`);
      }
      opts.mode = v;
    } else if (a === "--tier") {
      const v = requireValue("--tier", argv[++i]);
      if (v !== "auto" && v !== "local" && v !== "project") {
        throw new Error(`--tier must be one of: auto, local, project (got "${v}")`);
      }
      opts.tier = v;
    } else if (a === "--runner") {
      const v = requireValue("--runner", argv[++i]);
      if (v !== "bunx" && v !== "npx" && v !== "auto") {
        throw new Error(`--runner must be one of: bunx, npx, auto (got "${v}")`);
      }
      opts.runner = v;
    } else if (a === "--command-prefix") opts.commandPrefixOverride = requireValue("--command-prefix", argv[++i]);
    else if (a === "--replace") opts.replace = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--json") opts.json = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

/**
 * Auto-detect installation mode. "local" when the settings file lives inside
 * a loom dev checkout (project root contains hooks/file-ownership.ts AND
 * scripts/register-loom-hooks.ts). Otherwise "plugin".
 */
function detectMode(settingsPath: string): "local" | "plugin" {
  // Default: peel off two levels (.claude/settings.json → project root).
  // Fallback to cwd when --settings points somewhere unconventional.
  const resolved = path.resolve(settingsPath);
  const parent = path.dirname(resolved);
  // Fall back to the settings file's parent dir rather than cwd — the script
  // may be invoked from anywhere, but the project root is always near the
  // settings file path. Only peel an extra level when nested in .claude/.
  const projectRoot =
    path.basename(parent) === ".claude" ? path.dirname(parent) : parent;
  const looksLikeLoomCheckout =
    fs.existsSync(path.join(projectRoot, "hooks", "file-ownership.ts")) &&
    fs.existsSync(path.join(projectRoot, "scripts", "register-loom-hooks.ts"));
  return looksLikeLoomCheckout ? "local" : "plugin";
}

function runnerPrefix(runner: "bunx" | "npx"): string {
  return runner === "bunx" ? "bunx tsx" : "npx --yes tsx";
}

function resolveCommandPrefix(opts: Options): {
  prefix: string;
  mode: "local" | "plugin" | "explicit";
  runner: "bunx" | "npx" | "wrapper" | "explicit";
} {
  if (opts.commandPrefixOverride !== null) {
    return { prefix: opts.commandPrefixOverride, mode: "explicit", runner: "explicit" };
  }
  const effective = opts.mode === "auto" ? detectMode(opts.settingsPath) : opts.mode;

  // Default path: dispatch through hooks/run-hook.sh (matches the canonical
  // .claude/settings.json shape in the loom-ai repo). The wrapper resolves
  // bun → npx tsx at exec time, so users can install bun later without
  // re-registering hooks.
  //
  // Hook commands MUST anchor with ${CLAUDE_PROJECT_DIR} (local) or
  // ${CLAUDE_PLUGIN_ROOT} (plugin) — bare relative paths fail with exit 127
  // once Claude Code's persistent Bash shell cd's into a subdir. See:
  // https://docs.anthropic.com/en/docs/claude-code/hooks and
  // https://github.com/gsd-build/get-shit-done/issues/1906
  if (opts.runner === "auto") {
    const rootPart =
      effective === "local"
        ? "${CLAUDE_PROJECT_DIR}/"
        : "${CLAUDE_PLUGIN_ROOT}/";
    return {
      prefix: `sh ${rootPart}hooks/run-hook.sh ${rootPart}`,
      mode: effective,
      runner: "wrapper",
    };
  }

  const runner = opts.runner;
  const runnerPart = runnerPrefix(runner);
  const prefix =
    effective === "local"
      ? `${runnerPart} \${CLAUDE_PROJECT_DIR}`
      : `${runnerPart} \${CLAUDE_PLUGIN_ROOT}`;
  return { prefix, mode: effective, runner };
}

interface SettingsHookEntry {
  matcher?: string;
  hooks: Array<{ type: string; command: string; timeout?: number }>;
}

interface Settings {
  hooks?: Partial<Record<EventKind, SettingsHookEntry[]>>;
  [k: string]: unknown;
}

function readSettings(p: string): { settings: Settings; existed: boolean } {
  if (!fs.existsSync(p)) return { settings: {}, existed: false };
  try {
    const content = fs.readFileSync(p, "utf-8").trim();
    if (!content) return { settings: {}, existed: true };
    return { settings: JSON.parse(content) as Settings, existed: true };
  } catch (err) {
    throw new Error(
      `Cannot parse ${p}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function writeAtomic(p: string, content: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + ".tmp";
  try {
    fs.writeFileSync(tmp, content, "utf-8");
    fs.renameSync(tmp, p);
  } catch (err) {
    // Clean up the .tmp so we don't leave a partial write behind. Swallow
    // unlink errors — the original write error is what the caller needs.
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {}
    throw err;
  }
}

function commandReferencesHook(command: string, scriptName: string): boolean {
  // Match either a standalone "hooks/<name>.ts" (preceded by start/space/quote)
  // or a "${CLAUDE_PLUGIN_ROOT}/hooks/<name>.ts" form. Reject paths like
  // "my-hooks/<name>.ts" or "custom-hooks/<name>.ts" so unrelated user hooks
  // aren't accidentally treated as Loom hooks. scriptName is regex-escaped so
  // future hook names with regex-significant characters (`.`, `+`, etc.) still
  // match literally.
  const escaped = scriptName.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  const re = new RegExp(
    `(^|[\\s"'])(\\$\\{CLAUDE_(?:PLUGIN_ROOT|PROJECT_DIR)\\}/)?hooks/${escaped}\\.ts(\\s|$|["'])`
  );
  return re.test(command);
}

function entryAlreadyPresent(
  settings: Settings,
  entry: HookEntry,
  expectedScriptName: string
): boolean {
  const bucket = settings.hooks?.[entry.event];
  if (!Array.isArray(bucket)) return false;
  for (const item of bucket) {
    if (!item || typeof item !== "object") continue;
    const itemMatcher = item.matcher ?? "";
    const wantMatcher = entry.matcher ?? "";
    if (itemMatcher !== wantMatcher) continue;
    const hooksList = Array.isArray(item.hooks) ? item.hooks : [];
    for (const h of hooksList) {
      if (!h || typeof h !== "object") continue;
      if (commandReferencesHook(String(h.command ?? ""), expectedScriptName)) {
        return true;
      }
    }
  }
  return false;
}

function buildSettingsEntry(
  entry: HookEntry,
  commandPrefix: string
): SettingsHookEntry {
  const trimmed = commandPrefix.replace(/\s+$/, "");
  // A prefix ending in ${CLAUDE_PROJECT_DIR} or ${CLAUDE_PLUGIN_ROOT} expects
  // a "/" to join the hooks path; a prefix already ending in "/" needs no
  // separator; anything else (e.g. "bunx tsx") needs a space.
  const endsWithRoot = /\$\{CLAUDE_(PROJECT_DIR|PLUGIN_ROOT)\}$/.test(trimmed);
  const sep = endsWithRoot ? "/" : /\/$/.test(trimmed) ? "" : " ";
  const pathPart = `hooks/${entry.hookName}.ts`;
  const command = `${trimmed}${sep}${pathPart}`;
  const result: SettingsHookEntry = {
    hooks: [{ type: "command", command, timeout: entry.timeoutMs }],
  };
  if (entry.matcher) result.matcher = entry.matcher;
  return result;
}

/**
 * Remove all hook entries under settings.hooks whose command references any
 * known Loom hook file. Used when --replace is set so re-runs cleanly swap
 * stale entries (different prefix, mode, or runner) for fresh ones.
 */
function purgeLoomEntries(settings: Settings): number {
  if (!settings.hooks) return 0;
  const loomNames = Array.from(new Set(LOOM_HOOKS.map((e) => e.hookName)));
  let removed = 0;
  for (const event of Object.keys(settings.hooks) as EventKind[]) {
    const bucket = settings.hooks[event];
    if (!Array.isArray(bucket)) continue;
    const filtered: SettingsHookEntry[] = [];
    for (const item of bucket) {
      if (!item || typeof item !== "object") continue;
      // Filter out individual hook references from the inner array; if no
      // hooks remain, drop the bucket entry entirely. This preserves the
      // unrelated hooks in a mixed entry while purging Loom ones.
      const hooksList = Array.isArray(item.hooks) ? item.hooks : [];
      const keptInner = hooksList.filter((h) => {
        if (!h || typeof h !== "object") return true;
        const cmd = String(h.command ?? "");
        const isLoom = loomNames.some((name) => commandReferencesHook(cmd, name));
        if (isLoom) removed++;
        return !isLoom;
      });
      if (keptInner.length > 0) {
        filtered.push({ ...item, hooks: keptInner });
      }
    }
    if (filtered.length === 0) delete settings.hooks[event];
    else settings.hooks[event] = filtered;
  }
  return removed;
}

/**
 * Inspect `settingsPath` and return true if it contains any registered Loom
 * hook entry. Used by tier resolution to decide whether a tier is "occupied".
 * Returns false if the file is missing, empty, or unparseable — a tier we
 * can't read is treated as not-occupied so re-runs never block on a corrupt
 * sibling file. The unparseable case is also reported back to main() via the
 * caller so it can warn (though we keep tier resolution non-fatal).
 */
function settingsContainsLoomEntries(settingsPath: string): boolean {
  if (!fs.existsSync(settingsPath)) return false;
  let content: string;
  try {
    content = fs.readFileSync(settingsPath, "utf-8").trim();
  } catch {
    return false;
  }
  if (!content) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const hooks = (parsed as { hooks?: unknown }).hooks;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) return false;
  const loomNames = Array.from(new Set(LOOM_HOOKS.map((e) => e.hookName)));
  for (const event of Object.keys(hooks)) {
    const bucket = (hooks as Record<string, unknown>)[event];
    if (!Array.isArray(bucket)) continue;
    for (const item of bucket) {
      if (!item || typeof item !== "object") continue;
      const inner = (item as { hooks?: unknown }).hooks;
      if (!Array.isArray(inner)) continue;
      for (const h of inner) {
        if (!h || typeof h !== "object") continue;
        const cmd = String((h as { command?: unknown }).command ?? "");
        if (loomNames.some((name) => commandReferencesHook(cmd, name))) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Build the canonical pair of settings paths from cwd. The local-tier file is
 * `.claude/settings.local.json` (gitignored, per-user); the project-tier file
 * is `.claude/settings.json` (committed). Both live next to each other.
 */
function tierPaths(cwd: string): { local: string; project: string } {
  const dir = path.join(cwd, ".claude");
  return {
    local: path.join(dir, "settings.local.json"),
    project: path.join(dir, "settings.json"),
  };
}

interface PlanItem {
  hookName: string;
  event: EventKind;
  matcher: string;
  status: "registered" | "skipped:already-present" | "skipped:missing-source" | "would-register";
  detail: string;
}

function main(): void {
  let opts: Options;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Honor --json on parse failures too, so callers that requested
    // structured output still get a parseable error envelope.
    if (process.argv.includes("--json")) {
      process.stdout.write(JSON.stringify({ ok: false, error: msg }) + "\n");
    } else {
      process.stderr.write(`[register-loom-hooks] ${msg}\n`);
    }
    process.exit(1);
  }

  // Tier resolution. Skipped entirely if --settings was passed explicitly:
  // the user told us exactly which file to write, so respect that.
  let resolvedTier: Tier | null = null;
  let tierReason: "explicit" | "preserve" | "default-local" | "n/a" = "n/a";
  if (!opts.settingsPathExplicit) {
    const paths = tierPaths(process.cwd());
    const existingLocal = settingsContainsLoomEntries(paths.local);
    const existingProject = settingsContainsLoomEntries(paths.project);
    const resolution = resolveTier({
      explicitFlag: opts.tier,
      existingLocalEntries: existingLocal,
      existingProjectEntries: existingProject,
    });
    if (!resolution.ok) {
      // MIGRATION_TIER_AMBIGUOUS — refuse to write without explicit --tier.
      const msg =
        `MIGRATION_TIER_AMBIGUOUS: Loom hook entries found in both ` +
        `${paths.project} and ${paths.local}. Re-run with --tier local or ` +
        `--tier project to pick a winner (use --tier project only if you want ` +
        `the entries committed to git).`;
      if (opts.json) {
        process.stdout.write(
          JSON.stringify({
            ok: false,
            error: "MIGRATION_TIER_AMBIGUOUS",
            message: msg,
            existingTiers: resolution.existingTiers,
          }) + "\n"
        );
      } else {
        process.stderr.write(`[register-loom-hooks] ${msg}\n`);
      }
      process.exit(2);
    }
    resolvedTier = resolution.tier;
    tierReason = resolution.reason;
    opts.settingsPath = resolution.tier === "local" ? paths.local : paths.project;

    // Loud-on-stderr notice for the committed tier. Users need to know that
    // `.claude/settings.json` is git-tracked before we shove a 14-hook block
    // into it.
    if (resolution.tier === "project") {
      process.stderr.write(
        `Loom: writing to .claude/settings.json — this file will be committed to git.\n`
      );
    }
  }

  const sourcesPresent = LOOM_HOOKS.filter((e) =>
    fs.existsSync(path.join(opts.hooksRoot, `${e.hookName}.ts`))
  );
  if (sourcesPresent.length === 0) {
    const msg = `No Loom hook source files found under ${opts.hooksRoot}. Cannot register anything.`;
    if (opts.json) {
      process.stdout.write(JSON.stringify({ ok: false, error: msg }) + "\n");
    } else {
      process.stderr.write(`[register-loom-hooks] ${msg}\n`);
    }
    process.exit(1);
  }

  let settings: Settings;
  let existed: boolean;
  try {
    ({ settings, existed } = readSettings(opts.settingsPath));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (opts.json) {
      process.stdout.write(JSON.stringify({ ok: false, error: msg }) + "\n");
    } else {
      process.stderr.write(`[register-loom-hooks] ${msg}\n`);
    }
    process.exit(1);
  }

  // Defensively normalize settings before reading its keys. JSON.parse can
  // yield null, a primitive, or an array if settings.json contains something
  // weird; coerce any of those to an empty object.
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    settings = {};
  }
  if (!settings.hooks || typeof settings.hooks !== "object" || Array.isArray(settings.hooks)) {
    settings.hooks = {};
  }

  const { prefix: commandPrefix, mode: resolvedMode, runner: resolvedRunner } = resolveCommandPrefix(opts);

  // Wrapper runner dispatches all hooks through hooks/run-hook.sh. If it's
  // missing, every registered hook fails at runtime — fail loudly here instead.
  if (resolvedRunner === "wrapper") {
    const wrapperPath = path.join(opts.hooksRoot, "run-hook.sh");
    if (!fs.existsSync(wrapperPath)) {
      const msg = `Wrapper runner selected but ${wrapperPath} is missing. Re-copy templates or pass --runner bunx|npx.`;
      if (opts.json) {
        process.stdout.write(JSON.stringify({ ok: false, error: msg }) + "\n");
      } else {
        process.stderr.write(`[register-loom-hooks] ${msg}\n`);
      }
      process.exit(1);
    }
  }

  let purgedCount = 0;
  if (opts.replace && !opts.dryRun) {
    purgedCount = purgeLoomEntries(settings);
  } else if (opts.replace && opts.dryRun) {
    purgedCount = purgeLoomEntries(
      JSON.parse(JSON.stringify(settings)) as Settings
    );
  }

  const plan: PlanItem[] = [];

  for (const entry of LOOM_HOOKS) {
    const sourceFile = path.join(opts.hooksRoot, `${entry.hookName}.ts`);
    if (!fs.existsSync(sourceFile)) {
      plan.push({
        hookName: entry.hookName,
        event: entry.event,
        matcher: entry.matcher ?? "",
        status: "skipped:missing-source",
        detail: `${sourceFile} not present`,
      });
      continue;
    }
    if (!opts.replace && entryAlreadyPresent(settings, entry, entry.hookName)) {
      plan.push({
        hookName: entry.hookName,
        event: entry.event,
        matcher: entry.matcher ?? "",
        status: "skipped:already-present",
        detail: "matching entry exists in settings.hooks",
      });
      continue;
    }

    const newItem = buildSettingsEntry(entry, commandPrefix);
    if (!opts.dryRun) {
      // settings.hooks is normalized to {} above, so the ! is safe. Guard
      // against a corrupted bucket (non-array) before push.
      if (!Array.isArray(settings.hooks![entry.event])) {
        settings.hooks![entry.event] = [];
      }
      settings.hooks![entry.event]!.push(newItem);
    }
    plan.push({
      hookName: entry.hookName,
      event: entry.event,
      matcher: entry.matcher ?? "",
      status: opts.dryRun ? "would-register" : "registered",
      detail: `matcher=${entry.matcher ?? "(none)"}, timeout=${entry.timeoutMs}, cmd=${newItem.hooks[0].command}`,
    });
  }

  const changes = plan.filter(
    (p) => p.status === "registered" || p.status === "would-register"
  );
  const willWrite = (changes.length > 0 || purgedCount > 0) && !opts.dryRun;
  if (willWrite) {
    try {
      writeAtomic(opts.settingsPath, JSON.stringify(settings, null, 2) + "\n");
    } catch (err) {
      const msg = `Failed to write ${opts.settingsPath}: ${err instanceof Error ? err.message : String(err)}`;
      if (opts.json) {
        process.stdout.write(JSON.stringify({ ok: false, error: msg, plan }) + "\n");
      } else {
        process.stderr.write(`[register-loom-hooks] ${msg}\n`);
      }
      process.exit(1);
    }
  }

  if (opts.json) {
    process.stdout.write(
      JSON.stringify({
        ok: true,
        settingsPath: opts.settingsPath,
        settingsExisted: existed,
        mode: resolvedMode,
        tier: resolvedTier,
        tierReason,
        runner: resolvedRunner,
        commandPrefix,
        dryRun: opts.dryRun,
        changes: changes.length,
        purged: purgedCount,
        plan,
      }) + "\n"
    );
  } else {
    const verb = opts.dryRun ? "would" : "did";
    const tierSuffix = resolvedTier ? `, tier: ${resolvedTier}` : "";
    process.stdout.write(`[register-loom-hooks] ${opts.settingsPath} (mode: ${resolvedMode}, runner: ${resolvedRunner}${tierSuffix})\n`);
    if (purgedCount > 0) {
      process.stdout.write(`  purged ${purgedCount} pre-existing Loom hook reference${purgedCount === 1 ? "" : "s"} (--replace)\n`);
    }
    for (const item of plan) {
      process.stdout.write(`  ${item.event}${item.matcher ? ` ${item.matcher}` : ""} ${item.hookName}: ${item.status} — ${item.detail}\n`);
    }
    process.stdout.write(`[register-loom-hooks] ${verb} register ${changes.length} hook(s).\n`);
  }
  process.exit(0);
}

main();
