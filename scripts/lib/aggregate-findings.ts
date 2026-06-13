/**
 * Pure aggregation function for the plan-review convergence harness.
 *
 * Schema:     `agents/protocols/findings.schema.md` (ConvergenceFindings v1)
 * Input:      6 (or fewer, in partial-failure mode) AgentResult envelopes,
 *             one per reviewer agent. See `agents/protocols/agent-result.schema.md`.
 * Output:     a single `ConvergenceFindings` object ready to be encoded as TOON
 *             and written to `.plan-execution/convergence/findings.toon`.
 *
 * This module is PURE — no `fs`, no `Date.now()`, no `process.*`. The harness
 * entry-point at `scripts/plan-review-harness.ts` is the I/O boundary; this
 * file is responsible only for deterministic mapping + invariant enforcement.
 *
 * Locked decisions wired:
 *   - W-01 (timestamp precision)  — caller injects a `now()` clock; the helper
 *                                   formats `producedAt` as ISO 8601 with ms
 *                                   precision via `Date#toISOString()`.
 *   - W-03 (reviewer attribution) — every finding row carries `reviewerAgent`
 *                                   set to one of the 6 locked reviewer names
 *                                   verbatim. Dimension is derived from the
 *                                   reviewer name when an envelope-level
 *                                   override is not provided.
 *
 * Severity mapping (from findings.schema.md § Severity Mapping):
 *
 *   AgentResult severity | ConvergenceFindings severity | counter
 *   ---------------------+------------------------------+------------
 *   critical             | blocking                     | blocking +1
 *   high                 | blocking                     | blocking +1
 *   medium               | warning                      | advisory +1
 *   low                  | info                         | advisory +1
 *   info                 | info                         | advisory +1
 *   advisory             | info                         | advisory +1
 *
 *   advisoryCount = count(severity in {warning, info})   per schema invariant 2
 *   blockingCount = count(severity == blocking)          per schema invariant 1
 *   findings.length = blockingCount + advisoryCount      per schema invariant 3
 *
 * ID assignment: sequential `F-01`, `F-02`, ... across the FLATTENED set of
 * findings. Order is stable: walk envelopes in the canonical reviewer order
 * (feature-coverage, strategy, ux, phasing, parallelization, agentic-workflow),
 * then walk each envelope's issues in encounter order. Envelopes with status
 * 'failure' contribute zero findings; the caller is responsible for emitting
 * a partial-failure warning.
 */

// ---------------------------------------------------------------------------
// Locked enums
// ---------------------------------------------------------------------------

/** The 6 dimensions emitted by the plan-review harness. */
export const CANONICAL_DIMENSIONS = [
  "feature-coverage",
  "strategy",
  "ux",
  "phasing",
  "parallelization",
  "agentic-workflow",
] as const;

export type ReviewerDimension = (typeof CANONICAL_DIMENSIONS)[number];

/**
 * The 6 reviewer agent names as they appear in `findings.toon`'s `reviewerAgent`
 * column. These use the `-reviewer-agent` suffix locked by the schema's
 * `reviewerAgent` enum, even though the underlying `agents/{name}.md` files use
 * the `-agent` suffix without the `-reviewer-` infix. The harness handles the
 * mapping at spawn time (see `scripts/plan-review-harness.ts`).
 */
export const CANONICAL_REVIEWER_AGENTS = [
  "feature-coverage-reviewer-agent",
  "strategy-reviewer-agent",
  "ux-reviewer-agent",
  "phasing-reviewer-agent",
  "parallelization-reviewer-agent",
  "agentic-workflow-reviewer-agent",
] as const;

export type ReviewerAgent = (typeof CANONICAL_REVIEWER_AGENTS)[number];

/** Stable order used when flattening findings into `F-NN` ids. */
const CANONICAL_REVIEWER_ORDER: ReviewerAgent[] = [...CANONICAL_REVIEWER_AGENTS];

// ---------------------------------------------------------------------------
// Input shapes — narrow subset of AgentResult that the aggregator consumes.
// ---------------------------------------------------------------------------

/** Severity values accepted from `AgentResult.issues[]`. */
export type AgentIssueSeverity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "info"
  | "advisory";

/** Convergence-side severity values per findings.schema.md. */
export type ConvergenceSeverity = "blocking" | "warning" | "info" | "advisory";

/**
 * A single row from an `AgentResult.issues[]` array. Only the fields the
 * aggregator reads are required here; the harness owns the broader envelope.
 */
export interface AgentResultIssue {
  severity: AgentIssueSeverity;
  /** Free-form category from the reviewer (ignored by the aggregator). */
  category?: string;
  /** Required: the one-line statement of the issue. */
  message: string;
  /** Optional: file path the issue applies to. Defaults to the subject. */
  file?: string;
  /** Optional: sub-file locator (heading path, line range, function name). */
  location?: string;
  /** Optional: recommended remedy. Surfaced to the integrator. */
  suggestion?: string;
  /**
   * Optional: reviewer-declared dimension override. If absent, the aggregator
   * derives the dimension from the reviewer agent name.
   */
  dimension?: ReviewerDimension;
}

/** Status values produced by reviewer agents. */
export type AgentStatus = "success" | "failure" | "partial";

/**
 * The single AgentResult envelope shape the aggregator consumes. The harness
 * is the I/O boundary that parses TOON and constructs these in memory.
 */
export interface AgentResultEnvelope {
  /** Reviewer agent name (e.g., `feature-coverage-reviewer-agent`). */
  agent: string;
  status: AgentStatus;
  issues?: AgentResultIssue[];
}

// ---------------------------------------------------------------------------
// Output shapes — match findings.schema.md verbatim.
// ---------------------------------------------------------------------------

/** A single row in `ConvergenceFindings.findings[]`. */
export interface ConvergenceFinding {
  /** Sequential id: `F-01`, `F-02`, ... */
  id: string;
  dimension: ReviewerDimension;
  severity: ConvergenceSeverity;
  /** Typically equals the subject path. */
  locationPath: string;
  /** Free-form anchor (heading path or empty string when whole-file). */
  locationAnchor: string;
  /** <= 200 chars; clipped if longer (schema guidance). */
  summary: string;
  suggestion?: string;
  reviewerAgent: ReviewerAgent;
}

/** Top-level `ConvergenceFindings` object. */
export interface ConvergenceFindings {
  subject: string;
  harnessName: "plan-review";
  iteration: number;
  blockingCount: number;
  advisoryCount: number;
  /** ISO 8601 with millisecond precision (locked W-01). */
  producedAt: string;
  findings: ConvergenceFinding[];
}

/** Options accepted by `aggregateFindings`. */
export interface AggregateOptions {
  /** The subject path declared in `converge.config`. Mirrored verbatim into output. */
  subject: string;
  /** 1-indexed pass number; must equal the driver's `currentIteration`. */
  iteration: number;
  /** The reviewer envelopes to flatten. Usually 6; may be fewer in partial-failure mode. */
  envelopes: AgentResultEnvelope[];
  /** Optional injected clock for testability. Defaults to `() => new Date()`. */
  now?: () => Date;
  /** Optional max length for `summary` clipping. Default 200. */
  summaryMaxLen?: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when an aggregator invariant is violated. Per findings.schema.md, a
 * mismatch in count consistency is a `FINDINGS_SCHEMA_INVALID` defect — the
 * aggregator throws to surface the bug before the file is written.
 */
export class FindingsInvariantViolation extends Error {
  constructor(detail: string) {
    super(`FINDINGS_SCHEMA_INVALID: ${detail}`);
    this.name = "FindingsInvariantViolation";
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Map an AgentResult severity onto a ConvergenceFindings severity.
 * Verbatim from findings.schema.md § Severity Mapping.
 */
export function severityToConvergenceSeverity(
  severity: AgentIssueSeverity,
): ConvergenceSeverity {
  switch (severity) {
    case "critical":
    case "high":
      return "blocking";
    case "medium":
      return "warning";
    case "low":
    case "info":
    case "advisory":
      return "info";
  }
}

/**
 * Derive the canonical dimension for a reviewer agent name. Strips the
 * `-reviewer-agent` suffix.
 *
 * @throws if the name is not one of the 6 canonical reviewers.
 */
export function deriveDimension(reviewerAgent: string): ReviewerDimension {
  const idx = CANONICAL_REVIEWER_AGENTS.indexOf(reviewerAgent as ReviewerAgent);
  if (idx === -1) {
    throw new FindingsInvariantViolation(
      `unknown reviewer agent: ${reviewerAgent}; expected one of ${CANONICAL_REVIEWER_AGENTS.join(", ")}`,
    );
  }
  return CANONICAL_DIMENSIONS[idx];
}

/** Format a sequential finding id (`F-01`, `F-02`, ...). */
function formatFindingId(n: number): string {
  return `F-${String(n).padStart(2, "0")}`;
}

/** Clip a summary to `max` characters, trimming whitespace at the boundary. */
function clipSummary(message: string, max: number): string {
  const oneLine = message.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) {
    return oneLine;
  }
  return oneLine.slice(0, max - 1).trimEnd() + "…";
}

/**
 * Stable order: keep envelopes in canonical reviewer order, regardless of the
 * order the caller passed them in. Unknown reviewer names throw via
 * `deriveDimension` when their issues are flattened.
 */
function orderEnvelopes(
  envelopes: AgentResultEnvelope[],
): AgentResultEnvelope[] {
  const byName = new Map<string, AgentResultEnvelope>();
  for (const env of envelopes) {
    byName.set(env.agent, env);
  }
  const ordered: AgentResultEnvelope[] = [];
  for (const name of CANONICAL_REVIEWER_ORDER) {
    const env = byName.get(name);
    if (env) ordered.push(env);
  }
  // Append any non-canonical envelopes at the end so unknown-reviewer errors
  // surface deterministically (instead of being silently dropped).
  for (const env of envelopes) {
    if (!CANONICAL_REVIEWER_AGENTS.includes(env.agent as ReviewerAgent)) {
      ordered.push(env);
    }
  }
  return ordered;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Aggregate up to 6 reviewer AgentResult envelopes into a single
 * `ConvergenceFindings` object.
 *
 * The function is PURE — it never reads from disk, never calls Date.now()
 * directly, and never throws on transient runtime conditions. It throws ONLY
 * when an invariant from findings.schema.md is violated (e.g., the recomputed
 * `blockingCount` does not match the count of blocking findings) — which is a
 * caller bug, not a runtime failure.
 *
 * Partial-failure handling: an envelope with `status === 'failure'` contributes
 * zero findings. The harness entry point is responsible for emitting a stderr
 * warning that names the failed reviewer (per AC 8). The aggregator silently
 * ignores `status: 'failure'` envelopes.
 *
 * @param opts See {@link AggregateOptions}.
 * @returns A fully populated `ConvergenceFindings` object.
 * @throws {FindingsInvariantViolation} when a count invariant is violated.
 */
export function aggregateFindings(opts: AggregateOptions): ConvergenceFindings {
  const {
    subject,
    iteration,
    envelopes,
    now = () => new Date(),
    summaryMaxLen = 200,
  } = opts;

  if (!Number.isInteger(iteration) || iteration < 1) {
    throw new FindingsInvariantViolation(
      `iteration must be a positive integer (got ${iteration})`,
    );
  }
  if (!subject || typeof subject !== "string") {
    throw new FindingsInvariantViolation(
      `subject is required and must be a non-empty string`,
    );
  }

  const ordered = orderEnvelopes(envelopes);
  const findings: ConvergenceFinding[] = [];
  let nextId = 1;

  for (const env of ordered) {
    // Partial-failure: a failed reviewer contributes nothing.
    if (env.status === "failure") {
      continue;
    }
    const reviewerAgent = env.agent as ReviewerAgent;
    // deriveDimension throws if reviewerAgent is unknown — that's the right
    // behavior, since silently dropping unknown reviewers would mask a defect.
    const defaultDimension = deriveDimension(reviewerAgent);

    const issues = env.issues ?? [];
    for (const issue of issues) {
      const severity = severityToConvergenceSeverity(issue.severity);
      const dimension: ReviewerDimension = issue.dimension ?? defaultDimension;
      const finding: ConvergenceFinding = {
        id: formatFindingId(nextId++),
        dimension,
        severity,
        locationPath: issue.file ?? subject,
        locationAnchor: issue.location ?? "",
        summary: clipSummary(issue.message ?? "", summaryMaxLen),
        reviewerAgent,
      };
      if (issue.suggestion) {
        finding.suggestion = issue.suggestion;
      }
      findings.push(finding);
    }
  }

  // Recompute counts and enforce schema invariants 1, 2, 3.
  let blockingCount = 0;
  let advisoryCount = 0;
  for (const f of findings) {
    if (f.severity === "blocking") {
      blockingCount++;
    } else if (f.severity === "warning" || f.severity === "info") {
      advisoryCount++;
    } else {
      // The aggregator only emits {blocking, warning, info}. An 'advisory'
      // ConvergenceFindings severity is allowed by the schema enum but the
      // mapping table never produces it, so anything other than the three
      // expected values is a defect.
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
    harnessName: "plan-review",
    iteration,
    blockingCount,
    advisoryCount,
    producedAt: now().toISOString(),
    findings,
  };
}

// ---------------------------------------------------------------------------
// TOON encoder — kept in this file to share the same severity enum.
// ---------------------------------------------------------------------------

/**
 * CSV-safe quote: if a value contains a comma, newline, or double-quote,
 * wrap it in double quotes and escape interior double-quotes by doubling.
 * The TOON typed-array row format follows the same rules as RFC 4180.
 */
function csvQuote(raw: string): string {
  if (raw === "") return "";
  if (/[,\n"]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

/**
 * Encode a `ConvergenceFindings` object as TOON text suitable for atomic
 * write to `findings.toon`. The exact format matches the example in
 * findings.schema.md.
 */
export function encodeFindingsToToon(findings: ConvergenceFindings): string {
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
