#!/usr/bin/env tsx
/**
 * /loom-change init "title" — create a new change-proposal directory.
 *
 * Creates `.loom/changes/chg-{YYYYMMDD}-{kebab-slug}/proposal.md` populated from
 * the schema, an initial ChangeState file under
 * `.plan-execution/ephemeral/changes/{changeId}.toon`, and a `deltas.toon`
 * mirror file (kept empty/zero-row until the author fills in `## Deltas`).
 *
 * If the changeId already exists with `status: rejected`, init **revives** it:
 *   - Preserves the directory (the author may have notes/scratch they want).
 *   - Resets proposal.md to a fresh template (frontmatter only).
 *   - Resets ChangeState back to `proposed` with a fresh transition
 *     `rejected → proposed`.
 *   - Re-writes the deltas.toon mirror to zero rows.
 *
 * Otherwise, init refuses to overwrite an existing change (status ≠ rejected)
 * with exit code 1.
 *
 * Phase 6 deliverable. See PLAN-spec-upgrades.md Phase 6 + change-proposal.schema.md.
 *
 * Field-locked names (see change-proposal.schema.md → ## ChangeProposal Field Reference):
 *   changeId, status, intent, scope, approach, affectedSpecs, deltas,
 *   linkedPlan, reviewedBy, reviewedAt, reviewNotes, approvedBy, approvedAt,
 *   createdAt, archivedAt.
 *
 * Exit codes:
 *   0  success
 *   1  refusing to overwrite an existing non-rejected change
 *   2  invalid arguments / IO / format error
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  changeDir,
  changesDir,
  changeStateDir,
  deltasPath,
  isValidChangeId,
  proposalPath,
  tmpPathFor,
} from "../../hooks/lib/change-paths.js";
import {
  readChangeState,
  writeChangeState,
  type ChangeState,
  type TransitionEntry,
} from "../../hooks/lib/change-state.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface InitOptions {
  /** Free-text title; converted to a kebab-case slug for the change directory. */
  title: string;
  /** Optional explicit changeId — overrides auto-generation. Must be valid format. */
  changeId?: string;
  /** Project root. Defaults to `process.cwd()`. */
  rootDir?: string;
  /** Actor identity recorded on the initial transition. */
  actor?: string;
  /** Fixed timestamp for createdAt / updatedAt — testing aid. Defaults to now. */
  now?: Date;
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
}

export interface InitResult {
  changeId: string;
  proposalFile: string;
  stateFile: string;
  deltasFile: string;
  /** True when an existing rejected change was revived. */
  revived: boolean;
  exitCode: number;
}

export function runInit(options: InitOptions): InitResult {
  const rootDir = options.rootDir ?? process.cwd();
  const out = options.out ?? process.stdout;
  const err = options.err ?? process.stderr;
  const now = options.now ?? new Date();
  const actor = options.actor ?? "human:cli";

  const title = options.title.trim();
  if (title.length === 0) {
    err.write("Usage: /loom-change init \"<title>\"\n");
    return emptyResult(2);
  }

  let changeId: string;
  if (options.changeId !== undefined) {
    if (!isValidChangeId(options.changeId)) {
      err.write(
        `Invalid changeId '${options.changeId}': expected chg-{YYYYMMDD}-{kebab-slug}\n`
      );
      return emptyResult(2);
    }
    changeId = options.changeId;
  } else {
    changeId = generateChangeId(title, now);
  }

  const dir = changeDir(rootDir, changeId);
  const propPath = proposalPath(rootDir, changeId);
  const delPath = deltasPath(rootDir, changeId);

  let revived = false;

  if (fs.existsSync(dir)) {
    // Allow reviving a rejected change; refuse anything else.
    const existingState = safeReadState(rootDir, changeId);
    if (existingState === null) {
      err.write(
        `Directory exists at ${path.relative(rootDir, dir)} with no ChangeState. ` +
          `Remove it manually or pick a different title.\n`
      );
      return emptyResult(1);
    }
    if (existingState.status !== "rejected") {
      err.write(
        `Change '${changeId}' already exists with status '${existingState.status}'. ` +
          `Only rejected changes may be revived via re-init.\n`
      );
      return emptyResult(1);
    }
    revived = true;
  }

  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(changesDir(rootDir), { recursive: true });
  fs.mkdirSync(changeStateDir(rootDir), { recursive: true });

  const createdAt = now.toISOString();
  const titleHuman = humanizeTitle(title);

  // Write proposal.md
  const proposalBody = renderInitialProposal({
    changeId,
    title: titleHuman,
    createdAt,
  });
  atomicWriteText(propPath, proposalBody);

  // Write deltas.toon (zero rows — author fills in via subsequent edits)
  atomicWriteText(delPath, renderEmptyDeltasToon());

  // Write or rewrite ChangeState
  let transitions: TransitionEntry[];
  if (revived) {
    // Preserve the existing transitions history; append a new
    // `rejected → proposed` transition. Bump the updatedAt strictly forward.
    const existing = safeReadState(rootDir, changeId)!;
    const reviveAt = bumpAfter(existing.updatedAt, now);
    transitions = [
      ...existing.transitions,
      {
        from: "rejected",
        to: "proposed",
        at: reviveAt,
        by: actor,
        reason: "revived via re-init",
      },
    ];
    const nextState: ChangeState = {
      changeId,
      status: "proposed",
      transitions,
      conflicts: existing.conflicts, // historical record retained
      supersededBy: null,
      updatedAt: reviveAt,
    };
    writeChangeState(rootDir, nextState);
  } else {
    transitions = [
      {
        from: "",
        to: "proposed",
        at: createdAt,
        by: actor,
        reason: "initial proposal",
      },
    ];
    const state: ChangeState = {
      changeId,
      status: "proposed",
      transitions,
      conflicts: [],
      supersededBy: null,
      updatedAt: createdAt,
    };
    writeChangeState(rootDir, state);
  }

  out.write(
    revived
      ? `Revived rejected change ${changeId} at ${path.relative(rootDir, dir)}\n`
      : `Initialized change ${changeId} at ${path.relative(rootDir, dir)}\n`
  );
  out.write(`  proposal: ${path.relative(rootDir, propPath)}\n`);
  out.write(`  deltas:   ${path.relative(rootDir, delPath)}\n`);

  return {
    changeId,
    proposalFile: propPath,
    stateFile: "", // not exposed; writeChangeState resolves it
    deltasFile: delPath,
    revived,
    exitCode: 0,
  };
}

// ---------------------------------------------------------------------------
// Shared helpers — re-exported so quick-archive (and other Phase 6 scripts)
// can compose their own retroactive proposals without duplicating template
// logic.
// ---------------------------------------------------------------------------

/** Compute a changeId from a free-text title and date. */
export function generateChangeId(title: string, now: Date): string {
  const datePart = formatDate(now);
  const slug = toKebabSlug(title);
  return `chg-${datePart}-${slug}`;
}

/** Convert ANY string to a kebab-case slug usable in the changeId tail. */
export function toKebabSlug(input: string): string {
  const lower = input.toLowerCase();
  const cleaned = lower
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  // Slug must be 3-60 chars, lowercase alnum + hyphens, start/end alnum.
  let slug = cleaned;
  if (slug.length < 3) {
    slug = `${slug}-change`.replace(/-+/g, "-");
  }
  if (slug.length > 60) {
    slug = slug.slice(0, 60).replace(/-+$/, "");
  }
  // Ensure starts/ends with alnum.
  if (!/^[a-z0-9]/.test(slug)) slug = `c${slug}`;
  if (!/[a-z0-9]$/.test(slug)) slug = `${slug}0`;
  return slug;
}

/** Convert a title slug-fragment back to a human-readable headline. */
export function humanizeTitle(rawTitle: string): string {
  // Author may have passed a quoted phrase; just trim and use as-is.
  return rawTitle.trim();
}

export interface InitialProposalInput {
  changeId: string;
  title: string;
  createdAt: string;
}

/**
 * Render the initial template proposal.md body — TOON frontmatter with all
 * required fields stubbed (nullable optional fields left blank), followed by
 * the body section skeleton from change-proposal.schema.md.
 */
export function renderInitialProposal(input: InitialProposalInput): string {
  const lines: string[] = [];
  lines.push("```toon");
  lines.push(`changeId: ${input.changeId}`);
  lines.push(`status: proposed`);
  lines.push(`intent: ${escapeScalar(input.title)} — fill in 2-5 sentences explaining what and why.`);
  lines.push(`scope:`);
  lines.push(`  included[1]: TODO list at least one in-scope item`);
  lines.push(`  excluded[1]: TODO list at least one explicit exclusion`);
  lines.push(`approach: TODO 1-3 sentences on the high-level technical strategy.`);
  lines.push(`affectedSpecs[0]:`);
  lines.push(`linkedPlan:`);
  lines.push(`reviewedBy:`);
  lines.push(`reviewedAt:`);
  lines.push(`reviewNotes:`);
  lines.push(`approvedBy:`);
  lines.push(`approvedAt:`);
  lines.push(`createdAt: ${input.createdAt}`);
  lines.push(`archivedAt:`);
  lines.push("```");
  lines.push("");
  lines.push(`# Change Proposal: ${input.title}`);
  lines.push("");
  lines.push(`## Intent`);
  lines.push(`<!-- prose elaboration of the intent frontmatter field -->`);
  lines.push("");
  lines.push(`## Scope`);
  lines.push(`<!-- prose elaboration of the scope frontmatter field -->`);
  lines.push("");
  lines.push(`## Approach`);
  lines.push(`<!-- prose elaboration of the approach frontmatter field -->`);
  lines.push("");
  lines.push(`## Deltas`);
  lines.push(`<!-- one ### {domain} subsection per DeltaBlock; see change-proposal.schema.md -->`);
  lines.push("");
  lines.push(`## Rationale`);
  lines.push(`<!-- free-form rationale; archived into the contract page's History section -->`);
  lines.push("");
  return lines.join("\n");
}

/** Empty deltas mirror — overwritten by Phase 6 archive once deltas exist. */
export function renderEmptyDeltasToon(): string {
  return [
    `# deltas.toon mirror — refreshed by /loom-change archive on commit. Source of truth is proposal.md.`,
    `deltas[0]{domain,breakingChange,addedReqCount,modifiedReqCount,removedReqCount,addedScenarioCount,modifiedScenarioCount,removedScenarioCount}:`,
    ``,
  ].join("\n");
}

/** Atomic text write: write `.tmp`, then `fs.renameSync`. */
export function atomicWriteText(target: string, content: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = tmpPathFor(target);
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, target);
}

/**
 * Return a strictly-monotonic ISO timestamp greater than `previous`, anchored
 * to `now` when possible. Used when reviving a rejected change, or stamping
 * multiple transitions in the same logical operation (quick-archive).
 */
export function bumpAfter(previous: string, now: Date): string {
  const nowIso = now.toISOString();
  if (nowIso > previous) return nowIso;
  // Bump by 1 millisecond past the previous timestamp.
  const t = Date.parse(previous);
  if (Number.isNaN(t)) {
    // Last resort — append a fixed suffix so we still move forward.
    return `${previous}+1ms`;
  }
  return new Date(t + 1).toISOString();
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function emptyResult(exitCode: number): InitResult {
  return {
    changeId: "",
    proposalFile: "",
    stateFile: "",
    deltasFile: "",
    revived: false,
    exitCode,
  };
}

function safeReadState(rootDir: string, changeId: string): ChangeState | null {
  try {
    return readChangeState(rootDir, changeId);
  } catch {
    return null;
  }
}

function formatDate(d: Date): string {
  const y = d.getUTCFullYear().toString().padStart(4, "0");
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = d.getUTCDate().toString().padStart(2, "0");
  return `${y}${m}${day}`;
}

function escapeScalar(text: string): string {
  // TOON scalars: keep things simple — replace newlines, strip leading/trailing
  // whitespace. Quoting is not required by the parser for this template.
  return text.replace(/\r?\n/g, " ").trim();
}

// ---------------------------------------------------------------------------
// CLI entry-point
// ---------------------------------------------------------------------------

function parseCliArgs(argv: string[]): InitOptions | { error: string } {
  const positional: string[] = [];
  let rootDir: string | undefined;
  let changeId: string | undefined;
  let actor: string | undefined;

  for (const arg of argv) {
    if (arg.startsWith("--root=")) rootDir = arg.slice("--root=".length);
    else if (arg.startsWith("--id=")) changeId = arg.slice("--id=".length);
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
    else if (!arg.startsWith("--")) positional.push(arg);
  }

  if (positional.length === 0) {
    return { error: "Usage: /loom-change init \"<title>\"" };
  }
  const title = positional.join(" ");
  return { title, changeId, actor, rootDir };
}

const isMain =
  (process.argv[1] ?? "").endsWith("init.ts") ||
  (process.argv[1] ?? "").endsWith("init.js");

if (isMain) {
  const parsed = parseCliArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(parsed.error + "\n");
    process.exit(2);
  }
  const result = runInit(parsed);
  process.exit(result.exitCode);
}
