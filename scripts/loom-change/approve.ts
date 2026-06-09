#!/usr/bin/env tsx
/**
 * /loom-change approve <id> [--by <actor>] — stamp approval.
 *
 * Transitions the change from `reviewed` → `approved`:
 *   - Updates proposal.md frontmatter: stamps `status`, `approvedBy`,
 *     `approvedAt`.
 *   - Appends a `reviewed → approved` transition to ChangeState.
 *
 * Rejects illegal transitions (any source state other than `reviewed`) with a
 * clear error.
 *
 * Phase 6 deliverable. See PLAN-spec-upgrades.md Phase 6 + change-proposal.schema.md.
 *
 * Exit codes:
 *   0  success
 *   1  illegal transition or missing proposal
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
} from "../../hooks/lib/change-state.js";
import { bumpAfter, atomicWriteText } from "./init.js";
import { applyFrontmatterUpdates } from "./review.js";

export interface ApproveOptions {
  changeId: string;
  rootDir?: string;
  by?: string;
  now?: Date;
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
}

export interface ApproveResult {
  changeId: string;
  exitCode: number;
}

export function runApprove(options: ApproveOptions): ApproveResult {
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
    err.write(`No ChangeState for ${options.changeId}\n`);
    return { changeId: options.changeId, exitCode: 1 };
  }
  if (state.status !== "reviewed") {
    err.write(
      `Illegal transition: cannot approve change with status '${state.status}' (expected 'reviewed').\n`
    );
    return { changeId: options.changeId, exitCode: 1 };
  }

  const approvedAt = bumpAfter(state.updatedAt, now);

  // Update proposal.md frontmatter.
  const propPath = proposalPath(rootDir, options.changeId);
  if (!fs.existsSync(propPath)) {
    err.write(`Proposal missing at ${path.relative(rootDir, propPath)}\n`);
    return { changeId: options.changeId, exitCode: 1 };
  }
  const raw = fs.readFileSync(propPath, "utf8");
  const updated = applyFrontmatterUpdates(raw, {
    status: "approved",
    approvedBy: actor,
    approvedAt,
  });
  atomicWriteText(propPath, updated);

  // Update ChangeState.
  const nextState: ChangeState = {
    ...state,
    status: "approved",
    transitions: [
      ...state.transitions,
      {
        from: "reviewed",
        to: "approved",
        at: approvedAt,
        by: actor,
        reason: "approved for archive",
      },
    ],
    updatedAt: approvedAt,
  };
  writeChangeState(rootDir, nextState);

  out.write(`Approved ${options.changeId} (by ${actor} at ${approvedAt})\n`);
  return { changeId: options.changeId, exitCode: 0 };
}

function stringifyError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// CLI entry-point
// ---------------------------------------------------------------------------

function parseCliArgs(argv: string[]): ApproveOptions | { error: string } {
  let changeId: string | null = null;
  let by: string | undefined;
  let rootDir: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--by") by = argv[++i];
    else if (arg.startsWith("--by=")) by = arg.slice("--by=".length);
    else if (arg.startsWith("--root=")) rootDir = arg.slice("--root=".length);
    else if (!arg.startsWith("--")) {
      if (changeId !== null) {
        return { error: `Multiple changeId arguments: '${changeId}', '${arg}'` };
      }
      changeId = arg;
    }
  }
  if (changeId === null) {
    return { error: "Usage: /loom-change approve <changeId> [--by <actor>]" };
  }
  return { changeId, by, rootDir };
}

const isMain =
  (process.argv[1] ?? "").endsWith("approve.ts") ||
  (process.argv[1] ?? "").endsWith("approve.js");

if (isMain) {
  const parsed = parseCliArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(parsed.error + "\n");
    process.exit(2);
  }
  const result = runApprove(parsed);
  process.exit(result.exitCode);
}
