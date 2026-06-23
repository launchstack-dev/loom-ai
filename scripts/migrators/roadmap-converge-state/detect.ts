/**
 * Version detection for RoadmapConvergeState TOON content.
 *
 * Mirrors the line-anchored regex pattern from
 * hooks/lib/install-state-migrator.ts § detectInstallStateVersion to defeat
 * string-smuggling: a malicious file cannot inject `schemaVersion: 1` inside
 * a field value and trick the detector.
 *
 * Return shape matches the F-13 detection contract used by /loom-upgrade:
 *   - detected: integer schema version parsed from content, or 0 when absent
 *   - current:  CURRENT_VERSION constant from the migrator
 *   - outdated: true when detected < current OR detected is unrecognised
 *
 * Throws MigrationDowngradeError when content declares a *future* version
 * (detected > current). The runtime cannot read forward; this is a hard fail.
 *
 * See PLAN-roadmap-converge-harness.md Scenario S-02 for the contract this
 * implements.
 */

import { MigrationDowngradeError } from "../../../hooks/lib/migration-errors.js";
import { CURRENT_VERSION } from "./index.js";

export interface RoadmapConvergeStateDetectionResult {
  /** Parsed schemaVersion from content, or 0 when no marker found. */
  detected: number;
  /** Current schema version targeted by this migrator build. */
  current: number;
  /** True when `detected` is less than `current` OR the marker is missing/unparseable. */
  outdated: boolean;
}

/**
 * Inspect raw TOON content and report its declared schemaVersion vs. current.
 *
 * @throws {MigrationDowngradeError} when `detected > current` (file from the future).
 */
export function detectRoadmapConvergeStateVersion(
  content: string
): RoadmapConvergeStateDetectionResult {
  // Line-anchored — `schemaVersion:` MUST appear at the start of a line,
  // with no surrounding noise. This rejects values smuggled inside string
  // fields (e.g., a question text that happens to contain "schemaVersion: 99").
  const match = /^schemaVersion:\s*(\d+)\s*$/m.exec(content);

  if (!match) {
    // No marker — treat as pre-versioned content. Outdated by definition;
    // caller is responsible for verifying field shape before invoking
    // migrateToLatest.
    return { detected: 0, current: CURRENT_VERSION, outdated: true };
  }

  const detected = parseInt(match[1], 10);

  if (detected > CURRENT_VERSION) {
    // Forward-version content — this runtime cannot read it. Per F-13 the
    // only recovery is to upgrade the runtime or roll back the file from a
    // snapshot. Throwing here keeps the contract symmetrical with the
    // downgrade case enforced inside migrateToLatest.
    throw new MigrationDowngradeError(detected, CURRENT_VERSION);
  }

  return {
    detected,
    current: CURRENT_VERSION,
    outdated: detected < CURRENT_VERSION,
  };
}
