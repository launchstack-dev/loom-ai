#!/usr/bin/env tsx
/**
 * /loom-change run <id> [--by <actor>] — start work on an approved change.
 *
 * Transitions the change from `approved` → `in-progress`:
 *   - Updates proposal.md frontmatter `status`.
 *   - Appends an `approved → in-progress` transition to ChangeState.
 *
 * If proposal.linkedPlan is set, this script's responsibility is to flag the
 * linked plan for execution; we surface the linkedPlan path to stdout so the
 * caller (CLI or harness) can dispatch `/loom-plan execute` against it. We do
 * NOT shell out to plan execution here — the run command intentionally remains
 * a state-machine step and leaves execution dispatch to the user/harness.
 *
 * When linkedPlan is null, run is a no-op-mutation step — it simply moves the
 * change into `in-progress` for the human's manual implementation work, which
 * subsequently gets archived via `/loom-change archive`.
 *
 * Phase 6 deliverable. See PLAN-spec-upgrades.md Phase 6.
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
import { parseProposalFrontmatter } from "./proposal-frontmatter.js";

export interface RunOptions {
  changeId: string;
  rootDir?: string;
  by?: string;
  now?: Date;
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
}

export interface RunResult {
  changeId: string;
  linkedPlan: string | null;
  exitCode: number;
}

export function runRun(options: RunOptions): RunResult {
  const rootDir = options.rootDir ?? process.cwd();
  const out = options.out ?? process.stdout;
  const err = options.err ?? process.stderr;
  const now = options.now ?? new Date();
  const actor = options.by ?? "agent:change-runner";

  if (!isValidChangeId(options.changeId)) {
    err.write(
      `Invalid changeId '${options.changeId}': expected ${CHANGE_ID_PATTERN}\n`
    );
    return { changeId: options.changeId, linkedPlan: null, exitCode: 2 };
  }

  const dir = changeDir(rootDir, options.changeId);
  if (!fs.existsSync(dir)) {
    err.write(`No change found at ${path.relative(rootDir, dir)}\n`);
    return { changeId: options.changeId, linkedPlan: null, exitCode: 1 };
  }

  let state: ChangeState | null;
  try {
    state = readChangeState(rootDir, options.changeId);
  } catch (e) {
    err.write(`Failed to read ChangeState: ${stringifyError(e)}\n`);
    return { changeId: options.changeId, linkedPlan: null, exitCode: 2 };
  }
  if (state === null) {
    err.write(`No ChangeState for ${options.changeId}\n`);
    return { changeId: options.changeId, linkedPlan: null, exitCode: 1 };
  }
  if (state.status !== "approved") {
    err.write(
      `Illegal transition: cannot run change with status '${state.status}' (expected 'approved').\n`
    );
    return { changeId: options.changeId, linkedPlan: null, exitCode: 1 };
  }

  const propPath = proposalPath(rootDir, options.changeId);
  if (!fs.existsSync(propPath)) {
    err.write(`Proposal missing at ${path.relative(rootDir, propPath)}\n`);
    return { changeId: options.changeId, linkedPlan: null, exitCode: 1 };
  }

  // Read linkedPlan for surfacing to the caller.
  let linkedPlan: string | null = null;
  try {
    const rawProp = fs.readFileSync(propPath, "utf8");
    const parsed = parseProposalFrontmatter(rawProp);
    linkedPlan = parsed.linkedPlan;
  } catch (e) {
    err.write(`Warning: failed to parse proposal frontmatter: ${stringifyError(e)}\n`);
  }

  const runAt = bumpAfter(state.updatedAt, now);

  // Update proposal.md.
  const raw = fs.readFileSync(propPath, "utf8");
  const updated = applyFrontmatterUpdates(raw, { status: "in-progress" });
  atomicWriteText(propPath, updated);

  // Update ChangeState.
  const nextState: ChangeState = {
    ...state,
    status: "in-progress",
    transitions: [
      ...state.transitions,
      {
        from: "approved",
        to: "in-progress",
        at: runAt,
        by: actor,
        reason: linkedPlan ? `run started (linkedPlan=${linkedPlan})` : "run started",
      },
    ],
    updatedAt: runAt,
  };
  writeChangeState(rootDir, nextState);

  if (linkedPlan !== null && linkedPlan.length > 0) {
    out.write(
      `Started ${options.changeId} (in-progress). LinkedPlan: ${linkedPlan} — dispatch with /loom-plan execute when ready.\n`
    );
  } else {
    out.write(
      `Started ${options.changeId} (in-progress). No linked plan — proceed with manual implementation then /loom-change archive.\n`
    );
  }
  return { changeId: options.changeId, linkedPlan, exitCode: 0 };
}

function stringifyError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// CLI entry-point
// ---------------------------------------------------------------------------

function parseCliArgs(argv: string[]): RunOptions | { error: string } {
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
    return { error: "Usage: /loom-change run <changeId> [--by <actor>]" };
  }
  return { changeId, by, rootDir };
}

const isMain =
  (process.argv[1] ?? "").endsWith("run.ts") ||
  (process.argv[1] ?? "").endsWith("run.js");

if (isMain) {
  const parsed = parseCliArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(parsed.error + "\n");
    process.exit(2);
  }
  const result = runRun(parsed);
  process.exit(result.exitCode);
}
