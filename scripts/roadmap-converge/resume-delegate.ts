/**
 * Resume-delegate: dual-state digest ordering for /loom-resume.
 *
 * When /loom-resume needs to surface context for an interrupted session, it
 * may have two sources of state:
 *
 *   1. .plan-execution/pipeline-state.toon  — general plan-execution state
 *   2. .roadmap-converge/{slug}/state.toon  — roadmap convergence state
 *
 * This module provides `buildResumeDigests`, which:
 *   - Accepts mtime snapshots for both state files (passed in by the caller so
 *     this module stays pure and testable — no direct fs.statSync inside the
 *     ordering logic).
 *   - Returns a list of rendered digest strings ordered by mtime descending
 *     (most recently modified first).
 *   - Reads and renders only the files that actually exist (existence flags
 *     are also passed by the caller via StateExistenceCheck).
 *
 * The file-system reads are confined to `loadRoadmapConvergeDigests` which is
 * the only I/O boundary in this module. The ordering logic (`orderByMtime` and
 * `buildResumeDigests`) is pure and fully testable with injected stubs.
 *
 * Usage (production):
 *
 *   import { buildResumeDigests, probeStatePaths } from "./resume-delegate.js";
 *
 *   const probed = probeStatePaths(slug);
 *   const digests = buildResumeDigests(probed, slug);
 *   for (const d of digests) process.stdout.write(d + "\n---\n");
 */

import { statSync } from "node:fs";

import { renderDigestFromState } from "./digest.js";
import { readState } from "./state-io.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PIPELINE_STATE_PATH = ".plan-execution/pipeline-state.toon";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Existence + mtime snapshot for a state file. mtime is null when the file
 * does not exist.
 */
export interface StateExistenceCheck {
  /** Canonical file path. */
  path: string;
  /** Whether the file exists on disk. */
  exists: boolean;
  /**
   * File mtime as milliseconds since epoch. null when !exists.
   * Pass a fixed value in tests to make ordering deterministic.
   */
  mtimeMs: number | null;
  /**
   * The kind of state this entry represents. Used by buildResumeDigests to
   * decide which reader/renderer to invoke.
   *
   *   "roadmap-converge" → read via readState(slug) + renderDigestFromState
   *   "pipeline-state"   → render a short informational line (full pipeline
   *                        state rendering is out of scope for Phase 3; the
   *                        caller can inject a custom renderer via options)
   */
  kind: "roadmap-converge" | "pipeline-state";
  /**
   * For kind="roadmap-converge": the slug used to derive the state path.
   * Ignored for kind="pipeline-state".
   */
  slug?: string;
}

export interface ResumeDigestOptions {
  /**
   * Optional custom renderer for pipeline-state entries. When not provided,
   * a minimal placeholder line is used. Phase 6 wires the full pipeline-state
   * renderer here.
   */
  renderPipelineState?: (path: string) => string;
  /**
   * Optional stderr sink. Defaults to process.stderr.write.
   */
  stderr?: (line: string) => void;
}

// ---------------------------------------------------------------------------
// Probing helper (I/O boundary)
// ---------------------------------------------------------------------------

/**
 * Probe the canonical state paths for a slug and return StateExistenceChecks.
 * This is the I/O boundary — call it once in production and pass the result
 * into the pure `buildResumeDigests`.
 */
export function probeStatePaths(slug: string): StateExistenceCheck[] {
  const roadmapPath = `.roadmap-converge/${slug}/state.toon`;
  const roadmapExists = fileExistsSync(roadmapPath);
  const pipelineExists = fileExistsSync(PIPELINE_STATE_PATH);

  return [
    {
      path: roadmapPath,
      exists: roadmapExists,
      mtimeMs: roadmapExists ? fileMtimeSync(roadmapPath) : null,
      kind: "roadmap-converge",
      slug,
    },
    {
      path: PIPELINE_STATE_PATH,
      exists: pipelineExists,
      mtimeMs: pipelineExists ? fileMtimeSync(PIPELINE_STATE_PATH) : null,
      kind: "pipeline-state",
    },
  ];
}

// ---------------------------------------------------------------------------
// Ordering helper (pure)
// ---------------------------------------------------------------------------

/**
 * Sort StateExistenceChecks that exist by mtime descending (most recent first).
 * Entries where exists=false are excluded from the result.
 * Pure — no I/O.
 */
export function orderByMtime(checks: StateExistenceCheck[]): StateExistenceCheck[] {
  return checks
    .filter((c) => c.exists && c.mtimeMs !== null)
    .sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0));
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

/**
 * Build an ordered list of rendered digest strings for /loom-resume.
 *
 * Accepts an array of StateExistenceCheck instances (produced by
 * `probeStatePaths` in production or injected stubs in tests). Returns a
 * list of rendered strings, most-recently-modified first.
 *
 * For roadmap-converge entries: reads state via readState(slug) and renders
 * with renderDigestFromState. A missing/unreadable file is skipped with a
 * stderr warning.
 *
 * For pipeline-state entries: delegates to opts.renderPipelineState if
 * provided, otherwise emits a one-line stub (full rendering is Phase 6).
 *
 * Returns an empty array when no state files exist.
 */
export function buildResumeDigests(
  checks: StateExistenceCheck[],
  opts: ResumeDigestOptions = {}
): string[] {
  const stderr = opts.stderr ?? ((l: string) => process.stderr.write(l + "\n"));
  const ordered = orderByMtime(checks);

  const results: string[] = [];
  for (const check of ordered) {
    if (check.kind === "roadmap-converge") {
      const slug = check.slug;
      if (!slug) {
        stderr(`[resume-delegate] roadmap-converge entry missing slug: ${check.path}`);
        continue;
      }
      const { state } = readState(slug);
      if (state === null) {
        stderr(`[resume-delegate] roadmap-converge state not found for slug: ${slug}`);
        continue;
      }
      results.push(renderDigestFromState(state));
    } else {
      // pipeline-state
      if (opts.renderPipelineState) {
        results.push(opts.renderPipelineState(check.path));
      } else {
        results.push(
          `=== Pipeline State ===\n` +
          `State file: ${check.path}\n` +
          `(Full pipeline-state rendering available in Phase 6 — run /loom-status for details)\n`
        );
      }
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Internal fs helpers
// ---------------------------------------------------------------------------

function fileExistsSync(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function fileMtimeSync(path: string): number {
  return statSync(path).mtimeMs;
}
