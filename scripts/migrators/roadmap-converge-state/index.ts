/**
 * Pure-function migrator for RoadmapConvergeState (.roadmap-converge/*\/state.toon).
 *
 * Registered with the F-13 schema-version runtime via
 * protocols/schema-versions.toon under `roadmapConvergeState`
 * (currentVersion: 1, migratorKind: module).
 *
 * Pattern mirrors hooks/lib/install-state-migrator.ts and Loom F-13:
 *   - Frozen MIGRATIONS map keyed by "fromV->toV"
 *   - Pure `migrateToLatest(input, fromVersion, opts, targetVersion?, registry?)` walker
 *   - Throws MigrationDowngradeError if fromVersion > targetVersion
 *   - Throws MissingMigrationStepError if a chain step is absent from the registry
 *
 * No I/O. Side effects (timestamps, hashing) are injected via `MigrationOptions`.
 *
 * Phase 0a ships v1 as the only version. There are no migration steps yet —
 * MIGRATIONS is empty by design. The walker degenerates to a no-op when
 * fromVersion === targetVersion === 1. Future v2 will add a "1->2" entry.
 *
 * See protocols/roadmap-converge-state.schema.toon for the field
 * catalogue and PLAN-roadmap-converge-harness.md § Schema/Type Definitions
 * for the canonical English-language spec.
 */

import {
  MigrationDowngradeError,
  MissingMigrationStepError,
} from "../../../hooks/lib/migration-errors.js";

// ---------------------------------------------------------------------------
// Type surface — v1
// ---------------------------------------------------------------------------

export type RoadmapDimensionStatus = "green" | "yellow" | "red";

export type RoadmapDeltaSinceLast =
  | "improved"
  | "same"
  | "degraded"
  | "invalidated"
  | "new";

export type SignOffState = "not-eligible" | "eligible" | "signed-off";

export type FindingSeverity = "blocking" | "warning" | "nit";

export interface RoadmapDimensionV1 {
  name: string;
  status: RoadmapDimensionStatus;
  evidence?: string;
  blockers?: string[];
  evidenceRef?: string[];
  delta_since_last: RoadmapDeltaSinceLast;
}

export interface DimensionSnapshotV1 {
  name: string;
  status: RoadmapDimensionStatus;
}

export interface OpenQuestionV1 {
  id: string;
  dimension: string;
  text: string;
  asked_at: string;
  resolved_at?: string;
  resolution?: string;
}

export interface ArchivedDimensionV1 {
  name: string;
  reason: string;
  timestamp: string;
}

export interface SuppressedFindingV1 {
  id: string;
  dimension: string;
  severity: FindingSeverity;
  text: string;
  suppressed_at: string;
}

export interface RoadmapConvergeStateV1 {
  schemaVersion: 1;
  roadmapPath: string;
  roadmapSlug: string;
  archetype: string;
  round: number;
  passLimit: number;
  dimensions: RoadmapDimensionV1[];
  dimensionSnapshot: DimensionSnapshotV1[];
  open_questions: OpenQuestionV1[];
  archivedDimensions: ArchivedDimensionV1[];
  suppressedFindings: SuppressedFindingV1[];
  roadmap_diff_summary: string;
  paused_at: string;
  last_reviewer: string;
  next_action_hint: string;
  content_hash: string;
  sign_off_state: SignOffState;
  sign_off_at?: string;
  sign_off_diff_hash?: string;
}

/** Any-version union — grows with each major schema bump. */
export type AnyRoadmapConvergeState = RoadmapConvergeStateV1;

// ---------------------------------------------------------------------------
// Migration options
// ---------------------------------------------------------------------------

export interface MigrationOptions {
  /** Override `now()` for deterministic tests. Returns ISO-8601 string. */
  now?: () => string;
  /**
   * Optional callback invoked for non-fatal issues during migration. The
   * migration still succeeds; callers decide whether to surface or log.
   */
  onWarning?: (message: string) => void;
}

// ---------------------------------------------------------------------------
// Migration registry — frozen at module load (CWE-913)
// ---------------------------------------------------------------------------

export type MigrationStep = (
  input: AnyRoadmapConvergeState,
  opts: MigrationOptions
) => AnyRoadmapConvergeState;

export type MigrationRegistry = Readonly<Record<string, MigrationStep>>;

/**
 * Built-in migration steps. EMPTY at v1 — the only version. A future
 * v2 ships will add `"1->2": migrateRoadmapConvergeStateV1ToV2`.
 *
 * Frozen so production code cannot mutate the privileged execution
 * surface. Tests inject stubs by passing a separate registry to
 * `migrateToLatest`, not by mutating this constant.
 */
export const MIGRATIONS: MigrationRegistry = Object.freeze({});

/** Current schema version targeted by `migrateToLatest`. Mirror of registry. */
export const CURRENT_VERSION = 1;

// ---------------------------------------------------------------------------
// Chain walker
// ---------------------------------------------------------------------------

/**
 * Walk the migration chain from `fromVersion` to `targetVersion` (default
 * `CURRENT_VERSION`). Throws if any step in the chain is missing from the
 * supplied `registry`.
 *
 * Production callers omit `registry` and get the frozen built-in MIGRATIONS.
 * Tests supply `{ ...MIGRATIONS, "1->2": stub }` to exercise future-version
 * walks without mutating module state.
 *
 * Examples:
 *   migrateToLatest(v1Parsed, 1)                                          // no-op, returns v1
 *   migrateToLatest(v1Parsed, 1, opts, 2, { ...MIGRATIONS, "1->2": stub }) // → v2
 *   migrateToLatest(future, 2, opts)                                       // throws MigrationDowngradeError
 */
export function migrateToLatest(
  input: AnyRoadmapConvergeState,
  fromVersion: number,
  opts: MigrationOptions = {},
  targetVersion: number = CURRENT_VERSION,
  registry: MigrationRegistry = MIGRATIONS
): AnyRoadmapConvergeState {
  if (fromVersion === targetVersion) {
    return input;
  }
  if (fromVersion > targetVersion) {
    throw new MigrationDowngradeError(fromVersion, targetVersion);
  }

  let current: AnyRoadmapConvergeState = input;
  for (let v = fromVersion; v < targetVersion; v++) {
    const key = `${v}->${v + 1}`;
    const step = registry[key];
    if (!step) {
      throw new MissingMigrationStepError(key, fromVersion, targetVersion);
    }
    current = step(current, opts);
  }
  return current;
}
