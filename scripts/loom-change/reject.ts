#!/usr/bin/env tsx
/**
 * /loom-change reject <id> --reason "..." [--by <actor>] — reject a change.
 *
 * Legal source states: `proposed`, `reviewed`, `in-progress`.
 * Target state: `rejected`.
 *
 * - Updates proposal.md frontmatter `status: rejected`.
 * - Appends a `<prev> → rejected` transition with `reason: <flag value>`.
 * - Rejected proposals are *revivable* via `/loom-change init` against the
 *   same directory (init resets status to `proposed` and appends a
 *   `rejected → proposed` transition).
 *
 * `--reason` is REQUIRED — per change-state.schema.md transition rule
 * "reason min 5 chars" and the change-proposal.schema.md status-lifecycle
 * table requirement.
 *
 * Phase 6 deliverable. See PLAN-spec-upgrades.md Phase 6.
 *
 * Exit codes:
 *   0  success
 *   1  illegal transition or missing artifact
 *   2  invalid arguments / IO error
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  CHANGE_ID_PATTERN,
  changeDir,
  isValidChangeId,
  proposalPath,
} from "../../hooks/lib/change-paths.js";
import {
  readChangeState,
  writeChangeState,
  type ChangeState,
  type ChangeStatus,
} from "../../hooks/lib/change-state.js";
import { bumpAfter, atomicWriteText } from "./init.js";
import { applyFrontmatterUpdates } from "./review.js";

const LEGAL_FROM: ReadonlyArray<ChangeStatus> = ["proposed", "reviewed", "in-progress"];

export interface RejectOptions {
  changeId: string;
  reason: string;
  rootDir?: string;
  by?: string;
  now?: Date;
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
}

export interface RejectResult {
  changeId: string;
  previousStatus: ChangeStatus | null;
  exitCode: number;
}

export function runReject(options: RejectOptions): RejectResult {
  const rootDir = options.rootDir ?? process.cwd();
  const out = options.out ?? process.stdout;
  const err = options.err ?? process.stderr;
  const now = options.now ?? new Date();
  const actor = options.by ?? "human:cli";

  if (!isValidChangeId(options.changeId)) {
    err.write(
      `Invalid changeId '${options.changeId}': expected ${CHANGE_ID_PATTERN}\n`
    );
    return { changeId: options.changeId, previousStatus: null, exitCode: 2 };
  }

  const reasonText = options.reason.trim();
  if (reasonText.length < 5) {
    err.write(
      `--reason is required and must be at least 5 characters (got ${reasonText.length}).\n`
    );
    return { changeId: options.changeId, previousStatus: null, exitCode: 2 };
  }

  const dir = changeDir(rootDir, options.changeId);
  if (!fs.existsSync(dir)) {
    err.write(`No change found at ${path.relative(rootDir, dir)}\n`);
    return { changeId: options.changeId, previousStatus: null, exitCode: 1 };
  }

  let state: ChangeState | null;
  try {
    state = readChangeState(rootDir, options.changeId);
  } catch (e) {
    err.write(`Failed to read ChangeState: ${stringifyError(e)}\n`);
    return { changeId: options.changeId, previousStatus: null, exitCode: 2 };
  }
  if (state === null) {
    err.write(`No ChangeState for ${options.changeId}\n`);
    return { changeId: options.changeId, previousStatus: null, exitCode: 1 };
  }
  if (!LEGAL_FROM.includes(state.status)) {
    err.write(
      `Illegal transition: cannot reject change with status '${state.status}'. ` +
        `Legal source states: ${LEGAL_FROM.join(", ")}.\n`
    );
    return { changeId: options.changeId, previousStatus: state.status, exitCode: 1 };
  }

  const rejectAt = bumpAfter(state.updatedAt, now);
  const from = state.status;

  // Update proposal.md.
  const propPath = proposalPath(rootDir, options.changeId);
  if (fs.existsSync(propPath)) {
    const raw = fs.readFileSync(propPath, "utf8");
    const updated = applyFrontmatterUpdates(raw, { status: "rejected" });
    atomicWriteText(propPath, updated);
  } else {
    err.write(
      `Warning: proposal missing at ${path.relative(rootDir, propPath)}; proceeding with state-only rejection.\n`
    );
  }

  const nextState: ChangeState = {
    ...state,
    status: "rejected",
    transitions: [
      ...state.transitions,
      {
        from,
        to: "rejected",
        at: rejectAt,
        by: actor,
        reason: reasonText,
      },
    ],
    updatedAt: rejectAt,
  };
  writeChangeState(rootDir, nextState);

  out.write(`Rejected ${options.changeId} (was '${from}', by ${actor} at ${rejectAt})\n`);
  out.write(`  reason: ${reasonText}\n`);
  return { changeId: options.changeId, previousStatus: from, exitCode: 0 };
}

function stringifyError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// CLI entry-point
// ---------------------------------------------------------------------------

function parseCliArgs(argv: string[]): RejectOptions | { error: string } {
  let changeId: string | null = null;
  let by: string | undefined;
  let reason: string | undefined;
  let rootDir: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--by") by = argv[++i];
    else if (arg.startsWith("--by=")) by = arg.slice("--by=".length);
    else if (arg === "--reason") reason = argv[++i];
    else if (arg.startsWith("--reason=")) reason = arg.slice("--reason=".length);
    else if (arg.startsWith("--root=")) rootDir = arg.slice("--root=".length);
    else if (!arg.startsWith("--")) {
      if (changeId !== null) {
        return { error: `Multiple changeId arguments: '${changeId}', '${arg}'` };
      }
      changeId = arg;
    }
  }
  if (changeId === null) {
    return {
      error: "Usage: /loom-change reject <changeId> --reason \"...\" [--by <actor>]",
    };
  }
  if (reason === undefined || reason.trim().length === 0) {
    return { error: "--reason is required" };
  }
  return { changeId, reason, by, rootDir };
}

const isMain =
  (process.argv[1] ?? "").endsWith("reject.ts") ||
  (process.argv[1] ?? "").endsWith("reject.js");

if (isMain) {
  const parsed = parseCliArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(parsed.error + "\n");
    process.exit(2);
  }
  const result = runReject(parsed);
  process.exit(result.exitCode);
}
