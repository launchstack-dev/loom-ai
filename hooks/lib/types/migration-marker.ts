/**
 * MigrationMarker — per-project file at `.loom/migration-in-progress`.
 *
 * Written by F-05 `/loom-migrate-to-plugin` (and F-12 `/loom-update`)
 * BEFORE any mutation, so a crash leaves a resumable marker. Cleared on
 * success.
 *
 * Schema reference: agents/protocols/migration-marker.schema.md
 */

import type { Channel } from './plugin-install-state.js';

/**
 * Migration/update step completed. `--resume` reads this and continues from
 * the next step:
 *   - `download`  — tarball fetched, sha256 not yet verified
 *   - `verify`    — sha256 verified, files not yet swapped
 *   - `swap`      — files swapped, marker not yet cleared
 *   - `clear-marker` — terminal success (marker about to be deleted)
 *   - `null`      — no step yet completed (just-started)
 */
export type MigrationStep =
  | 'download'
  | 'verify'
  | 'swap'
  | 'clear-marker'
  | null;

export interface MigrationMarker {
  /** ISO 8601 / RFC 3339 datetime migration began. */
  startedAt: string;
  /** Channel migrating from. */
  fromChannel: Channel;
  /** Channel migrating to. */
  toChannel: Channel;
  /** Last completed step; `--resume` continues from the next one. */
  stepCompleted: MigrationStep;
}
