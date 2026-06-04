/**
 * Pure-function migrator for install-state.toon v2 → v3.
 * No I/O. Side effects (sha256 computation, timestamps) are injected via options.
 * See agents/protocols/install-state.schema.md and schema-upgrade.md Rule 12.
 */

import {
  MigrationDowngradeError,
  MigrationSchemaVersionMismatchError,
  MissingMigrationStepError,
} from "./migration-errors.js";

export interface InstallStateV2 {
  schemaVersion: 2;
  lastSynced: string;
  items: InstallStateV2Item[];
}

export interface InstallStateV2Item {
  name: string;
  type: string;
  source: string;
  targetPath: string;
  installedAt: string;
}

export interface InstallStateV3 {
  schemaVersion: 3;
  protocolVersion: number;
  lastSynced: string;
  loomCoreVersion: string;
  loomHooksVersion: string;
  catalogVersion: number;
  components: InstallStateV3Component[];
  items: InstallStateV3Item[];
  snapshot?: InstallStateV3Snapshot;
}

export interface InstallStateV3Component {
  name: string;
  version: string;
  kind: "core" | "hooks" | "kit";
  pinned: boolean;
  installedAt: string;
}

export interface InstallStateV3Item {
  name: string;
  type: string;
  source: string;
  targetPath: string;
  sha256: string;
  component: string;
  installedAt: string;
}

export interface InstallStateV3Snapshot {
  versionBeforeUpgrade: string;
  snapshotPath: string;
  snapshotSha256: string;
  capturedAt: string;
  expiresAt: string;
}

export interface InstallStateDetectionResult {
  version: 2 | 3 | "unknown";
  outdated: boolean;
  reason: string | null;
}

/** @deprecated Use `InstallStateDetectionResult`. Kept for one cycle for callers. */
export type DetectionResult = InstallStateDetectionResult;

export interface MigrationOptions {
  /** Default core version when migrating from v2 (which has no version concept). Defaults to "0.0.0". */
  defaultCoreVersion?: string;
  /** Default hooks version. Defaults to "0.0.0". */
  defaultHooksVersion?: string;
  /** Default catalog version. Defaults to 2 (the version that paired with install-state v2). */
  defaultCatalogVersion?: number;
  /** Default protocol version. Defaults to 3. */
  defaultProtocolVersion?: number;
  /** Resolver for per-file sha256. Receives targetPath, returns hex string or null when unreadable. */
  sha256Resolver?: (targetPath: string) => string | null;
  /** Override `now()` for deterministic tests. Returns ISO-8601 string. */
  now?: () => string;
  /**
   * Optional callback invoked for non-fatal issues during migration (e.g. a
   * sha256Resolver returned null for an unreadable file). The migration still
   * succeeds — the caller decides whether to log, surface to the user, or
   * fail closed at a higher layer. Empty sha256 in v3 always means
   * "unreadable at migration time," NOT "intentionally blank."
   */
  onWarning?: (message: string) => void;
}

const TOON_V3_MARKERS = [
  "protocolVersion:",
  "loomCoreVersion:",
  "loomHooksVersion:",
  "catalogVersion:",
  "components[",
] as const;

/**
 * Inspect raw TOON content (or a parsed object) and report its schema version
 * and whether it's outdated relative to current (v3).
 */
export function detectInstallStateVersion(content: string): DetectionResult {
  // Line-anchored to defeat string-smuggling: a malicious v2 file can't put
  // `schemaVersion: 3` inside an item value and trick the detector. Trailing-
  // whitespace allowed; trailing non-digit characters (e.g. `3.9`, `3abc`) fall
  // through to the "missing schemaVersion" branch instead of silently truncating.
  const hasSchemaVersion = /^schemaVersion:\s*(\d+)\s*$/m.exec(content);

  if (hasSchemaVersion) {
    const v = parseInt(hasSchemaVersion[1], 10);
    if (v === 3) {
      const missingMarkers = TOON_V3_MARKERS.filter((m) => !content.includes(m));
      if (missingMarkers.length > 0) {
        return {
          version: 3,
          outdated: true,
          reason: `v3 declared but missing required markers: ${missingMarkers.join(", ")}`,
        };
      }
      return { version: 3, outdated: false, reason: null };
    }
    if (v === 2) {
      return {
        version: 2,
        outdated: true,
        reason: "schemaVersion: 2 — migrate via Rule 12",
      };
    }
    if (v === 1) {
      // v1 (pre-2026-04 content-hashed inventory) had no users at v3 launch.
      // We collapse it into "outdated v2-equivalent" so the chain walker can
      // run the 2->3 step. Caller is responsible for inspecting items[] shape.
      return {
        version: 2,
        outdated: true,
        reason: "schemaVersion: 1 — pre-v2 content-hashed inventory; chain walks as v2→v3 (verify items[] shape)",
      };
    }
    return {
      version: "unknown",
      outdated: true,
      reason: `unrecognized schemaVersion: ${v}`,
    };
  }

  // No schemaVersion at all — pre-v2 file without a version marker.
  // Same treatment as v1: collapse to v2-equivalent for chain-walker compatibility.
  return {
    version: 2,
    outdated: true,
    reason: "missing schemaVersion — pre-v2 install-state; chain walks as v2→v3",
  };
}

/**
 * Migrate a parsed v2 install-state object to v3. Pure function — no I/O.
 * Per-file sha256 and `now` are injected via options so callers can drive
 * deterministic tests or supply real implementations at runtime.
 */
export function migrateInstallStateV2ToV3(
  v2: InstallStateV2,
  opts: MigrationOptions = {}
): InstallStateV3 {
  const now = opts.now ? opts.now() : new Date().toISOString();
  const sha256Resolver = opts.sha256Resolver ?? (() => null);
  const coreVersion = opts.defaultCoreVersion ?? "0.0.0";
  const hooksVersion = opts.defaultHooksVersion ?? "0.0.0";
  const catalogVersion = opts.defaultCatalogVersion ?? 2;
  const protocolVersion = opts.defaultProtocolVersion ?? 3;

  if (v2 == null || (v2 as { schemaVersion?: unknown }).schemaVersion !== 2) {
    throw new MigrationSchemaVersionMismatchError(
      2,
      v2 == null ? v2 : (v2 as { schemaVersion?: unknown }).schemaVersion
    );
  }

  const items: InstallStateV3Item[] = v2.items.map((item) => {
    const resolved = sha256Resolver(item.targetPath);
    if (resolved == null) {
      opts.onWarning?.(
        `sha256Resolver returned null for ${item.targetPath} — sha256 set to "" (empty means "unreadable at migration time")`
      );
    }
    return {
      name: item.name,
      type: item.type,
      source: item.source,
      targetPath: item.targetPath,
      sha256: resolved ?? "",
      component: "loom-core",
      installedAt: item.installedAt,
    };
  });

  return {
    schemaVersion: 3,
    protocolVersion,
    lastSynced: v2.lastSynced,
    loomCoreVersion: coreVersion,
    loomHooksVersion: hooksVersion,
    catalogVersion,
    components: [
      {
        name: "loom-core",
        version: coreVersion,
        kind: "core",
        pinned: false,
        installedAt: now,
      },
    ],
    items,
  };
}

// ---------------------------------------------------------------------------
// Chained migration walker
// ---------------------------------------------------------------------------
//
// MIGRATIONS maps "fromVersion->toVersion" → migration function. When a future
// v4 ships, add a "3->4" entry pointing to migrateInstallStateV3ToV4. The
// walker handles any chain length — a user upgrading from v2 directly to v5
// gets v2→v3→v4→v5 in sequence.
//
// Each step receives a parsed object of its `from` version and returns the
// next version's shape. Options are forwarded through the chain unchanged.

export type AnyInstallState = InstallStateV2 | InstallStateV3;

export type MigrationStep = (input: AnyInstallState, opts: MigrationOptions) => AnyInstallState;

export type MigrationRegistry = Readonly<Record<string, MigrationStep>>;

/**
 * Built-in migration steps. Frozen at module load so production code cannot
 * mutate the privileged execution surface (CWE-913). Tests inject stub steps
 * by passing a separate registry to `migrateToLatest`, not by mutating this.
 */
export const MIGRATIONS: MigrationRegistry = Object.freeze({
  "2->3": (input: AnyInstallState, opts: MigrationOptions) =>
    migrateInstallStateV2ToV3(input as InstallStateV2, opts),
});

/** Current schema version targeted by `migrateToLatest`. Mirror of registry. */
export const CURRENT_VERSION = 3;

/**
 * Walk the migration chain from `fromVersion` to `targetVersion` (default
 * `CURRENT_VERSION`). Throws if any step in the chain is missing from the
 * supplied `registry`.
 *
 * Production callers omit `registry` and get the frozen built-in MIGRATIONS.
 * Tests supply `{ ...MIGRATIONS, "3->4": stub }` to exercise future-version
 * walks without mutating module state.
 *
 * @example
 *   migrateToLatest(v2Parsed, 2, { sha256Resolver })                              // → v3
 *   migrateToLatest(v2Parsed, 2, opts, 4, { ...MIGRATIONS, "3->4": stub })        // → v4
 */
export function migrateToLatest(
  input: AnyInstallState,
  fromVersion: number,
  opts: MigrationOptions = {},
  targetVersion: number = CURRENT_VERSION,
  registry: MigrationRegistry = MIGRATIONS
): AnyInstallState {
  if (fromVersion === targetVersion) {
    return input;
  }
  if (fromVersion > targetVersion) {
    throw new MigrationDowngradeError(fromVersion, targetVersion);
  }

  let current: AnyInstallState = input;
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
