/**
 * HookFailureLogEntry — one row in `~/.cache/loom/hook-failures.log`.
 *
 * Append-only log written by `hooks/run-hook.sh` when the runtime probe
 * cannot locate a usable interpreter (F-15). Rotated when file exceeds 1MB.
 * Consumed by `/loom-doctor` F-04 `hooks` category red check.
 *
 * Schema reference: protocols/hook-failure-log.schema.md
 */

/** Runtime the wrapper attempted before giving up. */
export type RuntimeAttempted = 'bun' | 'npx-tsx' | 'node' | 'none';

export interface HookFailureLogEntry {
  /** ISO 8601 / RFC 3339 datetime the failure was recorded. */
  timestamp: string;
  /** Hook lifecycle name (e.g. `PreToolUse`). */
  hookName: string;
  /**
   * Absolute path to the `.ts` file the wrapper tried to invoke.
   * Phase 2 acceptance asserts on this field.
   */
  hookScriptPath: string;
  /** Full PATH environment variable at the time of the probe. */
  pathAtProbe: string;
  /** Which runtime the wrapper attempted. */
  runtimeAttempted: RuntimeAttempted;
}
