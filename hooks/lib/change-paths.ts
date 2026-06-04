/**
 * Path constants for the change-proposal lifecycle.
 *
 * Single source of truth for every `.loom/changes/` and
 * `.plan-execution/ephemeral/changes/` path used by the `/loom-change` command,
 * its scripts, and downstream validators. Phase 5 (query subcommands) and
 * Phase 6 (mutation subcommands) both import from here — keeping this module
 * stable prevents drift between callers.
 *
 * All paths are absolute when a `rootDir` is supplied, and relative otherwise.
 * Callers that need an absolute path should pass `process.cwd()` or the project
 * root explicitly; we intentionally do NOT read `process.cwd()` inside this
 * module so the helpers stay pure and testable.
 *
 * Schema references:
 *  - change-proposal.schema.md      → `.loom/changes/{changeId}/proposal.md`
 *  - change-state.schema.md         → `.plan-execution/ephemeral/changes/{changeId}.toon`
 *  - execution-conventions.md       → atomic-write conventions
 */

import path from "node:path";

/** Format of a valid change ID: `chg-{YYYYMMDD}-{kebab-slug}`. */
export const CHANGE_ID_PATTERN: RegExp = /^chg-\d{8}-[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;

/** True when `id` matches the locked changeId format. */
export function isValidChangeId(id: string): boolean {
  return CHANGE_ID_PATTERN.test(id);
}

/**
 * Root directory for all change-proposal artifacts (durable, committed to git).
 *
 * Always relative to the project root. Pass `rootDir` to absolutize:
 *
 *     changesDir("/Users/me/project") → "/Users/me/project/.loom/changes"
 *     changesDir()                    → ".loom/changes"
 */
export function changesDir(rootDir?: string): string {
  return joinRoot(rootDir, ".loom", "changes");
}

/**
 * Per-change directory holding the proposal, deltas, review notes, and archive log.
 *
 *     changeDir("/p", "chg-20260520-x") → "/p/.loom/changes/chg-20260520-x"
 */
export function changeDir(rootDir: string | undefined, changeId: string): string {
  return path.join(changesDir(rootDir), changeId);
}

/**
 * Path to a change's `proposal.md` file (TOON frontmatter + Markdown body).
 *
 * The proposal is the **durable, authoritative** record of intent and content
 * per change-proposal.schema.md. Atomic writes apply.
 */
export function proposalPath(rootDir: string | undefined, changeId: string): string {
  return path.join(changeDir(rootDir, changeId), "proposal.md");
}

/**
 * Path to a change's `deltas.toon` mirror (machine-extracted view of DeltaBlocks).
 *
 * Not authoritative on its own — drift from `proposal.md` is a blocking
 * validator finding. Useful for fast tooling reads.
 */
export function deltasPath(rootDir: string | undefined, changeId: string): string {
  return path.join(changeDir(rootDir, changeId), "deltas.toon");
}

/**
 * Path to a change's optional `review-notes.md` (long-form reviewer commentary).
 *
 * Written by `/loom-change review`. Frontmatter `reviewNotes` holds a short
 * snippet; this file may contain the full commentary.
 */
export function reviewNotesPath(rootDir: string | undefined, changeId: string): string {
  return path.join(changeDir(rootDir, changeId), "review-notes.md");
}

/**
 * Path to a change's `archive-log.toon` (mirror of the History entry appended
 * to each affected contract page).
 *
 * Written by `/loom-change archive` on successful commit.
 */
export function archiveLogPath(rootDir: string | undefined, changeId: string): string {
  return path.join(changeDir(rootDir, changeId), "archive-log.toon");
}

/**
 * Root directory for ephemeral change-state runtime files.
 *
 * Lives under `.plan-execution/ephemeral/` — gitignored, session-scoped per
 * execution-conventions.md.
 */
export function changeStateDir(rootDir?: string): string {
  return joinRoot(rootDir, ".plan-execution", "ephemeral", "changes");
}

/**
 * Path to a change's runtime ChangeState file.
 *
 * Tracks status transitions, conflicts, and supersession. Atomic-write per
 * execution-conventions.md (write `.tmp`, then rename).
 */
export function changeStatePath(rootDir: string | undefined, changeId: string): string {
  return path.join(changeStateDir(rootDir), `${changeId}.toon`);
}

/**
 * Path to a change's rollback log, written by `/loom-change archive` when a
 * mid-archive failure leaves contract pages in an inconsistent state.
 *
 * Format: see change-proposal.schema.md → Atomic Archive Semantics → Rollback
 * Log Format. Companion to `changeStatePath` — same directory, suffixed.
 */
export function rollbackPath(rootDir: string | undefined, changeId: string): string {
  return path.join(changeStateDir(rootDir), `${changeId}-rollback.toon`);
}

/**
 * Temp-file path used for atomic writes. Callers write to this path, then
 * `fs.renameSync` to the real path.
 */
export function tmpPathFor(realPath: string): string {
  return `${realPath}.tmp`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function joinRoot(rootDir: string | undefined, ...segments: string[]): string {
  if (rootDir === undefined || rootDir === "") {
    return path.join(...segments);
  }
  return path.join(rootDir, ...segments);
}
