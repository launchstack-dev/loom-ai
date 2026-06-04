#!/usr/bin/env tsx
/**
 * /loom-change status {id} — show one change's full lifecycle state.
 *
 * Combines:
 *   - proposal.md frontmatter (durable, authoritative — change-proposal.schema.md)
 *   - ChangeState transitions/conflicts/supersession (runtime — change-state.schema.md)
 *
 * Output sections (human-readable to stdout):
 *   1. Header           changeId + status (proposal wins; warn on mismatch)
 *   2. Identity         intent, scope, approach, affectedSpecs
 *   3. Lifecycle stamps reviewed/approved/created/archived metadata
 *   4. Transitions      full append-only state-machine log
 *   5. Conflicts        in-flight overlaps with other changes
 *   6. Supersession     supersededBy pointer (if set)
 *
 * Exit codes:
 *   0  success
 *   1  unknown changeId (no proposal directory)
 *   2  IO or parse error
 *
 * This is a query subcommand — it never writes. Phase 5 deliverable.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  CHANGE_ID_PATTERN,
  changeDir,
  isValidChangeId,
  proposalPath,
  rollbackPath,
} from "../../hooks/lib/change-paths.js";
import {
  readChangeState,
  type ChangeState,
} from "../../hooks/lib/change-state.js";
import {
  parseProposalFrontmatter,
  type ProposalFrontmatter,
} from "./proposal-frontmatter.js";

export interface StatusOptions {
  changeId: string;
  rootDir?: string;
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
  format?: "human" | "json";
}

export interface StatusResult {
  changeId: string;
  proposal: ProposalFrontmatter | null;
  state: ChangeState | null;
  proposalErrors: string[];
  stateErrors: string[];
  hasRollbackLog: boolean;
  exitCode: number;
}

export function runStatus(options: StatusOptions): StatusResult {
  const rootDir = options.rootDir ?? process.cwd();
  const out = options.out ?? process.stdout;
  const err = options.err ?? process.stderr;
  const format = options.format ?? "human";

  const result: StatusResult = {
    changeId: options.changeId,
    proposal: null,
    state: null,
    proposalErrors: [],
    stateErrors: [],
    hasRollbackLog: false,
    exitCode: 0,
  };

  if (!isValidChangeId(options.changeId)) {
    err.write(
      `Invalid changeId '${options.changeId}': expected ${CHANGE_ID_PATTERN}\n`
    );
    result.exitCode = 2;
    return result;
  }

  const dir = changeDir(rootDir, options.changeId);
  if (!fs.existsSync(dir)) {
    err.write(
      `No change found: ${path.relative(rootDir, dir) || dir} does not exist\n`
    );
    result.exitCode = 1;
    return result;
  }

  // Read proposal.md.
  const propPath = proposalPath(rootDir, options.changeId);
  if (fs.existsSync(propPath)) {
    try {
      const raw = fs.readFileSync(propPath, "utf8");
      result.proposal = parseProposalFrontmatter(raw);
    } catch (e) {
      result.proposalErrors.push(
        e instanceof Error ? e.message : String(e)
      );
    }
  } else {
    result.proposalErrors.push(
      `proposal.md missing under ${path.relative(rootDir, dir)}`
    );
  }

  // Read ChangeState.
  try {
    result.state = readChangeState(rootDir, options.changeId);
  } catch (e) {
    result.stateErrors.push(e instanceof Error ? e.message : String(e));
  }

  // Note rollback log presence (Phase 6 produces these; we surface them so
  // operators see the recovery hint).
  if (fs.existsSync(rollbackPath(rootDir, options.changeId))) {
    result.hasRollbackLog = true;
  }

  if (format === "json") {
    out.write(JSON.stringify(result, null, 2) + "\n");
    return result;
  }

  renderHuman(result, out, err);
  if (result.proposalErrors.length > 0 || result.stateErrors.length > 0) {
    result.exitCode = 2;
  }
  return result;
}

function renderHuman(
  result: StatusResult,
  out: NodeJS.WritableStream,
  err: NodeJS.WritableStream
): void {
  const p = result.proposal;
  const s = result.state;

  // Header.
  const proposalStatus = p?.status ?? "(no proposal)";
  const stateStatus = s?.status ?? "(no state)";
  const mismatch =
    p !== null && s !== null && p.status !== s.status
      ? "  ← MISMATCH (proposal wins)"
      : "";

  out.write(`Change: ${result.changeId}\n`);
  out.write(`  status (proposal): ${proposalStatus}\n`);
  out.write(`  status (state):    ${stateStatus}${mismatch}\n`);
  out.write("\n");

  // Identity.
  if (p !== null) {
    out.write("Identity\n");
    out.write(`  intent:        ${p.intent}\n`);
    out.write(`  approach:      ${p.approach}\n`);
    out.write(`  affectedSpecs: ${formatList(p.affectedSpecs)}\n`);
    out.write(`  scope.included: ${formatList(p.scope.included)}\n`);
    out.write(`  scope.excluded: ${formatList(p.scope.excluded)}\n`);
    out.write(`  linkedPlan:    ${p.linkedPlan ?? "-"}\n`);
    out.write("\n");

    // Lifecycle stamps.
    out.write("Lifecycle stamps\n");
    out.write(`  createdAt:   ${p.createdAt}\n`);
    out.write(`  reviewedBy:  ${p.reviewedBy ?? "-"}\n`);
    out.write(`  reviewedAt:  ${p.reviewedAt ?? "-"}\n`);
    if (p.reviewNotes !== null) {
      out.write(`  reviewNotes: ${truncate(p.reviewNotes, 200)}\n`);
    }
    out.write(`  approvedBy:  ${p.approvedBy ?? "-"}\n`);
    out.write(`  approvedAt:  ${p.approvedAt ?? "-"}\n`);
    out.write(`  archivedAt:  ${p.archivedAt ?? "-"}\n`);
    out.write("\n");
  }

  // Transitions.
  if (s !== null && s.transitions.length > 0) {
    out.write(`Transitions (${s.transitions.length})\n`);
    for (const t of s.transitions) {
      const from = t.from === "" ? "(none)" : t.from;
      out.write(`  ${t.at}  ${from} → ${t.to}  by ${t.by}\n`);
      if (t.reason && t.reason !== "-") {
        out.write(`    reason: ${t.reason}\n`);
      }
    }
    out.write("\n");
  } else if (s !== null) {
    out.write("Transitions: (empty — invalid; transitions[] should have ≥1 entry)\n\n");
  }

  // Conflicts.
  if (s !== null) {
    if (s.conflicts.length === 0) {
      out.write("Conflicts: none\n");
    } else {
      out.write(`Conflicts (${s.conflicts.length})\n`);
      for (const c of s.conflicts) {
        out.write(
          `  with ${c.otherChangeId} on [${c.conflictingIds.join(", ")}] at ${c.detectedAt}\n`
        );
      }
    }
    out.write("\n");
  }

  // Supersession.
  if (s !== null) {
    if (s.supersededBy !== null) {
      out.write(`Superseded by: ${s.supersededBy}\n\n`);
    } else if (s.status === "superseded") {
      out.write("Superseded: yes (supersededBy unknown — inconsistent state)\n\n");
    }
  }

  // Rollback log presence.
  if (result.hasRollbackLog) {
    out.write(
      `Rollback log present at ${path.relative(process.cwd(), rollbackPath(undefined, result.changeId))} — last archive attempt did not complete cleanly.\n\n`
    );
  }

  // Errors at the end so they don't drown the report.
  for (const message of result.proposalErrors) {
    err.write(`proposal error: ${message}\n`);
  }
  for (const message of result.stateErrors) {
    err.write(`state error: ${message}\n`);
  }
}

function formatList(items: string[]): string {
  if (items.length === 0) return "(empty)";
  return items.join(", ");
}

function truncate(text: string, width: number): string {
  const flattened = text.replace(/\s+/g, " ").trim();
  if (flattened.length <= width) return flattened;
  return flattened.slice(0, Math.max(0, width - 1)) + "…";
}

// ---------------------------------------------------------------------------
// CLI entry-point
// ---------------------------------------------------------------------------

function parseCliArgs(argv: string[]): StatusOptions | { error: string } {
  let changeId: string | null = null;
  let format: "human" | "json" = "human";
  let rootDir: string | undefined;

  for (const arg of argv) {
    if (arg === "--json") format = "json";
    else if (arg.startsWith("--root=")) rootDir = arg.slice("--root=".length);
    else if (!arg.startsWith("--")) {
      if (changeId !== null) {
        return { error: `Multiple changeId arguments supplied: '${changeId}', '${arg}'` };
      }
      changeId = arg;
    }
  }
  if (changeId === null) {
    return { error: "Usage: /loom-change status <changeId> [--json]" };
  }
  return { changeId, format, rootDir };
}

const isMain =
  (process.argv[1] ?? "").endsWith("status.ts") ||
  (process.argv[1] ?? "").endsWith("status.js");

if (isMain) {
  const parsed = parseCliArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(parsed.error + "\n");
    process.exit(2);
  }
  const result = runStatus(parsed);
  process.exit(result.exitCode);
}
