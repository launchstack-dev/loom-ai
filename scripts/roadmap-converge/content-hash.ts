/**
 * Content-hash utilities for the roadmap-converge driver.
 *
 * Computes sha256 of a roadmap file (UTF-8 bytes) and provides a helper to
 * compare a freshly-computed hash against the hash recorded in prior state.
 * A mismatch is the trigger for `delta_since_last = invalidated` on every
 * dimension in the upcoming pass — the canonical signal that the document
 * changed beneath the reviewer's feet.
 *
 * The diff summary (`+N -M lines`) is intentionally cheap: a line-count
 * subtraction against a stored prior line count. This matches the
 * `roadmap_diff_summary` field in state.toon and the one-line stderr notice
 * the driver emits on invalidation. We do NOT compute a full structural
 * diff here — that belongs to a future digest renderer.
 */

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

/**
 * Compute sha256 hex digest of a roadmap file. Reads UTF-8 bytes verbatim;
 * no normalisation (line endings, trailing newline) so that any byte-level
 * change re-invalidates the hash. This is intentional: roadmap reviewers
 * comment on punctuation, so anything visually distinct deserves a re-pass.
 *
 * Throws ENOENT-bearing Error if the file does not exist — caller (driver)
 * surfaces that as a missing-roadmap diagnostic.
 */
export function hashRoadmap(roadmapPath: string): string {
  const bytes = readFileSync(roadmapPath);
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Result of comparing the on-disk roadmap against state.content_hash.
 *   - `current` — sha256 just computed
 *   - `priorMatches` — true when state.content_hash equals current
 *   - `lineDiff` — `+N -M` synthesis vs. the priorLineCount.
 *                  When priorLineCount is null (first pass or unrecorded)
 *                  the value is "+{N} -0" where N = current line count.
 */
export interface ContentHashCompare {
  current: string;
  priorMatches: boolean;
  lineDiff: string;
  currentLineCount: number;
}

/**
 * Compare the roadmap on disk against a recorded prior hash. The driver
 * invokes this at the top of every pass — when `priorMatches` is false and
 * priorHash was non-empty, the driver invalidates all dimensions and emits
 * the one-line stderr notice using `lineDiff`.
 */
export function compareRoadmapHash(
  roadmapPath: string,
  priorHash: string,
  priorLineCount: number | null
): ContentHashCompare {
  const raw = readFileSync(roadmapPath, "utf-8");
  const current = createHash("sha256").update(raw, "utf-8").digest("hex");
  // Trim a trailing newline before counting so an empty file is 0 lines, not 1.
  const currentLineCount =
    raw.length === 0 ? 0 : raw.replace(/\n$/, "").split("\n").length;

  const prior = priorLineCount ?? 0;
  const added = Math.max(0, currentLineCount - prior);
  const removed = Math.max(0, prior - currentLineCount);

  return {
    current,
    priorMatches: priorHash !== "" && priorHash === current,
    lineDiff: `+${added} -${removed}`,
    currentLineCount,
  };
}

/**
 * Cheap existence + readability check the driver runs before invoking the
 * hash. Returns true when the path is a regular file, false otherwise.
 * Distinguishes "file missing" (caller halts) from "file unreadable"
 * (caller surfaces a clearer diagnostic).
 */
export function roadmapIsReadable(roadmapPath: string): boolean {
  try {
    const st = statSync(roadmapPath);
    return st.isFile();
  } catch {
    return false;
  }
}
