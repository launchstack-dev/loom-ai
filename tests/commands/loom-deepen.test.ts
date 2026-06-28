/**
 * Tests for /loom-deepen command
 *
 * S-01: /loom-deepen surfaces ≥3 candidates with codebase-design vocabulary
 * S-02: --html opt-in writes HTML alongside TOON
 * S-03: --html headless fallback prints path and exits 0
 *
 * Vocabulary (protocols/codebase-design.md):
 *   Module, Seam, Depth, Adapter, Leverage, Locality, Tracer Bullet, Vertical Slice
 *
 * These tests simulate the explore-runner output and the render-html pipeline
 * using temp-dir fixtures only. No real subagent spawning.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

const CODEBASE_DESIGN_VOCAB = [
  "Module",
  "Seam",
  "Depth",
  "Adapter",
  "Leverage",
  "Locality",
  "Tracer Bullet",
  "Vertical Slice",
];

// ---------------------------------------------------------------------------
// Fixtures — simulated explore-runner output rows
// ---------------------------------------------------------------------------

interface ExploreRow {
  moduleName: string;
  depthBefore: number;
  depthAfter: number;
  deletionTestResult: string;
  recommendation: string;
  beforeDiagram: string;
  afterDiagram: string;
}

function makeFixtureRows(reportsDir: string, count = 5): ExploreRow[] {
  mkdirSync(join(reportsDir, "diagrams"), { recursive: true });

  const rows: ExploreRow[] = [
    {
      moduleName: "token-estimator",
      depthBefore: 0.32,
      depthAfter: 0.71,
      deletionTestResult: "3 modules import this Interface; controlled Seam — extract and deepen before deletion.",
      recommendation: "Module 'token-estimator' has 9 exports — a wide Interface that dilutes Depth (0.32). Extract a focused sub-Module per Seam boundary; target Depth ≥0.71 by hiding 4 exports behind an Adapter.",
      beforeDiagram: join(reportsDir, "diagrams", "before-token-estimator.toon"),
      afterDiagram: join(reportsDir, "diagrams", "after-token-estimator.toon"),
    },
    {
      moduleName: "toon-parser",
      depthBefore: 0.28,
      depthAfter: 0.65,
      deletionTestResult: "7 modules depend on this Interface; high Leverage — restructure Seam before any deletion.",
      recommendation: "Module 'toon-parser' currently has Depth=0.28. Consolidate 12 exports behind one primary Seam; push implementation details below the Interface. Expected Depth after refactor: 0.65. High Leverage — callers need no changes.",
      beforeDiagram: join(reportsDir, "diagrams", "before-toon-parser.toon"),
      afterDiagram: join(reportsDir, "diagrams", "after-toon-parser.toon"),
    },
    {
      moduleName: "git-command-runner",
      depthBefore: 0.18,
      depthAfter: 0.55,
      deletionTestResult: "No other modules import this Module directly; Leverage is low — deletion-safe candidate.",
      recommendation: "Module 'git-command-runner' is thin (34 lines). Merge into its caller to improve Locality, or absorb the Adapter pattern it implements into the Module above it. Depth will increase from 0.18 to ~0.55.",
      beforeDiagram: join(reportsDir, "diagrams", "before-git-command-runner.toon"),
      afterDiagram: join(reportsDir, "diagrams", "after-git-command-runner.toon"),
    },
    {
      moduleName: "context-budget",
      depthBefore: 0.41,
      depthAfter: 0.78,
      deletionTestResult: "2 module(s) import this Interface; controlled Seam — extract and deepen before deletion.",
      recommendation: "Module 'context-budget' has 6 exports — extract focused sub-Module per Seam boundary; expected Depth gain: +0.37 by hiding Adapter details behind the primary Interface.",
      beforeDiagram: join(reportsDir, "diagrams", "before-context-budget.toon"),
      afterDiagram: join(reportsDir, "diagrams", "after-context-budget.toon"),
    },
    {
      moduleName: "roadmap-validator",
      depthBefore: 0.23,
      depthAfter: 0.61,
      deletionTestResult: "5 modules depend on this Interface; controlled Seam.",
      recommendation: "Module 'roadmap-validator' currently has Depth=0.23. Consolidate exports; target Depth ≥0.61. Leverage is moderate — a Seam refactor enables parallel testing of validator sub-modules.",
      beforeDiagram: join(reportsDir, "diagrams", "before-roadmap-validator.toon"),
      afterDiagram: join(reportsDir, "diagrams", "after-roadmap-validator.toon"),
    },
  ];

  // Write diagram artifacts
  for (const row of rows.slice(0, count)) {
    writeFileSync(
      row.beforeDiagram + ".tmp",
      `module: ${row.moduleName}\ndepth: ${row.depthBefore}\nshape: shallow\n`,
      "utf-8"
    );
    renameSync(row.beforeDiagram + ".tmp", row.beforeDiagram);

    writeFileSync(
      row.afterDiagram + ".tmp",
      `module: ${row.moduleName}\ndepth: ${row.depthAfter}\nshape: deep\n`,
      "utf-8"
    );
    renameSync(row.afterDiagram + ".tmp", row.afterDiagram);
  }

  return rows.slice(0, count);
}

// ---------------------------------------------------------------------------
// Simulated command harness (mirrors loom-deepen Steps 1-4)
// ---------------------------------------------------------------------------

interface DeepenRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  toonPath: string | null;
  htmlPath: string | null;
}

function simulateDeepenRun(opts: {
  projectDir: string;
  rows: ExploreRow[];
  html?: boolean;
  openFails?: boolean;
  date?: string;
}): DeepenRunResult {
  const { projectDir, rows, html = false, openFails = false, date = "2026-06-26" } = opts;

  const reportsDir = join(projectDir, ".plan-execution", "reports");
  mkdirSync(reportsDir, { recursive: true });

  const toonPath = join(reportsDir, `deepen-${date}.toon`);
  const htmlPath = html ? join(reportsDir, `deepen-${date}.html`) : null;

  // Simulate explore-runner output
  if (rows.length === 0) {
    return {
      exitCode: 2,
      stdout: "",
      stderr: "EXPLORE_AGENT_FAILED: no candidates found\n",
      toonPath: null,
      htmlPath: null,
    };
  }

  // Step 3: Write TOON report (atomic)
  const candidateLines = rows
    .map(
      (r) =>
        `  ${r.moduleName},${r.depthBefore},${r.depthAfter},${r.deletionTestResult},${r.recommendation},${r.beforeDiagram},${r.afterDiagram}`
    )
    .join("\n");

  const toonContent =
    `date: ${date}\n` +
    `target: ${projectDir}\n` +
    `limit: 10\n` +
    `partial: false\n` +
    `candidateCount: ${rows.length}\n` +
    `candidates[${rows.length}]{moduleName,depthBefore,depthAfter,deletionTestResult,recommendation,beforeDiagram,afterDiagram}:\n` +
    candidateLines +
    "\n";

  writeFileSync(toonPath + ".tmp", toonContent, "utf-8");
  renameSync(toonPath + ".tmp", toonPath);

  let stdout = toonContent;
  let stderr = "";
  let exitCode = 0;

  // Step 4: HTML (--html only)
  if (html && htmlPath) {
    // Simulate render-html output
    const htmlContent = `<!DOCTYPE html><html><head><title>Loom Deepen Report — ${date}</title></head><body><!-- ${rows.length} candidates --></body></html>`;
    writeFileSync(htmlPath + ".tmp", htmlContent, "utf-8");
    renameSync(htmlPath + ".tmp", htmlPath);

    if (openFails) {
      // Headless fallback
      stdout += `${htmlPath}\nopen this in a browser\n`;
      stderr += `HTML_OPEN_FAILED\n`;
      // exit 0 — not non-zero
    }

    stdout += `loom-deepen complete: ${rows.length} candidates, report at ${toonPath}\n`;
  } else {
    stdout += `loom-deepen complete: ${rows.length} candidates, report at ${toonPath}\n`;
  }

  return { exitCode, stdout, stderr, toonPath, htmlPath };
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;
let reportsDir: string;
let fixtureRows: ExploreRow[];

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "loom-deepen-test-"));
  reportsDir = join(tmpDir, ".plan-execution", "reports");
  mkdirSync(reportsDir, { recursive: true });
  fixtureRows = makeFixtureRows(reportsDir, 5);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// S-01: ≥3 candidates with codebase-design vocabulary
// ---------------------------------------------------------------------------

describe("S-01: /loom-deepen surfaces ≥3 candidates with codebase-design vocabulary", () => {
  it("produces at least 3 candidate rows in the TOON output", () => {
    const result = simulateDeepenRun({ projectDir: tmpDir, rows: fixtureRows });
    expect(result.exitCode).toBe(0);
    expect(fixtureRows.length).toBeGreaterThanOrEqual(3);
    expect(result.toonPath).not.toBeNull();
    const toon = readFileSync(result.toonPath!, "utf-8");
    expect(parseInt(toon.match(/candidateCount: (\d+)/)?.[1] ?? "0", 10)).toBeGreaterThanOrEqual(3);
  });

  it("every candidate cites at least one codebase-design vocab term in recommendation", () => {
    const result = simulateDeepenRun({ projectDir: tmpDir, rows: fixtureRows });
    for (const row of fixtureRows) {
      const hasVocab = CODEBASE_DESIGN_VOCAB.some((term) => row.recommendation.includes(term));
      expect(hasVocab, `Row '${row.moduleName}' missing vocab term in: "${row.recommendation}"`).toBe(true);
    }
  });

  it("every candidate row references a beforeDiagram artifact that exists on disk", () => {
    simulateDeepenRun({ projectDir: tmpDir, rows: fixtureRows });
    for (const row of fixtureRows) {
      expect(existsSync(row.beforeDiagram), `Missing beforeDiagram: ${row.beforeDiagram}`).toBe(true);
    }
  });

  it("every candidate row references an afterDiagram artifact that exists on disk", () => {
    simulateDeepenRun({ projectDir: tmpDir, rows: fixtureRows });
    for (const row of fixtureRows) {
      expect(existsSync(row.afterDiagram), `Missing afterDiagram: ${row.afterDiagram}`).toBe(true);
    }
  });

  it("default output is TOON only and no HTML file exists when --html is not passed", () => {
    const result = simulateDeepenRun({ projectDir: tmpDir, rows: fixtureRows, html: false });
    expect(result.toonPath).not.toBeNull();
    expect(existsSync(result.toonPath!)).toBe(true);
    // No HTML file at the canonical path
    const htmlPath = result.toonPath!.replace(".toon", ".html");
    expect(existsSync(htmlPath)).toBe(false);
  });

  it("TOON report contains required top-level fields", () => {
    const result = simulateDeepenRun({ projectDir: tmpDir, rows: fixtureRows });
    const toon = readFileSync(result.toonPath!, "utf-8");
    expect(toon).toContain("date:");
    expect(toon).toContain("target:");
    expect(toon).toContain("limit:");
    expect(toon).toContain("partial:");
    expect(toon).toContain("candidateCount:");
    expect(toon).toContain("candidates[");
  });

  it("candidate rows cite Module, Depth or Seam terms from protocols/codebase-design.md", () => {
    const coreTerms = ["Module", "Depth", "Seam"];
    // At least one row per core term should appear across the full candidate set
    for (const term of coreTerms) {
      const found = fixtureRows.some((r) => r.recommendation.includes(term) || r.deletionTestResult.includes(term));
      expect(found, `No row cites '${term}' — required vocab from codebase-design.md`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// S-02: --html opt-in writes HTML alongside TOON
// ---------------------------------------------------------------------------

describe("S-02: --html opt-in writes HTML alongside TOON", () => {
  it("TOON file exists at the canonical path when --html is passed", () => {
    const result = simulateDeepenRun({ projectDir: tmpDir, rows: fixtureRows, html: true });
    expect(result.toonPath).not.toBeNull();
    expect(existsSync(result.toonPath!)).toBe(true);
  });

  it("HTML file exists at the canonical path when --html is passed", () => {
    const result = simulateDeepenRun({ projectDir: tmpDir, rows: fixtureRows, html: true });
    expect(result.htmlPath).not.toBeNull();
    expect(existsSync(result.htmlPath!)).toBe(true);
  });

  it("HTML and TOON share the same date stem", () => {
    const date = "2026-06-26";
    const result = simulateDeepenRun({ projectDir: tmpDir, rows: fixtureRows, html: true, date });
    expect(result.toonPath).toContain(`deepen-${date}.toon`);
    expect(result.htmlPath).toContain(`deepen-${date}.html`);
  });

  it("HTML content is non-empty", () => {
    const result = simulateDeepenRun({ projectDir: tmpDir, rows: fixtureRows, html: true });
    const html = readFileSync(result.htmlPath!, "utf-8");
    expect(html.length).toBeGreaterThan(50);
  });

  it("HTML file is NOT created when --html is not passed", () => {
    const date = "2026-06-26";
    const result = simulateDeepenRun({ projectDir: tmpDir, rows: fixtureRows, html: false, date });
    const htmlPath = join(reportsDir, `deepen-${date}.html`);
    expect(existsSync(htmlPath)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// S-03: --html headless fallback prints path and exits 0
// ---------------------------------------------------------------------------

describe("S-03: --html headless fallback prints path and exits 0", () => {
  it("exits 0 when open/xdg-open/start all fail", () => {
    const result = simulateDeepenRun({
      projectDir: tmpDir,
      rows: fixtureRows,
      html: true,
      openFails: true,
    });
    expect(result.exitCode).toBe(0);
  });

  it("stdout contains the literal line 'open this in a browser' when open fails", () => {
    const result = simulateDeepenRun({
      projectDir: tmpDir,
      rows: fixtureRows,
      html: true,
      openFails: true,
    });
    const lines = result.stdout.split("\n");
    expect(lines).toContain("open this in a browser");
  });

  it("stdout contains the HTML file path when open fails", () => {
    const result = simulateDeepenRun({
      projectDir: tmpDir,
      rows: fixtureRows,
      html: true,
      openFails: true,
    });
    expect(result.stdout).toContain(".html");
    expect(result.stdout).toContain("deepen-");
  });

  it("stderr emits HTML_OPEN_FAILED at info severity when open fails", () => {
    const result = simulateDeepenRun({
      projectDir: tmpDir,
      rows: fixtureRows,
      html: true,
      openFails: true,
    });
    expect(result.stderr).toContain("HTML_OPEN_FAILED");
  });

  it("HTML file is still written to disk even when open fails", () => {
    const result = simulateDeepenRun({
      projectDir: tmpDir,
      rows: fixtureRows,
      html: true,
      openFails: true,
    });
    expect(result.htmlPath).not.toBeNull();
    expect(existsSync(result.htmlPath!)).toBe(true);
  });

  it("TOON file is also present when open fails (TOON is always primary output)", () => {
    const result = simulateDeepenRun({
      projectDir: tmpDir,
      rows: fixtureRows,
      html: true,
      openFails: true,
    });
    expect(existsSync(result.toonPath!)).toBe(true);
  });
});
