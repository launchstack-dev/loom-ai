/**
 * DoctorReport — written by `/loom-doctor` to `~/.cache/loom/doctor-report.toon`.
 *
 * `reportVersion` is a discriminator:
 *   - `1` — M-01 checks (Phase 9, F-04 v1)
 *   - `2` — M-02 checks (Phase 14, F-04 v2)
 *
 * Schema reference: protocols/doctor-report.schema.md
 */

import type { Channel, Source } from './plugin-install-state.js';

/** Per-check status tristate. */
export type CheckStatus = 'green' | 'yellow' | 'red';

/** Overall aggregate status across all checks. */
export type DoctorOverall = 'green' | 'yellow' | 'red';

/** One row in `checks[]`. */
export interface CheckRow {
  /** Unique check identifier (primary key per row). */
  name: string;
  /** Grouping label, e.g. `hooks`, `runtime`, `install`, `network`. */
  category: string;
  status: CheckStatus;
  /** Human-readable detail line shown to the user. */
  detail: string;
  /** Suggested fix command (e.g. `/loom-update`) or null. */
  fixCommand: string | null;
  /** Docs URL for deeper context or null. */
  docsUrl: string | null;
}

export interface DoctorReport {
  /** Discriminator: 1 = M-01, 2 = M-02. */
  reportVersion: 1 | 2;
  /** ISO 8601 / RFC 3339 datetime the report was generated. */
  generatedAt: string;
  /** Semver `vX.Y.Z`, copied from `install.toon`. */
  loomVersion: string;
  /** Channel from `install.toon` (top-level per FC-08). */
  installChannel: Channel;
  /** Source from `install.toon`. */
  installSource: Source;
  /** Aggregate status. */
  overall: DoctorOverall;
  /** All checks executed this run. */
  checks: CheckRow[];
  /** Path to `.tar.gz` diagnostic bundle when `--bundle` was used. */
  diagnosticBundle: string | null;
}
