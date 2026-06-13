/**
 * Pure-function skill router used by `/loom-library use|remove` (Phase 2)
 * and by the v4 catalog migrator (Phase 1).
 *
 * Extracted as a standalone module in Phase 0 so Phase 4's vitest tests can
 * import directly from here without depending on `commands/loom-library.md`
 * (vitest cannot import from markdown). See F-005 / F-006 / X-02 in
 * planning/plans/PLAN-kit-native-skills.md.
 *
 * NO I/O — every function is pure. Callers handle file reads/writes.
 */

import type { LibraryCatalogV4, TypedInclude } from "./library-catalog-migrator.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** All resource sections recognized by v4 kits' `includes:` arrays. */
export type ResourceType = "agent" | "protocol" | "skill" | "prompt" | "infrastructure";

/**
 * Parsed include entry result. `bare: true` means the source was a legacy
 * bare-name string; the caller must emit a DEPRECATION_WARNING.
 *
 * For bare entries, `type` is `null` until `resolveBareNameInclude` runs the
 * cross-section lookup.
 */
export interface ParsedInclude {
  type: ResourceType | null;
  name: string;
  bare: boolean;
}

/** Validation outcome for an install target path. */
export interface InstallPathValidation {
  valid: boolean;
  reason?: string;
}

/**
 * Single `items[]` entry written to `install-state.toon` after a successful
 * skill install. The full `InstallStateV3Item` shape lives in
 * `install-state-migrator.ts`; this is the minimal subset the router emits.
 */
export interface SkillInstallRecord {
  name: string;
  type: "skill";
  source: string;
  targetPath: string;
  sha256: string;
  component: string;
  installedAt: string;
}

/** Plan for `/loom-library remove <skill>` — caller deletes the file and
 *  prunes the parent dir when `pruneIfEmpty` is true. */
export interface SkillRemovePlan {
  skillMdPath: string;
  parentDir: string;
  pruneIfEmpty: boolean;
}

/** Bare-name resolution priority — locked here so callers and tests agree. */
export const BARE_NAME_PRIORITY: ReadonlyArray<ResourceType> = Object.freeze([
  "agent",
  "protocol",
  "skill",
  "prompt",
]);

/** Allowed install path prefixes — extended from `~/.claude/agents/` only
 *  to also accept `~/.claude/skills/` for native-skill items. */
export const ALLOWED_INSTALL_PREFIXES: ReadonlyArray<string> = Object.freeze([
  "~/.claude/skills/",
  "~/.claude/agents/",
]);

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Build the literal install target path for a Claude Code skill.
 *
 * The filename is **always `SKILL.md`** — Claude Code's skill activation
 * is keyed off this exact filename, so this is a hard contract, not a
 * suggestion.
 */
export function buildSkillTargetPath(name: string): string {
  return `~/.claude/skills/${name}/SKILL.md`;
}

/**
 * Parse a v4 kit `includes:` entry into a normalized shape.
 *
 *   - String input → `{ type: null, name, bare: true }` (caller resolves
 *     the type via `resolveBareNameInclude` and emits a DEPRECATION_WARNING)
 *   - `{ type, name }` object → `{ type, name, bare: false }`
 */
export function parseIncludeEntry(entry: TypedInclude): ParsedInclude {
  if (typeof entry === "string") {
    return { type: null, name: entry, bare: true };
  }
  return { type: entry.type, name: entry.name, bare: false };
}

/**
 * Validate that a target install path is inside one of the allowed prefixes
 * (`~/.claude/skills/` or `~/.claude/agents/`). Pure check — never throws.
 *
 * Returns `{ valid: false, reason }` so the caller can build a
 * `SOURCE_VALIDATION_ERROR` TOON envelope without having to interpret a
 * thrown error.
 */
export function validateInstallPath(targetPath: string): InstallPathValidation {
  if (typeof targetPath !== "string" || targetPath.length === 0) {
    return { valid: false, reason: "targetPath must be a non-empty string" };
  }
  for (const prefix of ALLOWED_INSTALL_PREFIXES) {
    if (targetPath.startsWith(prefix)) {
      return { valid: true };
    }
  }
  return {
    valid: false,
    reason: `targetPath must start with one of [${ALLOWED_INSTALL_PREFIXES.join(", ")}]`,
  };
}

/**
 * Build the install-state items[] record for a freshly installed skill.
 * The caller supplies the sha256 (computed from the on-disk file) and the
 * current ISO timestamp; this function performs no I/O.
 */
export function buildSkillInstallRecord(
  name: string,
  sha256: string,
  opts: { component?: string; installedAt?: string; source?: string } = {}
): SkillInstallRecord {
  return {
    name,
    type: "skill",
    source: opts.source ?? `skills/${name}/SKILL.md`,
    targetPath: buildSkillTargetPath(name),
    sha256,
    component: opts.component ?? "loom-core",
    installedAt: opts.installedAt ?? new Date(0).toISOString(),
  };
}

/**
 * Resolve a legacy bare-name include against a v4 catalog, walking the
 * sections in priority order (agents → protocols → skills → prompts).
 *
 * Returns `null` when the name is not found in any section. The caller is
 * responsible for raising `NOT_IN_CATALOG` and logging the
 * `DEPRECATION_WARNING` template (see `library-add-heuristic.ts →
 * formatDeprecationWarning`).
 */
export function resolveBareNameInclude(
  name: string,
  catalog: LibraryCatalogV4
): { type: ResourceType; name: string } | null {
  const lib = catalog.library;
  if (!lib) return null;

  // Use a discriminator function so the priority order is the single source
  // of truth and is easy to test.
  for (const type of BARE_NAME_PRIORITY) {
    const section = sectionFor(lib, type);
    if (section.some((entry) => entry.name === name)) {
      return { type, name };
    }
  }
  return null;
}

/**
 * Build the `/loom-library remove <skill>` plan. The caller deletes
 * `skillMdPath` and, if `pruneIfEmpty` is true and the parent directory is
 * empty afterward, removes the parent directory.
 */
export function buildSkillRemovePlan(name: string): SkillRemovePlan {
  return {
    skillMdPath: buildSkillTargetPath(name),
    parentDir: `~/.claude/skills/${name}/`,
    pruneIfEmpty: true,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Discriminator: return the entries array for a given resource type.
 *  Entries are typed loosely because v4 only types `protocols` and `skills`;
 *  agents / prompts / infrastructure are still `unknown[]` at the catalog
 *  level (those interfaces aren't part of this phase). */
function sectionFor(
  lib: LibraryCatalogV4["library"],
  type: ResourceType
): ReadonlyArray<{ name: string }> {
  switch (type) {
    case "protocol":
      return lib.protocols ?? [];
    case "skill":
      return lib.skills ?? [];
    case "agent":
      return (lib.agents ?? []) as ReadonlyArray<{ name: string }>;
    case "prompt":
      return (lib.prompts ?? []) as ReadonlyArray<{ name: string }>;
    case "infrastructure":
      return (lib.infrastructure ?? []) as ReadonlyArray<{ name: string }>;
  }
}
