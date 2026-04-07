/**
 * Shared hook harness. Handles stdin consumption, error handling, and exit codes.
 * Adopts Hookify's defensive patterns: always exit 0 on errors (fail open).
 */

export interface HookResult {
  /** "allow" lets the operation proceed; "block" denies it (PreToolUse only). */
  decision: "allow" | "block";
  /** Reason shown to the agent when blocked. */
  reason?: string;
  /** Informational message written to stdout (visible to agent as feedback). */
  message?: string;
}

/** Read all of stdin into a string. Handles partial reads safely. */
function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    process.stdin.on("error", reject);

    // If stdin is already ended (piped empty), resolve immediately
    if (process.stdin.readableEnded) {
      resolve(Buffer.concat(chunks).toString("utf-8"));
    }
  });
}

/**
 * Run a hook with full error handling.
 * The handler receives parsed stdin JSON and returns a HookResult.
 * On any error, the hook exits 0 (fail open — never accidentally block).
 */
export async function runHook(
  name: string,
  handler: (input: any) => Promise<HookResult>
): Promise<never> {
  try {
    const raw = await readStdin();
    const input = raw.trim() ? JSON.parse(raw) : {};
    const result = await handler(input);

    if (result.decision === "block") {
      process.stdout.write(
        JSON.stringify({ decision: "block", reason: result.reason ?? "Blocked by loom hook" })
      );
      process.exit(2);
    }

    if (result.message) {
      process.stdout.write(result.message);
    }

    process.exit(0);
  } catch (err) {
    // CRITICAL: errors ALWAYS exit 0 — fail open, never accidentally block
    process.stderr.write(`[loom-hook:${name}] ${err}\n`);
    process.exit(0);
  }
}

/** Convenience: create an allow result. */
export function allow(message?: string): HookResult {
  return { decision: "allow", message };
}

/** Convenience: create a block result. */
export function block(reason: string): HookResult {
  return { decision: "block", reason };
}
