#!/usr/bin/env tsx
/**
 * `/loom-doctor` CLI entry-point (Phase 9A1).
 *
 * Surface only — checks live in `scripts/lib/doctor/checks/*` (Phase 9A2),
 * and the migration runner lives at `scripts/lib/migration-runner.ts` (Phase
 * 9B). Both ship in parallel; this entry compiles and tests cleanly without
 * either present.
 *
 * Flag dispatch:
 *   --json                       → render JSON, suppress text
 *   --quiet                      → drop `pass` lines from text output
 *   --output-file <path>         → write report to file; stderr keeps progress
 *   --only <id>                  → run a single check
 *   --reconcile [--yes]          → MigrationRunner.reconcile(); confirm-gated
 *   --reset-evidence <check-id>  → MigrationRunner.resetEvidence(id)
 *   --fix                        → MigrationRunner.run()
 *   --bundle                     → createBundle() — redacted tarball
 *   --help                       → print usage, exit 0
 *
 * Exit codes mirror the DoctorReport schema: 0 = clean, 1 = warn/fail,
 * 2 = dispatcher / runtime error.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { runChecks } from "./lib/doctor/index.js";
import { renderJSON, renderText } from "./lib/doctor/render.js";
import { createBundle } from "./lib/doctor/bundle.js";
import type {
  Channel,
  MigrationRunner,
} from "./lib/doctor/migration-runner.interface.js";

const VERSION = "0.0.0";

const USAGE = `\
/loom-doctor [flags]

Diagnose Loom install health: channel, hook-wiring, settings, tier.

Flags:
  --json                       Emit raw DoctorReport JSON (schemaVersion=1)
  --quiet                      Suppress per-check pass lines (warn/fail only)
  --output-file <path>         Redirect report to file; stderr keeps progress
  --only <id>                  Run only the named check (registry id)
  --reconcile                  Reconcile install channel (requires confirmation)
  --reset-evidence <check-id>  Clear cached evidence for one check
  --fix                        Apply remediation via MigrationRunner.run()
  --bundle                     Package a redacted diagnostic tarball
  --yes                        Skip confirmation prompts
  --help                       Show this help and exit 0
`;

// ---------------------------------------------------------------------------
// Argv parsing
// ---------------------------------------------------------------------------

export interface ParsedArgs {
  json: boolean;
  quiet: boolean;
  outputFile?: string;
  only?: string;
  reconcile: boolean;
  resetEvidence?: string;
  fix: boolean;
  bundle: boolean;
  yes: boolean;
  help: boolean;
  /** Parse error (when set, the caller prints USAGE and exits non-zero). */
  error?: string;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    json: false,
    quiet: false,
    reconcile: false,
    fix: false,
    bundle: false,
    yes: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i];
    switch (tok) {
      case "--json":
        out.json = true;
        break;
      case "--quiet":
        out.quiet = true;
        break;
      case "--reconcile":
        out.reconcile = true;
        break;
      case "--fix":
        out.fix = true;
        break;
      case "--bundle":
        out.bundle = true;
        break;
      case "--yes":
        out.yes = true;
        break;
      case "--help":
      case "-h":
        out.help = true;
        break;
      case "--output-file":
        out.outputFile = argv[++i];
        if (!out.outputFile) out.error = "--output-file requires a path";
        break;
      case "--only":
        out.only = argv[++i];
        if (!out.only) out.error = "--only requires a check id";
        break;
      case "--reset-evidence":
        out.resetEvidence = argv[++i];
        if (!out.resetEvidence)
          out.error = "--reset-evidence requires a check id";
        break;
      default:
        out.error = `Unknown flag: ${tok}`;
        return out;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Runtime dependency seam
//
// `--fix`, `--reconcile`, `--reset-evidence` consume a MigrationRunner. The
// concrete implementation ships in Phase 9B; tests inject a mock via the
// `MainDeps.loadMigrationRunner` hook. At wave-merge time the production
// loader resolves to `import('./lib/migration-runner.js')`.
// ---------------------------------------------------------------------------

export interface MainDeps {
  argv?: string[];
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  stdin?: NodeJS.ReadableStream & { isTTY?: boolean };
  isTTY?: boolean;
  now?: () => Date;
  /** Returns the production-mode MigrationRunner (or throws if unavailable). */
  loadMigrationRunner?: () => Promise<MigrationRunner>;
  /** Confirmation prompt (only used when reconcile lacks `--yes`). */
  confirm?: (prompt: string) => Promise<boolean>;
  /** Discovery overrides — forwarded to the dispatcher. */
  discovery?: Parameters<typeof runChecks>[0]["discovery"];
  /** Channel/tier overrides (Phase 9B owns real detection). */
  installSource?: "plugin" | "curl" | "unknown";
  tier?: "local" | "project" | "mixed";
  version?: string;
}

async function defaultLoadMigrationRunner(): Promise<MigrationRunner> {
  // Loaded at runtime so the surface compiles without Phase 9B present. When
  // 9B lands, `scripts/lib/migration-runner.js` exports `migrationRunner`.
  const mod = (await import("./lib/migration-runner.js" as string)) as {
    migrationRunner?: MigrationRunner;
    default?: MigrationRunner;
  };
  const runner = mod.migrationRunner ?? mod.default;
  if (!runner) {
    throw new Error(
      "MigrationRunner unavailable: scripts/lib/migration-runner.ts has no `migrationRunner` export.",
    );
  }
  return runner;
}

async function defaultConfirm(prompt: string): Promise<boolean> {
  process.stderr.write(prompt);
  return new Promise<boolean>((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk as Buffer));
    process.stdin.on("end", () => {
      const answer = Buffer.concat(chunks).toString().trim().toLowerCase();
      resolve(answer === "y" || answer === "yes");
    });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function main(deps: MainDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const argv = deps.argv ?? process.argv.slice(2);
  const isTTY = deps.isTTY ?? Boolean(process.stdout.isTTY);
  const now = deps.now ?? (() => new Date());
  const version = deps.version ?? VERSION;

  const args = parseArgs(argv);

  if (args.error) {
    stderr.write(`${args.error}\n\n${USAGE}`);
    return 2;
  }
  if (args.help) {
    stdout.write(USAGE);
    return 0;
  }

  const loadMigrationRunner =
    deps.loadMigrationRunner ?? defaultLoadMigrationRunner;
  const confirm = deps.confirm ?? defaultConfirm;

  // --reset-evidence — delegate, no checks needed.
  if (args.resetEvidence) {
    try {
      const runner = await loadMigrationRunner();
      await runner.resetEvidence(args.resetEvidence);
      stderr.write(`Evidence cleared for check: ${args.resetEvidence}\n`);
      return 0;
    } catch (err) {
      stderr.write(`reset-evidence failed: ${(err as Error).message}\n`);
      return 2;
    }
  }

  // --reconcile — confirm-gated unless --yes.
  if (args.reconcile) {
    if (!args.yes) {
      const ok = await confirm(
        "Reconcile install channel? This rewrites settings on disk. [y/N] ",
      );
      if (!ok) {
        stderr.write("Reconcile aborted.\n");
        return 1;
      }
    }
    try {
      const runner = await loadMigrationRunner();
      const channel: Channel =
        (deps.installSource as Channel | undefined) === "curl"
          ? "curl"
          : "plugin";
      await runner.reconcile(channel);
      stderr.write(`Reconciled to channel: ${channel}\n`);
      return 0;
    } catch (err) {
      stderr.write(`Reconcile failed: ${(err as Error).message}\n`);
      return 2;
    }
  }

  // --fix — delegate the heavy lift to MigrationRunner.run().
  if (args.fix) {
    try {
      const runner = await loadMigrationRunner();
      await runner.run();
      stderr.write("Migration completed.\n");
      return 0;
    } catch (err) {
      stderr.write(`Fix failed: ${(err as Error).message}\n`);
      return 2;
    }
  }

  // Default path: run checks and render.
  let report;
  try {
    report = await runChecks({
      state: undefined,
      only: args.only,
      discovery: deps.discovery,
      now,
      installSource: deps.installSource ?? "unknown",
      tier: deps.tier ?? "project",
    });
  } catch (err) {
    stderr.write(`Doctor failed: ${(err as Error).message}\n`);
    return 2;
  }

  const text = args.json
    ? renderJSON(report)
    : renderText(report, { isTTY, quiet: args.quiet, version });

  if (args.outputFile) {
    const dir = path.dirname(args.outputFile);
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(args.outputFile + ".tmp", text);
    fs.renameSync(args.outputFile + ".tmp", args.outputFile);
    stderr.write(`Wrote doctor report to ${args.outputFile}\n`);
  } else {
    stdout.write(text);
  }

  if (args.bundle) {
    try {
      const { tarball } = createBundle({ report, version, now });
      stderr.write(`Bundle: ${tarball}\n`);
    } catch (err) {
      stderr.write(`Bundle failed: ${(err as Error).message}\n`);
      return 2;
    }
  }

  return report.exitCode;
}

// ---------------------------------------------------------------------------
// Entry-point guard
// ---------------------------------------------------------------------------

const isEntry =
  // @ts-expect-error Bun-specific import.meta.main
  import.meta.main === true ||
  import.meta.url === `file://${process.argv[1]}`;

if (isEntry) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`Internal error: ${(err as Error).stack}\n`);
      process.exit(2);
    },
  );
}
