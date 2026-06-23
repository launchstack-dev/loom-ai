#!/usr/bin/env tsx
/**
 * `/loom-uninstall` CLI entry-point (Phase 14).
 *
 * Inverse of install. Removes:
 *   - `~/.claude/plugins/loom/` (the plugin install dir)
 *   - `~/.loom/`                (per-user Loom state)
 *   - Loom hook entries from project-root `.claude/settings.json` AND
 *     `.claude/settings.local.json` (both tiers — respects Phase 9A2a's
 *     `tier-ambiguous` state by listing both files in the preview).
 *
 * Project state (`.loom/wiki/`, `orchestration.toml`, `.plan-execution/`)
 * is preserved by default. `--purge-project-state` requires the user to
 * type the literal word `uninstall` to confirm.
 *
 * The CLI is a thin shim over `scripts/lib/uninstall/index.ts`: argv
 * parsing + exit-code wiring only. Behavior lives in the orchestrator.
 */

import { runUninstall } from "./lib/uninstall/index.js";

const USAGE = `\
/loom-uninstall [flags]

Remove Loom from this machine. Preserves project state by default.

Flags:
  --purge-project-state   Also remove .loom/wiki/, orchestration.toml, and
                          .plan-execution/. Requires typing the literal word
                          'uninstall' to confirm.
  --dry-run               Print the removal plan and exit 0 without mutation.
  --yes                   Bypass all confirmation prompts (CI use only).
  --help                  Show this help and exit 0.

Exit codes:
  0   Success (or dry-run completed).
  1   Aborted: user declined, typed-literal mismatch, or 60s timeout.
  2   Internal error (argv parse failure, runtime exception).
`;

export interface ParsedArgs {
  purgeProjectState: boolean;
  dryRun: boolean;
  yes: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    purgeProjectState: false,
    dryRun: false,
    yes: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--purge-project-state":
        out.purgeProjectState = true;
        break;
      case "--dry-run":
        out.dryRun = true;
        break;
      case "--yes":
      case "-y":
        out.yes = true;
        break;
      case "--help":
      case "-h":
        out.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${a}`);
    }
  }
  return out;
}

export interface MainDeps {
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  argv?: string[];
}

/**
 * Programmatic entry-point. Returns the exit code; CLI shim below passes it
 * to `process.exit`. Tests call `main` directly and assert on the returned
 * code + captured streams.
 */
export async function main(deps?: MainDeps): Promise<number> {
  const stdout = deps?.stdout ?? process.stdout;
  const stderr = deps?.stderr ?? process.stderr;
  const argv = deps?.argv ?? process.argv.slice(2);

  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stderr.write(`[loom-uninstall] ${msg}\n`);
    stderr.write(USAGE);
    return 2;
  }

  if (args.help) {
    stdout.write(USAGE);
    return 0;
  }

  try {
    const outcome = await runUninstall(
      {
        purgeProjectState: args.purgeProjectState,
        dryRun: args.dryRun,
        yes: args.yes,
      },
      { stdout, stderr }
    );
    return outcome.exitCode;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stderr.write(`[loom-uninstall] internal error: ${msg}\n`);
    return 2;
  }
}

// CLI entrypoint guard: only run when invoked directly (not when imported
// by the test suite). `import.meta.url` is the file URL; argv[1] resolves
// to the absolute script path the user invoked.
const invokedDirectly = (() => {
  try {
    const here = new URL(import.meta.url).pathname;
    const entry = process.argv[1] ?? "";
    return here === entry || here.endsWith(entry) || entry.endsWith("loom-uninstall.ts");
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(
        `[loom-uninstall] fatal: ${err instanceof Error ? err.message : String(err)}\n`
      );
      process.exit(2);
    });
}
