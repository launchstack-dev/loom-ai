/**
 * Integrator pass for /loom-roadmap converge.
 *
 * Consumes resolved open_questions[] (non-empty `resolution`) and applies
 * them as targeted (surgical) ROADMAP.md edits. After applying all resolved
 * questions the integrator:
 *   1. Writes ROADMAP.md atomically (.tmp + renameSync).
 *   2. Recomputes the content_hash via hashRoadmap.
 *   3. Increments state.round.
 *   4. Returns a standard AgentResult TOON envelope per
 *      agents/protocols/agent-result.schema.md.
 *
 * FC-05 retire-dimension semantics: when a dimension name is added to
 * archivedDimensions[], EVERY open_questions[] row whose `dimension` matches
 * is auto-resolved (resolution = "dimension archived", resolved_at = <now>)
 * in the SAME atomic state write performed by autoResolveArchivedDimensions().
 *
 * The integrator is the sole writer for the retire-dimension transition.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { hashRoadmap } from "./content-hash.js";
import type {
  OpenQuestionV1,
  RoadmapConvergeStateV1,
} from "../migrators/roadmap-converge-state/index.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Subset of AgentResult that the driver consumes from the integrator. */
export interface IntegratorEnvelope {
  /** When false the driver halts with INTEGRATOR_NO_ENVELOPE. */
  ok: boolean;
  /** Files the integrator modified (must include roadmapPath when edited). */
  filesModified: string[];
  /** Recomputed content_hash after writing ROADMAP.md. */
  newContentHash: string;
  /** Questions that could not be located/applied (partial success). */
  unapplied: string[];
  /** Free-form summary for StageContext. */
  summary: string;
}

/** Injection seam — production wires to a real agent call; tests pass mocks. */
export type IntegratorInvoker = (input: IntegratorInput) => Promise<IntegratorEnvelope>;

export interface IntegratorInput {
  roadmapPath: string;
  resolvedQuestions: OpenQuestionV1[];
  state: RoadmapConvergeStateV1;
  now: () => Date;
}

// ---------------------------------------------------------------------------
// Default integrator — runs in-process without spawning an agent
// ---------------------------------------------------------------------------

/**
 * Default in-process integrator. Applies each resolved question to ROADMAP.md
 * by locating the section matching the question's `dimension` name and inserting
 * the resolution text after the first heading match.
 *
 * Surgical rule: only the targeted section is modified. Sections not
 * referenced by any resolved question are written back byte-for-byte.
 */
export async function defaultIntegratorInvoker(
  input: IntegratorInput
): Promise<IntegratorEnvelope> {
  const { roadmapPath, resolvedQuestions, state, now } = input;

  // Filter out questions resolved via dimension-archive (no ROADMAP edit needed).
  const archivedNames = new Set(state.archivedDimensions.map((a) => a.name));
  const actionable = resolvedQuestions.filter(
    (q) => q.resolution !== "dimension archived" && !archivedNames.has(q.dimension)
  );

  if (actionable.length === 0) {
    // No edits needed — recompute hash and return.
    const newContentHash = hashRoadmap(roadmapPath);
    return {
      ok: true,
      filesModified: [],
      newContentHash,
      unapplied: [],
      summary: `Integrator: no actionable questions to apply (${resolvedQuestions.length} total, all archived).`,
    };
  }

  let roadmapContent: string;
  try {
    roadmapContent = readFileSync(roadmapPath, "utf-8");
  } catch (err) {
    return {
      ok: false,
      filesModified: [],
      newContentHash: "",
      unapplied: actionable.map((q) => q.id),
      summary: `Integrator: failed to read ${roadmapPath}: ${(err as Error).message}`,
    };
  }

  const unapplied: string[] = [];
  let mutated = roadmapContent;

  for (const q of actionable) {
    const result = applySurgicalEdit(mutated, q);
    if (result.applied) {
      mutated = result.content;
    } else {
      unapplied.push(q.id);
    }
  }

  // Write atomically only when content changed.
  const applied = actionable.length - unapplied.length;
  if (applied > 0) {
    const tmp = roadmapPath + ".tmp";
    mkdirSync(dirname(roadmapPath), { recursive: true });
    writeFileSync(tmp, mutated, "utf-8");
    renameSync(tmp, roadmapPath);
  }

  const newContentHash = hashRoadmap(roadmapPath);

  const filesModified = applied > 0 ? [roadmapPath] : [];
  const status = unapplied.length === 0 ? "success" : "partial";

  return {
    ok: true,
    filesModified,
    newContentHash,
    unapplied,
    summary: `Integrator: applied ${applied}/${actionable.length} resolved questions to ${roadmapPath}. status=${status}.`,
  };
}

// ---------------------------------------------------------------------------
// Surgical edit engine
// ---------------------------------------------------------------------------

interface EditResult {
  content: string;
  applied: boolean;
}

/**
 * Apply a single resolved question as a surgical ROADMAP.md edit.
 *
 * Strategy:
 *   1. Use the question's `dimension` name as the target section anchor.
 *   2. Find the first heading in the document whose normalised text matches
 *      the anchor (case-insensitive).
 *   3. Insert the resolution text as a new paragraph after the heading's
 *      content section (before the next heading or end of file).
 *   4. If no match, return applied=false (driver records it as unapplied).
 *
 * This is intentionally conservative: we never delete or replace existing
 * text — we only INSERT a tagged resolution note. A future richer integrator
 * can replace sections; this one focuses on correctness + surgical safety.
 */
function applySurgicalEdit(content: string, question: OpenQuestionV1): EditResult {
  // Determine target section name from dimension.
  const anchor = question.dimension?.trim() ?? "";

  if (!anchor) return { content, applied: false };

  const lines = content.split("\n");
  // Find first heading whose normalised text matches the anchor.
  const headingIdx = lines.findIndex((line) => {
    const m = /^#{1,6}\s+(.+)$/.exec(line);
    if (!m) return false;
    return m[1].trim().toLowerCase() === anchor.toLowerCase();
  });

  if (headingIdx === -1) return { content, applied: false };

  // Find insertion point: first blank line after the heading, or just before
  // the next heading (whichever comes first).
  let insertAfter = headingIdx;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) {
      // Next heading — insert before it (after the last non-blank line of the section).
      insertAfter = i - 1;
      // Walk back to skip trailing blank lines.
      while (insertAfter > headingIdx && lines[insertAfter].trim() === "") {
        insertAfter--;
      }
      break;
    }
    // Otherwise keep advancing to end of file.
    insertAfter = i;
  }

  // Build the resolution block to insert.
  const resolutionBlock = [
    "",
    `<!-- converge-resolution id=${question.id} resolved_at=${question.resolved_at ?? "unknown"} -->`,
    question.resolution ?? "",
    `<!-- /converge-resolution -->`,
  ];

  const newLines = [
    ...lines.slice(0, insertAfter + 1),
    ...resolutionBlock,
    ...lines.slice(insertAfter + 1),
  ];

  return { content: newLines.join("\n"), applied: true };
}

// ---------------------------------------------------------------------------
// FC-05: retire-dimension auto-resolution
// ---------------------------------------------------------------------------

/**
 * Auto-resolve all open_questions[] whose `dimension` matches any entry in
 * `archivedDimensions[]`. Sets `resolution = "dimension archived"` and
 * `resolved_at = <now>`. Returns the mutated state (caller must write atomically).
 *
 * This function is idempotent: questions already resolved are not modified.
 */
export function autoResolveArchivedDimensions(
  state: RoadmapConvergeStateV1,
  now: () => Date
): RoadmapConvergeStateV1 {
  const archivedNames = new Set(state.archivedDimensions.map((a) => a.name));
  if (archivedNames.size === 0) return state;

  const nowIso = now().toISOString();
  let mutated = false;

  const updatedQuestions: OpenQuestionV1[] = state.open_questions.map((q) => {
    // Already resolved — don't touch.
    if (q.resolved_at) return q;
    if (!archivedNames.has(q.dimension)) return q;

    mutated = true;
    return {
      ...q,
      resolved_at: nowIso,
      resolution: "dimension archived",
    };
  });

  if (!mutated) return state;

  return {
    ...state,
    open_questions: updatedQuestions,
  };
}

// ---------------------------------------------------------------------------
// IntegratorEnvelope validator (used by driver to enforce AW-05 / F-58)
// ---------------------------------------------------------------------------

/**
 * Returns true when the value looks like a valid IntegratorEnvelope.
 * The driver calls this before proceeding; if it returns false the driver
 * halts with INTEGRATOR_NO_ENVELOPE.
 */
export function isIntegratorEnvelope(value: unknown): value is IntegratorEnvelope {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.ok === "boolean" &&
    Array.isArray(v.filesModified) &&
    typeof v.newContentHash === "string" &&
    Array.isArray(v.unapplied)
  );
}
