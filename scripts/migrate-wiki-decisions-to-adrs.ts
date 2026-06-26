#!/usr/bin/env bun
/**
 * migrate-wiki-decisions-to-adrs.ts — F-18 Phase A ADR migration
 *
 * Converts every `decision-*.md` wiki page under a given wiki pages directory
 * into a formal ADR at `docs/adr/NNNN-{kebab-title}.md` and rewrites the
 * original wiki page to a stub pointer.
 *
 * Ambiguous pages (multiple H1/H2 "decision" markers, or no extractable single
 * decision title) emit `WIKI_DECISION_MIGRATION_AMBIGUOUS` to stderr and are
 * left UNTOUCHED.
 *
 * F-13 walker pattern:
 *   detectWikiDecisionAmbiguity(content) -> {ambiguous: boolean, reason: string}
 *   migrateWikiDecisionToAdr(content, pageId, adrNumber) -> {adrContent, stubContent}
 *
 * Idempotency: if a wiki page already contains the stub pointer sentinel
 * (`<!-- loom:adr-stub -->`), it is skipped — the corresponding ADR already
 * exists. Second run produces no changes.
 *
 * Usage:
 *   bun scripts/migrate-wiki-decisions-to-adrs.ts <wiki-pages-dir> <adr-dir>
 *   bun scripts/migrate-wiki-decisions-to-adrs.ts --dry-run <wiki-pages-dir> <adr-dir>
 *   bun scripts/migrate-wiki-decisions-to-adrs.ts --help
 *
 * Exit codes:
 *   0  — success (all non-ambiguous pages migrated, or already current)
 *   1  — wiki pages directory not found
 *   64 — usage error
 */

import {
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  readdirSync,
  mkdirSync,
} from "node:fs";
import { resolve, join, basename } from "node:path";

// ── Pure migrator ──────────────────────────────────────────────────────────

/**
 * Sentinel that marks an already-migrated wiki stub page.
 */
const STUB_SENTINEL = "<!-- loom:adr-stub -->";

export interface AmbiguityDetectionResult {
  ambiguous: boolean;
  reason: string;
}

/**
 * Detect whether a wiki decision page is ambiguous (cannot be cleanly
 * converted to a single ADR).
 *
 * Ambiguity criteria:
 *   1. The page contains multiple `## Decision` or `# {Title}` headings at H1
 *      level (after the TOON frontmatter block) — indicates multiple distinct
 *      decisions bundled in one page.
 *   2. The page has no extractable title — no H1 heading after the frontmatter.
 *   3. The page is already a stub (sentinel present) — skip without ambiguity error.
 */
export function detectWikiDecisionAmbiguity(
  content: string,
): AmbiguityDetectionResult {
  // Already migrated — not ambiguous, just skip.
  if (content.includes(STUB_SENTINEL)) {
    return { ambiguous: false, reason: "already-migrated" };
  }

  // Strip TOON frontmatter block (``` toon ... ```).
  const bodyAfterFrontmatter = stripToonFrontmatter(content);

  // Count H1 headings in the body.
  const h1Headings = bodyAfterFrontmatter
    .split(/\r?\n/)
    .filter((l) => /^#\s+/.test(l) && !/^##/.test(l));

  if (h1Headings.length === 0) {
    return {
      ambiguous: true,
      reason: "no-title: no H1 heading found after TOON frontmatter",
    };
  }

  if (h1Headings.length > 1) {
    return {
      ambiguous: true,
      reason: `multiple-decisions: found ${h1Headings.length} H1 headings (${h1Headings.map((h) => h.trim()).join(", ")})`,
    };
  }

  return { ambiguous: false, reason: "" };
}

/**
 * Strip the TOON frontmatter block (``` toon ... ```) from wiki page content.
 * Returns the body after the closing ```.
 */
function stripToonFrontmatter(content: string): string {
  // Match opening ```toon or ``` toon fence (with or without language tag).
  const fenceStart = content.indexOf("```toon");
  if (fenceStart === -1) return content;

  const fenceEnd = content.indexOf("```", fenceStart + 3);
  if (fenceEnd === -1) return content;

  return content.slice(fenceEnd + 3).trim();
}

/**
 * Extract the page title from H1 heading in the body (after frontmatter).
 */
function extractTitle(content: string): string {
  const body = stripToonFrontmatter(content);
  const match = /^#\s+(.+)$/m.exec(body);
  return match ? match[1].trim() : "";
}

/**
 * Extract the `pageId` from TOON frontmatter.
 */
function extractPageId(content: string): string {
  const match = /^pageId:\s*(.+)$/m.exec(content);
  return match ? match[1].trim() : "";
}

/**
 * Extract the `createdAt` timestamp from TOON frontmatter.
 */
function extractCreatedAt(content: string): string {
  const match = /^createdAt:\s*(.+)$/m.exec(content);
  return match ? match[1].trim().slice(0, 10) : "unknown"; // ISO date portion only
}

/**
 * Convert a title to a kebab-case slug for ADR filenames.
 */
export function toKebabCase(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Find the next available ADR number given the current ADR directory contents.
 * Reads existing NNNN-*.md files and returns max+1, minimum 1.
 */
export function nextAdrNumber(adrDir: string): number {
  if (!existsSync(adrDir)) return 1;
  const files = readdirSync(adrDir).filter((f) => /^\d{4}-.+\.md$/.test(f));
  if (files.length === 0) return 1;
  const nums = files.map((f) => parseInt(f.slice(0, 4), 10));
  return Math.max(...nums) + 1;
}

export interface MigratedWikiDecision {
  adrContent: string;
  stubContent: string;
  adrFilename: string;
  adrNumber: number;
}

/**
 * Migrate a single wiki decision page to an ADR + stub pointer.
 * Pure function — no I/O.
 *
 * @param content    Raw wiki page content
 * @param adrNumber  The NNNN number to assign to this ADR
 */
export function migrateWikiDecisionToAdr(
  content: string,
  adrNumber: number,
): MigratedWikiDecision {
  const title = extractTitle(content);
  const pageId = extractPageId(content);
  const createdAt = extractCreatedAt(content);
  const kebab = toKebabCase(title || pageId);
  const nnnn = String(adrNumber).padStart(4, "0");
  const adrFilename = `${nnnn}-${kebab}.md`;

  // Extract the body (after frontmatter) for the ADR content.
  const body = stripToonFrontmatter(content);

  const adrContent = `# ADR-${nnnn}: ${title || pageId}

| Field | Value |
|-------|-------|
| **Number** | ${nnnn} |
| **Title** | ${title || pageId} |
| **Status** | accepted |
| **Date** | ${createdAt} |
| **SupersededBy** | — |

_Migrated from wiki page \`${pageId}\` by \`scripts/migrate-wiki-decisions-to-adrs.ts\`._

${body}
`;

  const stubContent = `${STUB_SENTINEL}
\`\`\`toon
pageId: ${pageId}
category: decision
staleness: migrated
\`\`\`

# ${title || pageId}

> **Migrated to ADR.** This wiki page has been promoted to a formal Architecture Decision Record.
>
> See: [ADR-${nnnn}: ${title || pageId}](../../../docs/adr/${adrFilename})

This stub exists to preserve cross-references. Do not edit — manage the decision at the ADR path above.
`;

  return { adrContent, stubContent, adrFilename, adrNumber };
}

// ── CLI ───────────────────────────────────────────────────────────────────

interface ParsedArgs {
  dryRun: boolean;
  wikiPagesDir: string | null;
  adrDir: string | null;
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
  return {
    dryRun,
    wikiPagesDir: positional[0] ?? null,
    adrDir: positional[1] ?? null,
  };
}

function printUsage(): void {
  process.stdout.write(
    [
      "Usage: bun scripts/migrate-wiki-decisions-to-adrs.ts [--dry-run] <wiki-pages-dir> <adr-dir>",
      "",
      "  <wiki-pages-dir>  Path to .loom/wiki/pages/ (or fixture equivalent)",
      "  <adr-dir>         Path to docs/adr/ (created if absent)",
      "  --dry-run         Print what would happen; do not write files",
      "",
    ].join("\n"),
  );
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
  const { dryRun, wikiPagesDir, adrDir } = parseArgs(process.argv);

  if (!wikiPagesDir || !adrDir) {
    printUsage();
    return 64;
  }

  const absWikiPages = resolve(wikiPagesDir);
  const absAdrDir = resolve(adrDir);

  if (!existsSync(absWikiPages)) {
    process.stderr.write(
      `errorCode: WIKI_PAGES_NOT_FOUND\nmessage: wiki pages directory not found: ${absWikiPages}\n`,
    );
    return 1;
  }

  // Collect all decision-*.md files.
  const allPages = readdirSync(absWikiPages).filter((f) =>
    /^decision-.+\.md$/.test(f),
  );

  if (allPages.length === 0) {
    process.stdout.write(
      `No decision-*.md pages found in ${absWikiPages}. Nothing to migrate.\n`,
    );
    return 0;
  }

  if (!dryRun && !existsSync(absAdrDir)) {
    mkdirSync(absAdrDir, { recursive: true });
  }

  let migrated = 0;
  let skipped = 0;
  let ambiguous = 0;

  // We assign ADR numbers sequentially; track the next number separately
  // from nextAdrNumber() so dry-run and live run are consistent.
  let nextNum = nextAdrNumber(absAdrDir);

  for (const filename of allPages) {
    const pagePath = join(absWikiPages, filename);
    const content = readFileSync(pagePath, "utf8");

    // Already migrated — skip.
    if (content.includes(STUB_SENTINEL)) {
      process.stdout.write(`[skip] ${filename} — already migrated\n`);
      skipped++;
      continue;
    }

    // Check for ambiguity.
    const ambiguityCheck = detectWikiDecisionAmbiguity(content);
    if (ambiguityCheck.ambiguous) {
      process.stderr.write(
        `WIKI_DECISION_MIGRATION_AMBIGUOUS: ${filename} — ${ambiguityCheck.reason}\n`,
      );
      ambiguous++;
      continue;
    }

    // Migrate.
    const result = migrateWikiDecisionToAdr(content, nextNum);
    const adrPath = join(absAdrDir, result.adrFilename);

    if (dryRun) {
      process.stdout.write(
        `[dry-run] Would create: ${adrPath}\n` +
        `[dry-run] Would rewrite stub: ${pagePath}\n`,
      );
    } else {
      atomicWrite(adrPath, result.adrContent);
      atomicWrite(pagePath, result.stubContent);
      process.stdout.write(
        `[migrated] ${filename} → ${result.adrFilename}\n`,
      );
    }

    nextNum++;
    migrated++;
  }

  process.stdout.write(
    `\nSummary: ${migrated} migrated, ${skipped} skipped (already done), ${ambiguous} ambiguous (left untouched)\n`,
  );

  return 0;
}

main().then((code) => process.exit(code));
