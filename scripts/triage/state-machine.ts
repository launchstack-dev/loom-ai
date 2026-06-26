/**
 * scripts/triage/state-machine.ts
 *
 * Pure triage transition enforcer per PLAN-F-18 §488-531 and TriageState schema §101-124.
 *
 * Exports:
 *   transition(entry, toState, opts) -> TransitionResult
 *
 * Error codes:
 *   WONTFIX_REOPEN_REQUIRED  — attempted to leave wontfix without explicit reopen
 *   INVALID_TRANSITION       — transition not in the documented valid set
 *   REASON_REQUIRED          — FC-B1: reason required but missing
 */

// ── Types ───────────────────────────────────────────────────────────────────

export type TriageStateValue =
  | "needs-triage"
  | "needs-info"
  | "ready-for-agent"
  | "ready-for-human"
  | "wontfix";

export type TransitionActor = "human" | "agent";

export interface TransitionRow {
  from: TriageStateValue;
  to: TriageStateValue;
  at: string; // ISO 8601
  actor: TransitionActor;
  reason: string | null;
}

export interface TriageEntry {
  id: string;
  category: "bug" | "enhancement";
  state: TriageStateValue;
  createdAt: string;
  updatedAt: string;
  transitions: TransitionRow[];
}

export interface TransitionOptions {
  actor: TransitionActor;
  reason?: string | null;
  /** ISO 8601 timestamp; defaults to new Date().toISOString() if omitted */
  at?: string;
  /**
   * Must be true to perform a wontfix reopen via /loom-note reopen.
   * Without this flag, any transition FROM wontfix fails with WONTFIX_REOPEN_REQUIRED.
   */
  explicitReopen?: boolean;
}

export type TransitionErrorCode =
  | "WONTFIX_REOPEN_REQUIRED"
  | "INVALID_TRANSITION"
  | "REASON_REQUIRED";

export interface TransitionResult {
  ok: true;
  entry: TriageEntry;
  row: TransitionRow;
}

export interface TransitionError {
  ok: false;
  errorCode: TransitionErrorCode;
  message: string;
}

// ── Valid transition table §512-524 ─────────────────────────────────────────

/**
 * Documented valid transitions.
 * Key: `${from}→${to}`
 */
const VALID_TRANSITIONS = new Set<string>([
  "needs-triage→needs-info",
  "needs-triage→ready-for-agent",
  "needs-triage→ready-for-human",
  "needs-triage→wontfix",
  "needs-info→needs-triage",
  "needs-info→wontfix",
  "ready-for-agent→ready-for-human",
  "ready-for-human→ready-for-agent",
  // wontfix→needs-triage is valid only via explicit reopen
  "wontfix→needs-triage",
]);

/**
 * FC-B1: Transitions where `reason` MUST be non-null.
 * Applied: plan §112.
 */
const REASON_REQUIRED_TRANSITIONS = new Set<string>([
  "needs-triage→wontfix",
  "needs-info→wontfix",
  // All wontfix→* reopen paths
  "wontfix→needs-triage",
]);

// ── Core function ────────────────────────────────────────────────────────────

/**
 * Attempt to transition `entry` to `toState`.
 *
 * Returns `TransitionResult` (ok: true) with a mutated copy of the entry and
 * the appended TransitionRow, or `TransitionError` (ok: false) with an error
 * code and human-readable message.
 *
 * Does NOT mutate the original entry — returns a shallow-cloned copy with
 * updated `state`, `updatedAt`, and `transitions`.
 */
export function transition(
  entry: TriageEntry,
  toState: TriageStateValue,
  opts: TransitionOptions,
): TransitionResult | TransitionError {
  const fromState = entry.state;
  const key = `${fromState}→${toState}`;
  const at = opts.at ?? new Date().toISOString();
  const reason = opts.reason ?? null;

  // ── Guard: wontfix requires explicit reopen path ──────────────────────────
  if (fromState === "wontfix" && !opts.explicitReopen) {
    return {
      ok: false,
      errorCode: "WONTFIX_REOPEN_REQUIRED",
      message: `Entry ${entry.id} is in wontfix state. Use /loom-note reopen ${entry.id} --reason "..." to reopen.`,
    };
  }

  // ── Guard: must be a documented transition ────────────────────────────────
  if (!VALID_TRANSITIONS.has(key)) {
    return {
      ok: false,
      errorCode: "INVALID_TRANSITION",
      message: `Transition ${key} is not documented. Entry ${entry.id} remains in ${fromState}.`,
    };
  }

  // ── Guard: FC-B1 — reason required on specific paths ──────────────────────
  if (REASON_REQUIRED_TRANSITIONS.has(key) && !reason) {
    return {
      ok: false,
      errorCode: "REASON_REQUIRED",
      message: `Transition ${key} requires a non-null reason (FC-B1). Provide opts.reason.`,
    };
  }

  // ── Build transition row ──────────────────────────────────────────────────
  const row: TransitionRow = {
    from: fromState,
    to: toState,
    at,
    actor: opts.actor,
    reason,
  };

  // ── Return mutated copy ───────────────────────────────────────────────────
  const updated: TriageEntry = {
    ...entry,
    state: toState,
    updatedAt: at,
    transitions: [...entry.transitions, row],
  };

  return { ok: true, entry: updated, row };
}
