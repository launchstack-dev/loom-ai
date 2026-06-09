#!/usr/bin/env tsx
/**
 * /loom-change list — enumerate every change-proposal in the project.
 *
 * Reads:
 *   - `.loom/changes/{changeId}/proposal.md`       (durable proposal frontmatter)
 *   - `.plan-execution/ephemeral/changes/{changeId}.toon`  (runtime state)
 *
 * Output: a human-readable table to stdout, columns:
 *   changeId | status | conflicts | superseded | createdAt | intent (truncated)
 *
 * The proposal.md frontmatter wins on disagreement (see
 * change-state.schema.md → Status mirroring note). When ChangeState is
 * missing or unparseable, we still list the change but flag it.
 *
 * Exit codes:
 *   0  success (zero or more changes listed)
 *   1  IO error reading the changes root (other than "no changes yet")
 *
 * This is a query subcommand — it never writes. Phase 5 deliverable.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  changesDir,
  isValidChangeId,
  proposalPath,
} from "../../hooks/lib/change-paths.js";
import {
  listChangeStates,
  readChangeState,
  type ChangeState,
} from "../../hooks/lib/change-state.js";
import {
  parseProposalFrontmatter,
  type ProposalFrontmatter,
} from "./proposal-frontmatter.js";

interface ListedChange {
  changeId: string;
  status: string;
  intent: string;
  createdAt: string;
  archivedAt: string | null;
  conflictCount: number;
  supersededBy: string | null;
  stateError: string | null;
}

export interface ListOptions {
  /** Project root. Defaults to `process.cwd()`. */
  rootDir?: string;
  /** Optional output stream. Defaults to `process.stdout`. */
  out?: NodeJS.WritableStream;
  /** Optional error stream. Defaults to `process.stderr`. */
  err?: NodeJS.WritableStream;
  /** Emit JSON instead of a table. Used by integration tests. */
  format?: "table" | "json";
}

export interface ListResult {
  changes: ListedChange[];
  errors: string[];
  exitCode: number;
}

/**
 * Library entry-point — invoked by both the CLI wrapper below and (eventually)
 * by Phase 6 mutation commands that want to surface a quick listing after a
 * transition.
 */
export function runList(options: ListOptions = {}): ListResult {
  const rootDir = options.rootDir ?? process.cwd();
  const out = options.out ?? process.stdout;
  const err = options.err ?? process.stderr;
  const format = options.format ?? "table";

  const dir = changesDir(rootDir);
  const result: ListResult = { changes: [], errors: [], exitCode: 0 };

  if (!fs.existsSync(dir)) {
    if (format === "json") {
      out.write(JSON.stringify({ changes: [], message: "no changes initialized" }) + "\n");
    } else {
      out.write("No changes found.\n");
      out.write(`(expected directory: ${path.relative(rootDir, dir) || dir})\n`);
    }
    return result;
  }

  // Collect every proposal directory under .loom/changes/.
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const changeIds: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!isValidChangeId(entry.name)) {
      result.errors.push(
        `Directory '${entry.name}' under .loom/changes/ is not a valid changeId; skipping.`
      );
      continue;
    }
    changeIds.push(entry.name);
  }
  changeIds.sort();

  // Sweep ChangeState files too — this surfaces orphan states (state without
  // proposal) which usually indicates a partially-cleaned-up change.
  const stateSweep = listChangeStates(rootDir);
  const statesById = new Map<string, ChangeState>(stateSweep.states.map((s) => [s.changeId, s]));
  for (const e of stateSweep.errors) {
    result.errors.push(`State file error (${e.file}): ${e.message}`);
  }
  for (const state of stateSweep.states) {
    if (!changeIds.includes(state.changeId)) {
      result.errors.push(
        `Orphan ChangeState for '${state.changeId}' has no matching proposal directory.`
      );
    }
  }

  for (const changeId of changeIds) {
    const propPath = proposalPath(rootDir, changeId);
    let frontmatter: ProposalFrontmatter | null = null;
    if (fs.existsSync(propPath)) {
      try {
        const raw = fs.readFileSync(propPath, "utf8");
        frontmatter = parseProposalFrontmatter(raw);
      } catch (e) {
        result.errors.push(
          `Failed to parse ${path.relative(rootDir, propPath)}: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    } else {
      result.errors.push(
        `Proposal directory '${changeId}' missing proposal.md`
      );
    }

    let state: ChangeState | null = statesById.get(changeId) ?? null;
    let stateError: string | null = null;
    if (state === null) {
      // The sweep already loaded the state, but if it errored we may still
      // want to attempt a direct read for a clearer per-change error.
      try {
        state = readChangeState(rootDir, changeId);
      } catch (e) {
        stateError = e instanceof Error ? e.message : String(e);
      }
    }

    // Status precedence: proposal wins (per schema). Fall back to ChangeState
    // if frontmatter is unparseable.
    const status =
      frontmatter?.status ?? state?.status ?? "(unknown)";

    result.changes.push({
      changeId,
      status,
      intent: truncate(frontmatter?.intent ?? "", 80),
      createdAt: frontmatter?.createdAt ?? "",
      archivedAt: frontmatter?.archivedAt ?? null,
      conflictCount: state?.conflicts.length ?? 0,
      supersededBy: state?.supersededBy ?? null,
      stateError,
    });
  }

  if (format === "json") {
    out.write(
      JSON.stringify(
        { changes: result.changes, errors: result.errors },
        null,
        2
      ) + "\n"
    );
    return result;
  }

  // Table output.
  if (result.changes.length === 0) {
    out.write("No changes found.\n");
  } else {
    out.write(renderTable(result.changes));
  }

  if (result.errors.length > 0) {
    err.write("\n");
    for (const message of result.errors) {
      err.write(`warning: ${message}\n`);
    }
  }

  return result;
}

function truncate(text: string, width: number): string {
  const flattened = text.replace(/\s+/g, " ").trim();
  if (flattened.length <= width) return flattened;
  return flattened.slice(0, Math.max(0, width - 1)) + "…";
}

function renderTable(rows: ListedChange[]): string {
  const headers = ["changeId", "status", "conflicts", "supersededBy", "createdAt", "intent"];
  const data = rows.map((r) => [
    r.changeId,
    r.status,
    r.conflictCount === 0 ? "-" : String(r.conflictCount),
    r.supersededBy ?? "-",
    r.createdAt || "-",
    r.intent || "-",
  ]);

  const widths = headers.map((h, i) =>
    Math.max(h.length, ...data.map((row) => row[i].length))
  );

  const renderRow = (cells: string[]): string =>
    cells.map((c, i) => c.padEnd(widths[i])).join("  ");

  const lines: string[] = [];
  lines.push(renderRow(headers));
  lines.push(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of data) lines.push(renderRow(row));
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// CLI entry-point
// ---------------------------------------------------------------------------

function parseCliArgs(argv: string[]): ListOptions {
  const opts: ListOptions = {};
  for (const arg of argv) {
    if (arg === "--json") opts.format = "json";
    else if (arg.startsWith("--root=")) opts.rootDir = arg.slice("--root=".length);
  }
  return opts;
}

const isMain =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.argv[1] ?? "").endsWith("list.ts") || (process.argv[1] ?? "").endsWith("list.js");

if (isMain) {
  const options = parseCliArgs(process.argv.slice(2));
  const result = runList(options);
  process.exit(result.exitCode);
}
