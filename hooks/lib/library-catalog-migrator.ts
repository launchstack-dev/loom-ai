/**
 * Pure-function migrator for library.yaml v2 → v3.
 * No I/O. The caller parses YAML, hands us an object, gets a v3 object back.
 * See agents/protocols/library-catalog.schema.md and schema-upgrade.md Rule 13.
 */

export interface LibraryCatalogV2 {
  catalog_version: 2;
  repo: string;
  default_dirs: unknown;
  library: unknown;
  kits?: KitEntry[];
}

export interface LibraryCatalogV3 {
  catalog_version: 3;
  repo: string;
  loomCoreVersion: string;
  loomHooksVersion: string;
  releases: ReleaseEntry[];
  default_dirs: unknown;
  library: unknown;
  kits: KitEntry[];
}

export interface KitEntry {
  name: string;
  version: string;
  minLoomVersion?: number;
  minCoreVersion?: string;
  minHooksVersion?: string;
  [key: string]: unknown;
}

export interface ReleaseEntry {
  version: string;
  coreTarball: string;
  hooksTarball: string;
  cosignSignature: string;
  sha256Manifest: string;
  releasedAt: string;
}

export interface DetectionResult {
  version: 1 | 2 | 3 | "unknown";
  outdated: boolean;
  reason: string | null;
}

export interface MigrationOptions {
  coreVersion: string;
  hooksVersion: string;
  /** When provided, a single release entry is synthesized from this and the repo URL. */
  initialRelease?: {
    version: string;
    releasedAt: string;
  };
}

const V3_TOP_LEVEL_MARKERS = [
  "loomCoreVersion:",
  "loomHooksVersion:",
  "releases:",
] as const;

/**
 * Detect whether raw library.yaml content (string) is v1, v2, or v3.
 * Heuristic: explicit `catalog_version` field plus presence of v3 markers.
 */
export function detectLibraryCatalogVersion(content: string): DetectionResult {
  const match = /^\s*catalog_version:\s*(\d+)/m.exec(content);

  if (!match) {
    return {
      version: 1,
      outdated: true,
      reason: "missing catalog_version — pre-v2 catalog, migrate via Rule 13",
    };
  }

  const v = parseInt(match[1], 10);
  if (v === 3) {
    const missing = V3_TOP_LEVEL_MARKERS.filter((m) => !content.includes(m));
    if (missing.length > 0) {
      return {
        version: 3,
        outdated: true,
        reason: `v3 declared but missing top-level fields: ${missing.join(", ")}`,
      };
    }
    return { version: 3, outdated: false, reason: null };
  }
  if (v === 2) {
    return {
      version: 2,
      outdated: true,
      reason: "catalog_version: 2 — migrate via Rule 13",
    };
  }
  if (v === 1) {
    return {
      version: 1,
      outdated: true,
      reason: "catalog_version: 1 — pre-kit catalog, migrate via Rule 13",
    };
  }
  return {
    version: "unknown",
    outdated: true,
    reason: `unrecognized catalog_version: ${v}`,
  };
}

/**
 * Migrate a parsed v2 catalog object to v3. Pure function.
 * Caller supplies coreVersion/hooksVersion (typically from install-state v3
 * post-migration). When `initialRelease` is provided, a single canonical release
 * entry is synthesized from the repo URL.
 */
export function migrateLibraryCatalogV2ToV3(
  v2: LibraryCatalogV2,
  opts: MigrationOptions
): LibraryCatalogV3 {
  if (v2.catalog_version !== 2) {
    throw new Error(
      `migrateLibraryCatalogV2ToV3: expected catalog_version === 2, got ${v2.catalog_version}`
    );
  }

  const releases: ReleaseEntry[] = opts.initialRelease
    ? [synthesizeRelease(v2.repo, opts.initialRelease)]
    : [];

  return {
    catalog_version: 3,
    repo: v2.repo,
    loomCoreVersion: opts.coreVersion,
    loomHooksVersion: opts.hooksVersion,
    releases,
    default_dirs: v2.default_dirs,
    library: v2.library,
    kits: v2.kits ?? [],
  };
}

function synthesizeRelease(
  repoUrl: string,
  release: { version: string; releasedAt: string }
): ReleaseEntry {
  const base = `${repoUrl}/releases/download/v${release.version}`;
  return {
    version: release.version,
    coreTarball: `${base}/loom-core-v${release.version}.tar.gz`,
    hooksTarball: `${base}/loom-hooks-v${release.version}.tar.gz`,
    cosignSignature: `${base}/loom-core-v${release.version}.tar.gz.sig`,
    sha256Manifest: `${base}/SHA256SUMS`,
    releasedAt: release.releasedAt,
  };
}
