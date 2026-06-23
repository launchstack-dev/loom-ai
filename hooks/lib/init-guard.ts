/**
 * First-invocation init-guard for `/loom-*` commands.
 *
 * Every `/loom-*` command (except `/loom-init` itself) calls
 * {@link assertInitialized} before doing any project-state mutation. The guard
 * has three branches:
 *
 *   1. **Initialized** — `{cwd}/.loom/plugin-root` exists → return immediately.
 *      The command proceeds as normal.
 *   2. **Recently dismissed** — no plugin-root, but
 *      `{cwd}/.loom/dismissed-init-prompt` is present and inside the 24h TTL
 *      → exit silently (no stdout, no mutation). This keeps the prompt from
 *      becoming background noise when the user has chosen not to init yet.
 *   3. **First invocation (or stale dismissal)** — no plugin-root and no
 *      fresh marker → emit the canonical prompt to stdout, write a fresh
 *      dismissal marker so subsequent runs are silent for 24h, and exit 0.
 *
 * The guard never throws and never blocks. It always exits 0 — Loom is
 * advisory at this layer, not gating. The decision to mutate (or not) is the
 * caller's; the guard merely surfaces the prompt and records the dismissal.
 *
 * `/loom-init` itself does NOT call this guard. It performs its own
 * idempotency check (see commands/loom-init.md).
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  isFresh,
  readDismissalMarker,
  writeDismissalMarker,
} from "./dismissal-marker.js";

/** Exact prompt text. Must remain byte-identical — tests assert on it. */
export const INIT_GUARD_PROMPT =
  "Loom is not initialized in this project. Run /loom-init to activate.";

/** Outcome of an `assertInitialized` call — surfaced for callers that want telemetry. */
export type GuardOutcome =
  | { kind: "initialized" }
  | { kind: "dismissed-silent" }
  | { kind: "prompted" };

/** Optional injection seam for tests. */
export interface GuardDeps {
  now?: () => Date;
  fileExists?: (p: string) => boolean;
  stdout?: (line: string) => void;
  readFile?: (p: string) => string;
  writeFile?: (p: string, contents: string) => void;
  rename?: (from: string, to: string) => void;
  mkdir?: (p: string) => void;
}

export interface GuardOptions {
  /** Override the default 24h TTL for the dismissal marker. */
  ttlMs?: number;
}

/**
 * Run the init-guard for a project working directory and return the outcome.
 *
 * Side effects (when not initialized):
 *   - Writes `{cwd}/.loom/dismissed-init-prompt` if no fresh marker exists.
 *   - Emits {@link INIT_GUARD_PROMPT} to stdout if no fresh marker exists.
 *
 * Never throws.
 */
export function assertInitialized(
  cwd: string,
  opts: GuardOptions = {},
  deps: GuardDeps = {}
): GuardOutcome {
  const fileExists = deps.fileExists ?? defaultFileExists;
  const now = deps.now ?? (() => new Date());
  const stdout = deps.stdout ?? defaultStdout;

  const pluginRootPath = path.join(cwd, ".loom", "plugin-root");
  if (fileExists(pluginRootPath)) {
    return { kind: "initialized" };
  }

  const markerPath = path.join(cwd, ".loom", "dismissed-init-prompt");
  const marker = readDismissalMarker(markerPath, deps);
  const nowDate = now();
  if (isFresh(marker, nowDate, opts.ttlMs)) {
    return { kind: "dismissed-silent" };
  }

  stdout(INIT_GUARD_PROMPT);
  try {
    writeDismissalMarker(markerPath, nowDate, deps);
  } catch {
    // Marker write is best-effort. If it fails (e.g., read-only fs) the user
    // will see the prompt again next time — annoying but not broken.
  }
  return { kind: "prompted" };
}

/**
 * CLI entry point for the init-guard. Returns the outcome and the process
 * exit code (always 0 — the guard is advisory).
 *
 * Wrappers (e.g., a `hooks/init-guard.ts` script) call this with `process.cwd()`
 * and then call `process.exit(result.exitCode)`.
 */
export function runInitGuard(
  cwd: string,
  deps: GuardDeps = {}
): { outcome: GuardOutcome; exitCode: 0 } {
  const outcome = assertInitialized(cwd, {}, deps);
  return { outcome, exitCode: 0 };
}

function defaultFileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function defaultStdout(line: string): void {
  process.stdout.write(`${line}\n`);
}
