#!/usr/bin/env bun
/**
 * migrate-context-split.ts — F-18 Phase A content migration
 *
 * Splits a pre-F-18 monolithic CONTEXT.md (which contained both a glossary/
 * tech-stack section AND a "Locked Decisions" section) into two separate files:
 *
 *   CONTEXT.md   — glossary view only (≤50 domain terms + tech stack)
 *   DECISIONS.md — locked decisions section only
 *
 * F-13 walker pattern:
 *   detectContextSplitVersion(content) -> {detected, current, outdated}
 *   migrateContextSplit(content)       -> {contextMd: string, decisionsMd: string}
 *
 * The migrator is PURE (no I/O). The CLI wrapper handles atomic writes.
 *
 * Idempotency: if both CONTEXT.md and DECISIONS.md already exist in the
 * split form (detected as "current"), a second run produces an empty --dry-run
 * diff. The detection is based on the presence of a sentinel comment in
 * CONTEXT.md.
 *
 * Usage:
 *   bun scripts/migrate-context-split.ts <dir>            # migrate in place
 *   bun scripts/migrate-context-split.ts --dry-run <dir>  # print diff, no write
 *   bun scripts/migrate-context-split.ts --help
 *
 * Exit codes:
 *   0  — success (migrated, or already current)
 *   1  — CONTEXT.md not found in <dir>
 *   64 — usage error
 */

import {
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
} from "node:fs";
import { resolve, join } from "node:path";

// ── Pure migrator ──────────────────────────────────────────────────────────

export const CONTEXT_SPLIT_CURRENT_VERSION = 2;

/**
 * Sentinel that marks an already-split CONTEXT.md. Written at the top
 * of the file during migration so idempotency detection is O(1).
 */
const CONTEXT_SENTINEL = "<!-- loom:context-split:v2 -->";

export interface ContextSplitDetectionResult {
  /** 1 = monolithic (pre-F-18), 2 = already split */
  detected: number;
  current: number;
  outdated: boolean;
}

/**
 * Inspect CONTEXT.md content and report its split state.
 * Pre-F-18 files do not contain the sentinel → treated as v1 (monolithic).
 */
export function detectContextSplitVersion(
  contextContent: string,
): ContextSplitDetectionResult {
  const detected = contextContent.includes(CONTEXT_SENTINEL) ? 2 : 1;
  return {
    detected,
    current: CONTEXT_SPLIT_CURRENT_VERSION,
    outdated: detected < CONTEXT_SPLIT_CURRENT_VERSION,
  };
}

export interface MigratedContextSplit {
  contextMd: string;
  decisionsMd: string;
}

/**
 * Split monolithic CONTEXT.md into glossary view + decisions file.
 * Idempotent: if already split (sentinel present), returns the same content.
 *
 * Splitting heuristic:
 *   - Lines up to (but not including) the first `## Locked Decisions` heading
 *     go into CONTEXT.md.
 *   - Lines from `## Locked Decisions` to end go into DECISIONS.md.
 *   - If no `## Locked Decisions` heading is found, all content stays in
 *     CONTEXT.md and DECISIONS.md gets a stub with a pointer.
 */
export function migrateContextSplit(
  contextContent: string,
): MigratedContextSplit {
  const detection = detectContextSplitVersion(contextContent);

  if (!detection.outdated) {
    // Already split — idempotent fast-path. Return content unchanged.
    // DECISIONS.md is managed separately; we can't derive it here without
    // the original file, so return empty string as sentinel that no write
    // is needed. The CLI must detect this and skip the write.
    return { contextMd: contextContent, decisionsMd: "" };
  }

  const lines = contextContent.split(/\r?\n/);

  // Find the "## Locked Decisions" split point (case-insensitive).
  const splitIndex = lines.findIndex((l) =>
    /^##\s+locked\s+decisions/i.test(l),
  );

  let glossaryLines: string[];
  let decisionsLines: string[];

  if (splitIndex === -1) {
    // No decisions section found — all content is glossary.
    glossaryLines = lines;
    decisionsLines = [
      "# Locked Decisions",
      "",
      "_No locked decisions detected in the original CONTEXT.md._",
      "_Run `/loom-wiki ingest` to populate this file from wiki decision pages._",
      "",
    ];
  } else {
    glossaryLines = lines.slice(0, splitIndex);
    decisionsLines = lines.slice(splitIndex);
  }

  // Strip trailing blank lines from glossary section.
  while (glossaryLines.length > 0 && glossaryLines[glossaryLines.length - 1].trim() === "") {
    glossaryLines.pop();
  }

  // Build CONTEXT.md — prepend sentinel so future runs detect split state.
  const contextMd = [
    CONTEXT_SENTINEL,
    "",
    ...glossaryLines,
    "",
  ].join("\n");

  // Build DECISIONS.md — ensure it starts with the H1.
  let decisionsContent: string;
  if (decisionsLines[0].startsWith("## Locked Decisions")) {
    // Promote the H2 to H1 for the standalone file.
    decisionsLines[0] = "# Locked Decisions";
    decisionsContent = [
      "_Maintained by /loom-wiki ingest. Source: CONTEXT.md pre-F-18 split._",
      "_See docs/adr/ for formal ADRs._",
      "",
      ...decisionsLines,
      "",
    ].join("\n");
  } else {
    decisionsContent = decisionsLines.join("\n");
    if (!decisionsContent.endsWith("\n")) decisionsContent += "\n";
  }

  return { contextMd, decisionsMd: decisionsContent };
}

// ── CLI ───────────────────────────────────────────────────────────────────

interface ParsedArgs {
  dryRun: boolean;
  dir: string | null;
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
  return { dryRun, dir: positional[0] ?? null };
}

function printUsage(): void {
  process.stdout.write(
    [
      "Usage: bun scripts/migrate-context-split.ts [--dry-run] <dir>",
      "",
      "  <dir>       Directory containing CONTEXT.md (writes CONTEXT.md + DECISIONS.md)",
      "  --dry-run   Print unified diff to stdout; do not write files",
      "",
    ].join("\n"),
  );
}

/**
 * Minimal unified-diff renderer (no external dep).
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
 * Atomic write: write to .tmp then renameSync.
 */
function atomicWrite(path: string, content: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
}

async function main(): Promise<number> {
  const { dryRun, dir } = parseArgs(process.argv);

  if (!dir) {
    printUsage();
    return 64;
  }

  const absDir = resolve(dir);
  const contextPath = join(absDir, "CONTEXT.md");
  const decisionsPath = join(absDir, "DECISIONS.md");

  if (!existsSync(contextPath)) {
    process.stderr.write(
      `errorCode: CONTEXT_NOT_FOUND\nmessage: CONTEXT.md not found in: ${absDir}\n`,
    );
    return 1;
  }

  const contextBefore = readFileSync(contextPath, "utf8");
  const decisionsBefore = existsSync(decisionsPath)
    ? readFileSync(decisionsPath, "utf8")
    : "";

  const detection = detectContextSplitVersion(contextBefore);

  if (!detection.outdated) {
    // Already split — idempotent no-op.
    if (dryRun) {
      process.stdout.write(`--- CONTEXT.md (unchanged)\n`);
      process.stdout.write(`--- DECISIONS.md (unchanged)\n`);
    }
    return 0;
  }

  const { contextMd, decisionsMd } = migrateContextSplit(contextBefore);

  if (dryRun) {
    process.stdout.write(unifiedDiff(contextBefore, contextMd, "CONTEXT.md"));
    process.stdout.write(
      unifiedDiff(decisionsBefore, decisionsMd, "DECISIONS.md"),
    );
    return 0;
  }

  // Atomic writes.
  atomicWrite(contextPath, contextMd);
  atomicWrite(decisionsPath, decisionsMd);

  process.stdout.write(
    `Migrated: CONTEXT.md → glossary view + DECISIONS.md created\n`,
  );
  return 0;
}

main().then((code) => process.exit(code));
