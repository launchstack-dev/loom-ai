/**
 * Pure-function migrator for library.yaml v2 → v3.
 * No I/O. The caller parses YAML, hands us an object, gets a v3 object back.
 * See agents/protocols/library-catalog.schema.md and schema-upgrade.md Rule 13.
 */

import {
  MigrationDowngradeError,
  MigrationSchemaVersionMismatchError,
  MigrationValidationError,
  MissingMigrationStepError,
} from "./migration-errors.js";

const ALLOWED_REPO_HOSTS = new Set(["github.com", "codeberg.org"]);
const SEMVER_RE = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/;

/**
 * Validate a `repo` URL before interpolating it into release-tarball URLs.
 * Repo URLs flow from user-edited YAML straight into fetch + cosign verify;
 * un-validated values can produce file://, javascript:, or attacker-origin URLs.
 * Returns a normalized URL (trailing slash stripped).
 */
export function validateRepoUrl(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new MigrationValidationError("repo", value, "must be a non-empty string");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new MigrationValidationError("repo", value, "not a valid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new MigrationValidationError("repo", value, `scheme must be https (got "${parsed.protocol}")`);
  }
  if (parsed.username || parsed.password) {
    throw new MigrationValidationError("repo", value, "must not contain userinfo (user:pass@)");
  }
  if (parsed.hash) {
    throw new MigrationValidationError("repo", value, "must not contain a fragment (#...)");
  }
  if (!ALLOWED_REPO_HOSTS.has(parsed.host)) {
    throw new MigrationValidationError(
      "repo",
      value,
      `host must be one of [${[...ALLOWED_REPO_HOSTS].join(", ")}] (got "${parsed.host}")`
    );
  }
  // Strip trailing slash so synthesized release URLs don't end up with `//releases`.
  return value.replace(/\/+$/, "");
}

/**
 * Validate a semver release version before interpolation into release URLs.
 * Rejects path-traversal payloads and any non-semver tokens.
 */
export function validateSemver(value: unknown, field: string = "release.version"): string {
  if (typeof value !== "string") {
    throw new MigrationValidationError(field, value, "must be a string");
  }
  if (!SEMVER_RE.test(value)) {
    throw new MigrationValidationError(field, value, "must match major.minor.patch[-prerelease]");
  }
  return value;
}

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

export interface LibraryCatalogDetectionResult {
  version: 2 | 3 | "unknown";
  outdated: boolean;
  reason: string | null;
}

/** @deprecated Use `LibraryCatalogDetectionResult`. Kept for one cycle for callers. */
export type DetectionResult = LibraryCatalogDetectionResult;

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
  // Line-anchored + end-anchored to reject `catalog_version: 3.9` (which previously
  // truncated silently via parseInt) and embedded substring smuggling.
  const match = /^catalog_version:\s*(\d+)\s*$/m.exec(content);

  if (!match) {
    // No catalog_version field — pre-v2 catalog. Collapse to v2-equivalent so
    // the chain walker can run the 2->3 step.
    return {
      version: 2,
      outdated: true,
      reason: "missing catalog_version — pre-v2 catalog; chain walks as v2→v3",
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
    // v1 (pre-kit catalog) had no users at v3 launch. Collapse to v2-equivalent.
    return {
      version: 2,
      outdated: true,
      reason: "catalog_version: 1 — pre-kit catalog; chain walks as v2→v3 (verify kits[] shape)",
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
  if (v2 == null || (v2 as { catalog_version?: unknown }).catalog_version !== 2) {
    throw new MigrationSchemaVersionMismatchError(
      2,
      v2 == null ? v2 : (v2 as { catalog_version?: unknown }).catalog_version
    );
  }

  const normalizedRepo = validateRepoUrl(v2.repo);
  const releases: ReleaseEntry[] = opts.initialRelease
    ? [synthesizeRelease(normalizedRepo, opts.initialRelease)]
    : [];

  return {
    catalog_version: 3,
    repo: normalizedRepo,
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
  // Both inputs are already validated by validateRepoUrl + validateSemver at the boundary,
  // but re-assert the semver here so this function is safe to call from future code paths
  // that don't go through migrateLibraryCatalogV2ToV3.
  const version = validateSemver(release.version);
  const base = `${repoUrl}/releases/download/v${version}`;
  return {
    version,
    coreTarball: `${base}/loom-core-v${version}.tar.gz`,
    hooksTarball: `${base}/loom-hooks-v${version}.tar.gz`,
    cosignSignature: `${base}/loom-core-v${version}.tar.gz.sig`,
    sha256Manifest: `${base}/SHA256SUMS`,
    releasedAt: release.releasedAt,
  };
}

// ---------------------------------------------------------------------------
// Chained migration walker
// ---------------------------------------------------------------------------
//
// See install-state-migrator.ts for the registry/walker rationale. Same pattern
// here: MIGRATIONS maps "fromV->toV" → step; walker chains them.
//
// Catalog migrations are NOT pure-pure — opts.coreVersion/hooksVersion are
// required for v2→v3 because v2 has no version concept. The walker forwards
// opts through every step; future migrations that don't need these fields
// simply ignore them.

export type AnyLibraryCatalog = LibraryCatalogV2 | LibraryCatalogV3;

export type MigrationStep = (input: AnyLibraryCatalog, opts: MigrationOptions) => AnyLibraryCatalog;

export type MigrationRegistry = Readonly<Record<string, MigrationStep>>;

/** Frozen built-in registry. Tests inject stubs by passing a separate registry. */
export const MIGRATIONS: MigrationRegistry = Object.freeze({
  "2->3": (input: AnyLibraryCatalog, opts: MigrationOptions) =>
    migrateLibraryCatalogV2ToV3(input as LibraryCatalogV2, opts),
});

/** Current schema version targeted by `migrateToLatest`. Mirror of registry. */
export const CURRENT_VERSION = 3;

/**
 * Walk the migration chain from `fromVersion` to `targetVersion`. Production
 * callers omit `registry` and get the frozen built-in MIGRATIONS; tests pass
 * an override to exercise future-version walks without mutating module state.
 */
export function migrateToLatest(
  input: AnyLibraryCatalog,
  fromVersion: number,
  opts: MigrationOptions,
  targetVersion: number = CURRENT_VERSION,
  registry: MigrationRegistry = MIGRATIONS
): AnyLibraryCatalog {
  if (fromVersion === targetVersion) {
    return input;
  }
  if (fromVersion > targetVersion) {
    throw new MigrationDowngradeError(fromVersion, targetVersion);
  }

  let current: AnyLibraryCatalog = input;
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
