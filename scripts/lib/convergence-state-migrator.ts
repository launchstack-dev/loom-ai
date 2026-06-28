/**
 * convergence-state.toon v1 → v2 migrator (F-18 Phase 0, sub-4b).
 *
 * Mirrors the F-13 walker pattern from
 * scripts/migrators/roadmap-converge-state/detect.ts:
 *
 *   detectConvergenceStateVersion(content) -> {detected, current, outdated}
 *   migrateConvergenceStateV1toV2(content) -> string  (pure, idempotent)
 *
 * v1 → v2 adds:
 *   - schemaVersion: 2 marker
 *   - loops[N]{loopId,symptom,rung,verifiedRed,runtimeMs,linkedLoops,retiredAt}: typed array
 *
 * The migrator is PURE — no I/O. The CLI wrapper in
 * scripts/migrate-convergence-state.ts is responsible for atomic writes.
 *
 * Idempotency: running the migrator twice produces byte-identical output
 * because the second pass detects current=2 and returns the content
 * unchanged.
 */

export const CONVERGENCE_STATE_CURRENT_VERSION = 2;

export interface ConvergenceStateDetectionResult {
  /** Parsed schemaVersion from content, or 1 when no marker found (pre-versioned defaults to v1). */
  detected: number;
  /** Current schema version targeted by this migrator build. */
  current: number;
  /** True when `detected < current`. */
  outdated: boolean;
}

/**
 * Inspect raw TOON content and report its declared schemaVersion vs. current.
 *
 * Pre-F-18 convergence-state.toon files have no `schemaVersion:` marker;
 * those are treated as v1.
 */
export function detectConvergenceStateVersion(
  content: string,
): ConvergenceStateDetectionResult {
  // Line-anchored — defeats string-smuggling per F-13 detection contract.
  const match = /^schemaVersion:\s*(\d+)\s*$/m.exec(content);

  if (!match) {
    // No marker → pre-versioned v1.
    return {
      detected: 1,
      current: CONVERGENCE_STATE_CURRENT_VERSION,
      outdated: true,
    };
  }

  const detected = parseInt(match[1], 10);

  if (detected > CONVERGENCE_STATE_CURRENT_VERSION) {
    throw new Error(
      `MIGRATION_SCHEMA_MISMATCH: convergence-state.toon declares schemaVersion ${detected} but this runtime only supports up to ${CONVERGENCE_STATE_CURRENT_VERSION}.`,
    );
  }

  return {
    detected,
    current: CONVERGENCE_STATE_CURRENT_VERSION,
    outdated: detected < CONVERGENCE_STATE_CURRENT_VERSION,
  };
}

/**
 * Migrate convergence-state.toon v1 content to v2. Idempotent: applying
 * twice produces byte-identical output.
 *
 * v1 → v2 changes:
 *   - Stamp `schemaVersion: 2` at the top of the document (after any
 *     leading frontmatter-style comments).
 *   - Append an empty `loops[0]{...}:` typed-array header so downstream
 *     readers can rely on the column shape being present even when no
 *     loops exist yet. Existing data is preserved verbatim.
 *
 * The migrator is PURE; it returns the new content as a string.
 */
export function migrateConvergenceStateV1toV2(content: string): string {
  const detection = detectConvergenceStateVersion(content);

  // Idempotent fast-path: already current.
  if (detection.detected === CONVERGENCE_STATE_CURRENT_VERSION) {
    return content;
  }

  if (detection.detected !== 1) {
    throw new Error(
      `MIGRATION_SCHEMA_MISMATCH: expected v1 content, got v${detection.detected}.`,
    );
  }

  // Normalise trailing newline handling so the appended loops table is
  // always preceded by exactly one blank line.
  let body = content.replace(/\s+$/u, "");

  // Insert schemaVersion marker if absent. We place it at the very top so
  // future detect calls hit it on line 1.
  if (!/^schemaVersion:\s*\d+\s*$/m.test(body)) {
    body = `schemaVersion: ${CONVERGENCE_STATE_CURRENT_VERSION}\n${body}`;
  } else {
    body = body.replace(
      /^schemaVersion:\s*\d+\s*$/m,
      `schemaVersion: ${CONVERGENCE_STATE_CURRENT_VERSION}`,
    );
  }

  // Append the empty loops[] table.
  const loopsHeader =
    "loops[0]{loopId,symptom,rung,verifiedRed,runtimeMs,linkedLoops,retiredAt}:";

  // Avoid double-appending if (somehow) already present.
  if (!body.includes("loops[")) {
    body = `${body}\n\n${loopsHeader}\n`;
  } else if (!body.endsWith("\n")) {
    body = `${body}\n`;
  }

  return body;
}
