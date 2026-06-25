/**
 * Tests for hooks/lib/scenario-validator.ts.
 *
 * Uses the 3 valid + 6 invalid examples from protocols/scenario.schema.md
 * as a starting set, plus original cases per validation rule (compound
 * trigger, missing fields, unknown tag, unresolved stateRef, duplicate ID
 * cross-check, subjective then, default-tier resolution chain).
 *
 * Each case asserts severity and a substring of the message.
 */

import { describe, it, expect } from "vitest";
import {
  parseScenarios,
} from "../hooks/lib/scenario-parser.js";
import {
  validateScenario,
  resolveTestTier,
  LOCKED_TAGS,
} from "../hooks/lib/scenario-validator.js";

function parseOne(toonBlock: string): ReturnType<typeof parseScenarios>["scenarios"][number] {
  const { scenarios, errors } = parseScenarios(toonBlock);
  if (errors.length > 0) {
    throw new Error(`parse error in test fixture: ${errors[0].message}`);
  }
  if (scenarios.length !== 1) {
    throw new Error(`expected 1 scenario, got ${scenarios.length}`);
  }
  return scenarios[0];
}

// -------------------------------------------------------------------------
// Fixtures — 3 valid + 6 invalid from scenario.schema.md
// -------------------------------------------------------------------------

const VALID_1 = [
  "```toon",
  "id: S-01",
  "title: Create user with valid signup payload",
  'given[2]: No user with email "alice@example.com" exists, The signup endpoint is reachable',
  'when: A client POSTs to /api/users with valid signup payload for "alice@example.com"',
  "whenTriggerType: api-call",
  'then[3]: Response status MUST be 201, Response body MUST contain id and email fields, A row MUST exist in users where email = "alice@example.com"',
  "stateRef:",
  "tags[1]: happy-path",
  "testTier: integration",
  "automatable: true",
  "```",
].join("\n");

const VALID_2 = [
  "```toon",
  "id: S-04",
  "title: Reject transition from archived to active",
  'given[1]: An Order entity exists in state "archived"',
  "when: A client invokes Order.reactivate()",
  "whenTriggerType: actor-action",
  'then[2]: The call MUST raise IllegalStateTransition, Order state MUST remain "archived"',
  "stateRef: archived",
  "tags[2]: edge-case, error",
  "testTier: unit",
  "automatable: true",
  "```",
].join("\n");

const VALID_3 = [
  "```toon",
  "id: S-09",
  "title: Welcome email body reads naturally to a human reader",
  "given[1]: A welcome email was queued for a newly-created user",
  "when: A reviewer opens the queued email in the preview pane",
  "whenTriggerType: actor-action",
  "then[1]: The email body SHOULD be grammatically correct and use the user's name where templated",
  "stateRef:",
  "tags[1]: happy-path",
  "testTier: qa-review",
  "automatable: false",
  "```",
].join("\n");

const INVALID_1_COMPOUND = [
  "```toon",
  "id: S-02",
  "title: Signup and immediate login",
  'given[1]: No user with email "bob@example.com" exists',
  "when: A client POSTs to /api/users with valid payload AND then POSTs to /api/sessions with the same credentials",
  "whenTriggerType: api-call",
  "then[2]: Both responses MUST be 2xx, A session cookie MUST be returned",
  "tags[1]: happy-path",
  "testTier: integration",
  "automatable: true",
  "```",
].join("\n");

const INVALID_2_NO_GIVEN = [
  "```toon",
  "id: S-03",
  "title: Reject empty signup payload",
  "given[0]:",
  "when: A client POSTs to /api/users with an empty body",
  "whenTriggerType: api-call",
  "then[1]: Response status MUST be 400",
  "tags[1]: error",
  "testTier: integration",
  "automatable: true",
  "```",
].join("\n");

const INVALID_3_UNKNOWN_TAG = [
  "```toon",
  "id: S-05",
  "title: Reject SQL injection attempts",
  "given[1]: The signup endpoint is reachable",
  "when: A client POSTs to /api/users with email \"alice' OR 1=1--\"",
  "whenTriggerType: api-call",
  "then[1]: Response status MUST be 400",
  "tags[1]: security-critical",
  "testTier: integration",
  "automatable: true",
  "```",
].join("\n");

const INVALID_4_UNRESOLVED_STATE = [
  "```toon",
  "id: S-06",
  "title: Reject reactivation from frozen state",
  'given[1]: An Order entity exists in state "frozen"',
  "when: A client invokes Order.reactivate()",
  "whenTriggerType: actor-action",
  "then[1]: The call MUST raise IllegalStateTransition",
  "stateRef: frozen",
  "tags[1]: error",
  "testTier: unit",
  "automatable: true",
  "```",
].join("\n");

const INVALID_6_SUBJECTIVE = [
  "```toon",
  "id: S-07",
  "title: Error page looks polished",
  "given[1]: A request to a non-existent route is made",
  "when: A user navigates to /no-such-page",
  "whenTriggerType: actor-action",
  "then[1]: The error page SHOULD look polished and on-brand",
  "tags[1]: happy-path",
  "testTier: integration",
  "automatable: true",
  "```",
].join("\n");

// -------------------------------------------------------------------------
// Valid examples — no blocking findings.
// -------------------------------------------------------------------------

describe("validateScenario — valid examples produce no blocking findings", () => {
  it("Valid Example 1 (api-call happy-path) — no blocking findings", () => {
    const s = parseOne(VALID_1);
    const findings = validateScenario(s, {
      parentStates: [],
      localTags: [],
    });
    expect(findings.filter((f) => f.severity === "blocking")).toEqual([]);
  });

  it("Valid Example 2 (edge case with stateRef) — no blocking findings when state is known", () => {
    const s = parseOne(VALID_2);
    const findings = validateScenario(s, {
      parentStates: ["pending", "active", "archived"],
      localTags: [],
    });
    expect(findings.filter((f) => f.severity === "blocking")).toEqual([]);
  });

  it("Valid Example 3 (qa-review non-automatable) — no blocking findings", () => {
    const s = parseOne(VALID_3);
    const findings = validateScenario(s, {
      parentStates: [],
      localTags: [],
    });
    expect(findings.filter((f) => f.severity === "blocking")).toEqual([]);
  });
});

// -------------------------------------------------------------------------
// Invalid examples — each must surface its documented finding.
// -------------------------------------------------------------------------

describe("validateScenario — invalid examples surface the right finding", () => {
  it("Invalid 1: compound 'when' trigger is blocking", () => {
    const s = parseOne(INVALID_1_COMPOUND);
    const findings = validateScenario(s, { localTags: [] });
    const compound = findings.find(
      (f) => f.field === "when" && f.severity === "blocking"
    );
    expect(compound).toBeDefined();
    expect(compound?.message).toMatch(/compound trigger/);
  });

  it("Invalid 2: empty 'given' is blocking", () => {
    const s = parseOne(INVALID_2_NO_GIVEN);
    const findings = validateScenario(s, { localTags: [] });
    const empty = findings.find(
      (f) => f.field === "given" && f.severity === "blocking"
    );
    expect(empty).toBeDefined();
    expect(empty?.message).toMatch(/'given' is empty/);
  });

  it("Invalid 3: unknown tag is blocking when localTags is configured (empty array)", () => {
    const s = parseOne(INVALID_3_UNKNOWN_TAG);
    const findings = validateScenario(s, { localTags: [] });
    const tag = findings.find(
      (f) => f.field === "tags" && f.severity === "blocking"
    );
    expect(tag).toBeDefined();
    expect(tag?.message).toMatch(/"security-critical"/);
    expect(tag?.message).toMatch(/scenarios\.local\.yaml/);
  });

  it("Invalid 3 — same tag is accepted when declared in localTags", () => {
    const s = parseOne(INVALID_3_UNKNOWN_TAG);
    const findings = validateScenario(s, {
      localTags: ["security-critical"],
    });
    expect(findings.filter((f) => f.field === "tags")).toEqual([]);
  });

  it("Invalid 4: unresolved stateRef is blocking when parentStates is provided", () => {
    const s = parseOne(INVALID_4_UNRESOLVED_STATE);
    const findings = validateScenario(s, {
      parentStates: ["pending", "active", "archived"],
      localTags: [],
    });
    const sr = findings.find(
      (f) => f.field === "stateRef" && f.severity === "blocking"
    );
    expect(sr).toBeDefined();
    expect(sr?.message).toMatch(/"frozen"/);
  });

  it("Invalid 4 — stateRef check is skipped (no blocking) when parentStates is undefined", () => {
    const s = parseOne(INVALID_4_UNRESOLVED_STATE);
    const findings = validateScenario(s, { localTags: [] });
    expect(
      findings.filter((f) => f.field === "stateRef" && f.severity === "blocking")
    ).toEqual([]);
  });

  it("Invalid 6: subjective then clause with automatable:true is warning", () => {
    const s = parseOne(INVALID_6_SUBJECTIVE);
    const findings = validateScenario(s, { localTags: [] });
    const subj = findings.find(
      (f) => f.field === "then" && f.severity === "warning"
    );
    expect(subj).toBeDefined();
    expect(subj?.message).toMatch(/subjective/);
  });
});

// -------------------------------------------------------------------------
// Original cases per validation rule.
// -------------------------------------------------------------------------

describe("validateScenario — additional rule coverage", () => {
  it("rejects an invalid whenTriggerType value as blocking", () => {
    const block = [
      "```toon",
      "id: S-20",
      "title: Bad trigger type",
      "given[1]: condition",
      "when: trigger",
      "whenTriggerType: cron-job",
      "then[1]: outcome MUST happen",
      "tags[1]: happy-path",
      "automatable: true",
      "```",
    ].join("\n");

    const s = parseOne(block);
    const findings = validateScenario(s, { localTags: [] });
    const tt = findings.find(
      (f) => f.field === "whenTriggerType" && f.severity === "blocking"
    );
    expect(tt).toBeDefined();
    expect(tt?.message).toMatch(/cron-job/);
  });

  it("rejects an invalid testTier value as blocking", () => {
    const block = [
      "```toon",
      "id: S-21",
      "title: Bad test tier",
      "given[1]: condition",
      "when: trigger",
      "whenTriggerType: api-call",
      "then[1]: outcome MUST happen",
      "tags[1]: happy-path",
      "testTier: smoke",
      "automatable: true",
      "```",
    ].join("\n");

    const s = parseOne(block);
    const findings = validateScenario(s, { localTags: [] });
    const t = findings.find(
      (f) => f.field === "testTier" && f.severity === "blocking"
    );
    expect(t).toBeDefined();
    expect(t?.message).toMatch(/smoke/);
  });

  it("rejects an id that does not match S-NN as blocking", () => {
    const block = [
      "```toon",
      "id: foo-bar",
      "title: bad id",
      "given[1]: condition",
      "when: trigger",
      "whenTriggerType: api-call",
      "then[1]: outcome MUST happen",
      "tags[1]: happy-path",
      "automatable: true",
      "```",
    ].join("\n");

    const s = parseOne(block);
    const findings = validateScenario(s, { localTags: [] });
    const idf = findings.find(
      (f) => f.field === "id" && f.severity === "blocking"
    );
    expect(idf).toBeDefined();
    expect(idf?.message).toMatch(/S-\{NN\}/);
  });

  it("flags 'then' clauses that mention internal state as a warning", () => {
    const block = [
      "```toon",
      "id: S-22",
      "title: Cache is populated",
      "given[1]: condition",
      "when: trigger",
      "whenTriggerType: api-call",
      "then[1]: The cache MUST be populated with the result",
      "tags[1]: happy-path",
      "automatable: true",
      "```",
    ].join("\n");

    const s = parseOne(block);
    const findings = validateScenario(s, { localTags: [] });
    const w = findings.find(
      (f) => f.field === "then" && f.severity === "warning"
    );
    expect(w).toBeDefined();
    expect(w?.message).toMatch(/internal state/);
  });

  it("rejects a title >120 chars as blocking", () => {
    const longTitle = "x".repeat(130);
    const block = [
      "```toon",
      "id: S-23",
      `title: ${longTitle}`,
      "given[1]: condition",
      "when: trigger",
      "whenTriggerType: api-call",
      "then[1]: outcome MUST happen",
      "tags[1]: happy-path",
      "automatable: true",
      "```",
    ].join("\n");

    const s = parseOne(block);
    const findings = validateScenario(s, { localTags: [] });
    const t = findings.find(
      (f) => f.field === "title" && f.severity === "blocking"
    );
    expect(t).toBeDefined();
    expect(t?.message).toMatch(/exceeds 120 chars/);
  });

  it("flags automatable:false combined with non-qa-review testTier as warning", () => {
    const block = [
      "```toon",
      "id: S-24",
      "title: Suspicious tier",
      "given[1]: condition",
      "when: trigger",
      "whenTriggerType: api-call",
      "then[1]: outcome SHOULD happen",
      "tags[1]: happy-path",
      "testTier: integration",
      "automatable: false",
      "```",
    ].join("\n");

    const s = parseOne(block);
    const findings = validateScenario(s, { localTags: [] });
    const w = findings.find(
      (f) => f.field === "automatable" && f.severity === "warning"
    );
    expect(w).toBeDefined();
    expect(w?.message).toMatch(/qa-review/);
  });
});

// -------------------------------------------------------------------------
// Default testTier resolution chain.
// -------------------------------------------------------------------------

describe("resolveTestTier — default-tier resolution chain", () => {
  it("rule 1: automatable:false short-circuits to qa-review (regardless of tag)", () => {
    const block = [
      "```toon",
      "id: S-30",
      "title: Non-automatable defaults to qa-review",
      "given[1]: condition",
      "when: trigger",
      "whenTriggerType: api-call",
      "then[1]: judgment call",
      "tags[1]: happy-path",
      "automatable: false",
      "```",
    ].join("\n");
    const s = parseOne(block);
    expect(resolveTestTier(s)).toBe("qa-review");
  });

  it("rule 2: single locked tag uses that tag's default (happy-path + api-call → integration)", () => {
    const block = [
      "```toon",
      "id: S-31",
      "title: Single tag",
      "given[1]: condition",
      "when: trigger",
      "whenTriggerType: api-call",
      "then[1]: outcome MUST happen",
      "tags[1]: happy-path",
      "automatable: true",
      "```",
    ].join("\n");
    const s = parseOne(block);
    expect(resolveTestTier(s)).toBe("integration");
  });

  it("rule 2 (actor-action variant): happy-path + actor-action → e2e", () => {
    const block = [
      "```toon",
      "id: S-32",
      "title: actor happy path",
      "given[1]: condition",
      "when: A user clicks save",
      "whenTriggerType: actor-action",
      "then[1]: outcome MUST happen",
      "tags[1]: happy-path",
      "automatable: true",
      "```",
    ].join("\n");
    const s = parseOne(block);
    expect(resolveTestTier(s)).toBe("e2e");
  });

  it("rule 3: multiple locked tags use the highest-cost default among them", () => {
    // edge-case → unit, error → integration  →  integration wins
    const block = [
      "```toon",
      "id: S-33",
      "title: multi-tag",
      "given[1]: condition",
      "when: trigger",
      "whenTriggerType: api-call",
      "then[1]: outcome MUST happen",
      "tags[2]: edge-case, error",
      "automatable: true",
      "```",
    ].join("\n");
    const s = parseOne(block);
    expect(resolveTestTier(s)).toBe("integration");
  });

  it("rule 4: no locked tags → fall back to whenTriggerType (system-event → unit)", () => {
    const block = [
      "```toon",
      "id: S-34",
      "title: system event",
      "given[1]: condition",
      "when: A cron tick fires",
      "whenTriggerType: system-event",
      "then[1]: outcome MUST happen",
      "tags[1]: regression",
      "automatable: true",
      "```",
    ].join("\n");
    const s = parseOne(block);
    // regression tag defaults via whenTriggerType (system-event → unit).
    expect(resolveTestTier(s)).toBe("unit");
  });

  it("explicit testTier always overrides the resolution chain", () => {
    const block = [
      "```toon",
      "id: S-35",
      "title: explicit override",
      "given[1]: condition",
      "when: trigger",
      "whenTriggerType: api-call",
      "then[1]: outcome MUST happen",
      "tags[1]: happy-path",
      "testTier: e2e",
      "automatable: true",
      "```",
    ].join("\n");
    const s = parseOne(block);
    expect(resolveTestTier(s)).toBe("e2e");
  });
});

describe("LOCKED_TAGS — exported enum integrity", () => {
  it("contains exactly the four canonical tags", () => {
    expect([...LOCKED_TAGS].sort()).toEqual(
      ["edge-case", "error", "happy-path", "regression"].sort()
    );
  });
});
