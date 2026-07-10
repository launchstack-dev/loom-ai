/**
 * Convergence circuit breakers — the executable form of the locked breaker
 * semantics in agents/convergence-driver.md § Circuit Breakers (C-01, C-10,
 * C-11). This module is PURE: no fs, no process, no clock — so the Workflow
 * drivers, the markdown-fallback tooling, and tests all evaluate the exact
 * same policy.
 *
 * DRY contract (locked C-01): one implementation across target / criteria /
 * document modes. The mode selects the counter that callers normalize into
 * `IterationRecord.blocking` (target: failing, criteria: blockingFailing,
 * document: blockingCount); the policy itself has no mode branches except the
 * two mode-scoped guards the spec defines (criteria frozen-stall, document
 * scope-expansion).
 *
 * haltReason strings, status values, cause/recovery strings, and stdout
 * formats are LOCKED (convergence-summary.schema.md C-10/C-11). Do not
 * paraphrase, extend, or re-emit them from other sites.
 */

export type ConvergenceMode = "target" | "criteria" | "document";

export type HaltReason =
  | "STALL"
  | "REGRESSION"
  | "BUDGET_EXHAUSTED"
  | "MAX_ITERATIONS"
  | "SCOPE_EXPANSION"
  | "VALIDATION_EXHAUSTED"
  | "INTEGRATOR_NOT_FOUND"
  | "HARNESS_MISSING"
  | "FINDINGS_SCHEMA_INVALID";

export type ConvergenceStatus =
  | "converged"
  | "halted-stall"
  | "halted-regression"
  | "halted-budget"
  | "halted-max-iter"
  | "halted-scope-expansion"
  | "halted-validation";

/** Breaker-origin halt reasons the driver may emit mid-loop. VALIDATION_EXHAUSTED is wrapper-set only. */
export const DRIVER_HALT_REASONS: ReadonlySet<HaltReason> = new Set([
  "STALL",
  "REGRESSION",
  "BUDGET_EXHAUSTED",
  "MAX_ITERATIONS",
  "SCOPE_EXPANSION",
]);

export const STATUS_BY_HALT_REASON: Readonly<Record<string, ConvergenceStatus>> = {
  STALL: "halted-stall",
  REGRESSION: "halted-regression",
  BUDGET_EXHAUSTED: "halted-budget",
  MAX_ITERATIONS: "halted-max-iter",
  SCOPE_EXPANSION: "halted-scope-expansion",
  VALIDATION_EXHAUSTED: "halted-validation",
};

/** Locked C-10 cause strings — verbatim from convergence-summary.schema.md. */
export const HALT_CAUSE: Readonly<Record<HaltReason, string>> = {
  STALL: "`blockingCount` unchanged across 2 consecutive iterations",
  REGRESSION: "`blockingCount` increased vs prior iteration",
  BUDGET_EXHAUSTED: "Cumulative agent spawns exceeded `converge.config.agentBudget`",
  MAX_ITERATIONS:
    "Iteration count reached `converge.config.maxIterations` without convergence",
  SCOPE_EXPANSION: "Integrator added a new top-level Phase/Feature/Milestone (C-06)",
  VALIDATION_EXHAUSTED:
    "Post-converge validation (Step 5.5 of `/loom-plan create --autoconverge`) found blocking structural issues, re-entered the driver once, and validation STILL failed. The driver-owned loop itself converged on reviewer agreement; the wrapper sets this haltReason after re-entry exhaustion.",
  INTEGRATOR_NOT_FOUND: "`converge.config.integrator` does not resolve",
  HARNESS_MISSING: "`converge.config.harness` path missing OR no `findings.toon` produced",
  FINDINGS_SCHEMA_INVALID: "Harness wrote `findings.toon` failing schema validation",
};

/** Locked C-10 recovery strings — verbatim from convergence-summary.schema.md. */
export const HALT_RECOVERY: Readonly<Record<HaltReason, string>> = {
  STALL: "/loom-converge --resume after fixing integrator prompt or splitting work",
  REGRESSION: "`cp` the prior snapshot back, then /loom-converge --resume",
  BUDGET_EXHAUSTED: "Increase `agentBudget`, then /loom-converge --resume",
  MAX_ITERATIONS: "Accept current draft, raise `--max-iterations`, or revert",
  SCOPE_EXPANSION: "Approve scope OR `cp` snapshot back; re-invoke",
  VALIDATION_EXHAUSTED:
    "Run /loom-plan review --integrate manually, or /loom-roadmap refine, to resolve the structural blockers in .plan-execution/convergence/validation-failures.toon, then re-invoke /loom-plan create --review-integrate --autoconverge.",
  INTEGRATOR_NOT_FOUND: "Fix `integrator` field",
  HARNESS_MISSING: "Fix `harness` field or repair harness",
  FINDINGS_SCHEMA_INVALID: "Inspect harness aggregator",
};

/** One iteration's normalized state. `blocking` is the mode-specific counter. */
export interface IterationRecord {
  iteration: number;
  /** target: failing · criteria: blockingFailing · document: blockingCount */
  blocking: number;
}

export interface BreakerInput {
  mode: ConvergenceMode;
  /** The iteration just completed (1-indexed). */
  iteration: number;
  maxIterations: number;
  agentBudget: number;
  /** Cumulative spawns: harness + reviewers + integrator/fixers, all iterations. */
  totalAgentsSpawned: number;
  /** History INCLUDING the iteration just completed, oldest first. */
  history: IterationRecord[];
  /** Criteria mode: all blocking criteria frozen (oscillation) — spec'd STALL. */
  allBlockingFrozen?: boolean;
  /** Document mode: scope-expansion guard tripped this iteration (C-06). */
  scopeExpansionDetected?: boolean;
}

export interface BreakerVerdict {
  halt: boolean;
  haltReason?: HaltReason;
  status?: ConvergenceStatus;
  /** consecutiveStalls counter after this evaluation (persist into state). */
  consecutiveStalls: number;
}

/**
 * Convergence rate per driver.md step 9: (prior - current) / prior, with the
 * locked edge case prior == 0 → 0.00.
 */
export function computeRate(prior: number, current: number): number {
  if (prior === 0) return 0;
  return (prior - current) / prior;
}

/** A stalled iteration: rate < 0.01 vs the prior iteration (driver.md step 10). */
function isStalled(history: IterationRecord[], index: number): boolean {
  if (index < 1) return false;
  return computeRate(history[index - 1].blocking, history[index].blocking) < 0.01;
}

/**
 * Evaluate all breakers at the end of an iteration, in the spec's step-10
 * order: convergence short-circuit, STALL, REGRESSION, BUDGET_EXHAUSTED,
 * frozen-stall (criteria), SCOPE_EXPANSION (document), MAX_ITERATIONS.
 * Pure — callers persist `consecutiveStalls` and act on the verdict.
 */
export function evaluateBreakers(input: BreakerInput): BreakerVerdict {
  const { history } = input;
  const last = history[history.length - 1];

  // consecutiveStalls: incremented on a stalled iteration, reset otherwise.
  const stalledNow = isStalled(history, history.length - 1);
  const stalledPrior = isStalled(history, history.length - 2);
  const consecutiveStalls = stalledNow ? (stalledPrior ? 2 : 1) : 0;

  // Converged — evaluated before any breaker (loop step 2 short-circuit).
  if (last && last.blocking === 0) {
    return { halt: true, status: "converged", consecutiveStalls: 0 };
  }

  // STALL: rate < 0.01 for 2 consecutive iterations (document mode: equal
  // blockingCount twice — the same condition through the normalized counter).
  if (consecutiveStalls >= 2) {
    return halt("STALL", consecutiveStalls);
  }

  // REGRESSION: counter increased vs prior iteration (advisory excluded by
  // normalization).
  if (history.length >= 2 && last.blocking > history[history.length - 2].blocking) {
    return halt("REGRESSION", consecutiveStalls);
  }

  // BUDGET_EXHAUSTED: cumulative spawns >= budget.
  if (input.totalAgentsSpawned >= input.agentBudget) {
    return halt("BUDGET_EXHAUSTED", consecutiveStalls);
  }

  // Criteria mode only: all blocking criteria frozen → STALLED.
  if (input.mode === "criteria" && input.allBlockingFrozen) {
    return halt("STALL", consecutiveStalls);
  }

  // Document mode only: scope-expansion guard (C-06).
  if (input.mode === "document" && input.scopeExpansionDetected) {
    return halt("SCOPE_EXPANSION", consecutiveStalls);
  }

  // MAX_ITERATIONS: cap reached without convergence.
  if (input.iteration >= input.maxIterations) {
    return halt("MAX_ITERATIONS", consecutiveStalls);
  }

  return { halt: false, consecutiveStalls };

  function halt(reason: HaltReason, stalls: number): BreakerVerdict {
    return {
      halt: true,
      haltReason: reason,
      status: STATUS_BY_HALT_REASON[reason],
      consecutiveStalls: stalls,
    };
  }
}

/**
 * Scope-expansion detection (locked C-06, document mode only): the integrator
 * added a NEW top-level structural heading. Exact regexes — no fuzzy variants.
 */
const SCOPE_PATTERNS = [/^### Phase \d+/, /^### F-\d+/, /^### M-\d+/];

export function detectScopeExpansion(before: string, after: string): string[] {
  const headings = (text: string): Set<string> => {
    const found = new Set<string>();
    for (const line of text.split("\n")) {
      if (SCOPE_PATTERNS.some((re) => re.test(line))) found.add(line.trim());
    }
    return found;
  };
  const prior = headings(before);
  return [...headings(after)].filter((h) => !prior.has(h));
}

/** Locked C-09 per-iteration stdout line. */
export function renderIterationLine(
  n: number,
  max: number,
  prev: number,
  curr: number,
  fixed: number,
  fresh: number
): string {
  return `[autoconverge] iteration ${n}/${max} — blockingCount: ${prev} → ${curr} (${fixed} fixed, ${fresh} new)`;
}

/** Locked C-10 halt-message block. */
export function renderHaltMessage(haltReason: HaltReason): string {
  return (
    `[autoconverge] HALT haltReason=${haltReason}\n` +
    `  cause: ${HALT_CAUSE[haltReason]}\n` +
    `  recovery: ${HALT_RECOVERY[haltReason]}`
  );
}
