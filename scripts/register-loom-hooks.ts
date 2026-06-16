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
 *   node scripts/register-loom-hooks.ts --runner bunx|npx|auto
 *   node scripts/register-loom-hooks.ts --command-prefix <prefix>
 *   node scripts/register-loom-hooks.ts --replace
 *   node scripts/register-loom-hooks.ts --dry-run
 *   node scripts/register-loom-hooks.ts --json
 *
 * Exit codes:
 *   0 — registered (or nothing to do)
 *   1 — settings file unparseable / write failure / no hook .ts files
 */

import * as fs from "node:fs";
import * as path from "node:path";

type EventKind = "SessionStart" | "PreToolUse" | "PostToolUse" | "Stop";

interface HookEntry {
  hookName: string;
  event: EventKind;
  matcher?: string; // omitted/empty for events without a matcher (SessionStart, Stop, "*")
  timeoutMs: number;
}

/**
 * The canonical Loom hook registration manifest. Derived from
 * `.claude/settings.json` in the loom-ai repo (the source of truth for the
 * intended wiring). Event+matcher combinations are preserved exactly.
 *
 * NOTE: `context-monitor` appears twice intentionally — once on PostToolUse
 * for ambient telemetry, once on Stop for the end-of-session snapshot. Both
 * entries are independent and registered separately.
 */
const LOOM_HOOKS: HookEntry[] = [
  // PreToolUse Write|Edit — gating
  { hookName: "contract-lock",       event: "PreToolUse",  matcher: "Write|Edit", timeoutMs: 10000 },
  { hookName: "file-ownership",      event: "PreToolUse",  matcher: "Write|Edit", timeoutMs: 10000 },
  { hookName: "wiki-write-guard",    event: "PreToolUse",  matcher: "Write|Edit", timeoutMs: 10000 },
  // PreToolUse Write|Edit — non-gating (warner)
  { hookName: "wiki-impact-warner",  event: "PreToolUse",  matcher: "Write|Edit", timeoutMs: 3000  },
  // PreToolUse Bash — gating
  { hookName: "deploy-guard",        event: "PreToolUse",  matcher: "Bash",       timeoutMs: 10000 },
  // PreToolUse Agent — preflight
  { hookName: "context-budget",      event: "PreToolUse",  matcher: "Agent",      timeoutMs: 10000 },
  { hookName: "budget-tracker",      event: "PreToolUse",  matcher: "Agent",      timeoutMs: 10000 },
  // PostToolUse Write|Edit — typecheck
  { hookName: "typecheck-on-write",  event: "PostToolUse", matcher: "Write|Edit", timeoutMs: 30000 },
  // PostToolUse Bash — wiki ledger
  { hookName: "wiki-commit-ledger",  event: "PostToolUse", matcher: "Bash",       timeoutMs: 5000  },
  // PostToolUse * — ambient monitors
  { hookName: "context-monitor",     event: "PostToolUse", matcher: "",           timeoutMs: 10000 },
  { hookName: "checkpoint-trigger",  event: "PostToolUse", matcher: "",           timeoutMs: 10000 },
  { hookName: "status-updater",      event: "PostToolUse", matcher: "",           timeoutMs: 10000 },
  // Stop * — gating + end-of-session
  { hookName: "quality-gate",        event: "Stop",        matcher: "",           timeoutMs: 10000 },
  { hookName: "context-monitor",     event: "Stop",        matcher: "",           timeoutMs: 10000 },
  // SessionStart
  { hookName: "wiki-session-status", event: "SessionStart",                       timeoutMs: 5000  },
];

type Mode = "local" | "plugin" | "auto";
type RunnerChoice = "bunx" | "npx" | "auto";

interface Options {
  settingsPath: string;
  hooksRoot: string;
  mode: Mode;
  runner: RunnerChoice;
  commandPrefixOverride: string | null;
  replace: boolean;
  dryRun: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    settingsPath: path.join(process.cwd(), ".claude", "settings.json"),
    hooksRoot: path.resolve(__dirname, "..", "hooks"),
    mode: "auto",
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
    if (a === "--settings") opts.settingsPath = path.resolve(requireValue("--settings", argv[++i]));
    else if (a === "--hooks-root") opts.hooksRoot = path.resolve(requireValue("--hooks-root", argv[++i]));
    else if (a === "--mode") {
      const v = requireValue("--mode", argv[++i]);
      if (v !== "local" && v !== "plugin" && v !== "auto") {
        throw new Error(`--mode must be one of: local, plugin, auto (got "${v}")`);
      }
      opts.mode = v;
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
  const projectRoot =
    path.basename(parent) === ".claude" ? path.dirname(parent) : process.cwd();
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
  if (opts.runner === "auto") {
    const rootPart = effective === "local" ? "" : "${CLAUDE_PLUGIN_ROOT}/";
    return {
      prefix: `sh ${rootPart}hooks/run-hook.sh ${rootPart}`,
      mode: effective,
      runner: "wrapper",
    };
  }

  const runner = opts.runner;
  const runnerPart = runnerPrefix(runner);
  const prefix = effective === "local"
    ? runnerPart
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
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, p);
}

function commandReferencesHook(command: string, scriptName: string): boolean {
  // Match either a standalone "hooks/<name>.ts" (preceded by start/space/quote)
  // or a "${CLAUDE_PLUGIN_ROOT}/hooks/<name>.ts" form. Reject paths like
  // "my-hooks/<name>.ts" or "custom-hooks/<name>.ts" so unrelated user hooks
  // aren't accidentally treated as Loom hooks.
  const re = new RegExp(
    `(^|[\\s"'])(\\$\\{CLAUDE_PLUGIN_ROOT\\}/)?hooks/${scriptName}\\.ts(\\s|$|["'])`
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
    const itemMatcher = item.matcher ?? "";
    const wantMatcher = entry.matcher ?? "";
    if (itemMatcher !== wantMatcher) continue;
    for (const h of item.hooks ?? []) {
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
  const sep = /\$\{CLAUDE_PLUGIN_ROOT\}$|\/$/.test(trimmed) ? "" : " ";
  const pathPart = /\$\{CLAUDE_PLUGIN_ROOT\}$/.test(trimmed)
    ? `/hooks/${entry.hookName}.ts`
    : `hooks/${entry.hookName}.ts`;
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
      // Filter out individual hook references from the inner array; if no
      // hooks remain, drop the bucket entry entirely. This preserves the
      // unrelated hooks in a mixed entry while purging Loom ones.
      const keptInner = (item.hooks ?? []).filter((h) => {
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

interface PlanItem {
  hookName: string;
  event: EventKind;
  matcher: string;
  status: "registered" | "skipped:already-present" | "skipped:missing-source" | "would-register";
  detail: string;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));

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
      // Guard against a corrupted settings.json where settings.hooks[event]
      // is present but not an array — coerce to a fresh array before push.
      if (!Array.isArray(settings.hooks[entry.event])) {
        settings.hooks[entry.event] = [];
      }
      settings.hooks[entry.event]!.push(newItem);
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
    process.stdout.write(`[register-loom-hooks] ${opts.settingsPath} (mode: ${resolvedMode}, runner: ${resolvedRunner})\n`);
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
