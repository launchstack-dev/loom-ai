/**
 * Per-pass driver for /loom-roadmap converge.
 *
 * Wave 1 ships single-roadmap (slug defaults to "ROADMAP") and orchestrates:
 *
 *   1. Lock acquire (atomic O_EXCL; 10-min stale window; --force escape hatch)
 *   2. Archetype-detection hook seam (Phase 4: wired to archetype-detector.ts)
 *   3. Content-hash invalidation check + line-diff stderr notice
 *   4. Reviewer fan-out (one virtual call per dimension via spawnReviewer)
 *   5. Per-dimension AgentResult parsing — non-envelope = skip with
 *      REVIEWER_NO_ENVELOPE warning, dimension records delta_since_last=same
 *   6. Per-dimension 5-finding cap; overflow → suppressedFindings + stderr
 *   7. Rendering rule per F-15: emit nothing for green; green-exemplar for
 *      yellow; both bands for red — dispatched on RoadmapDimension.status
 *      + parsed rubric sections
 *   8. Atomic state write
 *   9. Integrator-pass: apply resolved open_questions to ROADMAP.md surgically
 *      (Phase 5). Validates IntegratorEnvelope; halts with INTEGRATOR_NO_ENVELOPE
 *      on invalid return. Handles INTEGRATOR_NO_ENVELOPE and retains state.
 *   10. Stall detection (Phase 5): two passes with identical dimension statuses
 *       and no resolved questions → halted-stalled, STALL_DETECTED stderr, exit 1.
 *   11. Pass-cap halt (Phase 5): round == passLimit and not all-green →
 *       halted-pass-cap, PASS_CAP_REACHED stderr, exit 1.
 *   12. Atomic StageContext write to .plan-execution/stage-context/execute.toon
 *       and .plan-execution/stage-context/execute-integrator.toon
 *   13. Lock release
 *
 * The driver is invoked by `commands/loom-roadmap/converge.md` (which talks
 * to `agents/roadmap-converge-driver.md`). The reviewer agent is invoked
 * once per dimension via the `spawnReviewer` injection seam — production
 * wires this to a real Agent call; tests pass deterministic mocks.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { archetypeDetectionHook as defaultArchetypeDetectionHook } from "./archetype-detector.js";

import {
  acquireLock,
  releaseLock,
  type LockAcquireResult,
} from "./lock.js";
import {
  compareRoadmapHash,
  roadmapIsReadable,
} from "./content-hash.js";
import {
  freshState,
  lockFileFor,
  readState,
  stateFileFor,
  writeState,
} from "./state-io.js";
import {
  autoResolveArchivedDimensions,
  defaultIntegratorInvoker,
  isIntegratorEnvelope,
  type IntegratorEnvelope,
  type IntegratorInvoker,
} from "./integrator.js";
import {
  checkPassCap,
  checkStall,
} from "./stall-detector.js";
import type {
  OpenQuestionV1,
  RoadmapConvergeStateV1,
  RoadmapDimensionStatus,
  RoadmapDimensionV1,
  SuppressedFindingV1,
} from "../migrators/roadmap-converge-state/index.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Per-dimension finding cap (per AC AW-15). Overflow → suppressedFindings. */
export const PER_DIMENSION_FINDING_CAP = 5;

/** Stage-context output path for the execute stage. */
export const EXECUTE_STAGE_CONTEXT_PATH = ".plan-execution/stage-context/execute.toon";

/** Stage-context output path for the integrator-pass stage (Phase 5). */
export const EXECUTE_INTEGRATOR_STAGE_CONTEXT_PATH = ".plan-execution/stage-context/execute-integrator.toon";

// ---------------------------------------------------------------------------
// Reviewer envelope — minimal contract surface we consume from AgentResult
// ---------------------------------------------------------------------------

/**
 * Subset of AgentResult.issues[] that the driver consumes. Reviewer agents
 * MUST return TOON conforming to agent-result.schema.md; the driver pulls
 * `issues[]` (per AW-05) and treats each row as a candidate finding.
 *
 * `severity` mirrors RoadmapConvergeStateV1.suppressedFindings.severity.
 */
export interface ReviewerFinding {
  /** Finding id (e.g. "F-03"). Reviewer assigns or driver assigns later. */
  id?: string;
  severity: "blocking" | "warning" | "nit";
  description: string;
  /** Optional file/line — surfaced as text in suppressedFindings[].text. */
  file?: string;
  line?: number;
}

/** Reviewer outcome consumed by the driver. */
export interface ReviewerEnvelope {
  /** When false, driver records REVIEWER_NO_ENVELOPE + delta_since_last=same. */
  ok: boolean;
  /** Single-bucket status the reviewer assigns to the dimension. */
  status: RoadmapDimensionStatus;
  /** Free-form evidence (<= 500 chars per schema). */
  evidence?: string;
  /** Concrete blockers — surfaced to RoadmapDimension.blockers. */
  blockers?: string[];
  /** Section anchors in ROADMAP.md (e.g. ["#vision"]). */
  evidenceRef?: string[];
  /** Raw findings — uncapped at this layer; driver applies the per-dim cap. */
  findings: ReviewerFinding[];
}

/**
 * Reviewer-invocation seam. Production wires this to a real Agent call that
 * spawns roadmap-converge-reviewer.md with the rubric + roadmap section in
 * context. Tests inject deterministic mocks.
 */
export type ReviewerInvoker = (input: {
  dimensionName: string;
  rubricPath: string;
  roadmapPath: string;
  priorStatus: RoadmapDimensionStatus | null;
}) => Promise<ReviewerEnvelope>;

// ---------------------------------------------------------------------------
// Archetype detection hook seam (P-02)
// ---------------------------------------------------------------------------

/**
 * Phase 4 fills this with the real archetype detector. Wave 1 ships the
 * no-op default — invoking it returns null, the driver carries on with the
 * archetype already present in state (or "default" on cold start). The seam
 * is typed up-front so the Phase 4 cold-start AC isn't a forward reference.
 */
export type ArchetypeDetectionHook = (
  roadmapPath: string,
  existingState: RoadmapConvergeStateV1 | null
) => Promise<{ archetype: string; confidence: number } | null>;

/** Default no-op archetype hook — does NOT modify state. */
export const noopArchetypeDetectionHook: ArchetypeDetectionHook = async () => null;

// ---------------------------------------------------------------------------
// Driver options
// ---------------------------------------------------------------------------

export interface DriverOptions {
  /** Roadmap file path (e.g. "planning/ROADMAP.md"). */
  roadmapPath: string;
  /** Path-safe slug. Wave 1 default = "ROADMAP". */
  slug: string;
  /** Hard cap = 5 (per ROADMAP); default = 3. */
  passLimit?: number;
  /** Force-acquire even when a fresh lock is held. */
  force?: boolean;
  /** Dimensions to evaluate (resolved from RoadmapReadinessSchema). */
  dimensions: { name: string; rubricRef: string }[];
  /** Reviewer fan-out invoker. Spawned once per dimension. */
  invokeReviewer: ReviewerInvoker;
  /** Archetype-detection seam. Default = no-op. */
  archetypeDetectionHook?: ArchetypeDetectionHook;
  /**
   * Integrator invoker seam (Phase 5). Production wires to a real agent call
   * that spawns roadmap-converge-integrator.md. Tests inject deterministic mocks.
   * Default = defaultIntegratorInvoker (in-process surgical edit).
   */
  invokeIntegrator?: IntegratorInvoker;
  /** Receives stderr lines (banner, advisories, footers). */
  stderr?: (line: string) => void;
  /** Deterministic clock for tests. */
  now?: () => Date;
  /** Override process.pid for tests. */
  pid?: number;
}

export interface DriverResult {
  /** 0 on success, 1 on lock conflict / pre-flight failure / stall / pass-cap. */
  exitCode: number;
  /**
   * Optional reason code:
   *   LOCK_CONFLICT, ROADMAP_MISSING
   *   INTEGRATOR_NO_ENVELOPE — integrator returned a non-envelope payload
   *   STALL_DETECTED         — two identical passes, no questions resolved
   *   PASS_CAP_REACHED       — round == passLimit and not all-green
   */
  reason?: string;
  /** Final state — null when pre-flight halted before reading. */
  state: RoadmapConvergeStateV1 | null;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runConvergePass(opts: DriverOptions): Promise<DriverResult> {
  const stderr = opts.stderr ?? ((s: string) => process.stderr.write(s + "\n"));
  const now = opts.now ?? (() => new Date());
  const passLimit = clamp(opts.passLimit ?? 3, 1, 5);
  const lockPath = lockFileFor(opts.slug);
  const archetypeHook = opts.archetypeDetectionHook ?? defaultArchetypeDetectionHook;
  const invokeIntegrator = opts.invokeIntegrator ?? defaultIntegratorInvoker;

  const startedAt = now();
  const startedAtMs = startedAt.getTime();

  // ── Pre-flight ────────────────────────────────────────────────────────
  if (!roadmapIsReadable(opts.roadmapPath)) {
    stderr(`[roadmap-converge] roadmap not readable: ${opts.roadmapPath}`);
    return { exitCode: 1, reason: "ROADMAP_MISSING", state: null };
  }

  // Ensure the state dir exists so the lock file can be created.
  mkdirSync(dirname(lockPath), { recursive: true });

  // ── Lock ──────────────────────────────────────────────────────────────
  const lockResult = acquireLock(lockPath, {
    now: () => startedAtMs,
    pid: opts.pid,
    force: opts.force,
    onAdvisory: (msg) => stderr(`[roadmap-converge] ${msg}`),
  });
  if (!lockResult.acquired) {
    handleLockConflict(lockResult, lockPath, stderr);
    return { exitCode: 1, reason: "LOCK_CONFLICT", state: null };
  }

  try {
    // ── Read prior state (or cold-start) ────────────────────────────────
    const read = readState(opts.slug);
    const priorState = read.state;

    // ── Archetype-detection hook (Wave 1: no-op default) ────────────────
    const archetypeResult = await archetypeHook(opts.roadmapPath, priorState);
    const archetype =
      archetypeResult?.archetype ?? priorState?.archetype ?? "default";

    // ── Content-hash invalidation check ─────────────────────────────────
    const priorHash = priorState?.content_hash ?? "";
    const priorLineCount = inferPriorLineCount(priorState?.roadmap_diff_summary);
    const hashCheck = compareRoadmapHash(opts.roadmapPath, priorHash, priorLineCount);
    const invalidated = priorHash !== "" && !hashCheck.priorMatches;
    if (invalidated) {
      stderr(
        `[roadmap-converge] ROADMAP.md changed since last pass (${hashCheck.lineDiff}) — dimensions invalidated`
      );
    }

    // ── Build/seed state for this pass ──────────────────────────────────
    let state: RoadmapConvergeStateV1 =
      priorState ??
      freshState({
        roadmapPath: opts.roadmapPath,
        roadmapSlug: opts.slug,
        archetype,
        passLimit,
        contentHash: hashCheck.current,
      });
    state.archetype = archetype;
    state.passLimit = passLimit;
    state.content_hash = hashCheck.current;
    state.roadmap_diff_summary = hashCheck.lineDiff;
    state.last_reviewer = "roadmap-converge-reviewer";

    // Snapshot prior dimension statuses before we overwrite them.
    const priorByName = new Map<string, RoadmapDimensionV1>();
    for (const d of state.dimensions) priorByName.set(d.name, d);
    state.dimensionSnapshot = state.dimensions.map((d) => ({
      name: d.name,
      status: d.status,
    }));

    // ── Round-start banner (UX-11) ──────────────────────────────────────
    const upcomingRound = state.round + 1;
    const openCount = state.open_questions.filter((q) => !q.resolved_at).length;
    stderr(
      `[roadmap-converge] pass ${upcomingRound}/${passLimit} starting for ${opts.slug} — ${opts.dimensions.length} dimensions, ${openCount} open`
    );

    // ── Reviewer fan-out (parallel) ─────────────────────────────────────
    const reviewerPromises = opts.dimensions.map(async (dim) => {
      const prior = priorByName.get(dim.name) ?? null;
      let envelope: ReviewerEnvelope;
      try {
        envelope = await opts.invokeReviewer({
          dimensionName: dim.name,
          rubricPath: dim.rubricRef,
          roadmapPath: opts.roadmapPath,
          priorStatus: prior?.status ?? null,
        });
      } catch (err) {
        envelope = {
          ok: false,
          status: prior?.status ?? "yellow",
          findings: [],
          evidence: `reviewer threw: ${(err as Error).message}`,
        };
      }
      return { dim, envelope, prior };
    });
    const reviewerOutcomes = await Promise.all(reviewerPromises);

    // ── Apply outcomes: caps, suppression, rendering, deltas ────────────
    const renderedFindings: OpenQuestionV1[] = [...state.open_questions];
    const newSuppressed: SuppressedFindingV1[] = [];
    const nextDimensions: RoadmapDimensionV1[] = [];

    for (const { dim, envelope, prior } of reviewerOutcomes) {
      if (!envelope.ok) {
        // Per AW-16: skip dimension with warning, record delta=same, continue
        stderr(`[roadmap-converge] REVIEWER_NO_ENVELOPE for ${dim.name} — skipping`);
        nextDimensions.push({
          name: dim.name,
          status: prior?.status ?? "yellow",
          evidence: prior?.evidence,
          blockers: prior?.blockers,
          evidenceRef: prior?.evidenceRef,
          delta_since_last: "same",
        });
        continue;
      }

      // Determine delta_since_last
      const delta = computeDelta({
        priorStatus: prior?.status ?? null,
        nextStatus: envelope.status,
        invalidated,
      });

      nextDimensions.push({
        name: dim.name,
        status: envelope.status,
        evidence: trimEvidence(envelope.evidence),
        blockers: (envelope.blockers ?? []).map((b) => b.slice(0, 200)),
        evidenceRef: envelope.evidenceRef ?? [],
        delta_since_last: delta,
      });

      // Per-dimension 5-cap
      const findings = envelope.findings ?? [];
      const kept = findings.slice(0, PER_DIMENSION_FINDING_CAP);
      const overflow = findings.slice(PER_DIMENSION_FINDING_CAP);

      // Render rule (F-15) — applied to the surfaced finding text
      const rubricSections = loadRubricSections(dim.rubricRef);
      for (let i = 0; i < kept.length; i++) {
        const f = kept[i];
        const rendered = renderFinding(f, envelope.status, rubricSections);
        renderedFindings.push({
          id: f.id ?? assignQuestionId(renderedFindings, dim.name, i),
          dimension: dim.name,
          text: rendered,
          asked_at: startedAt.toISOString(),
        });
      }

      // Overflow → suppressedFindings + stderr footer
      if (overflow.length > 0) {
        stderr(
          `[roadmap-converge] ${overflow.length} suppressed for ${dim.name}`
        );
        overflow.forEach((f, i) => {
          newSuppressed.push({
            id: f.id ?? `F-${dim.name}-overflow-${i + 1}`,
            dimension: dim.name,
            severity: f.severity,
            text: f.description,
            suppressed_at: startedAt.toISOString(),
          });
        });
      }
    }

    // ── Preserve prior-pass snapshot for stall comparison ──────────────────
    // checkStall (below) compares the current pass's statuses to the snapshot
    // captured at the END of the prior pass. The new snapshot is written
    // AFTER checkStall so this pass's statuses do not shadow the comparison.
    const priorDimensionSnapshot = state.dimensionSnapshot;

    state.dimensions = nextDimensions;
    state.open_questions = renderedFindings;
    state.suppressedFindings = [...state.suppressedFindings, ...newSuppressed];
    state.round = upcomingRound;

    // ── FC-05: auto-resolve open_questions for archived dimensions ─────────
    // Must happen BEFORE integrator-pass so the integrator sees the correct
    // resolved/unresolved split and skips "dimension archived" questions.
    state = autoResolveArchivedDimensions(state, now);

    // ── Atomic state write ──────────────────────────────────────────────
    writeState(opts.slug, state);

    // ── Integrator-pass (Phase 5) ───────────────────────────────────────
    // Count questions resolved during this round BEFORE calling integrator.
    const resolvedThisRound = state.open_questions.filter(
      (q) => q.resolved_at && q.resolution !== "dimension archived"
    ).length;

    // Only run integrator when there are resolved questions to apply.
    const resolvedQuestions = state.open_questions.filter((q) => q.resolved_at);
    let integratorFilesModified: string[] = [];

    if (resolvedQuestions.length > 0) {
      let integratorResult: unknown;
      try {
        integratorResult = await invokeIntegrator({
          roadmapPath: opts.roadmapPath,
          resolvedQuestions,
          state,
          now,
        });
      } catch (err) {
        stderr(
          `[roadmap-converge] INTEGRATOR_NO_ENVELOPE — integrator threw: ${(err as Error).message}`
        );
        return { exitCode: 1, reason: "INTEGRATOR_NO_ENVELOPE", state };
      }

      if (!isIntegratorEnvelope(integratorResult)) {
        stderr(
          `[roadmap-converge] INTEGRATOR_NO_ENVELOPE — integrator returned non-envelope payload`
        );
        return { exitCode: 1, reason: "INTEGRATOR_NO_ENVELOPE", state };
      }

      const envelope = integratorResult as IntegratorEnvelope;
      if (!envelope.ok) {
        stderr(
          `[roadmap-converge] INTEGRATOR_NO_ENVELOPE — integrator returned ok=false: ${envelope.summary}`
        );
        return { exitCode: 1, reason: "INTEGRATOR_NO_ENVELOPE", state };
      }

      // Update content_hash to reflect ROADMAP.md edits.
      if (envelope.newContentHash) {
        state.content_hash = envelope.newContentHash;
        writeState(opts.slug, state);
      }

      integratorFilesModified = envelope.filesModified;

      if (envelope.unapplied.length > 0) {
        stderr(
          `[roadmap-converge] integrator could not apply questions: ${envelope.unapplied.join(", ")}`
        );
      }
    }

    // ── Stall detection (Phase 5) ──────────────────────────────────────
    // Compare current dimensions against the PRIOR pass's snapshot, captured
    // above before the reviewer fan-out overwrote state.dimensions.
    // Skip the stall check when the pass converged (all dimensions green and
    // no unresolved questions) — that is a success state, not a stall.
    const allGreenForStall = state.dimensions.every((d) => d.status === "green");
    const noUnresolvedForStall = state.open_questions.every((q) => q.resolved_at);
    const converged = allGreenForStall && noUnresolvedForStall;
    if (!converged) {
      const stallResult = checkStall({
        state: { ...state, dimensionSnapshot: priorDimensionSnapshot },
        resolvedThisRound,
      });
      if (stallResult.stalled) {
        state.next_action_hint =
          "Retire stale dimensions with /loom-roadmap retire-dimension or re-run with --force";
        writeState(opts.slug, state);
        stderr(`[roadmap-converge] STALL_DETECTED — ${stallResult.reason}`);
        return { exitCode: 1, reason: "STALL_DETECTED", state };
      }
    }

    // ── Pass-cap halt (Phase 5) ────────────────────────────────────────
    const passCapResult = checkPassCap(state);
    if (passCapResult.exceeded) {
      state.next_action_hint =
        "Resolve blockers or /loom-roadmap sign-off manually";
      writeState(opts.slug, state);
      stderr(`[roadmap-converge] PASS_CAP_REACHED — ${passCapResult.reason}`);
      // Write integrator StageContext before returning.
      const completedAtCap = now();
      writeIntegratorStageContext({
        startedAt,
        completedAt: completedAtCap,
        state,
        integratorFilesModified,
        extraDecisions: [passCapResult.reason],
      });
      return { exitCode: 1, reason: "PASS_CAP_REACHED", state };
    }

    // ── Sign-off eligibility transition ─────────────────────────────────
    // After all blocking checks pass, evaluate whether the roadmap is ready
    // for sign-off. Driver owns the not-eligible ↔ eligible transition;
    // sign-off.ts owns the eligible → signed-off transition (purity invariant).
    if (converged && state.sign_off_state !== "signed-off") {
      state.sign_off_state = "eligible";
    } else if (state.sign_off_state === "eligible" && !converged) {
      state.sign_off_state = "not-eligible";
    }

    // ── Snapshot current dimension statuses for NEXT pass's stall check ────
    // Written at END of pass per AC FC-03; consumed by checkStall on pass N+1.
    state.dimensionSnapshot = state.dimensions.map((d) => ({
      name: d.name,
      status: d.status,
    }));
    writeState(opts.slug, state);

    // ── Atomic StageContext writes ──────────────────────────────────────
    const completedAt = now();
    writeStageContext({
      stage: "execute",
      wave: 1,
      startedAt,
      completedAt,
      summary: `roadmap-converge pass ${state.round} for ${opts.slug} — ${state.dimensions.length} dimensions reviewed`,
      filesChanged: [stateFileFor(opts.slug)],
      findingsResolved: resolvedThisRound,
      findingsRemaining: state.open_questions.filter((q) => !q.resolved_at).length,
      keyDecisions: invalidated
        ? [`content-hash mismatch — all dimensions invalidated (${hashCheck.lineDiff})`]
        : [],
      nextStageHints: [
        state.round >= passLimit
          ? "pass limit reached — user should run /loom-roadmap sign-off or extend [roadmap.converge].maxPasses"
          : "ready for next pass — re-run /loom-roadmap converge",
      ],
    });

    writeIntegratorStageContext({
      startedAt,
      completedAt,
      state,
      integratorFilesModified,
      extraDecisions: [],
    });

    return { exitCode: 0, state };
  } finally {
    releaseLock(lockPath);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleLockConflict(
  result: Exclude<LockAcquireResult, { acquired: true }>,
  lockPath: string,
  stderr: (s: string) => void
): void {
  const minutes = Math.floor(result.ageMs / 60_000);
  const seconds = Math.floor((result.ageMs % 60_000) / 1000);
  const age = minutes > 0 ? `${minutes}m${seconds}s` : `${seconds}s`;
  stderr(
    `[roadmap-converge] LOCK_CONFLICT — another converge pass is in progress (started ${age} ago, PID ${result.conflict.pid}). If stale, delete ${lockPath} or re-run with --force.`
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function trimEvidence(s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  return s.length > 500 ? s.slice(0, 500) : s;
}

function inferPriorLineCount(diffSummary: string | undefined): number | null {
  if (!diffSummary) return null;
  // The prior diff summary is of the form "+N -M" — we don't know the prior
  // line count from it directly. Return null; compareRoadmapHash will treat
  // priorLineCount=null as 0, which is the right baseline for cold start.
  return null;
}

function computeDelta(args: {
  priorStatus: RoadmapDimensionStatus | null;
  nextStatus: RoadmapDimensionStatus;
  invalidated: boolean;
}): RoadmapDimensionV1["delta_since_last"] {
  if (args.invalidated) return "invalidated";
  if (args.priorStatus === null) return "new";
  if (args.priorStatus === args.nextStatus) return "same";
  return statusRank(args.nextStatus) > statusRank(args.priorStatus)
    ? "improved"
    : "degraded";
}

function statusRank(s: RoadmapDimensionStatus): number {
  switch (s) {
    case "red":
      return 0;
    case "yellow":
      return 1;
    case "green":
      return 2;
  }
}

function assignQuestionId(
  existing: OpenQuestionV1[],
  dimension: string,
  i: number
): string {
  // Q-NN format per schema. Compute next index across the full set.
  let max = 0;
  for (const q of existing) {
    const m = /^Q-(\d+)$/.exec(q.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `Q-${String(max + i + 1).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Rubric loading + F-15 rendering rule
// ---------------------------------------------------------------------------

export interface RubricSections {
  green: string;
  yellow: string;
  red: string;
}

/**
 * Parse a rubric markdown file into Green/Yellow/Red sections. Used by the
 * F-15 rendering rule. Missing sections degrade gracefully to empty strings.
 */
export function parseRubric(content: string): RubricSections {
  const sections: RubricSections = { green: "", yellow: "", red: "" };
  const re = /^##\s+(Green|Yellow|Red)\s*$/gim;
  const matches: { name: keyof RubricSections; start: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const name = m[1].toLowerCase() as keyof RubricSections;
    matches.push({ name, start: m.index + m[0].length });
  }
  for (let i = 0; i < matches.length; i++) {
    const { name, start } = matches[i];
    const end = i + 1 < matches.length ? matches[i + 1].start : content.length;
    // Strip the leading "## Name" header from end-of-section by finding the
    // next "## " line within (we already skipped the header itself above).
    let chunk = content.slice(start, end);
    const nextHdr = chunk.search(/^##\s+/m);
    if (nextHdr >= 0) chunk = chunk.slice(0, nextHdr);
    sections[name] = chunk.trim();
  }
  return sections;
}

function loadRubricSections(rubricRef: string): RubricSections {
  try {
    const content = readFileSync(rubricRef, "utf-8");
    return parseRubric(content);
  } catch {
    return { green: "", yellow: "", red: "" };
  }
}

/**
 * F-15: per-dimension rendering rule.
 *   - green  → emit nothing extra (return finding description verbatim;
 *              callers typically don't surface green-status findings, but
 *              this function stays pure and returns the description as-is)
 *   - yellow → append the green-band exemplar inline
 *   - red    → append BOTH green and red exemplars inline
 */
export function renderFinding(
  finding: ReviewerFinding,
  status: RoadmapDimensionStatus,
  rubric: RubricSections
): string {
  const base = finding.description;
  if (status === "green") return base;
  if (status === "yellow") {
    if (!rubric.green) return base;
    return `${base}\n\n--- Green-band exemplar ---\n${rubric.green}`;
  }
  // red
  const parts = [base];
  if (rubric.green) {
    parts.push(`--- Green-band exemplar ---\n${rubric.green}`);
  }
  if (rubric.red) {
    parts.push(`--- Red-band exemplar ---\n${rubric.red}`);
  }
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Integrator StageContext writer (atomic) — Phase 5
// ---------------------------------------------------------------------------

interface IntegratorStageContextInput {
  startedAt: Date;
  completedAt: Date;
  state: RoadmapConvergeStateV1;
  integratorFilesModified: string[];
  extraDecisions: string[];
}

/**
 * Write execute-integrator.toon atomically. Must include filesModified[] from
 * the integrator's result for auditability (AC AW-06 / F-31).
 */
function writeIntegratorStageContext(input: IntegratorStageContextInput): void {
  const { startedAt, completedAt, state, integratorFilesModified, extraDecisions } = input;
  mkdirSync(dirname(EXECUTE_INTEGRATOR_STAGE_CONTEXT_PATH), { recursive: true });

  const filesChanged = [
    stateFileFor(state.roadmapSlug),
    ...integratorFilesModified,
  ];
  const findingsRemaining = state.open_questions.filter((q) => !q.resolved_at).length;
  const findingsResolved = state.open_questions.filter((q) => !!q.resolved_at).length;

  const keyDecisions: string[] = [
    ...extraDecisions,
  ];
  if (integratorFilesModified.length > 0) {
    keyDecisions.push(`integrator modified: ${integratorFilesModified.join(", ")}`);
  }

  const lines: string[] = [];
  lines.push(`stage: execute-integrator`);
  lines.push(`wave: 5`);
  lines.push(`iteration: 0`);
  lines.push(`startedAt: ${startedAt.toISOString()}`);
  lines.push(`completedAt: ${completedAt.toISOString()}`);
  lines.push(
    `durationMs: ${completedAt.getTime() - startedAt.getTime()}`
  );
  lines.push(`inputTokensEstimate: 0`);
  lines.push(`outputTokensEstimate: 0`);
  lines.push(`findingsResolved: ${findingsResolved}`);
  lines.push(`findingsRemaining: ${findingsRemaining}`);
  lines.push(
    `summary: integrator-pass round ${state.round} for ${state.roadmapSlug} — ${integratorFilesModified.length > 0 ? "ROADMAP.md mutated" : "no ROADMAP.md edits"}`
  );
  lines.push("");
  lines.push(`filesChanged[${filesChanged.length}]: ${filesChanged.join(",")}`);
  lines.push(`exportsAdded[0]:`);
  lines.push("");
  lines.push(`keyDecisions[${keyDecisions.length}]:`);
  for (const d of keyDecisions) lines.push(`  ${d}`);
  lines.push("");
  lines.push(`nextStageHints[1]:`);
  lines.push(
    `  ${findingsRemaining > 0 ? "resolve open questions and re-run /loom-roadmap converge" : "all questions resolved — ready for sign-off"}`
  );

  const body = lines.join("\n") + "\n";
  const tmp = EXECUTE_INTEGRATOR_STAGE_CONTEXT_PATH + ".tmp";
  writeFileSync(tmp, body, "utf-8");
  renameSync(tmp, EXECUTE_INTEGRATOR_STAGE_CONTEXT_PATH);
}

// ---------------------------------------------------------------------------
// StageContext writer (atomic)
// ---------------------------------------------------------------------------

export interface StageContextInput {
  stage: string;
  wave: number;
  startedAt: Date;
  completedAt: Date;
  summary: string;
  filesChanged: string[];
  findingsResolved: number;
  findingsRemaining: number;
  keyDecisions: string[];
  nextStageHints: string[];
}

export function writeStageContext(input: StageContextInput): void {
  mkdirSync(dirname(EXECUTE_STAGE_CONTEXT_PATH), { recursive: true });
  const lines: string[] = [];
  lines.push(`stage: ${input.stage}`);
  lines.push(`wave: ${input.wave}`);
  lines.push(`iteration: 0`);
  lines.push(`startedAt: ${input.startedAt.toISOString()}`);
  lines.push(`completedAt: ${input.completedAt.toISOString()}`);
  lines.push(
    `durationMs: ${input.completedAt.getTime() - input.startedAt.getTime()}`
  );
  lines.push(`inputTokensEstimate: 0`);
  lines.push(`outputTokensEstimate: 0`);
  lines.push(`findingsResolved: ${input.findingsResolved}`);
  lines.push(`findingsRemaining: ${input.findingsRemaining}`);
  lines.push(`summary: ${input.summary.replace(/\n/g, " ")}`);
  lines.push("");
  lines.push(`filesChanged[${input.filesChanged.length}]: ${input.filesChanged.join(",")}`);
  lines.push(`exportsAdded[0]:`);
  lines.push("");
  lines.push(`keyDecisions[${input.keyDecisions.length}]:`);
  for (const d of input.keyDecisions) lines.push(`  ${d}`);
  lines.push("");
  lines.push(`nextStageHints[${input.nextStageHints.length}]:`);
  for (const h of input.nextStageHints) lines.push(`  ${h}`);
  const body = lines.join("\n") + "\n";
  const tmp = EXECUTE_STAGE_CONTEXT_PATH + ".tmp";
  writeFileSync(tmp, body, "utf-8");
  renameSync(tmp, EXECUTE_STAGE_CONTEXT_PATH);
}
