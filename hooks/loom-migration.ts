#!/usr/bin/env node
/**
 * SessionStart hook entry point — applies the legacy hook-anchor migration
 * once per session start. Delegates the work to
 * `scripts/lib/migration-runner.ts` so `/loom-doctor --fix` and the hook
 * share a single implementation.
 *
 * Exit codes:
 *   0  — applied / not-needed (always succeed; never block a session start)
 *   0  — refused-ownership-guard (we surface a notice but DO NOT block)
 *
 * Stderr (on outcome=applied):
 *   Loom: applied hook migration to {path}. Run /loom-doctor to review.
 *
 * Stderr (on outcome=refused-ownership-guard):
 *   Loom: migration refused (ownership guard) for {path}. See /loom-doctor.
 */
import { MigrationRunnerImpl } from "../scripts/lib/migration-runner.js";
import type { Channel } from "../scripts/lib/doctor/migration-runner.interface.js";

/**
 * Resolve the install channel from env. The Claude Code plugin runtime
 * sets `CLAUDE_PLUGIN_ROOT`; curl installs do not. Falls back to `curl`.
 */
function resolveChannelFromEnv(env: NodeJS.ProcessEnv = process.env): Channel {
  return env.CLAUDE_PLUGIN_ROOT ? "plugin" : "curl";
}

/**
 * Run the migration and print a user-visible notice when the runner
 * actually rewrote a settings file. Exported for testability — the
 * integration tests import this directly rather than spawning a subprocess.
 */
export async function main(
  opts: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stderr?: { write: (chunk: string) => void };
  } = {}
): Promise<number> {
  const env = opts.env ?? process.env;
  const stderr = opts.stderr ?? process.stderr;
  const runner = new MigrationRunnerImpl({
    cwd: opts.cwd,
    resolveChannel: () => resolveChannelFromEnv(env),
  });
  try {
    const result = await runner.run();
    if (result.outcome === "applied") {
      // The single user-visible notice the plan requires. Emit one line per
      // changed file so multi-file rewrites are not silently merged.
      for (const file of result.changedFiles) {
        stderr.write(
          `Loom: applied hook migration to ${file}. Run /loom-doctor to review.\n`
        );
      }
    } else if (result.outcome === "refused-ownership-guard") {
      stderr.write(
        `Loom: migration refused (ownership guard) for ${result.path}. ` +
          `Run /loom-doctor for details or /loom-doctor --reset-evidence to recover.\n`
      );
    }
    return 0;
  } catch (err) {
    // Never block a session start on a migration error.
    stderr.write(`Loom: migration hook error (non-fatal): ${(err as Error).message}\n`);
    return 0;
  }
}

// Entry-point dispatch when invoked directly (e.g. via run-hook.sh).
// We compare via fileURLToPath to avoid false positives in test runners.
const isDirect =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  /loom-migration(\.ts|\.js|\.cjs)?$/.test(process.argv[1]);

if (isDirect) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`Loom: migration hook fatal: ${(err as Error).message}\n`);
      process.exit(0);
    }
  );
}
