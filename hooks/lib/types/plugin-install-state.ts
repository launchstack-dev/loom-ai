/**
 * InstallState — per-machine record at `~/.loom/install.toon`.
 *
 * Tracks what Loom version is installed, how it was installed, and any
 * partial-install or in-progress-update state. Consumed by `/loom-doctor`
 * (F-04), `/loom-update` (F-12), and the F-05 migration flow.
 *
 * Schema reference: agents/protocols/plugin-install-state.schema.md
 */

/** Distribution channel (C-06). */
export type Channel = 'curl' | 'plugin';

/** Origin of the install (C-06). */
export type Source =
  | 'curl-script'
  | 'marketplace-browse'
  | 'self-hosted-url'
  | 'direct-link'
  | 'migration'
  | 'beta-channel';

/** Recorded in `migratedFrom` when an install crossed channels via F-05. */
export interface MigratedFrom {
  channel: Channel;
  /** Semver `vX.Y.Z` of the previous channel install. */
  version: string;
}

/**
 * Active update payload. When present, an update is mid-flight. Cleared on
 * success. Replaced with the literal `'failed'` when `/loom-update --resume`
 * hits an unrecoverable condition (terminal state — `/loom-update` will not
 * resume from here; user must run `/loom-update --check` or `/loom-doctor`).
 */
export interface UpdateInProgressPayload {
  /** Semver `vX.Y.Z` of the version being upgraded from. */
  fromVersion: string;
  /** Semver `vX.Y.Z` of the target version. */
  toVersion: string;
  /** ISO 8601 / RFC 3339 datetime the update started. */
  startedAt: string;
}

export type UpdateInProgress = UpdateInProgressPayload | 'failed' | null;

/**
 * Forensic trace of a partially-failed install. Populated by the installer
 * when a write step fails after others succeed. Consumed by F-04
 * `install-interrupted` red check.
 */
export interface InstallError {
  /** Symbolic name of the failed install step. */
  step: string;
  /** Human-readable failure description. */
  message: string;
  /** ISO 8601 / RFC 3339 datetime of failure. */
  timestamp: string;
}

export interface InstallState {
  /** Installed Loom version. Matches `/^v\d+\.\d+\.\d+$/`. */
  installedVersion: string;
  /** ISO 8601 / RFC 3339 datetime install completed. */
  installTimestamp: string;
  /** HTTPS URL the install was fetched from. */
  installSourceUrl: string;
  /** Runtime identifier, e.g. `node-20.11`, `bun-1.0.x`. */
  runtimeVersion: string;
  /** Distribution channel (C-06). */
  channel: Channel;
  /** Install origin (C-06). */
  source: Source;
  /** Populated by F-05 when this install resulted from a cross-channel migration. */
  migratedFrom: MigratedFrom | null;
  /** ISO 8601 / RFC 3339 datetime of last telemetry ping; null when `doNotTrack` is true. */
  lastPing: string | null;
  /** True after the user opts out of telemetry (F-11). Default false. */
  doNotTrack: boolean;
  /** See {@link UpdateInProgress}. */
  updateInProgress: UpdateInProgress;
  /** Forensic trace of last partial install failure, or null when clean. */
  installError: InstallError | null;
  /**
   * Semver `vX.Y.Z` if the user pinned a version via
   * `claude plugin add loom@<version>`. Honored by F-12 `/loom-update`.
   */
  pinnedVersion: string | null;
}
