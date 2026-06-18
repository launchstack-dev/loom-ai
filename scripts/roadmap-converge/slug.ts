/**
 * Slug derivation for roadmap-converge multi-roadmap support.
 *
 * A slug is the path-safe identifier derived from the roadmap filename
 * (without extension). It is used as the subdirectory name under
 * `.roadmap-converge/{slug}/` for state files and lock files.
 *
 * Rules:
 *   - Basename of the roadmap path, without extension.
 *   - Non-alphanumeric characters (after extension removal) → `-`.
 *   - Leading/trailing `-` are stripped.
 *   - Consecutive `-` are collapsed to a single `-`.
 *
 * Examples:
 *   planning/ROADMAP.md          → ROADMAP
 *   planning/feature/sub-roadmap.md → sub-roadmap
 *   planning/Some File.md        → Some-File
 */

import { basename, extname } from "node:path";

// ---------------------------------------------------------------------------
// Public: derive a slug from a roadmap file path
// ---------------------------------------------------------------------------

/**
 * Derive a path-safe slug from a roadmap file path.
 *
 * @param roadmapPath  Relative or absolute path to the roadmap file.
 * @returns            Slug string (non-empty; throws on degenerate input).
 */
export function deriveSlug(roadmapPath: string): string {
  const ext = extname(roadmapPath);
  const base = basename(roadmapPath, ext);

  // Replace non-alphanumeric characters (excluding `-`) with `-`.
  const slug = base
    .replace(/[^a-zA-Z0-9-]/g, "-")
    // Collapse consecutive dashes
    .replace(/-{2,}/g, "-")
    // Strip leading/trailing dashes
    .replace(/^-+|-+$/g, "");

  if (!slug) {
    throw new Error(
      `[slug] Cannot derive a valid slug from roadmap path: "${roadmapPath}"`
    );
  }

  return slug;
}

// ---------------------------------------------------------------------------
// Public: collision guard — registry of slug → canonical roadmap path
// ---------------------------------------------------------------------------

/**
 * In-process slug registry. Maps slug → first roadmapPath that claimed it.
 *
 * Callers call `registerSlug(slug, roadmapPath)` after deriving a slug. If
 * the slug was previously claimed by a DIFFERENT roadmap path, the function
 * prints a SLUG_COLLISION error to stderr and throws (so the process exits 1).
 *
 * Same path re-registering the same slug is a no-op (idempotent).
 */
const _registry = new Map<string, string>();

/**
 * Register a slug. Throws and prints `SLUG_COLLISION` to stderr when two
 * different roadmap paths claim the same slug.
 *
 * @param slug         The derived slug.
 * @param roadmapPath  The roadmap path that produced this slug.
 * @param stderr       Sink for the SLUG_COLLISION line (default: process.stderr).
 */
export function registerSlug(
  slug: string,
  roadmapPath: string,
  stderr: (line: string) => void = (l) => process.stderr.write(l + "\n")
): void {
  const prior = _registry.get(slug);
  if (prior === undefined) {
    _registry.set(slug, roadmapPath);
    return;
  }
  if (prior === roadmapPath) {
    // Same path — idempotent.
    return;
  }
  const msg = `SLUG_COLLISION: slug "${slug}" is claimed by both "${prior}" and "${roadmapPath}". Rename one of these roadmap files.`;
  stderr(msg);
  throw new Error(msg);
}

/**
 * Clear the slug registry. Used by tests to reset state between runs.
 */
export function clearSlugRegistry(): void {
  _registry.clear();
}

/**
 * Derive a slug AND register it atomically. Convenience wrapper that combines
 * `deriveSlug` + `registerSlug`.
 *
 * @param roadmapPath  Roadmap file path.
 * @param stderr       Optional stderr sink.
 * @returns            Registered slug.
 */
export function slugFor(
  roadmapPath: string,
  stderr?: (line: string) => void
): string {
  const slug = deriveSlug(roadmapPath);
  registerSlug(slug, roadmapPath, stderr);
  return slug;
}
