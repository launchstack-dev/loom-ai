/**
 * scripts/loom-pause/handoff-shim.ts
 *
 * Backward-compatibility shim for pre-F-18 loom-pause handoff paths.
 *
 * Before F-18, loom-pause wrote the handoff document to the working tree:
 *   .plan-execution/handoff.md         (most common)
 *   .plan-execution/session-handoff.md (older variant)
 *
 * After F-18, the handoff document lives in the OS temporary directory:
 *   $TMPDIR/loom-handoff-{id}.md
 *
 * This module exposes a single pure function `resolveLegacyPath` that, given
 * a pre-F-18 path, returns the canonical F-18 tmp-dir path that consumers
 * should use instead.  The function does NOT copy or move files — it only
 * resolves the path so callers can locate (or create) the file in the right
 * place.
 *
 * Canonical filename format:
 *   loom-handoff-{id}.md
 *
 * where `{id}` is derived from the legacy path's parent directory name or a
 * stable hash when the legacy path does not carry an identifier.
 *
 * Pure function — no side effects, no I/O.
 */

import { join, basename, dirname } from "node:path";
import { tmpdir } from "node:os";

/**
 * Known pre-F-18 handoff filename patterns.  Ordered from most specific to
 * most generic so the first match wins.
 */
const LEGACY_FILENAME_PATTERNS: RegExp[] = [
  /^loom-handoff-([a-zA-Z0-9_-]+)\.md$/,   // already has an id — migrate as-is
  /^handoff-([a-zA-Z0-9_-]+)\.md$/,         // handoff-{id}.md
  /^session-handoff\.md$/,                   // pre-F-18 older variant
  /^handoff\.md$/,                           // pre-F-18 most common
];

/**
 * Derive a stable identifier from a legacy handoff file path.
 *
 * Strategy:
 *  1. If the filename already embeds an id (e.g. `handoff-abc123.md`), extract it.
 *  2. Otherwise use the parent directory's name as the id (e.g. `.plan-execution`
 *     → `plan-execution`).
 */
function deriveId(legacyPath: string): string {
  const filename = basename(legacyPath);

  // Pattern 0: filename already has the loom-handoff-{id} format — preserve id.
  const alreadyCanonical = /^loom-handoff-([a-zA-Z0-9_-]+)\.md$/.exec(filename);
  if (alreadyCanonical) return alreadyCanonical[1]!;

  // Pattern 1: handoff-{id}.md
  const withId = /^handoff-([a-zA-Z0-9_-]+)\.md$/.exec(filename);
  if (withId) return withId[1]!;

  // Fallback: sanitise the parent directory name.
  const parentDir = basename(dirname(legacyPath));
  return parentDir.replace(/^\./, "").replace(/[^a-zA-Z0-9_-]/g, "-") || "legacy";
}

/**
 * Resolve a pre-F-18 handoff path to its F-18 tmp-dir equivalent.
 *
 * @param legacyPath  Absolute or relative path to the old handoff document.
 * @returns           The canonical `$TMPDIR/loom-handoff-{id}.md` path that
 *                    consumers should use instead.
 */
export function resolveLegacyPath(legacyPath: string): string {
  const id = deriveId(legacyPath);
  return join(tmpdir(), `loom-handoff-${id}.md`);
}

/**
 * Returns true if `path` looks like a pre-F-18 handoff path (i.e., it lives
 * inside `.plan-execution/` or matches a known legacy filename pattern).
 *
 * Useful for callers that want to gate-check before calling `resolveLegacyPath`.
 */
export function isLegacyHandoffPath(path: string): boolean {
  const filename = basename(path);

  // Check known legacy filename patterns.
  for (const pattern of LEGACY_FILENAME_PATTERNS) {
    if (pattern.test(filename)) {
      // A file named `loom-handoff-{id}.md` in tmpdir is NOT legacy.
      if (
        filename.startsWith("loom-handoff-") &&
        path.startsWith(tmpdir())
      ) {
        return false;
      }
      return true;
    }
  }

  return false;
}
