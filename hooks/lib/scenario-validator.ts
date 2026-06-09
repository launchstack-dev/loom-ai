/**
 * Scenario well-formedness validator.
 *
 * Enforces the validation rules from agents/protocols/scenario.schema.md with
 * severity classification per agents/protocols/validation-rules.md (blocking |
 * warning | info). Returns findings rather than throwing; callers (plan and
 * roadmap scenario orchestrators) decide whether to halt the pipeline.
 *
 * Also implements the default-testTier resolution chain:
 *   1. `automatable: false`           → qa-review
 *   2. exactly one locked tag         → that tag's default tier
 *   3. multiple tags                  → highest-cost tier among them
 *   4. fallback to whenTriggerType    → api-call→integration, actor-action→e2e,
 *                                       system-event→unit
 *   Explicit testTier always overrides.
 */

import type { Scenario, TestTier, WhenTriggerType } from "./scenario-parser.js";

export type FindingSeverity = "blocking" | "warning" | "info";

/**
 * A single validator finding. `scenarioId` is the scenario whose validation
 * surfaced the finding; `field` (when set) names the offending field for
 * machine consumers.
 */
export interface ScenarioFinding {
  severity: FindingSeverity;
  message: string;
  scenarioId: string;
  field?: string;
}

/**
 * Optional context for scenario validation. Provide the parent doc's known
 * states (from `## State Machines`) so `stateRef` checks can resolve. When
 * absent, `stateRef` resolution is skipped (with an info finding).
 */
export interface ScenarioValidationContext {
  /** Names of states defined in the parent doc's State Machines section. */
  parentStates?: string[];
  /** Project-local tag enum loaded from scenarios.local.yaml. */
  localTags?: string[];
  /** When true, surface info-severity findings (RFC 2119, missing entity refs). */
  emitInfo?: boolean;
  /** Friendly parent name for messages (e.g., "Phase 1 — User Signup"). */
  parentName?: string;
}

export const LOCKED_TAGS: ReadonlyArray<string> = [
  "happy-path",
  "edge-case",
  "error",
  "regression",
];

export const VALID_WHEN_TRIGGER_TYPES: ReadonlyArray<string> = [
  "actor-action",
  "system-event",
  "api-call",
];

export const VALID_TEST_TIERS: ReadonlyArray<string> = [
  "unit",
  "integration",
  "e2e",
  "qa-review",
];

const TIER_COST: Record<string, number> = {
  unit: 1,
  integration: 2,
  e2e: 3,
  "qa-review": 4,
};

/**
 * Validate a single scenario, returning all findings (blocking, warning, info)
 * tied to it. Findings are returned in declaration order — callers are free to
 * sort or filter by severity.
 */
export function validateScenario(
  scenario: Scenario,
  context: ScenarioValidationContext = {}
): ScenarioFinding[] {
  const findings: ScenarioFinding[] = [];
  const sid = scenario.id;

  // --- id format ----------------------------------------------------------
  if (!/^S-\d{2,}$/.test(sid)) {
    findings.push({
      severity: "blocking",
      scenarioId: sid,
      field: "id",
      message: `scenario ${sid}: id does not match format S-{NN} (2+ zero-padded digits)`,
    });
  }

  // --- title --------------------------------------------------------------
  if (!scenario.title || scenario.title.length === 0) {
    findings.push({
      severity: "blocking",
      scenarioId: sid,
      field: "title",
      message: `scenario ${sid}: missing required 'title'`,
    });
  } else if (scenario.title.length > 120) {
    findings.push({
      severity: "blocking",
      scenarioId: sid,
      field: "title",
      message: `scenario ${sid}: 'title' exceeds 120 chars (${scenario.title.length})`,
    });
  }

  // --- given --------------------------------------------------------------
  if (!scenario.given || scenario.given.length === 0) {
    findings.push({
      severity: "blocking",
      scenarioId: sid,
      field: "given",
      message: `scenario ${sid}: 'given' is empty. At least one precondition is required.`,
    });
  }

  // --- when (exactly one trigger) ----------------------------------------
  if (!scenario.when || scenario.when.length === 0) {
    findings.push({
      severity: "blocking",
      scenarioId: sid,
      field: "when",
      message: `scenario ${sid}: 'when' is empty. Exactly one trigger is required.`,
    });
  } else if (containsCompoundTrigger(scenario.when)) {
    findings.push({
      severity: "blocking",
      scenarioId: sid,
      field: "when",
      message: `scenario ${sid}: 'when' contains compound trigger (matched conjunction like "AND then" / " and then "). Each scenario MUST have exactly one trigger. Split into multiple scenarios.`,
    });
  }

  // --- whenTriggerType ----------------------------------------------------
  if (!VALID_WHEN_TRIGGER_TYPES.includes(scenario.whenTriggerType)) {
    findings.push({
      severity: "blocking",
      scenarioId: sid,
      field: "whenTriggerType",
      message: `scenario ${sid}: 'whenTriggerType' value "${scenario.whenTriggerType}" is not in {${VALID_WHEN_TRIGGER_TYPES.join(", ")}}`,
    });
  }

  // --- then ---------------------------------------------------------------
  if (!scenario.then || scenario.then.length === 0) {
    findings.push({
      severity: "blocking",
      scenarioId: sid,
      field: "then",
      message: `scenario ${sid}: 'then' is empty. At least one outcome is required.`,
    });
  } else {
    for (const clause of scenario.then) {
      if (mentionsInternalState(clause)) {
        findings.push({
          severity: "warning",
          scenarioId: sid,
          field: "then",
          message: `scenario ${sid}: 'then' clause appears to assert internal state ("${clause}"). Prefer observable outcomes (HTTP status, file content, exit code).`,
        });
      }
    }
    if (context.emitInfo && !hasRfc2119Keyword(scenario.then)) {
      findings.push({
        severity: "info",
        scenarioId: sid,
        field: "then",
        message: `scenario ${sid}: 'then' lacks RFC 2119 normative keywords (MUST/SHOULD/MAY). Consider rephrasing for clarity.`,
      });
    }
  }

  // --- stateRef -----------------------------------------------------------
  if (scenario.stateRef !== null) {
    if (context.parentStates === undefined) {
      // No parent context — skip resolution but surface an info note so the
      // orchestrator knows the check was bypassed (e.g., standalone block).
      if (context.emitInfo) {
        findings.push({
          severity: "info",
          scenarioId: sid,
          field: "stateRef",
          message: `scenario ${sid}: stateRef "${scenario.stateRef}" — parent doc context not provided; skipped state resolution.`,
        });
      }
    } else if (!context.parentStates.includes(scenario.stateRef)) {
      const validStates = context.parentStates.length
        ? `Valid states: {${context.parentStates.join(", ")}}.`
        : "Parent doc declares no states.";
      findings.push({
        severity: "blocking",
        scenarioId: sid,
        field: "stateRef",
        message: `scenario ${sid}: stateRef "${scenario.stateRef}" does not appear in the parent document's ## State Machines section. ${validStates}`,
      });
    }
  }

  // --- tags ---------------------------------------------------------------
  if (!scenario.tags || scenario.tags.length === 0) {
    findings.push({
      severity: "blocking",
      scenarioId: sid,
      field: "tags",
      message: `scenario ${sid}: 'tags' is empty. At least one tag is required.`,
    });
  } else {
    const localTags = context.localTags ?? [];
    for (const tag of scenario.tags) {
      if (LOCKED_TAGS.includes(tag)) continue;
      if (localTags.includes(tag)) continue;
      // Per schema: blocking unless declared in scenarios.local.yaml. When no
      // local config is supplied, we surface a warning so the caller can
      // distinguish "unknown tag with config absent" from "unknown tag with
      // config present" — the orchestrator can upgrade to blocking if it
      // confirms the file is absent on disk.
      const severity: FindingSeverity =
        context.localTags === undefined ? "warning" : "blocking";
      findings.push({
        severity,
        scenarioId: sid,
        field: "tags",
        message: `scenario ${sid}: tag "${tag}" is not in the locked enum {${LOCKED_TAGS.join(", ")}}${
          context.localTags === undefined
            ? " and no scenarios.local.yaml was provided"
            : " and is not declared in scenarios.local.yaml"
        }.`,
      });
    }
  }

  // --- testTier -----------------------------------------------------------
  if (scenario.testTier !== null && !VALID_TEST_TIERS.includes(scenario.testTier)) {
    findings.push({
      severity: "blocking",
      scenarioId: sid,
      field: "testTier",
      message: `scenario ${sid}: 'testTier' value "${scenario.testTier}" is not in {${VALID_TEST_TIERS.join(", ")}}`,
    });
  }

  // --- automatable cross-checks ------------------------------------------
  if (!scenario.automatable) {
    if (scenario.testTier !== null && scenario.testTier !== "qa-review") {
      findings.push({
        severity: "warning",
        scenarioId: sid,
        field: "automatable",
        message: `scenario ${sid}: 'automatable: false' but 'testTier' is "${scenario.testTier}". Non-automatable scenarios default to qa-review; an explicit lower tier is suspicious.`,
      });
    }
  } else {
    // automatable: true with subjective then clauses — warn.
    const subjectiveClauses = (scenario.then ?? []).filter(isSubjectiveClause);
    for (const clause of subjectiveClauses) {
      findings.push({
        severity: "warning",
        scenarioId: sid,
        field: "then",
        message: `scenario ${sid}: 'then' clause "${clause}" is subjective and not deterministically verifiable. Either set automatable: false (default tier: qa-review) or rephrase to a measurable check.`,
      });
    }
  }

  return findings;
}

/**
 * Resolve the effective testTier for a scenario per the chain in
 * scenario.schema.md. The explicit field wins; otherwise we apply
 * automatable → tag → multi-tag highest cost → whenTriggerType fallback.
 */
export function resolveTestTier(scenario: Scenario): TestTier {
  if (scenario.testTier !== null && VALID_TEST_TIERS.includes(scenario.testTier)) {
    return scenario.testTier as TestTier;
  }
  if (!scenario.automatable) return "qa-review";

  const lockedTags = (scenario.tags ?? []).filter((t) => LOCKED_TAGS.includes(t));
  if (lockedTags.length === 1) {
    return defaultTierForTag(lockedTags[0], scenario.whenTriggerType);
  }
  if (lockedTags.length > 1) {
    let best: TestTier = "unit";
    let bestCost = 0;
    for (const t of lockedTags) {
      const tier = defaultTierForTag(t, scenario.whenTriggerType);
      const cost = TIER_COST[tier] ?? 0;
      if (cost > bestCost) {
        best = tier;
        bestCost = cost;
      }
    }
    return best;
  }
  // No locked tags — fall back to whenTriggerType.
  return tierForTriggerType(scenario.whenTriggerType);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultTierForTag(tag: string, triggerType: WhenTriggerType | string): TestTier {
  switch (tag) {
    case "happy-path":
      // Per schema: integration for api-call, e2e for actor-action.
      if (triggerType === "actor-action") return "e2e";
      if (triggerType === "api-call") return "integration";
      return "integration";
    case "edge-case":
      return "unit";
    case "error":
      return "integration";
    case "regression":
      // Per schema: matches the bug's reproduction tier — fall back to
      // whenTriggerType when we can't know.
      return tierForTriggerType(triggerType);
    default:
      return tierForTriggerType(triggerType);
  }
}

function tierForTriggerType(triggerType: WhenTriggerType | string): TestTier {
  switch (triggerType) {
    case "api-call":
      return "integration";
    case "actor-action":
      return "e2e";
    case "system-event":
      return "unit";
    default:
      return "integration";
  }
}

/**
 * Detect compound triggers — the most common drift is " AND then " or
 * " and then " conjoining two distinct triggers in one `when:` line. Plain
 * sentence "and" between adjectives is fine; we look for the specific
 * "and then" pattern that signals trigger compounding.
 */
function containsCompoundTrigger(when: string): boolean {
  return /\b(?:AND then|and then)\b/.test(when);
}

const INTERNAL_STATE_PATTERNS = [
  /\bthe cache\b/i,
  /\binternal queue\b/i,
  /\binternal state\b/i,
  /\bprivate field\b/i,
  /\bprivate variable\b/i,
];

function mentionsInternalState(clause: string): boolean {
  return INTERNAL_STATE_PATTERNS.some((pat) => pat.test(clause));
}

const SUBJECTIVE_PATTERNS = [
  /\blooks?\b.*\b(polished|good|nice|clean|professional|on-brand)\b/i,
  /\bfeels?\b/i,
  /\bintuitive\b/i,
  /\bnaturally\b/i,
  /\bgrammatically (?:correct|right)\b/i,
  /\bappropriate\b/i,
];

function isSubjectiveClause(clause: string): boolean {
  return SUBJECTIVE_PATTERNS.some((pat) => pat.test(clause));
}

const RFC_2119_PATTERN = /\b(MUST|SHOULD|MAY|MUST NOT|SHOULD NOT)\b/;

function hasRfc2119Keyword(thens: string[]): boolean {
  return thens.some((t) => RFC_2119_PATTERN.test(t));
}
