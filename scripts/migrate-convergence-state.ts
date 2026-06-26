#!/usr/bin/env bun
/**
 * CLI wrapper for the convergence-state.toon v1 → v2 migrator.
 *
 * Usage:
 *   bun scripts/migrate-convergence-state.ts <path>             # migrate in place (atomic write)
 *   bun scripts/migrate-convergence-state.ts --dry-run <path>   # print unified diff to stdout, no write
 *   bun scripts/migrate-convergence-state.ts --dry-run < file   # read from stdin when no path supplied
 *
 * Exit codes:
 *   0  — success (migrated, or already current)
 *   3  — MIGRATION_SCHEMA_MISMATCH (file is neither v1 nor v2)
 *   64 — usage error
 */

import { readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  detectConvergenceStateVersion,
  migrateConvergenceStateV1toV2,
} from "./lib/convergence-state-migrator.js";

interface ParsedArgs {
  dryRun: boolean;
  path: string | null;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  let dryRun = false;
  const positional: string[] = [];
  for (const a of args) {
    if (a === "--dry-run") dryRun = true;
    else if (a === "--help" || a === "-h") {
      printUsage();
      process.exit(0);
    } else positional.push(a);
  }
  return { dryRun, path: positional[0] ?? null };
}

function printUsage(): void {
  process.stdout.write(
    [
      "Usage: bun scripts/migrate-convergence-state.ts [--dry-run] <path>",
      "       bun scripts/migrate-convergence-state.ts --dry-run < file",
      "",
    ].join("\n"),
  );
}

/**
 * Minimal unified-diff renderer (no external dep). Compares two strings
 * line-by-line and emits a `--- before / +++ after` block with `+`/`-`
 * markers. Sufficient for human-readable dry-run output.
 */
function unifiedDiff(before: string, after: string, label: string): string {
  if (before === after) return `--- ${label} (unchanged)\n`;
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  const lines: string[] = [`--- ${label} (before)`, `+++ ${label} (after)`];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    const av = a[i];
    const bv = b[i];
    if (av === bv) {
      if (av !== undefined) lines.push(` ${av}`);
    } else {
      if (av !== undefined) lines.push(`-${av}`);
      if (bv !== undefined) lines.push(`+${bv}`);
    }
  }
  return lines.join("\n") + "\n";
}

/**
 * Atomic write per CLAUDE.md convention: write to .tmp, then renameSync.
 */
function atomicWrite(path: string, content: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<number> {
  const { dryRun, path } = parseArgs(process.argv);

  let before: string;
  let label: string;

  if (path) {
    const abs = resolve(path);
    if (!existsSync(abs)) {
      process.stderr.write(`errorCode: USAGE\nmessage: file not found: ${abs}\n`);
      return 64;
    }
    before = readFileSync(abs, "utf8");
    label = abs;
  } else if (dryRun) {
    before = await readStdin();
    label = "<stdin>";
  } else {
    printUsage();
    return 64;
  }

  let after: string;
  try {
    after = migrateConvergenceStateV1toV2(before);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `errorCode: MIGRATION_SCHEMA_MISMATCH\nmessage: ${message}\n`,
    );
    return 3;
  }

  // Confirm post-migration the document is current and not outdated.
  const post = detectConvergenceStateVersion(after);
  if (post.outdated) {
    process.stderr.write(
      `errorCode: MIGRATION_SCHEMA_MISMATCH\nmessage: migrator produced non-current document (detected=${post.detected}, current=${post.current})\n`,
    );
    return 3;
  }

  if (dryRun) {
    process.stdout.write(unifiedDiff(before, after, label));
    return 0;
  }

  if (path && before !== after) {
    atomicWrite(resolve(path), after);
  }
  return 0;
}

main().then((code) => process.exit(code));
