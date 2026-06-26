/**
 * scripts/loom-deepen/render-html.ts
 *
 * Opt-in HTML renderer for /loom-deepen.
 * Reads the canonical TOON report and emits a self-contained HTML file.
 *
 * Usage:
 *   bunx tsx scripts/loom-deepen/render-html.ts --input <toon-path> --output <html-path>
 *
 * Design constraints:
 *   - Plain template string — NO framework imports (React, Vue, etc.)
 *   - No external CSS or JS dependencies — self-contained single file
 *   - TOON is parsed with a minimal line-by-line reader (no schema library)
 */

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { input: string; output: string } {
  let input = "";
  let output = "";

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input" && argv[i + 1]) {
      input = argv[++i];
    } else if (argv[i] === "--output" && argv[i + 1]) {
      output = argv[++i];
    }
  }

  if (!input) {
    process.stderr.write("render-html: --input <path> is required\n");
    process.exit(1);
  }
  if (!output) {
    process.stderr.write("render-html: --output <path> is required\n");
    process.exit(1);
  }

  return { input: path.resolve(input), output: path.resolve(output) };
}

// ---------------------------------------------------------------------------
// Minimal TOON reader
// ---------------------------------------------------------------------------

interface DeepenReport {
  date: string;
  target: string;
  limit: number;
  partial: boolean;
  candidateCount: number;
  candidates: Array<{
    moduleName: string;
    depthBefore: number;
    depthAfter: number;
    deletionTestResult: string;
    recommendation: string;
    beforeDiagram: string;
    afterDiagram: string;
  }>;
}

function parseToonReport(content: string): DeepenReport {
  const lines = content.split("\n");
  const report: DeepenReport = {
    date: "",
    target: "",
    limit: 10,
    partial: false,
    candidateCount: 0,
    candidates: [],
  };

  let inCandidatesTable = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("date:")) {
      report.date = trimmed.replace(/^date:\s*/, "").trim();
    } else if (trimmed.startsWith("target:")) {
      report.target = trimmed.replace(/^target:\s*/, "").trim();
    } else if (trimmed.startsWith("limit:")) {
      report.limit = parseInt(trimmed.replace(/^limit:\s*/, ""), 10) || 10;
    } else if (trimmed.startsWith("partial:")) {
      report.partial = trimmed.includes("true");
    } else if (trimmed.startsWith("candidateCount:")) {
      report.candidateCount = parseInt(trimmed.replace(/^candidateCount:\s*/, ""), 10) || 0;
    } else if (trimmed.startsWith("candidates[")) {
      inCandidatesTable = true;
    } else if (inCandidatesTable && trimmed && !trimmed.startsWith("candidates")) {
      // Parse CSV row: moduleName,depthBefore,depthAfter,deletionTestResult,recommendation,beforeDiagram,afterDiagram
      // Split on first 6 commas only (values may contain commas after the 6th column)
      const parts = trimmed.split(",");
      if (parts.length >= 7) {
        report.candidates.push({
          moduleName: parts[0].trim(),
          depthBefore: parseFloat(parts[1]) || 0,
          depthAfter: parseFloat(parts[2]) || 0,
          deletionTestResult: parts[3].trim(),
          recommendation: parts.slice(4, parts.length - 2).join(",").trim(),
          beforeDiagram: parts[parts.length - 2].trim(),
          afterDiagram: parts[parts.length - 1].trim(),
        });
      }
    }
  }

  return report;
}

// ---------------------------------------------------------------------------
// Depth bar renderer (ASCII → HTML progress bar)
// ---------------------------------------------------------------------------

function depthBar(value: number): string {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const color = pct < 40 ? "#e74c3c" : pct < 65 ? "#f39c12" : "#27ae60";
  return `<div class="depth-bar" style="width:100%;background:#eee;border-radius:4px;height:12px;">
    <div style="width:${pct}%;background:${color};border-radius:4px;height:12px;" title="${value.toFixed(3)}"></div>
  </div><small>${pct}%</small>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// HTML template (plain string — no framework)
// ---------------------------------------------------------------------------

function renderHtml(report: DeepenReport): string {
  const candidateRows = report.candidates
    .map(
      (c, i) => `
    <tr class="${i % 2 === 0 ? "even" : "odd"}">
      <td><code>${escapeHtml(c.moduleName)}</code></td>
      <td>${depthBar(c.depthBefore)}</td>
      <td>${depthBar(c.depthAfter)}</td>
      <td><small>${escapeHtml(c.deletionTestResult)}</small></td>
      <td><small>${escapeHtml(c.recommendation)}</small></td>
    </tr>`
    )
    .join("\n");

  const partialBanner = report.partial
    ? `<div class="banner warn">⚠ Partial report — one or more Explore subagents failed (EXPLORE_AGENT_FAILED). Showing available results only.</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Loom Deepen Report — ${escapeHtml(report.date)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
      margin: 0; padding: 24px;
      background: #f9f9f9; color: #222;
    }
    h1 { font-size: 1.4rem; margin-bottom: 4px; }
    .meta { color: #666; font-size: 0.85rem; margin-bottom: 16px; }
    .banner { padding: 10px 14px; border-radius: 4px; margin-bottom: 16px; font-size: 0.9rem; }
    .banner.warn { background: #fff3cd; border-left: 4px solid #f39c12; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 6px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.1); }
    th { background: #2c3e50; color: #fff; padding: 10px 14px; text-align: left; font-size: 0.85rem; }
    td { padding: 10px 14px; border-bottom: 1px solid #eee; vertical-align: top; font-size: 0.85rem; }
    tr.even td { background: #fafafa; }
    .depth-bar { display: inline-block; width: 80px; vertical-align: middle; margin-right: 6px; }
    code { background: #f0f0f0; padding: 1px 4px; border-radius: 3px; font-size: 0.85rem; }
    footer { margin-top: 24px; color: #999; font-size: 0.75rem; }
  </style>
</head>
<body>
  <h1>Loom Deepen Report</h1>
  <div class="meta">
    Date: ${escapeHtml(report.date)} &nbsp;|&nbsp;
    Target: <code>${escapeHtml(report.target)}</code> &nbsp;|&nbsp;
    Candidates: ${report.candidateCount}
    ${report.partial ? "&nbsp;|&nbsp; <strong>partial</strong>" : ""}
  </div>
  ${partialBanner}
  <table>
    <thead>
      <tr>
        <th>Module</th>
        <th>Depth Before</th>
        <th>Depth After</th>
        <th>Deletion Test</th>
        <th>Recommendation</th>
      </tr>
    </thead>
    <tbody>
      ${candidateRows || "<tr><td colspan='5' style='text-align:center;color:#999'>No candidates found.</td></tr>"}
    </tbody>
  </table>
  <footer>
    Generated by /loom-deepen &nbsp;|&nbsp; Vocabulary: Module · Seam · Depth · Adapter · Leverage · Locality
    (see protocols/codebase-design.md)
  </footer>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const { input, output } = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(input)) {
    process.stderr.write(`render-html: input file not found: ${input}\n`);
    process.exit(1);
  }

  const content = fs.readFileSync(input, "utf-8");
  const report = parseToonReport(content);

  const html = renderHtml(report);

  const tmpPath = output + ".tmp";
  fs.writeFileSync(tmpPath, html, "utf-8");
  fs.renameSync(tmpPath, output);

  process.stdout.write(`render-html: HTML written to ${output}\n`);
}
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
