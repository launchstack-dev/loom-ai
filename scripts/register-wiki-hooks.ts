#!/usr/bin/env node
/**
 * scripts/register-wiki-hooks.ts — implements `/loom upgrade` Rule 9.
 *
 * Idempotently registers the three wiki hooks (SessionStart wiki-session-status,
 * PreToolUse Write|Edit wiki-impact-warner, PostToolUse Bash wiki-commit-ledger)
 * into .claude/settings.json so legacy Loom projects pick them up.
 *
 * Per-hook file-existence guard: each candidate is registered only if its
 * source file at hooks/<name>.ts exists on disk. Prevents the deployment-window
 * regression where Rule 9 could otherwise register a hook against a missing
 * .ts file.
 *
 * Existing settings.json entries are preserved verbatim — the script only
 * appends missing hook entries, never replaces or reorders. Settings file is
 * written atomically (write to .tmp, then rename).
 *
 * Installation modes (auto-detected by `--mode auto`, override with `--mode`):
 *   plugin — Loom is installed as a Claude Code plugin. Hook entries reference
 *            `${CLAUDE_PLUGIN_ROOT}/hooks/<name>.ts`. Claude Code substitutes
 *            the variable at hook-exec time. Only valid in a plugin's own
 *            settings.json — NOT in a project-local `.claude/settings.json`,
 *            where the variable is not expanded.
 *   local  — Loom is a checkout in the project root. Hook entries reference
 *            `hooks/<name>.ts` (resolved relative to the project root, which
 *            Claude Code sets as cwd for hook execution).
 *   Auto-detect heuristic: `local` if the settings-file's project root
 *   (parent of `.claude/`) contains both `hooks/wiki-session-status.ts` and
 *   `scripts/register-wiki-hooks.ts` (i.e., we ARE the loom dev checkout).
 *   Otherwise `plugin`.
 *
 * Usage:
 *   node scripts/register-wiki-hooks.ts                           # default: .claude/settings.json, auto-detect mode
 *   node scripts/register-wiki-hooks.ts --settings <path>         # explicit path
 *   node scripts/register-wiki-hooks.ts --hooks-root <abs-path>   # override the hooks/ dir (defaults to repo root sibling of this script)
 *   node scripts/register-wiki-hooks.ts --mode local|plugin|auto  # installation mode (default auto)
 *   node scripts/register-wiki-hooks.ts --command-prefix <prefix> # explicit override (skips mode-derived default)
 *   node scripts/register-wiki-hooks.ts --replace                 # remove existing wiki-* hook entries before registering
 *                                                                 # (use when switching prefixes; otherwise dedup leaves stale entries)
 *   node scripts/register-wiki-hooks.ts --dry-run                 # print plan, do not write
 *   node scripts/register-wiki-hooks.ts --json                    # machine-readable report
 *
 * Exit codes:
 *   0 — registered (or nothing to do; all hooks already present or guarded out)
 *   1 — settings file unparseable / write failure / no hook .ts files at all
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

type EventKind = "SessionStart" | "PreToolUse" | "PostToolUse";

interface HookEntry {
  hookName: string;            // wiki-session-status, wiki-impact-warner, wiki-commit-ledger
  event: EventKind;
  matcher?: string;            // omitted for SessionStart
  timeoutMs: number;
}

const REGISTERABLE: HookEntry[] = [
  { hookName: "wiki-session-status", event: "SessionStart",  timeoutMs: 5000 },
  { hookName: "wiki-impact-warner",  event: "PreToolUse",   matcher: "Write|Edit", timeoutMs: 3000 },
  { hookName: "wiki-commit-ledger",  event: "PostToolUse",  matcher: "Bash",       timeoutMs: 5000 },
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
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--settings") opts.settingsPath = path.resolve(argv[++i]);
    else if (a === "--hooks-root") opts.hooksRoot = path.resolve(argv[++i]);
    else if (a === "--mode") {
      const v = argv[++i];
      if (v !== "local" && v !== "plugin" && v !== "auto") {
        throw new Error(`--mode must be one of: local, plugin, auto (got "${v}")`);
      }
      opts.mode = v;
    }
    else if (a === "--runner") {
      const v = argv[++i];
      if (v !== "bunx" && v !== "npx" && v !== "auto") {
        throw new Error(`--runner must be one of: bunx, npx, auto (got "${v}")`);
      }
      opts.runner = v;
    }
    else if (a === "--command-prefix") opts.commandPrefixOverride = argv[++i];
    else if (a === "--replace") opts.replace = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--json") opts.json = true;
  }
  return opts;
}

/**
 * Auto-detect installation mode. "local" when the settings file lives inside
 * the loom dev checkout (i.e., the project root contains both hooks/<name>.ts
 * and scripts/register-wiki-hooks.ts — the unmistakable shape of the loom-ai
 * repo itself). Otherwise "plugin": the user is upgrading some OTHER project
 * that consumes loom as a Claude Code plugin.
 */
function detectMode(settingsPath: string): "local" | "plugin" {
  const projectRoot = path.dirname(path.dirname(path.resolve(settingsPath)));
  const looksLikeLoomCheckout =
    fs.existsSync(path.join(projectRoot, "hooks", "wiki-session-status.ts")) &&
    fs.existsSync(path.join(projectRoot, "scripts", "register-wiki-hooks.ts"));
  return looksLikeLoomCheckout ? "local" : "plugin";
}

/**
 * Detect whether `bunx` is on PATH. Per project convention: prefer bun/bunx
 * when available, fall back to npm/npx otherwise. The choice is baked into
 * the settings.json command string at registration time — if the user later
 * installs bun, they can re-run --register-hooks --replace to swap runners.
 */
function detectRunner(): "bunx" | "npx" {
  try {
    execSync("bunx --version", { stdio: "ignore" });
    return "bunx";
  } catch {
    return "npx";
  }
}

function runnerPrefix(runner: "bunx" | "npx"): string {
  // `npx --yes` so unattended hook execution doesn't prompt to install tsx.
  return runner === "bunx" ? "bunx tsx" : "npx --yes tsx";
}

function resolveCommandPrefix(opts: Options): {
  prefix: string;
  mode: "local" | "plugin" | "explicit";
  runner: "bunx" | "npx" | "explicit";
} {
  if (opts.commandPrefixOverride !== null) {
    return { prefix: opts.commandPrefixOverride, mode: "explicit", runner: "explicit" };
  }
  const effective = opts.mode === "auto" ? detectMode(opts.settingsPath) : opts.mode;
  const runner = opts.runner === "auto" ? detectRunner() : opts.runner;
  const runnerPart = runnerPrefix(runner);
  // local: project-relative path. Claude Code sets cwd to the project root
  // before exec, so `<runner> hooks/<name>.ts` resolves correctly. No machine-
  // specific absolute path; settings.json is portable across clones.
  // plugin: ${CLAUDE_PLUGIN_ROOT} — Claude Code expands at hook-exec time, but
  // ONLY for hooks defined in a plugin's own settings.json. A project-local
  // .claude/settings.json with this prefix will fail to find the .ts files.
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
    return { settings: JSON.parse(fs.readFileSync(p, "utf-8")) as Settings, existed: true };
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

/**
 * Match any command string referencing hooks/<scriptName>.ts whether the path
 * is absolute (`.../hooks/X.ts`), variable-prefixed (`${CLAUDE_PLUGIN_ROOT}/hooks/X.ts`),
 * or project-relative (`hooks/X.ts`). Boundary check ensures `hooks/X.ts` isn't
 * matched as a substring of `other-hooks/X.ts`.
 */
function commandReferencesHook(command: string, scriptName: string): boolean {
  const re = new RegExp(`(^|[\\s/])hooks/${scriptName}\\.ts(\\s|$)`);
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
    // matcher match (treat missing matcher as "" for SessionStart parity)
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
  // Join prefix + hook path. The "/hooks/..." separator works for both
  // `bunx tsx ${CLAUDE_PLUGIN_ROOT}` (plugin) and `bunx tsx` (local: the
  // resulting `bunx tsx /hooks/...` would be wrong, so the local case omits
  // the leading slash by special-casing it here).
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
 * Remove all hook entries under settings.hooks whose command references a
 * loom wiki hook (any of the three) regardless of prefix. Used when --replace
 * is set so that a re-run with a different mode/prefix cleanly swaps entries
 * instead of leaving the previous (broken) version behind.
 */
function purgeLoomWikiEntries(settings: Settings): number {
  if (!settings.hooks) return 0;
  const wikiNames = REGISTERABLE.map((e) => e.hookName);
  let removed = 0;
  for (const event of Object.keys(settings.hooks) as EventKind[]) {
    const bucket = settings.hooks[event];
    if (!Array.isArray(bucket)) continue;
    const filtered = bucket.filter((item) => {
      const hasLoomHook = (item.hooks ?? []).some((h) => {
        const cmd = String(h.command ?? "");
        return wikiNames.some((name) => commandReferencesHook(cmd, name));
      });
      if (hasLoomHook) removed++;
      return !hasLoomHook;
    });
    if (filtered.length === 0) delete settings.hooks[event];
    else settings.hooks[event] = filtered;
  }
  return removed;
}

interface PlanItem {
  hookName: string;
  event: EventKind;
  status: "registered" | "skipped:already-present" | "skipped:missing-source" | "would-register";
  detail: string;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));

  // Validate at least one .ts file exists. If none, exit 1 — running this
  // script on a project that lacks the wiki hook deliverables is a bug.
  const sourcesPresent = REGISTERABLE.filter((e) =>
    fs.existsSync(path.join(opts.hooksRoot, `${e.hookName}.ts`))
  );
  if (sourcesPresent.length === 0) {
    const msg = `No wiki hook source files found under ${opts.hooksRoot}. Cannot register anything.`;
    if (opts.json) {
      process.stdout.write(JSON.stringify({ ok: false, error: msg }) + "\n");
    } else {
      process.stderr.write(`[register-wiki-hooks] ${msg}\n`);
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
      process.stderr.write(`[register-wiki-hooks] ${msg}\n`);
    }
    process.exit(1);
  }

  if (!settings.hooks || typeof settings.hooks !== "object") {
    settings.hooks = {};
  }

  const { prefix: commandPrefix, mode: resolvedMode, runner: resolvedRunner } = resolveCommandPrefix(opts);

  let purgedCount = 0;
  if (opts.replace && !opts.dryRun) {
    purgedCount = purgeLoomWikiEntries(settings);
  } else if (opts.replace && opts.dryRun) {
    // For dry-run, purge a clone so we can report the count without mutating.
    purgedCount = purgeLoomWikiEntries(
      JSON.parse(JSON.stringify(settings)) as Settings
    );
  }

  const plan: PlanItem[] = [];

  for (const entry of REGISTERABLE) {
    const sourceFile = path.join(opts.hooksRoot, `${entry.hookName}.ts`);
    if (!fs.existsSync(sourceFile)) {
      plan.push({
        hookName: entry.hookName,
        event: entry.event,
        status: "skipped:missing-source",
        detail: `${sourceFile} not present`,
      });
      continue;
    }
    if (!opts.replace && entryAlreadyPresent(settings, entry, entry.hookName)) {
      plan.push({
        hookName: entry.hookName,
        event: entry.event,
        status: "skipped:already-present",
        detail: "matching entry exists in settings.hooks",
      });
      continue;
    }

    const newItem = buildSettingsEntry(entry, commandPrefix);
    if (!opts.dryRun) {
      const bucket = (settings.hooks[entry.event] ||= []);
      bucket.push(newItem);
    }
    plan.push({
      hookName: entry.hookName,
      event: entry.event,
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
        process.stderr.write(`[register-wiki-hooks] ${msg}\n`);
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
    process.stdout.write(`[register-wiki-hooks] ${opts.settingsPath} (mode: ${resolvedMode}, runner: ${resolvedRunner})\n`);
    if (purgedCount > 0) {
      process.stdout.write(`  purged ${purgedCount} pre-existing wiki hook entr${purgedCount === 1 ? "y" : "ies"} (--replace)\n`);
    }
    for (const item of plan) {
      process.stdout.write(`  ${item.event} ${item.hookName}: ${item.status} — ${item.detail}\n`);
    }
    process.stdout.write(`[register-wiki-hooks] ${verb} register ${changes.length} hook(s).\n`);
  }
  process.exit(0);
}

main();
