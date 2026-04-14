/**
 * Test utility: simulate hook invocation by spawning the hook script
 * with JSON on stdin and capturing exit code + output.
 */

import { spawn, execSync } from "node:child_process";
import * as path from "node:path";

/** Detect whether bun is available, fall back to npx. */
const TSX_RUNNER: [string, string[]] = (() => {
  try {
    execSync("bun --version", { stdio: "ignore" });
    return ["bunx", ["tsx"]];
  } catch {
    return ["npx", ["--yes", "tsx"]];
  }
})();

export interface HookRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const HOOKS_DIR = path.resolve(import.meta.dirname, "../..");

/**
 * Run a hook script with the given input piped to stdin.
 * @param hookFile - Relative path from hooks/ dir (e.g., "file-ownership.ts")
 * @param input - Object to JSON-encode and pipe to stdin
 * @param env - Optional extra environment variables
 * @param cwd - Optional working directory (defaults to hooks/)
 */
export function runHook(
  hookFile: string,
  input: object,
  options?: { env?: Record<string, string>; cwd?: string }
): Promise<HookRunResult> {
  return new Promise((resolve) => {
    const hookPath = path.join(HOOKS_DIR, hookFile);
    const child = spawn(TSX_RUNNER[0], [...TSX_RUNNER[1], hookPath], {
      cwd: options?.cwd ?? HOOKS_DIR,
      env: { ...process.env, ...options?.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 0,
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
      });
    });

    child.on("error", () => {
      resolve({ exitCode: 1, stdout: "", stderr: "Failed to spawn hook process" });
    });

    // Write input to stdin and close
    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}

/**
 * Parse the JSON decision from hook stdout, if any.
 */
export function parseDecision(stdout: string): { decision: string; reason?: string } | null {
  try {
    const parsed = JSON.parse(stdout.trim());
    if (parsed && typeof parsed.decision === "string") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
