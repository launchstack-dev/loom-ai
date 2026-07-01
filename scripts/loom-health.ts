#!/usr/bin/env bunx
/**
 * scripts/loom-health.ts
 *
 * Composite 0-10 quality score. Best-effort — every component tool is optional;
 * missing tools skip that dimension and emit a HEALTH_TOOL_MISSING info.
 *
 * Components + weights:
 *   typecheck   30%   bunx tsc --noEmit (or npx tsc --noEmit)
 *   tests       30%   bunx vitest run (if vitest present)
 *   lint        20%   eslint (if config present)
 *   dead-code   10%   knip (if installed)
 *   shell       10%   shellcheck (if any .sh files exist)
 *
 * Output: TOON to stdout. Appends to .loom/health-history.toon (atomic).
 *
 * Contract: PLAN-gstack-adoption.md Phase 2 F-07, error HEALTH_TOOL_MISSING.
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

interface ComponentResult {
  tool: string;
  rawScore: number; // 0..10 or NaN when skipped
  weight: number; // 0..1
  skipped: boolean;
  note?: string;
  metric?: Record<string, number | string>;
}

const REPO_ROOT = process.cwd();
const HISTORY_PATH = path.join(REPO_ROOT, ".loom", "health-history.toon");

/** Linearly scores an error count. 0 errors → 10, at or above ceiling → 0. */
function linearScore(errors: number, ceiling: number): number {
  if (errors <= 0) return 10;
  if (errors >= ceiling) return 0;
  return Math.max(0, Math.min(10, 10 * (1 - errors / ceiling)));
}

/** Runs a command and returns { code, stdout, stderr }; never throws. */
function tryRun(cmd: string): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execSync(cmd, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      cwd: REPO_ROOT,
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e: any) {
    return {
      code: typeof e.status === "number" ? e.status : 1,
      stdout: (e.stdout ?? "").toString(),
      stderr: (e.stderr ?? "").toString(),
    };
  }
}

/** Returns true if the binary is on PATH. */
function has(bin: string): boolean {
  const which = tryRun(`command -v ${bin}`);
  return which.code === 0 && which.stdout.trim().length > 0;
}

function existsAny(patterns: string[]): boolean {
  for (const p of patterns) {
    if (fs.existsSync(path.join(REPO_ROOT, p))) return true;
  }
  return false;
}

function runTypecheck(): ComponentResult {
  const runner = has("bunx") ? "bunx" : has("npx") ? "npx" : null;
  if (!runner) {
    return {
      tool: "typecheck",
      rawScore: NaN,
      weight: 0.3,
      skipped: true,
      note: "HEALTH_TOOL_MISSING: no bunx or npx available",
    };
  }
  const hasTsConfig = existsAny(["tsconfig.json"]);
  if (!hasTsConfig) {
    return {
      tool: "typecheck",
      rawScore: NaN,
      weight: 0.3,
      skipped: true,
      note: "HEALTH_TOOL_MISSING: no tsconfig.json",
    };
  }
  const result = tryRun(`${runner} tsc --noEmit`);
  // Count "error TSxxxx" occurrences.
  const errors = (result.stdout.match(/error TS\d+/g) ?? []).length;
  const score = linearScore(errors, 10);
  return {
    tool: "typecheck",
    rawScore: score,
    weight: 0.3,
    skipped: false,
    metric: { tsErrors: errors },
  };
}

function runTests(): ComponentResult {
  const hasVitest =
    existsAny(["vitest.config.ts", "vitest.config.js", "vitest.config.mjs"]) ||
    fs.existsSync(path.join(REPO_ROOT, "node_modules", "vitest"));
  const runner = has("bunx") ? "bunx" : has("npx") ? "npx" : null;
  if (!hasVitest || !runner) {
    return {
      tool: "tests",
      rawScore: NaN,
      weight: 0.3,
      skipped: true,
      note: "HEALTH_TOOL_MISSING: vitest not installed",
    };
  }
  const result = tryRun(`${runner} vitest run --reporter=basic --run`);
  // Parse totals from vitest output: "Tests  N passed | M failed".
  const passMatch = /(\d+)\s+passed/.exec(result.stdout);
  const failMatch = /(\d+)\s+failed/.exec(result.stdout);
  const passed = passMatch ? parseInt(passMatch[1], 10) : 0;
  const failed = failMatch ? parseInt(failMatch[1], 10) : 0;
  const total = passed + failed;
  const rate = total === 0 ? (result.code === 0 ? 1 : 0) : passed / total;
  const score = Math.round(rate * 100) / 10;
  return {
    tool: "tests",
    rawScore: Math.min(10, Math.max(0, score)),
    weight: 0.3,
    skipped: false,
    metric: { passed, failed },
  };
}

function runLint(): ComponentResult {
  const hasConfig = existsAny([
    ".eslintrc",
    ".eslintrc.js",
    ".eslintrc.cjs",
    ".eslintrc.json",
    ".eslintrc.yaml",
    ".eslintrc.yml",
    "eslint.config.js",
    "eslint.config.mjs",
    "eslint.config.ts",
  ]);
  const runner = has("bunx") ? "bunx" : has("npx") ? "npx" : null;
  if (!hasConfig || !runner) {
    return {
      tool: "lint",
      rawScore: NaN,
      weight: 0.2,
      skipped: true,
      note: "HEALTH_TOOL_MISSING: eslint config not found",
    };
  }
  const result = tryRun(`${runner} eslint . --format=stylish`);
  // Count "error" markers, exclude "0 errors" summary lines.
  const errorCount = (result.stdout.match(/\bproblems?\b.*?(\d+)\s+error/g) ?? [])
    .map((m) => {
      const n = /(\d+)\s+error/.exec(m);
      return n ? parseInt(n[1], 10) : 0;
    })
    .reduce((a, b) => a + b, 0);
  const errors = errorCount || (result.code === 0 ? 0 : 10);
  const score = linearScore(errors, 10);
  return {
    tool: "lint",
    rawScore: score,
    weight: 0.2,
    skipped: false,
    metric: { lintErrors: errors },
  };
}

function runDeadCode(): ComponentResult {
  const hasKnip = fs.existsSync(path.join(REPO_ROOT, "node_modules", "knip"));
  const runner = has("bunx") ? "bunx" : has("npx") ? "npx" : null;
  if (!hasKnip || !runner) {
    return {
      tool: "dead-code",
      rawScore: NaN,
      weight: 0.1,
      skipped: true,
      note: "HEALTH_TOOL_MISSING: knip not installed",
    };
  }
  const result = tryRun(`${runner} knip --reporter=compact`);
  // knip reports totals like "Unused files (3)".
  const unusedMatches = result.stdout.match(/Unused\s+\w+\s*\((\d+)\)/g) ?? [];
  const total = unusedMatches
    .map((m) => parseInt(/\((\d+)\)/.exec(m)?.[1] ?? "0", 10))
    .reduce((a, b) => a + b, 0);
  const score = linearScore(total, 20);
  return {
    tool: "dead-code",
    rawScore: score,
    weight: 0.1,
    skipped: false,
    metric: { unused: total },
  };
}

function runShellcheck(): ComponentResult {
  let shFiles: string[] = [];
  try {
    const out = execSync(
      `git ls-files '*.sh' '*.bash' 2>/dev/null || find . -maxdepth 4 -type f \\( -name '*.sh' -o -name '*.bash' \\) 2>/dev/null`,
      { encoding: "utf-8", cwd: REPO_ROOT }
    );
    shFiles = out.split("\n").filter((l) => l.trim().length > 0);
  } catch {
    shFiles = [];
  }
  if (shFiles.length === 0) {
    return {
      tool: "shell",
      rawScore: NaN,
      weight: 0.1,
      skipped: true,
      note: "HEALTH_TOOL_MISSING: no shell scripts to check",
    };
  }
  if (!has("shellcheck")) {
    return {
      tool: "shell",
      rawScore: NaN,
      weight: 0.1,
      skipped: true,
      note: "HEALTH_TOOL_MISSING: shellcheck not installed",
    };
  }
  const result = tryRun(`shellcheck ${shFiles.map((f) => `'${f}'`).join(" ")}`);
  const errors = (result.stdout.match(/^In\s.+\sline\s\d+:/gm) ?? []).length;
  const score = linearScore(errors, 20);
  return {
    tool: "shell",
    rawScore: score,
    weight: 0.1,
    skipped: false,
    metric: { shellIssues: errors },
  };
}

function computeComposite(results: ComponentResult[]): number {
  const scored = results.filter((r) => !r.skipped && Number.isFinite(r.rawScore));
  if (scored.length === 0) return 0;
  const weightSum = scored.reduce((a, r) => a + r.weight, 0);
  const weighted = scored.reduce((a, r) => a + r.rawScore * r.weight, 0);
  // Re-normalise so composite always reads 0..10.
  const composite = weightSum === 0 ? 0 : weighted / weightSum;
  return Math.round(composite * 10) / 10;
}

function atomicAppendHistory(entryTOON: string): void {
  const dir = path.dirname(HISTORY_PATH);
  fs.mkdirSync(dir, { recursive: true });
  let existing = "";
  if (fs.existsSync(HISTORY_PATH)) {
    existing = fs.readFileSync(HISTORY_PATH, "utf-8");
  } else {
    existing = "schemaVersion: 1\nentries[0]{timestamp,score,tsErrors,testFailures,lintErrors,unused,shellIssues}:\n";
  }
  // Bump the entry count in the header line and append the new row.
  const headerRe = /^entries\[(\d+)\]\{([^}]+)\}:\s*$/m;
  const match = headerRe.exec(existing);
  let updated: string;
  if (match) {
    const currentN = parseInt(match[1], 10);
    const newHeader = `entries[${currentN + 1}]{${match[2]}}:`;
    updated = existing.replace(headerRe, newHeader) + entryTOON;
  } else {
    updated =
      existing.trimEnd() +
      "\nentries[1]{timestamp,score,tsErrors,testFailures,lintErrors,unused,shellIssues}:\n" +
      entryTOON;
  }
  const tmp = `${HISTORY_PATH}.tmp`;
  fs.writeFileSync(tmp, updated);
  fs.renameSync(tmp, HISTORY_PATH);
}

function renderTOON(composite: number, results: ComponentResult[]): {
  stdout: string;
  historyRow: string;
  metrics: Record<string, number>;
} {
  const rows = results
    .map((r) => {
      const rs = r.skipped ? "skipped" : r.rawScore.toFixed(1);
      const wc = r.skipped ? "0.0" : (r.rawScore * r.weight).toFixed(2);
      return `  ${r.tool},${rs},${wc}`;
    })
    .join("\n");
  const notes = results
    .filter((r) => r.note)
    .map((r) => `  ${r.tool},${r.note}`)
    .join("\n");
  const stdout =
    `loomHealthScore: ${composite.toFixed(1)}\n` +
    `breakdown[${results.length}]{tool,rawScore,weightedContribution}:\n` +
    rows +
    "\n" +
    (notes ? `notes[${results.filter((r) => r.note).length}]{tool,note}:\n${notes}\n` : "");

  const metrics: Record<string, number> = {};
  for (const r of results) {
    if (r.metric) {
      for (const [k, v] of Object.entries(r.metric)) {
        if (typeof v === "number") metrics[k] = v;
      }
    }
  }
  const timestamp = new Date().toISOString();
  const row = `  ${timestamp},${composite.toFixed(1)},${metrics.tsErrors ?? 0},${metrics.failed ?? 0},${metrics.lintErrors ?? 0},${metrics.unused ?? 0},${metrics.shellIssues ?? 0}\n`;
  return { stdout, historyRow: row, metrics };
}

export function main(): void {
  const results: ComponentResult[] = [
    runTypecheck(),
    runTests(),
    runLint(),
    runDeadCode(),
    runShellcheck(),
  ];
  const composite = computeComposite(results);
  const rendered = renderTOON(composite, results);
  process.stdout.write(rendered.stdout);
  try {
    atomicAppendHistory(rendered.historyRow);
  } catch (e) {
    process.stderr.write(`# health-history write failed (non-fatal): ${(e as Error).message}\n`);
  }
}

// Exports for tests.
export {
  linearScore,
  computeComposite,
  runTypecheck,
  runTests,
  runLint,
  runDeadCode,
  runShellcheck,
};

if (require.main === module) {
  main();
}
