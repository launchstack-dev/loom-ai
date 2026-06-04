#!/usr/bin/env tsx
/**
 * /loom-change quick-archive — zero-ceremony retroactive change.
 *
 * Used by `/loom-quick` after convergence passes. Compresses the lifecycle:
 *   1. Synthesize a minimal ChangeProposal from a deltas object + rationale.
 *   2. Stamp `reviewedBy: loom-quick`, `reviewedAt`, `approvedBy: loom-quick`,
 *      `approvedAt` with strictly-monotonic timestamps so the ChangeState
 *      transitions[] array remains valid.
 *   3. Run the standard archive path (full atomicity, conflict scan, and
 *      supersession scan intact — no shortcuts).
 *   4. Leave a retroactive proposal.md in `.loom/changes/` for audit.
 *
 * No interactive prompts. Callers MUST pass a fully-formed deltas object.
 *
 * Phase 6 deliverable. See PLAN-spec-upgrades.md Phase 6 + change-proposal.schema.md
 * → Quick-Mode Path.
 *
 * Exit codes:
 *   0  success
 *   1  archive failed (conflict, pre-flight, illegal state)
 *   2  invalid arguments / IO error
 *   3  mid-archive rollback emitted
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
} from "../../hooks/lib/change-paths.js";
import {
  writeChangeState,
  type ChangeState,
  type TransitionEntry,
} from "../../hooks/lib/change-state.js";
import {
  atomicWriteText,
  bumpAfter,
  generateChangeId,
  renderEmptyDeltasToon,
  toKebabSlug,
} from "./init.js";
import { runArchive, type ArchiveResult } from "./archive.js";

// ---------------------------------------------------------------------------
// Quick-archive delta input — mirrors DeltaBlockSummary but accepts the user's
// pre-formatted strings without parsing them.
// ---------------------------------------------------------------------------

export interface QuickArchiveScenario {
  /** Will be assigned/preserved. */
  id: string;
  title: string;
  given: string[];
  when: string;
  whenTriggerType: string;
  then: string[];
  stateRef: string | null;
  tags: string[];
  testTier: string | null;
  automatable: boolean;
}

export interface QuickArchiveScenarioModification {
  id: string;
  /** Raw TOON body of the existing scenario. */
  beforeRaw: string;
  /** Raw TOON body of the replacement scenario. */
  afterRaw: string;
}

export interface QuickArchiveRequirementModification {
  id: string;
  before: string;
  after: string;
}

export interface QuickArchiveDelta {
  domain: string;
  addedRequirements: string[];
  modifiedRequirements: QuickArchiveRequirementModification[];
  removedRequirements: string[];
  addedScenarios: QuickArchiveScenario[];
  modifiedScenarios: QuickArchiveScenarioModification[];
  removedScenarios: string[];
  breakingChange: boolean;
  migrationNote: string | null;
  rationale: string;
}

export interface QuickArchiveOptions {
  /** Free-text title — converted to a slug. */
  title: string;
  /** Rationale for the change — embedded in `## Rationale` and per-delta. */
  rationale: string;
  /** Per-domain mutations. ≥1 required. */
  deltas: QuickArchiveDelta[];
  /** Project root. Defaults to `process.cwd()`. */
  rootDir?: string;
  /** Wiki root. Defaults to `<rootDir>/.loom/wiki`. */
  wikiRoot?: string;
  /** Optional explicit changeId — overrides auto-generation. */
  changeId?: string;
  /** Fixed timestamp for deterministic tests. Defaults to now. */
  now?: Date;
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
}

export interface QuickArchiveResult {
  changeId: string;
  proposalFile: string;
  archive: ArchiveResult | null;
  exitCode: number;
}

/** Actor identity used for all auto-stamped transitions. */
const QUICK_ACTOR = "loom-quick";

export function runQuickArchive(options: QuickArchiveOptions): QuickArchiveResult {
  const rootDir = options.rootDir ?? process.cwd();
  const out = options.out ?? process.stdout;
  const err = options.err ?? process.stderr;
  const now = options.now ?? new Date();

  if (options.deltas.length === 0) {
    err.write("quick-archive: deltas[] must be non-empty.\n");
    return { changeId: "", proposalFile: "", archive: null, exitCode: 2 };
  }
  if (options.rationale.trim().length < 30) {
    err.write("quick-archive: rationale must be at least 30 characters.\n");
    return { changeId: "", proposalFile: "", archive: null, exitCode: 2 };
  }

  // ---- changeId --------------------------------------------------------
  let changeId: string;
  if (options.changeId) {
    if (!isValidChangeId(options.changeId)) {
      err.write(`quick-archive: invalid changeId '${options.changeId}'.\n`);
      return { changeId: "", proposalFile: "", archive: null, exitCode: 2 };
    }
    changeId = options.changeId;
  } else {
    changeId = generateChangeId(options.title || "quick", now);
  }

  // ---- Generate retroactive proposal -----------------------------------
  const dir = changeDir(rootDir, changeId);
  if (fs.existsSync(dir)) {
    err.write(`quick-archive: directory already exists at ${path.relative(rootDir, dir)}.\n`);
    return { changeId, proposalFile: "", archive: null, exitCode: 1 };
  }

  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(changesDir(rootDir), { recursive: true });
  fs.mkdirSync(changeStateDir(rootDir), { recursive: true });

  // Build monotonic timestamp ladder: createdAt < reviewedAt < approvedAt < runAt < archivedAt.
  // We bump 1ms per step from `now`. The archive script does its own bumping
  // via bumpAfter when it writes the archive transition.
  const t0 = now.toISOString();
  const t1 = new Date(now.getTime() + 1).toISOString();
  const t2 = new Date(now.getTime() + 2).toISOString();
  const t3 = new Date(now.getTime() + 3).toISOString();

  const affectedSpecs = options.deltas.map((d) => d.domain);
  const titleHuman = options.title.trim() || "quick archive";

  // Write proposal.md with synthesized frontmatter and a body that includes
  // the deltas (so archive.ts can parse them via parseDeltasFromProposal).
  const proposalBody = renderQuickArchiveProposal({
    changeId,
    title: titleHuman,
    rationale: options.rationale,
    deltas: options.deltas,
    affectedSpecs,
    createdAt: t0,
    reviewedAt: t1,
    approvedAt: t2,
    archivedAt: null, // archive.ts will stamp this
  });
  const propPath = proposalPath(rootDir, changeId);
  atomicWriteText(propPath, proposalBody);

  // Write deltas.toon mirror.
  const delPath = deltasPath(rootDir, changeId);
  atomicWriteText(delPath, renderQuickArchiveDeltasMirror(options.deltas));

  // Write ChangeState with all transitions up to in-progress.
  const transitions: TransitionEntry[] = [
    { from: "", to: "proposed", at: t0, by: QUICK_ACTOR, reason: "quick-archive synthesized proposal" },
    { from: "proposed", to: "reviewed", at: t1, by: QUICK_ACTOR, reason: "quick-archive auto-review" },
    { from: "reviewed", to: "approved", at: t2, by: QUICK_ACTOR, reason: "quick-archive auto-approve" },
    { from: "approved", to: "in-progress", at: t3, by: QUICK_ACTOR, reason: "quick-archive auto-run" },
  ];
  const state: ChangeState = {
    changeId,
    status: "in-progress",
    transitions,
    conflicts: [],
    supersededBy: null,
    updatedAt: t3,
  };
  writeChangeState(rootDir, state);

  // ---- Run archive ----------------------------------------------------
  // archive.ts does its own bumpAfter, so even with millisecond ladder above
  // the final archive timestamp will be strictly greater than t3.
  const archiveAt = new Date(now.getTime() + 100);
  const archiveResult = runArchive({
    changeId,
    rootDir,
    by: QUICK_ACTOR,
    now: archiveAt,
    wikiRoot: options.wikiRoot,
    out,
    err,
  });

  if (archiveResult.exitCode !== 0) {
    return {
      changeId,
      proposalFile: propPath,
      archive: archiveResult,
      exitCode: archiveResult.exitCode,
    };
  }

  return { changeId, proposalFile: propPath, archive: archiveResult, exitCode: 0 };
}

// ---------------------------------------------------------------------------
// Proposal rendering — matches the schema closely so archive.ts can re-parse it.
// ---------------------------------------------------------------------------

interface QuickArchiveProposalRender {
  changeId: string;
  title: string;
  rationale: string;
  deltas: QuickArchiveDelta[];
  affectedSpecs: string[];
  createdAt: string;
  reviewedAt: string;
  approvedAt: string;
  archivedAt: string | null;
}

function renderQuickArchiveProposal(input: QuickArchiveProposalRender): string {
  const lines: string[] = [];
  lines.push("```toon");
  lines.push(`changeId: ${input.changeId}`);
  lines.push(`status: in-progress`);
  lines.push(`intent: ${escapeScalar(input.title)} — retroactive archive via /loom-quick.`);
  lines.push(`scope:`);
  lines.push(`  included[1]: changes captured by /loom-quick`);
  lines.push(`  excluded[1]: anything outside the listed deltas`);
  lines.push(`approach: Zero-ceremony quick-archive synthesized by /loom-quick after convergence.`);
  lines.push(`affectedSpecs[${input.affectedSpecs.length}]: ${input.affectedSpecs.join(", ")}`);
  lines.push(`linkedPlan:`);
  lines.push(`reviewedBy: ${QUICK_ACTOR}`);
  lines.push(`reviewedAt: ${input.reviewedAt}`);
  lines.push(`reviewNotes: auto-review by /loom-quick`);
  lines.push(`approvedBy: ${QUICK_ACTOR}`);
  lines.push(`approvedAt: ${input.approvedAt}`);
  lines.push(`createdAt: ${input.createdAt}`);
  lines.push(`archivedAt:${input.archivedAt ? ` ${input.archivedAt}` : ""}`);
  lines.push("```");
  lines.push("");
  lines.push(`# Change Proposal: ${input.title}`);
  lines.push("");
  lines.push(`## Intent`);
  lines.push(`Retroactive change captured by /loom-quick to keep contract pages coherent after a zero-ceremony task.`);
  lines.push("");
  lines.push(`## Scope`);
  lines.push(`Included: the deltas listed below. Excluded: anything not captured in those deltas.`);
  lines.push("");
  lines.push(`## Approach`);
  lines.push(`/loom-quick executed the task; this proposal captures the resulting deltas for the change lifecycle.`);
  lines.push("");
  lines.push(`## Deltas`);
  lines.push("");
  for (const d of input.deltas) {
    lines.push(`### ${d.domain}`);
    lines.push("");
    lines.push("```toon");
    lines.push(`domain: ${d.domain}`);
    if (d.addedRequirements.length === 0) {
      lines.push(`addedRequirements[0]:`);
    } else {
      lines.push(`addedRequirements[${d.addedRequirements.length}]: ${d.addedRequirements.map(csvEscape).join(", ")}`);
    }
    if (d.modifiedRequirements.length === 0) {
      lines.push(`modifiedRequirements[0]{id,before,after}:`);
    } else {
      lines.push(`modifiedRequirements[${d.modifiedRequirements.length}]{id,before,after}:`);
      for (const m of d.modifiedRequirements) {
        lines.push(`  ${csvEscape(m.id)},${csvEscape(m.before)},${csvEscape(m.after)}`);
      }
    }
    if (d.removedRequirements.length === 0) {
      lines.push(`removedRequirements[0]:`);
    } else {
      lines.push(`removedRequirements[${d.removedRequirements.length}]: ${d.removedRequirements.join(", ")}`);
    }
    if (d.addedScenarios.length === 0) {
      lines.push(`addedScenarios[0]:`);
    } else {
      lines.push(`addedScenarios[${d.addedScenarios.length}]:`);
      for (const s of d.addedScenarios) {
        lines.push("  ```toon");
        lines.push(`  id: ${s.id}`);
        lines.push(`  title: ${s.title}`);
        lines.push(`  given[${s.given.length}]: ${s.given.join(", ")}`);
        lines.push(`  when: ${s.when}`);
        lines.push(`  whenTriggerType: ${s.whenTriggerType}`);
        lines.push(`  then[${s.then.length}]: ${s.then.join(", ")}`);
        lines.push(`  stateRef:${s.stateRef ? ` ${s.stateRef}` : ""}`);
        lines.push(`  tags[${s.tags.length}]: ${s.tags.join(", ")}`);
        lines.push(`  testTier:${s.testTier ? ` ${s.testTier}` : ""}`);
        lines.push(`  automatable: ${s.automatable ? "true" : "false"}`);
        lines.push("  ```");
      }
    }
    if (d.modifiedScenarios.length === 0) {
      lines.push(`modifiedScenarios[0]{id,before,after}:`);
    } else {
      lines.push(`modifiedScenarios[${d.modifiedScenarios.length}]{id,before,after}:`);
      for (const m of d.modifiedScenarios) {
        lines.push(`  ${csvEscape(m.id)},${csvEscape(m.beforeRaw)},${csvEscape(m.afterRaw)}`);
      }
    }
    if (d.removedScenarios.length === 0) {
      lines.push(`removedScenarios[0]:`);
    } else {
      lines.push(`removedScenarios[${d.removedScenarios.length}]: ${d.removedScenarios.join(", ")}`);
    }
    lines.push(`breakingChange: ${d.breakingChange ? "true" : "false"}`);
    lines.push(`migrationNote:${d.migrationNote ? ` ${escapeScalar(d.migrationNote)}` : ""}`);
    lines.push(`rationale: ${escapeScalar(d.rationale)}`);
    lines.push("```");
    lines.push("");
  }
  lines.push(`## Rationale`);
  lines.push(input.rationale.trim());
  lines.push("");
  return lines.join("\n");
}

function renderQuickArchiveDeltasMirror(deltas: QuickArchiveDelta[]): string {
  const lines: string[] = [];
  lines.push(`# deltas.toon mirror — written by /loom-change quick-archive.`);
  lines.push(`deltas[${deltas.length}]{domain,breakingChange,addedReqCount,modifiedReqCount,removedReqCount,addedScenarioCount,modifiedScenarioCount,removedScenarioCount}:`);
  for (const d of deltas) {
    lines.push(
      `  ${d.domain},${d.breakingChange ? "true" : "false"},${d.addedRequirements.length},${d.modifiedRequirements.length},${d.removedRequirements.length},${d.addedScenarios.length},${d.modifiedScenarios.length},${d.removedScenarios.length}`
    );
  }
  return lines.join("\n") + "\n";
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function escapeScalar(value: string): string {
  return value.replace(/\r?\n/g, " ").trim();
}

// ---------------------------------------------------------------------------
// CLI entry-point — quick-archive is primarily a library function called by
// /loom-quick, but a thin CLI is useful for testing.
// ---------------------------------------------------------------------------

interface CliOptions {
  inputFile?: string;
  rootDir?: string;
  wikiRoot?: string;
}

function parseCliArgs(argv: string[]): CliOptions | { error: string } {
  const opts: CliOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--input") opts.inputFile = argv[++i];
    else if (arg.startsWith("--input=")) opts.inputFile = arg.slice("--input=".length);
    else if (arg.startsWith("--root=")) opts.rootDir = arg.slice("--root=".length);
    else if (arg.startsWith("--wiki-root=")) opts.wikiRoot = arg.slice("--wiki-root=".length);
  }
  if (!opts.inputFile) {
    return {
      error: "Usage: /loom-change quick-archive --input <json-file> [--root <path>] [--wiki-root <path>]",
    };
  }
  return opts;
}

const isMain =
  (process.argv[1] ?? "").endsWith("quick-archive.ts") ||
  (process.argv[1] ?? "").endsWith("quick-archive.js");

if (isMain) {
  const parsed = parseCliArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(parsed.error + "\n");
    process.exit(2);
  }
  if (!parsed.inputFile) process.exit(2);
  let payload: QuickArchiveOptions;
  try {
    const raw = fs.readFileSync(parsed.inputFile, "utf8");
    payload = JSON.parse(raw) as QuickArchiveOptions;
  } catch (e) {
    process.stderr.write(`Failed to read quick-archive input: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(2);
  }
  const result = runQuickArchive({
    ...payload,
    rootDir: parsed.rootDir ?? payload.rootDir,
    wikiRoot: parsed.wikiRoot ?? payload.wikiRoot,
  });
  process.exit(result.exitCode);
}
