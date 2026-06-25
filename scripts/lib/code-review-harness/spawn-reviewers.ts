/**
 * Reviewer registry + spawn-request builder for `scripts/code-review-harness.ts`.
 *
 * Mirrors the structure of `scripts/plan-review-harness.ts` (the precedent) but
 * binds the F-01 row variant of `findings.applications-rows.md`:
 *
 *   - `dimension` is the per-application stable token `code-review`
 *   - `reviewerAgent` is the reviewer name (e.g., `code-reviewer`,
 *     `security-reviewer`) — one of the 9 reviewers `/loom-code review`
 *     spawns in `--full` mode.
 *
 * This module is PURE — no `fs` reads, no `Date.now()`. The harness entry
 * point at `scripts/code-review-harness.ts` is the I/O boundary.
 *
 * Schema references:
 *   - `protocols/converge.config.applications.md` (F-01 row)
 *   - `protocols/findings.applications-rows.md` (F-01 row variant)
 *   - `protocols/findings.schema.md` (canonical findings shape)
 */

import {
  type AgentResultEnvelope,
  type AgentResultIssue,
  severityToConvergenceSeverity,
  type AgentIssueSeverity,
  type ConvergenceSeverity,
} from "../aggregate-findings.js";

// ---------------------------------------------------------------------------
// Canonical F-01 reviewer registry
// ---------------------------------------------------------------------------

/**
 * Each row maps a `/loom-code review` reviewer to the metadata the harness
 * needs to write a spawn-request and parse the corresponding AgentResult
 * envelope back.
 *
 * The reviewer set matches `--full` mode of `/loom-code review` (9 reviewers):
 *   - 6 built-in pr-review-toolkit reviewers (code-reviewer, silent-failure,
 *     code-simplifier, test-analyzer, comment-analyzer, type-design-analyzer)
 *   - 3 bespoke reviewers in `agents/` (security, architecture,
 *     plan-compliance)
 *
 * `agentFile` is empty for built-in reviewers (they ship as Claude Code
 * subagents and have no on-disk .md in this repo); for bespoke reviewers it
 * points at the local `agents/{name}.md` file.
 */
export interface CodeReviewerRow {
  /** Schema-side name carried into findings.toon's `reviewerAgent` column. */
  reviewerAgent: string;
  /** Local agent file path (relative to repo root); empty for built-ins. */
  agentFile: string;
  /** True when the reviewer is a Claude Code built-in (no local .md). */
  builtin: boolean;
}

export const CODE_REVIEWER_AGENTS: CodeReviewerRow[] = [
  // Built-in reviewers (pr-review-toolkit). These have no local .md file;
  // their `subagent_type` is set at spawn time by the driver, not by this
  // harness.
  { reviewerAgent: "code-reviewer", agentFile: "", builtin: true },
  { reviewerAgent: "silent-failure-hunter", agentFile: "", builtin: true },
  { reviewerAgent: "code-simplifier", agentFile: "", builtin: true },
  { reviewerAgent: "pr-test-analyzer", agentFile: "", builtin: true },
  { reviewerAgent: "comment-analyzer", agentFile: "", builtin: true },
  { reviewerAgent: "type-design-analyzer", agentFile: "", builtin: true },
  // Bespoke reviewers (local agents/*.md).
  {
    reviewerAgent: "security-reviewer",
    agentFile: "agents/security-reviewer.md",
    builtin: false,
  },
  {
    reviewerAgent: "architecture-reviewer",
    agentFile: "agents/architecture-reviewer.md",
    builtin: false,
  },
  {
    reviewerAgent: "plan-compliance-reviewer",
    agentFile: "agents/plan-compliance-reviewer.md",
    builtin: false,
  },
];

/** The stable per-application dimension token. */
export const CODE_REVIEW_DIMENSION = "code-review" as const;

// ---------------------------------------------------------------------------
// F-01 aggregator (custom — does NOT reuse aggregate-findings.ts's
// reviewer-bound aggregateFindings, which is locked to the 6 plan-review
// dimensions). Reuses `severityToConvergenceSeverity` verbatim per W-03.
// ---------------------------------------------------------------------------

/** A single F-01 finding row. */
export interface CodeReviewFinding {
  id: string;
  dimension: typeof CODE_REVIEW_DIMENSION;
  severity: ConvergenceSeverity;
  locationPath: string;
  locationAnchor: string;
  summary: string;
  suggestion?: string;
  reviewerAgent: string;
}

/** Top-level F-01 findings object. */
export interface CodeReviewFindings {
  subject: string;
  harnessName: "code-review";
  iteration: number;
  blockingCount: number;
  advisoryCount: number;
  producedAt: string;
  findings: CodeReviewFinding[];
}

export interface AggregateCodeReviewOptions {
  subject: string;
  iteration: number;
  envelopes: AgentResultEnvelope[];
  now?: () => Date;
  summaryMaxLen?: number;
}

export class FindingsInvariantViolation extends Error {
  constructor(detail: string) {
    super(`FINDINGS_SCHEMA_INVALID: ${detail}`);
    this.name = "FindingsInvariantViolation";
  }
}

function clipSummary(message: string, max: number): string {
  const oneLine = message.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 1).trimEnd() + "…";
}

function formatFindingId(n: number): string {
  return `F-${String(n).padStart(2, "0")}`;
}

/**
 * Translate the integer iteration into a F-01 anchor cell of the form `:N`
 * per the row variant spec ("`:N` where N is `findings[].line`; `:0` when
 * whole-file"). The `location` field of `AgentResultIssue` is treated as
 * either a numeric line (we wrap with `:`) or pre-formatted (we pass it
 * through if it already starts with `:` or `##`).
 */
function normalizeAnchor(rawLocation: string | undefined): string {
  if (!rawLocation) return ":0";
  const trimmed = rawLocation.trim();
  if (trimmed === "") return ":0";
  if (trimmed.startsWith(":") || trimmed.startsWith("##")) return trimmed;
  // Pure integer? wrap with `:`. Otherwise pass through (could be a function
  // name or symbol anchor).
  if (/^\d+$/.test(trimmed)) return `:${trimmed}`;
  return trimmed;
}

/**
 * Aggregate reviewer envelopes into F-01 CodeReviewFindings.
 *
 * Severity mapping: delegated verbatim to
 * `severityToConvergenceSeverity()` from `aggregate-findings.ts`. W-03
 * attribution is preserved by carrying the envelope `agent` field through
 * to each finding's `reviewerAgent` column.
 *
 * Partial failure: envelopes with `status === 'failure'` contribute zero
 * findings; the caller is responsible for emitting a partial-failure
 * stderr warning.
 */
export function aggregateCodeReviewFindings(
  opts: AggregateCodeReviewOptions,
): CodeReviewFindings {
  const {
    subject,
    iteration,
    envelopes,
    now = () => new Date(),
    summaryMaxLen = 200,
  } = opts;

  if (!Number.isInteger(iteration) || iteration < 0) {
    throw new FindingsInvariantViolation(
      `iteration must be a non-negative integer (got ${iteration})`,
    );
  }
  if (!subject || typeof subject !== "string") {
    throw new FindingsInvariantViolation(
      `subject is required and must be a non-empty string`,
    );
  }

  // Stable order: walk CODE_REVIEWER_AGENTS, then walk each envelope's issues.
  const byName = new Map<string, AgentResultEnvelope>();
  for (const env of envelopes) {
    byName.set(env.agent, env);
  }
  const ordered: AgentResultEnvelope[] = [];
  for (const row of CODE_REVIEWER_AGENTS) {
    const env = byName.get(row.reviewerAgent);
    if (env) ordered.push(env);
  }
  // Append unknown reviewers at the end (do not silently drop).
  const known = new Set(CODE_REVIEWER_AGENTS.map((r) => r.reviewerAgent));
  for (const env of envelopes) {
    if (!known.has(env.agent)) ordered.push(env);
  }

  const findings: CodeReviewFinding[] = [];
  let nextId = 1;

  for (const env of ordered) {
    if (env.status === "failure") continue;
    const issues = env.issues ?? [];
    for (const issue of issues) {
      const severity = severityToConvergenceSeverity(
        issue.severity as AgentIssueSeverity,
      );
      const finding: CodeReviewFinding = {
        id: formatFindingId(nextId++),
        dimension: CODE_REVIEW_DIMENSION,
        severity,
        locationPath: issue.file ?? subject,
        locationAnchor: normalizeAnchor(issue.location),
        summary: clipSummary(issue.message ?? "", summaryMaxLen),
        reviewerAgent: env.agent,
      };
      if (issue.suggestion) finding.suggestion = issue.suggestion;
      findings.push(finding);
    }
  }

  // Recompute counts + enforce findings.schema invariants (1, 2, 3).
  let blockingCount = 0;
  let advisoryCount = 0;
  for (const f of findings) {
    if (f.severity === "blocking") blockingCount++;
    else if (f.severity === "warning" || f.severity === "info") advisoryCount++;
    else {
      throw new FindingsInvariantViolation(
        `unexpected finding severity ${f.severity} at id ${f.id}`,
      );
    }
  }
  if (findings.length !== blockingCount + advisoryCount) {
    throw new FindingsInvariantViolation(
      `total count mismatch: findings.length=${findings.length}, blocking=${blockingCount}, advisory=${advisoryCount}`,
    );
  }

  return {
    subject,
    harnessName: "code-review",
    iteration,
    blockingCount,
    advisoryCount,
    producedAt: now().toISOString(),
    findings,
  };
}

// ---------------------------------------------------------------------------
// TOON encoder
// ---------------------------------------------------------------------------

function csvQuote(raw: string): string {
  if (raw === "") return "";
  if (/[,\n"]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export function encodeCodeReviewFindingsToToon(
  findings: CodeReviewFindings,
): string {
  const header = [
    `subject: ${findings.subject}`,
    `harnessName: ${findings.harnessName}`,
    `iteration: ${findings.iteration}`,
    `blockingCount: ${findings.blockingCount}`,
    `advisoryCount: ${findings.advisoryCount}`,
    `producedAt: ${findings.producedAt}`,
    "",
  ];
  const arrayHeader = `findings[${findings.findings.length}]{id,dimension,severity,locationPath,locationAnchor,summary,suggestion,reviewerAgent}:`;
  const rows = findings.findings.map((f) => {
    const cells = [
      f.id,
      f.dimension,
      f.severity,
      f.locationPath,
      f.locationAnchor,
      f.summary,
      f.suggestion ?? "",
      f.reviewerAgent,
    ].map(csvQuote);
    return `  ${cells.join(",")}`;
  });
  return [...header, arrayHeader, ...rows, ""].join("\n");
}

// ---------------------------------------------------------------------------
// Re-exports for the harness entrypoint
// ---------------------------------------------------------------------------

export type { AgentResultEnvelope, AgentResultIssue };
