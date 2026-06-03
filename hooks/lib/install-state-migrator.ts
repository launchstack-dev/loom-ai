/**
 * Pure-function migrator for install-state.toon v2 → v3.
 * No I/O. Side effects (sha256 computation, timestamps) are injected via options.
 * See agents/protocols/install-state.schema.md and schema-upgrade.md Rule 12.
 */

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

export interface DetectionResult {
  version: 1 | 2 | 3 | "unknown";
  outdated: boolean;
  reason: string | null;
}

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
  const hasSchemaVersion = /\bschemaVersion:\s*(\d+)\b/.exec(content);

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
      return {
        version: 1,
        outdated: true,
        reason: "schemaVersion: 1 — pre-v2 content-hashed inventory, migrate via Rule 12 (treat as v2 with no items)",
      };
    }
    return {
      version: "unknown",
      outdated: true,
      reason: `unrecognized schemaVersion: ${v}`,
    };
  }

  // No schemaVersion at all. Per Rule 4 historical behaviour, treat as v1.
  return {
    version: 1,
    outdated: true,
    reason: "missing schemaVersion — pre-v2 install-state, migrate via Rule 12",
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

  if (v2.schemaVersion !== 2) {
    throw new Error(
      `migrateInstallStateV2ToV3: expected schemaVersion === 2, got ${v2.schemaVersion}`
    );
  }

  const items: InstallStateV3Item[] = v2.items.map((item) => ({
    name: item.name,
    type: item.type,
    source: item.source,
    targetPath: item.targetPath,
    sha256: sha256Resolver(item.targetPath) ?? "",
    component: "loom-core",
    installedAt: item.installedAt,
  }));

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
