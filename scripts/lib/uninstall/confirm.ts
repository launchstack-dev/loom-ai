/**
 * scripts/lib/uninstall/confirm.ts — interactive confirmation helpers for
 * `/loom-uninstall`. Two prompt flavors:
 *
 *   1. `confirmBase` — single-character `y`/`Y` confirmation with a 60s
 *      countdown timer rendered to stderr (tick once per second). Any other
 *      input or timeout returns `{ accepted: false, reason }`. The caller
 *      maps `accepted: false` to exit code 1.
 *
 *   2. `confirmTypedLiteral` — typed-literal confirmation. The user MUST
 *      type the exact literal (default `uninstall`) followed by EOL. Any
 *      deviation (case mismatch, surrounding whitespace beyond a trailing
 *      newline, alternative word) rejects.
 *
 * Both helpers are dependency-injected for fs/stdin/now/setTimeout so the
 * 60s timeout can be exercised in tests without actually waiting.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ConfirmDeps {
  /** Readable stream supplying the user's input. Defaults to `process.stdin`. */
  stdin?: NodeJS.ReadableStream;
  /** Writable stream for the prompt copy and countdown ticks. Defaults to `process.stderr`. */
  stderr?: NodeJS.WritableStream;
  /** `setTimeout` shim. Defaults to the global. Tests inject a controllable scheduler. */
  setTimeout?: (cb: () => void, ms: number) => any;
  /** `clearTimeout` shim matching the `setTimeout` shim. */
  clearTimeout?: (handle: any) => void;
  /** `setInterval` shim used to drive the countdown tick. */
  setInterval?: (cb: () => void, ms: number) => any;
  /** `clearInterval` shim matching the `setInterval` shim. */
  clearInterval?: (handle: any) => void;
}

export type ConfirmResult =
  | { accepted: true }
  | { accepted: false; reason: "rejected" | "timeout" | "stream-closed" };

const TIMEOUT_MS = 60_000;
const TICK_MS = 1_000;

function defaults(deps: ConfirmDeps | undefined): Required<ConfirmDeps> {
  return {
    stdin: deps?.stdin ?? process.stdin,
    stderr: deps?.stderr ?? process.stderr,
    setTimeout: deps?.setTimeout ?? ((cb, ms) => setTimeout(cb, ms)),
    clearTimeout: deps?.clearTimeout ?? ((h) => clearTimeout(h)),
    setInterval: deps?.setInterval ?? ((cb, ms) => setInterval(cb, ms)),
    clearInterval: deps?.clearInterval ?? ((h) => clearInterval(h)),
  };
}

/**
 * Read a single line from the stream. Resolves on first newline; the line
 * is returned WITHOUT the trailing CR/LF. If the stream ends without a
 * newline, the buffered partial line is returned. If the stream errors,
 * the promise rejects.
 */
function readLine(
  stdin: NodeJS.ReadableStream
): { promise: Promise<string | null>; cancel: () => void } {
  let buf = "";
  let settled = false;
  let resolve!: (v: string | null) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<string | null>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const onData = (chunk: Buffer | string) => {
    if (settled) return;
    buf += typeof chunk === "string" ? chunk : chunk.toString("utf-8");
    const nl = buf.indexOf("\n");
    if (nl >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, "");
      cleanup();
      settled = true;
      resolve(line);
    }
  };
  const onEnd = () => {
    if (settled) return;
    cleanup();
    settled = true;
    // No newline ever arrived. Return null to signal stream-closed; callers
    // treat that as a rejection (no input gathered).
    resolve(buf.length === 0 ? null : buf.replace(/\r$/, ""));
  };
  const onError = (err: Error) => {
    if (settled) return;
    cleanup();
    settled = true;
    reject(err);
  };
  const cleanup = () => {
    stdin.off?.("data", onData);
    stdin.off?.("end", onEnd);
    stdin.off?.("error", onError);
  };
  stdin.on("data", onData);
  stdin.on("end", onEnd);
  stdin.on("error", onError);
  // Ensure data events flow if the stream is paused. resume() is a no-op on
  // streams that don't support it; the optional-chain guards mock streams.
  (stdin as any).resume?.();
  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(null);
    },
  };
}

/**
 * Base prompt: ask `y/n` with a 60-second countdown. Only `y` or `Y`
 * accepts. Any other input rejects. Timeout rejects with reason `timeout`
 * (caller emits `Confirmation timed out after 60s; no changes made.` to
 * stderr before exit).
 */
export async function confirmBase(deps?: ConfirmDeps): Promise<ConfirmResult> {
  const d = defaults(deps);
  // Initial prompt copy is the responsibility of the orchestrator (it builds
  // the full removal plan). We only render the countdown ticker here so the
  // ticker doesn't interleave with the plan listing.
  let remaining = TIMEOUT_MS / TICK_MS;
  let timedOut = false;
  let tickHandle: any = null;
  let timeoutHandle: any = null;

  const writeTick = (label: string) => {
    try {
      d.stderr.write(label);
    } catch {
      // stderr can be closed mid-test; ignore.
    }
  };

  writeTick(`(${remaining}s) `);
  tickHandle = d.setInterval(() => {
    remaining -= 1;
    if (remaining > 0) writeTick(`(${remaining}s) `);
  }, TICK_MS);

  const { promise, cancel } = readLine(d.stdin);

  timeoutHandle = d.setTimeout(() => {
    timedOut = true;
    cancel();
  }, TIMEOUT_MS);

  let line: string | null;
  try {
    line = await promise;
  } catch {
    line = null;
  } finally {
    if (tickHandle) d.clearInterval(tickHandle);
    if (timeoutHandle) d.clearTimeout(timeoutHandle);
  }

  if (timedOut) return { accepted: false, reason: "timeout" };
  if (line === null) return { accepted: false, reason: "stream-closed" };
  const trimmed = line.trim();
  if (trimmed === "y" || trimmed === "Y") return { accepted: true };
  return { accepted: false, reason: "rejected" };
}

/**
 * Typed-literal prompt: user must type the exact literal (default
 * `uninstall`) and press Enter. Whitespace is trimmed before comparison.
 * Case-sensitive: `Uninstall`, `UNINSTALL`, etc. all reject.
 */
export async function confirmTypedLiteral(
  literal: string = "uninstall",
  deps?: ConfirmDeps
): Promise<ConfirmResult> {
  const d = defaults(deps);
  const { promise } = readLine(d.stdin);
  let line: string | null;
  try {
    line = await promise;
  } catch {
    line = null;
  }
  if (line === null) return { accepted: false, reason: "stream-closed" };
  if (line.trim() === literal) return { accepted: true };
  return { accepted: false, reason: "rejected" };
}
