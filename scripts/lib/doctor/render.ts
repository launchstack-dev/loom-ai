/**
 * Renderer for the `/loom-doctor` CLI surface (Phase 9A1).
 *
 * Pure functions — injects TTY detection so tests can drive both branches
 * without faking `process.stdout`. The line shape is asserted in
 * `test/loom-doctor.test.ts` and documented in
 * `protocols/doctor-report.schema.md`.
 *
 * Line shape (per check):
 *   `{✓ PASS|⚠ WARN|✗ FAIL} {id} ({category}) — {message}`
 *
 * Glyph emission rule: glyphs (`✓`, `⚠`, `✗`) appear only when stdout is a
 * TTY. Text labels (`PASS`, `WARN`, `FAIL`) are always present.
 */

// ---------------------------------------------------------------------------
// Local structural types
//
// We re-declare a minimal structural shape rather than depending on the
// `HealthCheck`/`DoctorReport` placeholders in
// `protocols/doctor-report.schema.md`; once real types ship we swap.
// ---------------------------------------------------------------------------

export type CheckStatus = "pass" | "warn" | "fail";

export interface RenderableCheck {
  id: string;
  category: string;
  status: CheckStatus;
  message: string;
  remediation?: string;
}

export interface RenderableReport {
  schemaVersion: 1;
  generatedAt: string;
  installSource: "plugin" | "curl" | "unknown";
  tier: "local" | "project" | "mixed";
  overallStatus: "clean" | "warnings" | "problems";
  exitCode: 0 | 1 | 2;
  checks: RenderableCheck[];
}

export interface RenderOptions {
  /** Whether stdout is a TTY (controls glyph rendering). */
  isTTY: boolean;
  /** Suppress `pass` lines (still includes them in summary counts). */
  quiet: boolean;
  /** Doctor CLI version string (for the header). */
  version: string;
}

// ---------------------------------------------------------------------------
// Status decoration
// ---------------------------------------------------------------------------

const LABELS: Record<CheckStatus, string> = {
  pass: "PASS",
  warn: "WARN",
  fail: "FAIL",
};

const GLYPHS: Record<CheckStatus, string> = {
  pass: "✓",
  warn: "⚠",
  fail: "✗",
};

export function renderCheckLine(
  check: RenderableCheck,
  isTTY: boolean,
): string {
  const label = LABELS[check.status];
  const prefix = isTTY ? `${GLYPHS[check.status]} ${label}` : label;
  return `${prefix} ${check.id} (${check.category}) — ${check.message}`;
}

// ---------------------------------------------------------------------------
// Text rendering
// ---------------------------------------------------------------------------

export function renderText(
  report: RenderableReport,
  opts: RenderOptions,
): string {
  const lines: string[] = [];
  lines.push(
    `[loom-doctor v${opts.version}] installSource=${report.installSource} tier=${report.tier} status=${report.overallStatus}`,
  );

  let passes = 0;
  let warns = 0;
  let errors = 0;

  for (const check of report.checks) {
    if (check.status === "pass") passes += 1;
    else if (check.status === "warn") warns += 1;
    else errors += 1;

    if (opts.quiet && check.status === "pass") continue;
    lines.push(renderCheckLine(check, opts.isTTY));
  }

  lines.push(
    `Summary: ${passes} checks passed, ${warns} warnings, ${errors} errors. Exit code: ${report.exitCode}.`,
  );

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// JSON rendering
// ---------------------------------------------------------------------------

export function renderJSON(report: RenderableReport): string {
  return JSON.stringify(report, null, 2) + "\n";
}
