/**
 * scripts/sediment-sweep/no-op-test.ts
 *
 * Full sentence-by-sentence sediment sweep across all SKILL.md files.
 * Implements the "writing-great-skills no-op test":
 *   For each sentence, ask: "If I deleted this sentence, would the skill
 *   still be predictable, leading-word-discoverable, and complete?"
 *   If yes → the sentence is a candidate for retirement.
 *
 * Flags but does NOT delete — operator-approved retirement is a separate step.
 *
 * Usage:
 *   bunx tsx scripts/sediment-sweep/no-op-test.ts --baseline
 *     → Capture body-line baseline across all SKILL.md files.
 *       Writes: planning/history/coverage/sediment-baseline-phase2.toon
 *
 *   bunx tsx scripts/sediment-sweep/no-op-test.ts
 *     → Default sweep mode. Reads baseline, runs no-op test, writes:
 *       planning/history/coverage/sediment-sweep-phase5.toon
 *       Also asserts netRetirementPercent >= 20 (exits 1 if below threshold).
 *
 *   bunx tsx scripts/sediment-sweep/no-op-test.ts --output <path>
 *     → Override sweep output path (sweep mode only).
 *
 *   bunx tsx scripts/sediment-sweep/no-op-test.ts --baseline --output <path>
 *     → Override baseline output path.
 */

import {
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Repo root: two levels up from scripts/sediment-sweep/ */
const REPO_ROOT = join(__dirname, "..", "..");

/** Default output paths */
const BASELINE_PATH = join(
  REPO_ROOT,
  "planning",
  "history",
  "coverage",
  "sediment-baseline-phase2.toon",
);
const SWEEP_PATH = join(
  REPO_ROOT,
  "planning",
  "history",
  "coverage",
  "sediment-sweep-phase5.toon",
);

// ---------------------------------------------------------------------------
// Helpers — file discovery
// ---------------------------------------------------------------------------

function findFiles(dir: string, fileName: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git") continue;
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      results.push(...findFiles(full, fileName));
    } else if (entry === fileName) {
      results.push(full);
    }
  }
  return results;
}

function relPath(absPath: string): string {
  return absPath.startsWith(REPO_ROOT)
    ? absPath.slice(REPO_ROOT.length + 1)
    : absPath;
}

// ---------------------------------------------------------------------------
// Helpers — content analysis
// ---------------------------------------------------------------------------

/**
 * Strips YAML frontmatter (--- ... ---) and returns the body text.
 */
function stripFrontmatter(content: string): string {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") return content;
  const endIdx = lines.indexOf("---", 1);
  if (endIdx === -1) return content;
  return lines.slice(endIdx + 1).join("\n");
}

/**
 * Counts non-empty, non-heading body lines in the given content.
 * Headings are lines whose trimmed form starts with one or more '#' characters.
 */
function countBodyLines(content: string): number {
  const body = stripFrontmatter(content);
  return body
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith("#");
    }).length;
}

// ---------------------------------------------------------------------------
// No-op test heuristics
// ---------------------------------------------------------------------------

/**
 * Sentence-level no-op test patterns.
 * A line is flagged as a retirement candidate if it matches any of these patterns.
 *
 * Patterns target:
 *   1. Restatements of headings  ("This section describes…", "The following section covers…")
 *   2. Redundant filler          ("Note that…", "Please note…", "It is important to note…")
 *   3. Generic disclaimers       ("This may vary…", "Results may differ…", "Your mileage may vary")
 *   4. Transitional filler       ("As mentioned above/below…", "As described earlier…")
 *   5. Empty preamble            ("In this skill, we will…", "This skill explains how to…")
 */
const RETIREMENT_PATTERNS: RegExp[] = [
  // Restatements of headings
  /^(this|the following)\s+(section|part|chapter|skill)\s+(describes?|covers?|explains?|discusses?|outlines?|details?)/i,
  /^in this (section|part|chapter|skill)/i,

  // Redundant filler / generic note markers
  /^(please\s+)?note that\b/i,
  /^it is important to note\b/i,
  /^(be|please be) aware that\b/i,
  /^(keep|please keep) in mind\b/i,

  // Generic disclaimers
  /\byour mileage may vary\b/i,
  /\bresults? may (differ|vary)\b/i,
  /\bthis may vary\b/i,

  // Transitional filler
  /^as (mentioned|described|noted|discussed|explained|outlined) (above|below|earlier|previously|later)\b/i,
  /^(see|refer to) the (section|chapter|note|tip|warning) (above|below)\b/i,

  // Empty preamble / skill intro
  /^(in this skill,?\s*)?(we will|you will|we're going to|you're going to|i will|i'm going to)\b/i,
  /^this skill (explains?|covers?|teaches?|shows?|demonstrates?|walks? you through)/i,
  /^this (guide|document|page|article|tutorial) (explains?|covers?|teaches?|shows?|describes?)/i,

  // Trailing summary restatement
  /^(in summary|to summarize|to recap|in conclusion)[,.]?\s*(we've|we have|you've|you have|this skill has)/i,
];

interface CandidateLine {
  lineNumber: number;
  text: string;
  reason: string;
}

/**
 * Run the no-op test on a single SKILL.md file.
 * Returns the list of candidate lines flagged for retirement.
 */
function runNoOpTest(content: string): CandidateLine[] {
  const body = stripFrontmatter(content);
  const lines = body.split("\n");
  const candidates: CandidateLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;

    for (const pattern of RETIREMENT_PATTERNS) {
      if (pattern.test(trimmed)) {
        candidates.push({
          lineNumber: i + 1,
          text: trimmed.slice(0, 120), // truncate for report
          reason: patternLabel(pattern),
        });
        break; // one reason per line is enough
      }
    }
  }

  return candidates;
}

function patternLabel(pattern: RegExp): string {
  const src = pattern.source;
  if (/this|section|describes/.test(src) && /^this/.test(src)) {
    return "heading-restatement";
  }
  if (/note that|important to note|be aware|keep in mind/.test(src)) {
    return "generic-filler-note";
  }
  if (/mileage|results? may|this may vary/.test(src)) {
    return "generic-disclaimer";
  }
  if (/mentioned|described|refer to/.test(src)) {
    return "transitional-filler";
  }
  if (/we will|you will|this skill/.test(src)) {
    return "empty-preamble";
  }
  if (/in summary|to summarize/.test(src)) {
    return "trailing-summary-restatement";
  }
  return "sediment";
}

// ---------------------------------------------------------------------------
// Baseline mode
// ---------------------------------------------------------------------------

function runBaseline(outputPath: string): void {
  console.log("[sediment-sweep] --baseline: scanning for SKILL.md files...");

  const skillFiles = findFiles(REPO_ROOT, "SKILL.md");

  if (skillFiles.length === 0) {
    console.warn("[sediment-sweep] WARNING: No SKILL.md files found.");
  }

  let totalBodyLines = 0;
  const rows: Array<{ file: string; bodyLineCount: number }> = [];

  for (const filePath of skillFiles) {
    let content: string;
    try {
      content = readFileSync(filePath, "utf8");
    } catch (err) {
      console.warn(`[sediment-sweep] Could not read ${filePath}: ${err}`);
      continue;
    }
    const count = countBodyLines(content);
    totalBodyLines += count;
    rows.push({ file: relPath(filePath), bodyLineCount: count });
    console.log(`  ${relPath(filePath)}: ${count} body lines`);
  }

  console.log(
    `[sediment-sweep] Total body lines across ${rows.length} SKILL.md file(s): ${totalBodyLines}`,
  );

  const outputDir = dirname(outputPath);
  mkdirSync(outputDir, { recursive: true });

  const rowLines = rows.map((r) => `  ${r.file},${r.bodyLineCount}`).join("\n");

  const toonContent = [
    `capturedAt: ${new Date().toISOString()}`,
    `phase: 2b`,
    `description: Non-empty non-heading body lines per SKILL.md file. Used as denominator for Phase 5a/5b ≥20% retirement claim (CT-08).`,
    `totalSkillFiles: ${rows.length}`,
    `totalBodyLines: ${totalBodyLines}`,
    ``,
    `rows[${rows.length}]{file,bodyLineCount}:`,
    rowLines,
  ].join("\n");

  const tmpPath = outputPath + ".tmp";
  writeFileSync(tmpPath, toonContent, "utf8");
  renameSync(tmpPath, outputPath);

  console.log(`[sediment-sweep] Baseline written to: ${outputPath}`);

  if (totalBodyLines === 0) {
    console.error(
      "[sediment-sweep] ERROR: totalBodyLines is 0. Phase 2b EXIT condition requires non-zero body line count.",
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Sweep mode
// ---------------------------------------------------------------------------

interface SweepRow {
  file: string;
  baselineBodyLineCount: number;
  postSweepBodyLineCount: number;
  retiredCount: number;
  retiredPercent: number;
}

/**
 * Parse the baseline TOON to extract {file → bodyLineCount} map.
 */
function readBaseline(
  baselinePath: string,
): { totalBodyLines: number; rows: Record<string, number> } {
  if (!existsSync(baselinePath)) {
    throw new Error(
      `Baseline file not found: ${baselinePath}. Run with --baseline first.`,
    );
  }
  const content = readFileSync(baselinePath, "utf8");
  let totalBodyLines = 0;
  const rows: Record<string, number> = {};
  let inTable = false;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("totalBodyLines:")) {
      totalBodyLines = parseInt(trimmed.split(":")[1].trim(), 10);
    }
    if (trimmed.startsWith("rows[")) {
      inTable = true;
      continue;
    }
    if (inTable && trimmed.length > 0) {
      const commaIdx = trimmed.lastIndexOf(",");
      if (commaIdx === -1) continue;
      const file = trimmed.slice(0, commaIdx).trim();
      const count = parseInt(trimmed.slice(commaIdx + 1).trim(), 10);
      if (!isNaN(count)) rows[file] = count;
    }
  }
  return { totalBodyLines, rows };
}

function runSweep(baselinePath: string, outputPath: string): void {
  console.log("[sediment-sweep] Sweep mode: running no-op test...");

  let baseline: { totalBodyLines: number; rows: Record<string, number> };
  try {
    baseline = readBaseline(baselinePath);
  } catch (err) {
    console.error(`[sediment-sweep] ${err}`);
    process.exit(1);
  }

  console.log(
    `[sediment-sweep] Baseline: ${baseline.totalBodyLines} total body lines across ${Object.keys(baseline.rows).length} file(s).`,
  );

  const skillFiles = findFiles(REPO_ROOT, "SKILL.md");

  const sweepRows: SweepRow[] = [];
  let totalRetiredCount = 0;

  for (const filePath of skillFiles) {
    const rel = relPath(filePath);
    let content: string;
    try {
      content = readFileSync(filePath, "utf8");
    } catch (err) {
      console.warn(`[sediment-sweep] Could not read ${filePath}: ${err}`);
      continue;
    }

    const candidates = runNoOpTest(content);
    const baselineCount = baseline.rows[rel] ?? countBodyLines(content);
    const retiredCount = candidates.length;
    const postSweepBodyLineCount = Math.max(0, baselineCount - retiredCount);
    const retiredPercent =
      baselineCount > 0
        ? Math.round((retiredCount / baselineCount) * 100 * 10) / 10
        : 0;

    totalRetiredCount += retiredCount;

    sweepRows.push({
      file: rel,
      baselineBodyLineCount: baselineCount,
      postSweepBodyLineCount,
      retiredCount,
      retiredPercent,
    });

    console.log(
      `  ${rel}: ${retiredCount}/${baselineCount} candidates flagged (${retiredPercent}%)`,
    );
    for (const c of candidates) {
      console.log(`    line ${c.lineNumber} [${c.reason}]: "${c.text.slice(0, 80)}"`);
    }
  }

  const totalBaselineLines = baseline.totalBodyLines;
  const totalPostSweepLines = Math.max(0, totalBaselineLines - totalRetiredCount);
  const netRetirementPercent =
    totalBaselineLines > 0
      ? Math.round(
          ((totalBaselineLines - totalPostSweepLines) / totalBaselineLines) * 100 * 10,
        ) / 10
      : 0;

  console.log(
    `[sediment-sweep] Net: ${totalRetiredCount} candidates / ${totalBaselineLines} baseline lines = ${netRetirementPercent}% retirement rate.`,
  );

  // Threshold check
  if (netRetirementPercent < 20) {
    console.error(
      `[sediment-sweep] THRESHOLD FAIL: netRetirementPercent ${netRetirementPercent}% < 20% (CT-08). ` +
        `Post-sweep count ${totalPostSweepLines} must be ≤ ${Math.floor(totalBaselineLines * 0.8)} (80% of ${totalBaselineLines}).`,
    );
    // Write report even on threshold failure so the caller can inspect
  } else {
    console.log(
      `[sediment-sweep] THRESHOLD PASS: ${netRetirementPercent}% ≥ 20% (CT-08).`,
    );
  }

  // Serialise TOON
  const rowLines = sweepRows
    .map(
      (r) =>
        `  ${r.file},${r.baselineBodyLineCount},${r.postSweepBodyLineCount},${r.retiredCount},${r.retiredPercent}`,
    )
    .join("\n");

  const toonContent = [
    `capturedAt: ${new Date().toISOString()}`,
    `phase: 5`,
    `baselineFile: ${relPath(baselinePath)}`,
    `totalBaselineBodyLines: ${totalBaselineLines}`,
    `totalPostSweepBodyLines: ${totalPostSweepLines}`,
    `totalRetiredCandidates: ${totalRetiredCount}`,
    `netRetirementPercent: ${netRetirementPercent}`,
    `thresholdRequired: 20`,
    `thresholdPassed: ${netRetirementPercent >= 20}`,
    ``,
    `rows[${sweepRows.length}]{file,baselineBodyLineCount,postSweepBodyLineCount,retiredCount,retiredPercent}:`,
    rowLines,
  ].join("\n");

  mkdirSync(dirname(outputPath), { recursive: true });
  const tmpPath = outputPath + ".tmp";
  writeFileSync(tmpPath, toonContent, "utf8");
  renameSync(tmpPath, outputPath);

  console.log(`[sediment-sweep] Sweep report written to: ${outputPath}`);

  if (netRetirementPercent < 20) {
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);

  const isBaseline = args.includes("--baseline");

  let outputPath: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--output" && args[i + 1]) {
      outputPath = args[++i];
    }
  }

  if (isBaseline) {
    runBaseline(outputPath ?? BASELINE_PATH);
  } else {
    runSweep(BASELINE_PATH, outputPath ?? SWEEP_PATH);
  }
}

main();
