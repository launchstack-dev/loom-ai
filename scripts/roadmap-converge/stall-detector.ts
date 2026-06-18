/**
 * Stall detector for /loom-roadmap converge.
 *
 * A stall is defined as:
 *   - state.round >= 2  (at least two passes have completed)
 *   - state.dimensionSnapshot[] (prior pass) statuses are ALL identical to
 *     current state.dimensions[] statuses
 *   - No open_questions were resolved in this round (resolvedThisRound === 0)
 *
 * When a stall is detected the driver sets state.halted_reason = "halted-stalled"
 * and emits STALL_DETECTED to stderr before returning exitCode=1.
 *
 * AC FC-03: the stall detector reads state.dimensionSnapshot[] (NOT audit-trail
 * files). The snapshot is written at the END of each pass, BEFORE the next-pass
 * reviewer fan-out overwrites state.dimensions[].
 */

import type {
  DimensionSnapshotV1,
  RoadmapConvergeStateV1,
  RoadmapDimensionStatus,
  RoadmapDimensionV1,
} from "../migrators/roadmap-converge-state/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StallCheckInput {
  /** State AFTER the current pass reviewer fan-out has been applied. */
  state: RoadmapConvergeStateV1;
  /** Number of open_questions resolved during this round (resolved_at set). */
  resolvedThisRound: number;
}

export type StallCheckResult =
  | { stalled: false }
  | { stalled: true; reason: string };

// ---------------------------------------------------------------------------
// Main check
// ---------------------------------------------------------------------------

/**
 * Determine whether the current pass is a stall.
 *
 * A stall requires ALL THREE conditions to be true simultaneously:
 *   1. state.round >= 2 — at least two passes have completed.
 *   2. Every dimension's status is unchanged vs. dimensionSnapshot[] (prior pass).
 *   3. resolvedThisRound === 0 — user resolved no questions this round.
 *
 * If dimensionSnapshot[] is empty (round 1 cold-start) condition 2 cannot
 * hold — returns stalled=false.
 */
export function checkStall(input: StallCheckInput): StallCheckResult {
  const { state, resolvedThisRound } = input;

  // Condition 1: need at least 2 completed passes.
  if (state.round < 2) {
    return { stalled: false };
  }

  // Condition 3: user resolved at least one question → not stalled.
  if (resolvedThisRound > 0) {
    return { stalled: false };
  }

  // Condition 2: compare dimensionSnapshot[] vs current dimensions[].
  const snapshot = state.dimensionSnapshot;
  if (snapshot.length === 0) {
    // No prior snapshot available — cannot confirm stall.
    return { stalled: false };
  }

  const identical = dimensionsIdentical(state.dimensions, snapshot);
  if (!identical) {
    return { stalled: false };
  }

  return {
    stalled: true,
    reason: buildStallReason(state),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when every dimension in `current` has a matching entry in
 * `snapshot` with the same status, AND the set of names is the same.
 *
 * Extra dimensions in `current` (not in snapshot) → not identical.
 * Missing dimensions in `current` (present in snapshot) → not identical.
 */
function dimensionsIdentical(
  current: RoadmapDimensionV1[],
  snapshot: DimensionSnapshotV1[]
): boolean {
  if (current.length !== snapshot.length) return false;

  const snapshotMap = new Map<string, RoadmapDimensionStatus>();
  for (const s of snapshot) {
    snapshotMap.set(s.name, s.status);
  }

  for (const dim of current) {
    const prior = snapshotMap.get(dim.name);
    if (prior === undefined) return false; // new dimension appeared
    if (prior !== dim.status) return false;
  }

  return true;
}

function buildStallReason(state: RoadmapConvergeStateV1): string {
  const statuses = state.dimensions
    .map((d) => `${d.name}=${d.status}`)
    .join(", ");
  return (
    `Pass ${state.round} produced identical dimension statuses to prior pass` +
    ` and no questions were resolved. Statuses: [${statuses}].` +
    ` Hint: retire stale dimensions with /loom-roadmap retire-dimension or re-run with --force.`
  );
}

// ---------------------------------------------------------------------------
// Pass-cap check
// ---------------------------------------------------------------------------

export type PassCapResult =
  | { exceeded: false }
  | { exceeded: true; reason: string };

/**
 * Check whether the pass cap has been reached without achieving all-green.
 *
 * Returns exceeded=true when:
 *   - state.round === state.passLimit
 *   - At least one dimension is NOT green
 *
 * The caller sets state.halted_reason = "halted-pass-cap", emits
 * PASS_CAP_REACHED to stderr, sets next_action_hint, and returns exitCode=1.
 */
export function checkPassCap(state: RoadmapConvergeStateV1): PassCapResult {
  if (state.round < state.passLimit) {
    return { exceeded: false };
  }

  const nonGreen = state.dimensions.filter((d) => d.status !== "green");
  if (nonGreen.length === 0) {
    // All-green — pass cap reached but no blocker.
    return { exceeded: false };
  }

  const detail = nonGreen.map((d) => `${d.name}=${d.status}`).join(", ");
  return {
    exceeded: true,
    reason:
      `Pass cap reached (round ${state.round}/${state.passLimit}) with non-green dimensions: [${detail}].`,
  };
}
