/**
 * Fail-loud logger for hook runtime failures.
 *
 * When `hooks/run-hook.sh` cannot resolve a runtime (no bun, no node, no npx)
 * or a hook script crashes outright, the wrapper itself fails open (exit 0
 * with stderr warning). That keeps Claude Code from getting blocked by
 * infrastructure absence — but it also means failures are silent unless we
 * write them somewhere. This module appends a structured TOON-ish entry to
 * `~/.cache/loom/hook-failures.log` so `/loom-doctor` and the install probe
 * can surface them.
 *
 * Format per line:
 *   ts,hookScriptPath,reason,detail
 *
 * Atomic-append: open with O_APPEND. fs.appendFileSync uses O_APPEND under the
 * hood on POSIX, which is sufficient for single-line entries (writes < PIPE_BUF
 * are atomic). If the cache dir can't be created we swallow — logging is
 * best-effort.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface HookFailureEntry {
  /** Absolute path to the .ts hook script that failed (or attempted to run). */
  hookScriptPath: string;
  /** Short machine-readable reason — e.g. "no-runtime", "hook-crashed", "probe-failed". */
  reason: string;
  /** Optional free-form detail (PATH at failure, exit code, stderr tail). */
  detail?: string;
  /** Optional ISO timestamp override (mostly for tests). */
  timestamp?: string;
}

export interface LoggerOptions {
  /** Override log path. Defaults to `~/.cache/loom/hook-failures.log`. */
  logPath?: string;
  /** Override the home directory (for tests). */
  homedir?: () => string;
}

/** Resolve the default log path under the user's cache dir. */
export function defaultLogPath(homedir: () => string = os.homedir): string {
  return path.join(homedir(), ".cache", "loom", "hook-failures.log");
}

/** Escape commas/newlines so a single entry remains one line. */
function escapeField(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/,/g, "\\,");
}

/**
 * Append a single fail-loud entry. Best-effort: never throws to the caller.
 * Returns true on success, false if the write was swallowed.
 */
export function logHookFailure(
  entry: HookFailureEntry,
  opts: LoggerOptions = {},
): boolean {
  const logPath = opts.logPath ?? defaultLogPath(opts.homedir);
  const ts = entry.timestamp ?? new Date().toISOString();
  const line =
    [
      ts,
      escapeField(entry.hookScriptPath),
      escapeField(entry.reason),
      escapeField(entry.detail ?? ""),
    ].join(",") + "\n";

  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, line, { encoding: "utf8", mode: 0o644 });
    return true;
  } catch {
    return false;
  }
}
