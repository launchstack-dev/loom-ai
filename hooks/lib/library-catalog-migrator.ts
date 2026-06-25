/**
 * Pure-function migrator for library.yaml v2 → v3.
 * No I/O. The caller parses YAML, hands us an object, gets a v3 object back.
 * See protocols/library-catalog.schema.md and schema-upgrade.md Rule 13.
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

// ---------------------------------------------------------------------------
// v4 interfaces (Phase 0 — contracts only; v3→v4 migration body lands in Phase 1)
// ---------------------------------------------------------------------------
//
// v4 splits the v3 `library.skills:` section into two:
//   - `library.protocols:` — formerly v3's `library.skills:` (inter-agent
//     protocol files; renamed verbatim during the v3→v4 migration)
//   - `library.skills:` — NEW: Claude Code native skills (SKILL.md format)
//
// `Kit.includes:` accepts both legacy bare-name strings and typed
// `{ type, name }` forms; bare strings emit a DEPRECATION_WARNING at install
// time and are removed in v5.
//
// See planning/plans/PLAN-kit-native-skills.md § Schema / Type Definitions
// for the canonical field reference.

/** A protocol entry — formerly a v3 `library.skills` item. Inter-agent message schema files. */
export interface ProtocolEntry {
  /** Slug, e.g. "execution-protocols". */
  name: string;
  /** Human-readable summary surfaced by `/loom-library list`. */
  description: string;
  /** Repo-relative path to the source markdown. */
  source: string;
}

/**
 * A Claude Code native skill entry. New in v4.
 *
 * Triggers are OPTIONAL: when present, the installer validates each entry as a
 * glob. When absent, Claude Code activates the skill via description-based
 * matching (see F-020 in PLAN-kit-native-skills.md).
 */
export interface SkillEntry {
  /** Slug; must match `[a-z][a-z0-9-]*` and the directory name under `~/.claude/skills/`. */
  name: string;
  /** Required, non-empty. Surfaced in description-based activation when `triggers` is absent. */
  description: string;
  /** Repo-relative path to the SKILL.md source. */
  source: string;
  /**
   * Optional glob patterns. When present and non-empty, Claude Code activates
   * on file pattern match. Empty array (`[]`) is treated as "no triggers" —
   * not auto-classified as a skill by `/loom-library add` (see CG-04).
   */
  triggers?: string[];
  /** F-028: mirrors the existing agent/prompt deprecation flag. */
  deprecated?: boolean;
  /** F-028: slug of the replacement skill; only meaningful when `deprecated: true`. */
  redirectsTo?: string;
}

/**
 * v4 kit `includes:` entry. Supports two forms:
 *   1. Typed object: `{ type: "skill", name: "python-conventions" }` — preferred
 *   2. Legacy bare name: `"python-conventions"` — deprecated, removed in v5
 *
 * Resolution priority for bare names: agents → protocols → skills → prompts.
 * The installer logs a DEPRECATION_WARNING on every bare-name match.
 */
export type TypedInclude =
  | { type: "agent" | "protocol" | "skill" | "prompt" | "infrastructure"; name: string }
  | string;

/** v4 kit entry with typed `includes:` array. Field set is a superset of v3 `KitEntry`. */
export interface KitV4Entry {
  name: string;
  description: string;
  version: string;
  minLoomVersion?: number;
  minCoreVersion?: string;
  minHooksVersion?: string;
  /** Required; ≥1 entry. Each item is either a typed object or a legacy bare name (deprecated). */
  includes: TypedInclude[];
  /** Optional kit dependency list; cycle-detected before install. */
  requires?: string[];
  /** Optional filename of the command to register under `~/.claude/commands/`. */
  command?: string;
  /** Free-form per-kit configuration emitted into orchestration.toml. */
  suggestedConfig?: unknown;
}

/**
 * v4 catalog shape. The `library` block is now typed (no longer `unknown` like
 * v2/v3) because the migrator owns the rename of `library.skills` → `library.protocols`
 * and the initialization of the new `library.skills: []` field.
 */
export interface LibraryCatalogV4 {
  catalog_version: 4;
  repo: string;
  loomCoreVersion: string;
  loomHooksVersion: string;
  releases: ReleaseEntry[];
  default_dirs: unknown;
  library: {
    /** Renamed from v3 `library.skills:` — inter-agent protocol files. */
    protocols: ProtocolEntry[];
    /** NEW in v4 — Claude Code native skills. Initialized empty at migration. */
    skills: SkillEntry[];
    /**
     * Agent entries. Per F-002, any `requires:` arrays containing `skill:`-prefixed
     * items are rewritten to `protocol:`-prefixed during the v3→v4 migration.
     */
    agents?: unknown[];
    prompts?: unknown[];
    infrastructure?: unknown[];
  };
  kits: KitV4Entry[];
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
  version: 2 | 3 | 4 | "unknown";
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
 * v4 introduces `library.protocols:` (renamed from v3 `library.skills:`) and a
 * new empty `library.skills: []` block for Claude Code native skills. Both
 * markers must appear inside the `library:` block for a v4 catalog to be
 * considered well-formed.
 */
const V4_LIBRARY_MARKERS = ["protocols:", "skills:"] as const;

/**
 * Detect whether raw library.yaml content (string) is v1, v2, v3, or v4.
 * Heuristic: explicit `catalog_version` field plus presence of version markers.
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
  if (v === 4) {
    // v4 inherits v3's top-level fields (loomCoreVersion / loomHooksVersion /
    // releases) and adds the library.protocols + library.skills split.
    const missingTopLevel = V3_TOP_LEVEL_MARKERS.filter((m) => !content.includes(m));
    if (missingTopLevel.length > 0) {
      return {
        version: 4,
        outdated: true,
        reason: `v4 declared but missing top-level fields: ${missingTopLevel.join(", ")}`,
      };
    }
    const missingLibrary = V4_LIBRARY_MARKERS.filter((m) => !content.includes(m));
    if (missingLibrary.length > 0) {
      return {
        version: 4,
        outdated: true,
        reason: `v4 declared but missing library.${missingLibrary.join("/library.")} markers`,
      };
    }
    return { version: 4, outdated: false, reason: null };
  }
  if (v === 3) {
    const missing = V3_TOP_LEVEL_MARKERS.filter((m) => !content.includes(m));
    if (missing.length > 0) {
      return {
        version: 3,
        outdated: true,
        reason: `v3 declared but missing top-level fields: ${missing.join(", ")}`,
      };
    }
    return { version: 3, outdated: true, reason: "catalog_version: 3 — migrate to v4 via Rule 13" };
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

export type AnyLibraryCatalog = LibraryCatalogV2 | LibraryCatalogV3 | LibraryCatalogV4;

export type MigrationStep = (input: AnyLibraryCatalog, opts: MigrationOptions) => AnyLibraryCatalog;

export type MigrationRegistry = Readonly<Record<string, MigrationStep>>;

/**
 * v3→v4 migrator. Pure function — no I/O, no input mutation.
 *
 * Transforms:
 *   1. `catalog_version: 3` → `catalog_version: 4`
 *   2. `library.skills:` → `library.protocols:` (rename, preserve order)
 *   3. NEW `library.skills: []` (Claude Code native skills, empty at migration)
 *   4. F-002: agent entries' `requires:` items matching `/^skill:(.+)$/` are
 *      rewritten to `protocol:$1`. All other `requires:` entries are preserved.
 *
 * All other top-level fields (repo, loomCoreVersion, loomHooksVersion, releases,
 * default_dirs, kits) are copied verbatim.
 *
 * @param v3 — A parsed v3 catalog object. `library` is typed `unknown` in v3;
 *             this function narrows it at runtime via safe Array/typeof checks.
 *             Missing optional sections (agents/prompts/infrastructure) are
 *             preserved as-is (undefined stays undefined; arrays stay arrays).
 * @param _opts — Reserved for future migrations; v3→v4 needs no extra config.
 *                The walker forwards opts through every step.
 */
export function migrateLibraryCatalogV3ToV4(
  v3: LibraryCatalogV3,
  _opts: MigrationOptions
): LibraryCatalogV4 {
  if (v3 == null || (v3 as { catalog_version?: unknown }).catalog_version !== 3) {
    throw new MigrationSchemaVersionMismatchError(
      3,
      v3 == null ? v3 : (v3 as { catalog_version?: unknown }).catalog_version
    );
  }

  // Narrow `library` (typed `unknown` in v3) with safe runtime checks. Missing
  // sections are tolerated: a v3 catalog with only `library.skills:` and no
  // `agents:` still migrates cleanly.
  const v3Library = (v3.library ?? {}) as Record<string, unknown>;

  const protocols: ProtocolEntry[] = Array.isArray(v3Library.skills)
    ? (v3Library.skills as unknown[]).map((raw, idx) => {
        const entry = raw as Record<string, unknown>;
        if (typeof entry.name !== "string" || entry.name.length === 0) {
          throw new Error(
            `migrateLibraryCatalogV3ToV4: library.skills[${idx}] missing required field 'name' (name=${String(entry.name ?? "<unknown>")})`
          );
        }
        if (typeof entry.source !== "string" || entry.source.length === 0) {
          throw new Error(
            `migrateLibraryCatalogV3ToV4: library.skills[${idx}] missing required field 'source' (name=${String(entry.name ?? "<unknown>")})`
          );
        }
        if (typeof entry.description !== "string" || entry.description.length === 0) {
          throw new Error(
            `migrateLibraryCatalogV3ToV4: library.skills[${idx}] missing required field 'description' (name=${String(entry.name ?? "<unknown>")})`
          );
        }
        return { ...(entry as unknown as ProtocolEntry) };
      })
    : [];

  // F-002: rewrite skill: → protocol: in agent.requires entries.
  const v3Agents = Array.isArray(v3Library.agents) ? (v3Library.agents as unknown[]) : undefined;
  const agents: unknown[] | undefined = v3Agents
    ? v3Agents.map((agent) => rewriteAgentRequires(agent))
    : undefined;

  const prompts = Array.isArray(v3Library.prompts)
    ? [...((v3Library.prompts ?? []) as unknown[])]
    : undefined;

  const infrastructure = Array.isArray(v3Library.infrastructure)
    ? [...((v3Library.infrastructure ?? []) as unknown[])]
    : undefined;

  const library: LibraryCatalogV4["library"] = {
    protocols,
    skills: [],
  };
  if (agents !== undefined) library.agents = agents;
  if (prompts !== undefined) library.prompts = prompts;
  if (infrastructure !== undefined) library.infrastructure = infrastructure;

  return {
    catalog_version: 4,
    repo: v3.repo,
    loomCoreVersion: v3.loomCoreVersion,
    loomHooksVersion: v3.loomHooksVersion,
    // Releases array: shallow-copy entries so callers can't mutate v3 via the v4 ref.
    releases: v3.releases.map((r) => ({ ...r })),
    default_dirs: v3.default_dirs,
    library,
    // KitEntry → KitV4Entry is a structural superset; v3 kits flow through.
    // Per F-002 the bare-string `includes:` form is still legal in v4 (deprecated).
    kits: (v3.kits ?? []).map((k) => ({ ...k })) as unknown as KitV4Entry[],
  };
}

const SKILL_PREFIX_RE = /^skill:(.+)$/;

/**
 * Rewrite an agent entry's `requires:` array, replacing any `skill:foo` token
 * with `protocol:foo`. Non-matching entries are preserved verbatim. Agents
 * without a `requires:` array are returned unchanged (shallow copy).
 *
 * Treats input as readonly — does not mutate the original object.
 */
function rewriteAgentRequires(agent: unknown): unknown {
  if (agent == null || typeof agent !== "object") return agent;
  const a = agent as Record<string, unknown>;
  if (!Array.isArray(a.requires)) return { ...a };
  const requires = (a.requires as unknown[]).map((item) => {
    if (typeof item !== "string") return item;
    const m = SKILL_PREFIX_RE.exec(item);
    return m ? `protocol:${m[1]}` : item;
  });
  return { ...a, requires };
}

/**
 * Frozen built-in registry. Tests inject stubs by passing a separate registry.
 *
 * The `"3->4"` step rewrites the `library.skills` block into `library.protocols`,
 * introduces an empty `library.skills:` block for Claude Code native skills,
 * and rewrites agent `requires:` `skill:*` tokens to `protocol:*` (F-002).
 * See `migrateLibraryCatalogV3ToV4` above for the full transform.
 */
export const MIGRATIONS: MigrationRegistry = Object.freeze({
  "2->3": (input: AnyLibraryCatalog, opts: MigrationOptions) =>
    migrateLibraryCatalogV2ToV3(input as LibraryCatalogV2, opts),
  "3->4": (input: AnyLibraryCatalog, opts: MigrationOptions) =>
    migrateLibraryCatalogV3ToV4(input as LibraryCatalogV3, opts),
});

/**
 * Current schema version targeted by `migrateToLatest`. Mirror of registry.
 *
 * Bumped from 3 → 4 in Phase 1 of PLAN-kit-native-skills.md, simultaneously
 * with the real `"3->4"` migrator landing above and `library-catalog.currentVersion`
 * in `protocols/schema-versions.toon` bumping to 4. The parity test in
 * `test/protocol/schema-upgrade-v3.test.ts` guards against drift between the
 * three sites.
 */
export const CURRENT_VERSION = 4;

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
