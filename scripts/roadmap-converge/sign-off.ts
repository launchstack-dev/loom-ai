/**
 * Sign-off entrypoint for /loom-roadmap sign-off.
 *
 * Sign-off is the ONLY code path that may set
 * RoadmapConvergeStateV1.sign_off_state to "signed-off". This invariant is
 * enforced by:
 *   1. test/roadmap-converge/sign-off-purity.test.ts — a grep guard that
 *      scans scripts/roadmap-converge/*.ts (excluding this file) for
 *      assignments writing "signed-off" and asserts zero matches.
 *   2. Convention — `/loom-roadmap converge` (driver.ts) writes
 *      sign_off_state="eligible" when the round closes clean, but never
 *      "signed-off". The transition from eligible → signed-off requires
 *      explicit user confirmation through this module.
 *
 * Eligibility precondition (per AC AW-12 / UX-18 / Scenario S-09):
 *   sign_off_state MUST equal "eligible". If not, we resolve a sub-code in
 *   the tiebreaker order NO_PASS → OPEN_QUESTIONS → RED_DIMENSIONS and exit
 *   with status 1, recording the additional blockers in last-error.toon so
 *   the user can fix everything in one pass instead of whack-a-mole.
 *
 * Atomic state write: handled by writeState() in state-io.ts, which uses
 * `{path}.tmp` + `fs.renameSync` so a crash mid-write never publishes a
 * partial file. We also write `.plan-execution/stage-context/execute-signoff.toon`
 * atomically per execution-conventions.md.
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";

import { readState, writeState } from "./state-io.js";
import { renderDiff } from "./diff-view.js";
import type {
  RoadmapConvergeStateV1,
} from "../migrators/roadmap-converge-state/index.js";

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export const SIGNOFF_STAGE_CONTEXT_PATH =
  ".plan-execution/stage-context/execute-signoff.toon";

export const LAST_ERROR_PATH = ".plan-execution/ephemeral/last-error.toon";

export type SignOffBlocker =
  | "NO_PASS"
  | "OPEN_QUESTIONS"
  | "RED_DIMENSIONS";

export interface SignOffOptions {
  /** Roadmap slug — Wave 1/2 ships single-roadmap ("ROADMAP"). */
  slug: string;
  /**
   * Skip the interactive y/n prompt. The diff view still renders so the
   * user can audit before this flag is set in scripts/CI.
   */
  yes?: boolean;
  /** stdout sink — defaults to process.stdout.write. */
  stdout?: (chunk: string) => void;
  /** stderr sink — defaults to process.stderr.write (line + \n). */
  stderr?: (line: string) => void;
  /**
   * Interactive prompt provider. Returns true to confirm, false to abort.
   * Defaults to a readline-on-stdin implementation. Tests inject a stub.
   */
  prompt?: (question: string) => Promise<boolean>;
  /**
   * TTY detection for pager dispatch. Defaults to checking process.stdout.
   * Tests override to false so the diff goes to the stdout sink directly.
   */
  isTty?: () => boolean;
  /** Pager command to pipe the diff through when stdout is a TTY. */
  pager?: string;
  /** ISO clock for deterministic tests. */
  now?: () => string;
}

export interface SignOffResult {
  exitCode: number;
  /**
   * Error sub-code when exitCode !== 0. One of:
   *   STATE_MISSING         — no state file on disk
   *   SIGNOFF_NOT_ELIGIBLE  — combined with `:NO_PASS` / `:OPEN_QUESTIONS`
   *                           / `:RED_DIMENSIONS` per tiebreaker
   *   USER_REJECTED         — user answered "no" at the confirmation prompt
   *   ALREADY_SIGNED_OFF    — state is already "signed-off"; idempotent guard
   */
  error?: string;
  /** State after the call (post-write on success, pre-check on failure). */
  state?: RoadmapConvergeStateV1;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runSignOff(opts: SignOffOptions): Promise<SignOffResult> {
  const stdout = opts.stdout ?? ((c: string) => process.stdout.write(c));
  const stderr = opts.stderr ?? ((l: string) => process.stderr.write(l + "\n"));
  const now = opts.now ?? (() => new Date().toISOString());
  const isTty = opts.isTty ?? (() => Boolean(process.stdout.isTTY));
  const pager = opts.pager ?? process.env.PAGER ?? "less";
  const prompt = opts.prompt ?? defaultPrompt;

  // ── Read state ────────────────────────────────────────────────────────
  const { state } = readState(opts.slug);
  if (state === null) {
    stderr(
      `[roadmap-signoff] STATE_MISSING — no .roadmap-converge/${opts.slug}/state.toon. Run '/loom-roadmap converge' first.`
    );
    writeLastError({
      code: "STATE_MISSING",
      slug: opts.slug,
      now: now(),
    });
    return { exitCode: 1, error: "STATE_MISSING" };
  }

  // ── Idempotency: already signed off ───────────────────────────────────
  if (state.sign_off_state === "signed-off") {
    stderr(
      `[roadmap-signoff] ALREADY_SIGNED_OFF — state.sign_off_state is already "signed-off" (at ${state.sign_off_at ?? "unknown"}).`
    );
    return { exitCode: 0, error: "ALREADY_SIGNED_OFF", state };
  }

  // ── Eligibility precondition ──────────────────────────────────────────
  if (state.sign_off_state !== "eligible") {
    const blockers = resolveBlockers(state);
    const primary = blockers[0] ?? "RED_DIMENSIONS";
    const additional = blockers.slice(1);
    const code = `SIGNOFF_NOT_ELIGIBLE:${primary}`;
    stderr(
      `[roadmap-signoff] ${code} — sign-off refused. ${describeBlocker(primary, state)}`
    );
    if (additional.length > 0) {
      stderr(
        `[roadmap-signoff] additional blockers: ${additional
          .map((b) => `SIGNOFF_NOT_ELIGIBLE:${b}`)
          .join(", ")}`
      );
    }
    writeLastError({
      code,
      slug: opts.slug,
      additionalBlockers: additional,
      now: now(),
    });
    writeStageContext({
      stage: "execute-signoff",
      slug: opts.slug,
      outcome: "refused",
      reason: code,
      now: now(),
    });
    return { exitCode: 1, error: code, state };
  }

  // ── Render diff ───────────────────────────────────────────────────────
  const diffText = renderDiff(state.sign_off_diff_hash ?? null, state.roadmapPath);
  emitDiff(diffText, { stdout, isTty, pager });

  // ── Confirm ───────────────────────────────────────────────────────────
  if (!opts.yes) {
    const ok = await prompt(
      "Confirm sign-off — mark this roadmap as converged? [y/N] "
    );
    if (!ok) {
      stderr(`[roadmap-signoff] USER_REJECTED — sign-off aborted.`);
      writeLastError({
        code: "USER_REJECTED",
        slug: opts.slug,
        now: now(),
      });
      writeStageContext({
        stage: "execute-signoff",
        slug: opts.slug,
        outcome: "rejected",
        reason: "USER_REJECTED",
        now: now(),
      });
      return { exitCode: 1, error: "USER_REJECTED", state };
    }
  }

  // ── Compute current hash and write state atomically ───────────────────
  const currentHash = sha256OfFile(state.roadmapPath);
  const timestamp = now();
  // SINGLE WRITE SITE: this assignment is the only place in the codebase
  // that sets sign_off_state to the converged terminal value. The purity
  // test (test/roadmap-converge/sign-off-purity.test.ts) enforces this.
  const next: RoadmapConvergeStateV1 = {
    ...state,
    sign_off_state: "signed-off",
    sign_off_at: timestamp,
    sign_off_diff_hash: currentHash,
  };
  writeState(opts.slug, next);

  writeStageContext({
    stage: "execute-signoff",
    slug: opts.slug,
    outcome: "signed-off",
    reason: "",
    signedOffAt: timestamp,
    diffHash: currentHash,
    now: timestamp,
  });

  stdout(
    `Sign-off recorded: ${state.roadmapPath} at ${timestamp} (sha256 ${currentHash.slice(0, 12)}).\n`
  );

  return { exitCode: 0, state: next };
}

// ---------------------------------------------------------------------------
// Eligibility resolution
// ---------------------------------------------------------------------------

/**
 * Return blockers in tiebreaker order (first = primary). The Error
 * Categories table in PLAN-roadmap-converge-harness.md orders these:
 *   NO_PASS > OPEN_QUESTIONS > RED_DIMENSIONS
 *
 * NO_PASS triggers when no reviewer pass has executed (round == 0 OR
 * dimensions array is empty — both indicate "we have nothing to sign").
 *
 * OPEN_QUESTIONS triggers when state.open_questions contains any entry
 * without a resolved_at timestamp.
 *
 * RED_DIMENSIONS triggers when any dimension has status !== "green".
 * (yellow and red both qualify — the AC says "all dimensions green".)
 */
export function resolveBlockers(state: RoadmapConvergeStateV1): SignOffBlocker[] {
  const blockers: SignOffBlocker[] = [];
  if (state.round === 0 || state.dimensions.length === 0) {
    blockers.push("NO_PASS");
  }
  const unresolved = state.open_questions.filter((q) => !q.resolved_at);
  if (unresolved.length > 0) {
    blockers.push("OPEN_QUESTIONS");
  }
  const nonGreen = state.dimensions.filter((d) => d.status !== "green");
  if (nonGreen.length > 0) {
    blockers.push("RED_DIMENSIONS");
  }
  return blockers;
}

function describeBlocker(
  blocker: SignOffBlocker,
  state: RoadmapConvergeStateV1
): string {
  switch (blocker) {
    case "NO_PASS":
      return "No reviewer pass has run yet. Execute '/loom-roadmap converge' first.";
    case "OPEN_QUESTIONS": {
      const n = state.open_questions.filter((q) => !q.resolved_at).length;
      return `${n} open question${n === 1 ? "" : "s"} unresolved.`;
    }
    case "RED_DIMENSIONS": {
      const names = state.dimensions
        .filter((d) => d.status !== "green")
        .map((d) => `${d.name}(${d.status})`)
        .join(", ");
      return `Non-green dimensions: ${names}.`;
    }
  }
}

// ---------------------------------------------------------------------------
// Diff emission
// ---------------------------------------------------------------------------

const PAGER_SAFE_RE = /^[a-zA-Z0-9_\/-]+$/;

function emitDiff(
  diffText: string,
  ctx: {
    stdout: (c: string) => void;
    isTty: () => boolean;
    pager: string;
  }
): void {
  if (!ctx.isTty()) {
    ctx.stdout(diffText);
    return;
  }
  // Validate pager before spawning. Fall back to 'less' on invalid characters.
  let safePager = ctx.pager;
  if (!PAGER_SAFE_RE.test(ctx.pager)) {
    process.stderr.write(
      `[roadmap-signoff] PAGER rejected: invalid characters — falling back to less\n`
    );
    safePager = "less";
  }
  // Pipe through pager. If the pager fails to spawn, fall back to direct stdout.
  const result = spawnSync(safePager, [], {
    input: diffText,
    stdio: ["pipe", "inherit", "inherit"],
    encoding: "utf-8",
  });
  if (result.error || (result.status !== 0 && result.status !== null)) {
    ctx.stdout(diffText);
  }
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function defaultPrompt(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      const normalised = (answer || "").trim().toLowerCase();
      resolve(normalised === "y" || normalised === "yes");
    });
  });
}

// ---------------------------------------------------------------------------
// Atomic writes — stage context + last-error
// ---------------------------------------------------------------------------

interface StageContextInput {
  stage: string;
  slug: string;
  outcome: "signed-off" | "refused" | "rejected";
  reason: string;
  signedOffAt?: string;
  diffHash?: string;
  now: string;
}

function writeStageContext(input: StageContextInput): void {
  const lines: string[] = [];
  lines.push(`stage: ${input.stage}`);
  lines.push(`wave: 2`);
  lines.push(`iteration: 0`);
  lines.push(`startedAt: ${input.now}`);
  lines.push(`completedAt: ${input.now}`);
  lines.push(`durationMs: 0`);
  lines.push(`inputTokensEstimate: 0`);
  lines.push(`outputTokensEstimate: 0`);
  lines.push(`slug: ${input.slug}`);
  lines.push(`outcome: ${input.outcome}`);
  lines.push(`reason: ${input.reason}`);
  if (input.signedOffAt) lines.push(`signedOffAt: ${input.signedOffAt}`);
  if (input.diffHash) lines.push(`diffHash: ${input.diffHash}`);
  lines.push(`filesChanged[0]:`);
  lines.push(`exportsAdded[0]{file,name,kind}:`);
  lines.push(`findingsResolved[0]:`);
  lines.push(`findingsRemaining[0]:`);
  lines.push(
    `summary: Sign-off ${input.outcome} for slug=${input.slug}${input.reason ? ` (${input.reason})` : ""}.`
  );
  lines.push(`keyDecisions[0]:`);
  lines.push(`nextStageHints[0]:`);
  const body = lines.join("\n") + "\n";
  atomicWrite(SIGNOFF_STAGE_CONTEXT_PATH, body);
}

interface LastErrorInput {
  code: string;
  slug: string;
  additionalBlockers?: SignOffBlocker[];
  now: string;
}

function writeLastError(input: LastErrorInput): void {
  const lines: string[] = [];
  lines.push(`code: ${input.code}`);
  lines.push(`slug: ${input.slug}`);
  lines.push(`occurredAt: ${input.now}`);
  if (input.additionalBlockers && input.additionalBlockers.length > 0) {
    lines.push(
      `additionalBlockers[${input.additionalBlockers.length}]: ${input.additionalBlockers.join(", ")}`
    );
  } else {
    lines.push(`additionalBlockers[0]:`);
  }
  const body = lines.join("\n") + "\n";
  try {
    atomicWrite(LAST_ERROR_PATH, body);
  } catch (err) {
    // Best-effort: last-error is diagnostic, never gating.
    console.error(`[roadmap-signoff] could not write last-error.toon: ${(err as Error).message}`);
  }
}

function atomicWrite(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, body, "utf-8");
  renameSync(tmp, path);
}

function sha256OfFile(path: string): string {
  const bytes = readFileSync(path);
  return createHash("sha256").update(bytes).digest("hex");
}
