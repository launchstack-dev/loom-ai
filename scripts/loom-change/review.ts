#!/usr/bin/env tsx
/**
 * /loom-change review <id> [--by <actor>] [--notes "..."] — stamp review.
 *
 * Transitions the change from `proposed` → `reviewed`:
 *   - Updates proposal.md frontmatter: stamps `status`, `reviewedBy`,
 *     `reviewedAt`, and `reviewNotes` (when supplied).
 *   - Appends a `proposed → reviewed` transition to ChangeState.
 *
 * Rejects illegal transitions (any source state other than `proposed`) with a
 * clear error.
 *
 * Phase 6 deliverable. See PLAN-spec-upgrades.md Phase 6 + change-proposal.schema.md.
 *
 * Exit codes:
 *   0  success
 *   1  illegal transition (status not 'proposed') or missing proposal
 *   2  invalid arguments / IO error
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  CHANGE_ID_PATTERN,
  changeDir,
  isValidChangeId,
  proposalPath,
  reviewNotesPath,
  tmpPathFor,
} from "../../hooks/lib/change-paths.js";
import {
  readChangeState,
  writeChangeState,
  type ChangeState,
} from "../../hooks/lib/change-state.js";
import { bumpAfter, atomicWriteText } from "./init.js";

export interface ReviewOptions {
  changeId: string;
  rootDir?: string;
  by?: string;
  notes?: string;
  /** Optional explicit timestamp for testing. Defaults to now. */
  now?: Date;
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
}

export interface ReviewResult {
  changeId: string;
  exitCode: number;
}

export function runReview(options: ReviewOptions): ReviewResult {
  const rootDir = options.rootDir ?? process.cwd();
  const out = options.out ?? process.stdout;
  const err = options.err ?? process.stderr;
  const now = options.now ?? new Date();
  const actor = options.by ?? "human:cli";

  if (!isValidChangeId(options.changeId)) {
    err.write(
      `Invalid changeId '${options.changeId}': expected ${CHANGE_ID_PATTERN}\n`
    );
    return { changeId: options.changeId, exitCode: 2 };
  }

  const dir = changeDir(rootDir, options.changeId);
  if (!fs.existsSync(dir)) {
    err.write(`No change found at ${path.relative(rootDir, dir)}\n`);
    return { changeId: options.changeId, exitCode: 1 };
  }

  let state: ChangeState | null;
  try {
    state = readChangeState(rootDir, options.changeId);
  } catch (e) {
    err.write(`Failed to read ChangeState: ${stringifyError(e)}\n`);
    return { changeId: options.changeId, exitCode: 2 };
  }
  if (state === null) {
    err.write(`No ChangeState found for ${options.changeId}\n`);
    return { changeId: options.changeId, exitCode: 1 };
  }
  if (state.status !== "proposed") {
    err.write(
      `Illegal transition: cannot review change with status '${state.status}' (expected 'proposed').\n`
    );
    return { changeId: options.changeId, exitCode: 1 };
  }

  const reviewedAt = bumpAfter(state.updatedAt, now);

  // Update proposal.md frontmatter.
  const propPath = proposalPath(rootDir, options.changeId);
  if (!fs.existsSync(propPath)) {
    err.write(`Proposal missing at ${path.relative(rootDir, propPath)}\n`);
    return { changeId: options.changeId, exitCode: 1 };
  }
  const raw = fs.readFileSync(propPath, "utf8");
  const updated = applyFrontmatterUpdates(raw, {
    status: "reviewed",
    reviewedBy: actor,
    reviewedAt,
    reviewNotes: options.notes ?? null,
  });
  atomicWriteText(propPath, updated);

  // Optionally persist long review notes in the dedicated file.
  if (options.notes !== undefined && options.notes.length > 0) {
    const notesPath = reviewNotesPath(rootDir, options.changeId);
    atomicWriteText(
      notesPath,
      `# Review notes for ${options.changeId}\n\n${options.notes}\n`
    );
  }

  // Append ChangeState transition.
  const nextState: ChangeState = {
    ...state,
    status: "reviewed",
    transitions: [
      ...state.transitions,
      {
        from: "proposed",
        to: "reviewed",
        at: reviewedAt,
        by: actor,
        reason: options.notes ?? "review accepted",
      },
    ],
    updatedAt: reviewedAt,
  };
  writeChangeState(rootDir, nextState);

  out.write(`Reviewed ${options.changeId} (by ${actor} at ${reviewedAt})\n`);
  return { changeId: options.changeId, exitCode: 0 };
}

// ---------------------------------------------------------------------------
// Frontmatter mutator — small targeted updater that preserves prose body.
// Exported so other Phase 6 mutation scripts can reuse it.
// ---------------------------------------------------------------------------

export interface FrontmatterUpdates {
  status?: string;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  reviewNotes?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  archivedAt?: string | null;
}

/**
 * Apply scalar updates to the TOON frontmatter of a proposal.md document.
 *
 * The body (everything after the closing fence) is preserved verbatim. The
 * frontmatter block is parsed line-by-line; matching scalar keys are replaced.
 * Keys not present in the frontmatter are NOT added — this function only
 * mutates fields that already exist (the init template seeds them all as
 * blanks, so this covers every legal field).
 */
export function applyFrontmatterUpdates(
  raw: string,
  updates: FrontmatterUpdates
): string {
  const lines = raw.split("\n");
  // Find opening + closing TOON fence.
  let openIdx = -1;
  let closeIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (openIdx === -1 && /^```\s*toon\s*$/.test(lines[i])) {
      openIdx = i;
      continue;
    }
    if (openIdx !== -1 && /^```\s*$/.test(lines[i])) {
      closeIdx = i;
      break;
    }
  }
  if (openIdx === -1 || closeIdx === -1) {
    // Malformed frontmatter — return unchanged. Callers verify via subsequent
    // parse, so this surfaces as a downstream error.
    return raw;
  }

  for (let i = openIdx + 1; i < closeIdx; i++) {
    const line = lines[i];
    // Skip indented children (e.g., scope subfields).
    if (line.startsWith("  ")) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const newValue = pickUpdate(updates, key);
    if (newValue === undefined) continue;
    lines[i] = `${key}:${newValue === null || newValue === "" ? "" : ` ${escapeScalar(newValue)}`}`;
  }

  return lines.join("\n");
}

function pickUpdate(
  updates: FrontmatterUpdates,
  key: string
): string | null | undefined {
  switch (key) {
    case "status":
      return updates.status;
    case "reviewedBy":
      return updates.reviewedBy;
    case "reviewedAt":
      return updates.reviewedAt;
    case "reviewNotes":
      return updates.reviewNotes;
    case "approvedBy":
      return updates.approvedBy;
    case "approvedAt":
      return updates.approvedAt;
    case "archivedAt":
      return updates.archivedAt;
    default:
      return undefined;
  }
}

function escapeScalar(value: string): string {
  return value.replace(/\r?\n/g, " ").trim();
}

function stringifyError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// CLI entry-point
// ---------------------------------------------------------------------------

function parseCliArgs(argv: string[]): ReviewOptions | { error: string } {
  let changeId: string | null = null;
  let by: string | undefined;
  let notes: string | undefined;
  let rootDir: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--by") {
      by = argv[++i];
    } else if (arg.startsWith("--by=")) {
      by = arg.slice("--by=".length);
    } else if (arg === "--notes") {
      notes = argv[++i];
    } else if (arg.startsWith("--notes=")) {
      notes = arg.slice("--notes=".length);
    } else if (arg.startsWith("--root=")) {
      rootDir = arg.slice("--root=".length);
    } else if (!arg.startsWith("--")) {
      if (changeId !== null) {
        return { error: `Multiple changeId arguments: '${changeId}', '${arg}'` };
      }
      changeId = arg;
    }
  }
  if (changeId === null) {
    return { error: "Usage: /loom-change review <changeId> [--by <actor>] [--notes \"...\"]" };
  }
  return { changeId, by, notes, rootDir };
}

const isMain =
  (process.argv[1] ?? "").endsWith("review.ts") ||
  (process.argv[1] ?? "").endsWith("review.js");

if (isMain) {
  const parsed = parseCliArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(parsed.error + "\n");
    process.exit(2);
  }
  const result = runReview(parsed);
  process.exit(result.exitCode);
}
