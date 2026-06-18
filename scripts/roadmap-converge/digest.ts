/**
 * Digest renderer for /loom-roadmap status.
 *
 * This module is PURE READ — it never writes to disk. A vitest grep guard
 * (tests/roadmap-converge/digest-purity.test.ts) enforces this invariant.
 *
 * Exported surface:
 *   buildDigest(state) → RoadmapConvergeDigest
 *   renderDigest(digest) → string
 *   renderDigestFromState(state) → string   (convenience)
 *
 * Glyphs per status (dimensionStatusLine):
 *   green  → ✓
 *   yellow → ⚠
 *   red    → ✗
 *
 * Render format (text):
 *
 *   === Roadmap Convergence Status: {slug} ===
 *   Pass: {round}/{passLimit}   Last touched: {lastTouched}   Sign-off: {signOffState}
 *   Diff since last pass: {diffSinceLastPass}
 *
 *   Dimensions:
 *     ✓ vision
 *     ⚠ milestones
 *     ✗ tool-selection
 *
 *   Open questions: {openQuestionCount}
 *   {firstQuestion}          ← only when openQuestionCount > 0
 *
 *   Next: {nextActionCommand}
 *
 * JSON output (--json flag) is produced by JSON.stringify(digest, null, 2).
 * The `renderDigest` function targets human-readable text; callers that need
 * JSON call buildDigest and serialize themselves.
 */

import type {
  OpenQuestionV1,
  RoadmapConvergeStateV1,
  RoadmapDimensionV1,
} from "../migrators/roadmap-converge-state/index.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RoadmapConvergeDigest {
  /** Roadmap slug (from state.roadmapSlug). */
  slug: string;
  /** Path to the roadmap file (from state.roadmapPath). */
  roadmapPath: string;
  /** Pass counter — state.round. */
  passNumber: number;
  /** Hard-cap on passes — state.passLimit. */
  passLimit: number;
  /** ISO 8601 — state.paused_at (most recent pass timestamp). */
  lastTouched: string;
  /** Human-readable glyph line: "✓ vision  ⚠ milestones  ✗ tool-selection". */
  dimensionStatusLine: string;
  /** Count of open_questions where resolved_at IS NULL. */
  openQuestionCount: number;
  /** Verbatim text of the first unresolved question, or undefined when none. */
  firstQuestion: string | undefined;
  /** state.roadmap_diff_summary — "+N -M lines since last pass". */
  diffSinceLastPass: string;
  /** state.next_action_hint — copyable command. */
  nextActionCommand: string;
  /** state.sign_off_state — one of not-eligible | eligible | signed-off. */
  signOffState: "not-eligible" | "eligible" | "signed-off";
  /** ISO 8601 when sign_off_state = signed-off; undefined otherwise. */
  signOffAt?: string;
}

// ---------------------------------------------------------------------------
// Glyph helpers
// ---------------------------------------------------------------------------

const STATUS_GLYPHS: Record<RoadmapDimensionV1["status"], string> = {
  green: "✓",
  yellow: "⚠",
  red: "✗",
};

/**
 * Build the per-dimension status line.
 * Output: "✓ vision  ⚠ milestones  ✗ tool-selection"
 * Empty dimensions array → "" (no output).
 */
export function buildDimensionStatusLine(dimensions: RoadmapDimensionV1[]): string {
  if (dimensions.length === 0) return "";
  return dimensions
    .map((d) => `${STATUS_GLYPHS[d.status] ?? "?"} ${d.name}`)
    .join("  ");
}

// ---------------------------------------------------------------------------
// Digest builder
// ---------------------------------------------------------------------------

/**
 * Build a RoadmapConvergeDigest from a v1 state object.
 * Pure function — no I/O.
 */
export function buildDigest(state: RoadmapConvergeStateV1): RoadmapConvergeDigest {
  const unresolvedQuestions: OpenQuestionV1[] = state.open_questions.filter(
    (q) => !q.resolved_at
  );
  const firstQuestion =
    unresolvedQuestions.length > 0 ? unresolvedQuestions[0].text : undefined;

  return {
    slug: state.roadmapSlug,
    roadmapPath: state.roadmapPath,
    passNumber: state.round,
    passLimit: state.passLimit,
    lastTouched: state.paused_at,
    dimensionStatusLine: buildDimensionStatusLine(state.dimensions),
    openQuestionCount: unresolvedQuestions.length,
    firstQuestion,
    diffSinceLastPass: state.roadmap_diff_summary,
    nextActionCommand: state.next_action_hint,
    signOffState: state.sign_off_state,
    signOffAt: state.sign_off_at,
  };
}

// ---------------------------------------------------------------------------
// Digest renderer (human-readable text)
// ---------------------------------------------------------------------------

/**
 * Render a RoadmapConvergeDigest to a human-readable string.
 * Pure function — no I/O. Output is deterministic given identical inputs.
 *
 * Satisfies the convergence target: on a state with 3 unresolved questions,
 * the output contains the literal "3 open questions" and the first question
 * text verbatim.
 */
export function renderDigest(digest: RoadmapConvergeDigest): string {
  const lines: string[] = [];

  lines.push(`=== Roadmap Convergence Status: ${digest.slug} ===`);
  lines.push(
    `Pass: ${digest.passNumber}/${digest.passLimit}   ` +
    `Last touched: ${digest.lastTouched || "(none)"}   ` +
    `Sign-off: ${digest.signOffState}`
  );

  if (digest.diffSinceLastPass) {
    lines.push(`Diff since last pass: ${digest.diffSinceLastPass}`);
  }

  lines.push("");
  if (digest.dimensionStatusLine) {
    lines.push("Dimensions:");
    for (const segment of digest.dimensionStatusLine.split("  ")) {
      if (segment.trim()) lines.push(`  ${segment.trim()}`);
    }
  } else {
    lines.push("Dimensions: (none — run /loom-roadmap converge to begin)");
  }

  lines.push("");
  const qLabel =
    digest.openQuestionCount === 1
      ? "1 open question"
      : `${digest.openQuestionCount} open questions`;
  lines.push(`Open questions: ${qLabel}`);

  if (digest.firstQuestion !== undefined) {
    lines.push(`  Q: ${digest.firstQuestion}`);
  }

  if (digest.signOffAt) {
    lines.push(`Signed off: ${digest.signOffAt}`);
  }

  lines.push("");
  lines.push(`Next: ${digest.nextActionCommand || "(none)"}`);

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Convenience: state → rendered string
// ---------------------------------------------------------------------------

/**
 * Convenience wrapper: builds the digest from state, renders to string.
 * Pure function — no I/O.
 */
export function renderDigestFromState(state: RoadmapConvergeStateV1): string {
  return renderDigest(buildDigest(state));
}
