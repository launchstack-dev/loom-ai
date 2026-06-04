/**
 * Tests for hooks/lib/scenario-parser.ts — extracts BDD scenarios from
 * markdown documents containing fenced TOON blocks.
 *
 * Covers: happy path, state references, multi-tag, missing required fields,
 * malformed TOON, no Scenarios section, multiple scenarios per section, and
 * a few edge cases on field formats. See agents/protocols/scenario.schema.md.
 */

import { describe, it, expect } from "vitest";
import {
  parseScenarios,
  parseScenariosInSection,
} from "../hooks/lib/scenario-parser.js";

const HAPPY = [
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

const EDGE_WITH_STATE = [
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

const QA_REVIEW = [
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

describe("parseScenarios — happy path & valid examples", () => {
  it("parses Valid Example 1 (api-call happy-path) into a fully typed Scenario", () => {
    const md = `# Doc\n${HAPPY}\n`;
    const { scenarios, errors } = parseScenarios(md);

    expect(errors).toEqual([]);
    expect(scenarios).toHaveLength(1);

    const s = scenarios[0];
    expect(s.id).toBe("S-01");
    expect(s.title).toBe("Create user with valid signup payload");
    expect(s.given).toHaveLength(2);
    expect(s.given[0]).toMatch(/No user with email/);
    expect(s.when).toMatch(/A client POSTs to \/api\/users/);
    expect(s.whenTriggerType).toBe("api-call");
    expect(s.then).toHaveLength(3);
    expect(s.then[0]).toBe("Response status MUST be 201");
    expect(s.stateRef).toBeNull();
    expect(s.tags).toEqual(["happy-path"]);
    expect(s.testTier).toBe("integration");
    expect(s.automatable).toBe(true);
  });

  it("parses Valid Example 2 (edge case with stateRef and multi-tag)", () => {
    const md = `# Doc\n${EDGE_WITH_STATE}\n`;
    const { scenarios, errors } = parseScenarios(md);

    expect(errors).toEqual([]);
    expect(scenarios).toHaveLength(1);

    const s = scenarios[0];
    expect(s.id).toBe("S-04");
    expect(s.stateRef).toBe("archived");
    expect(s.tags).toEqual(["edge-case", "error"]);
    expect(s.whenTriggerType).toBe("actor-action");
    expect(s.testTier).toBe("unit");
    expect(s.automatable).toBe(true);
  });

  it("parses Valid Example 3 (qa-review, automatable false)", () => {
    const md = `# Doc\n${QA_REVIEW}\n`;
    const { scenarios, errors } = parseScenarios(md);

    expect(errors).toEqual([]);
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0].automatable).toBe(false);
    expect(scenarios[0].testTier).toBe("qa-review");
  });
});

describe("parseScenarios — multiple blocks & sectioning", () => {
  it("parses multiple scenarios in the same section in document order", () => {
    const md = `# Doc\n\n## Scenarios\n\n${HAPPY}\n\n${EDGE_WITH_STATE}\n\n${QA_REVIEW}\n`;
    const { scenarios, errors } = parseScenarios(md);

    expect(errors).toEqual([]);
    expect(scenarios.map((s) => s.id)).toEqual(["S-01", "S-04", "S-09"]);
    // sourceLine reflects original markdown coordinates.
    expect(scenarios[0].sourceLine).toBeGreaterThan(0);
    expect(scenarios[1].sourceLine).toBeGreaterThan(scenarios[0].sourceLine);
  });

  it("returns an empty array when the document has no Scenarios section (parseScenariosInSection)", () => {
    const md = "# Doc\n\nNo scenarios here.\n\nJust prose and code.\n";
    const result = parseScenariosInSection(md, /^##\s+Scenarios\s*$/);
    expect(result.scenarios).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("parseScenariosInSection only picks up blocks inside the matching section", () => {
    const md = [
      "# Doc",
      "",
      "## Other",
      "",
      HAPPY,
      "",
      "## Scenarios",
      "",
      EDGE_WITH_STATE,
      "",
    ].join("\n");

    const result = parseScenariosInSection(md, /^##\s+Scenarios\s*$/);
    expect(result.scenarios).toHaveLength(1);
    expect(result.scenarios[0].id).toBe("S-04");
  });

  it("parseScenariosInSection stops at next equal-or-higher heading", () => {
    const md = [
      "## Scenarios",
      "",
      HAPPY,
      "",
      "## Next Section",
      "",
      EDGE_WITH_STATE,
    ].join("\n");

    const result = parseScenariosInSection(md, /^##\s+Scenarios\s*$/);
    expect(result.scenarios).toHaveLength(1);
    expect(result.scenarios[0].id).toBe("S-01");
  });
});

describe("parseScenarios — error paths & field formats", () => {
  it("emits a parse error for a block missing id", () => {
    const md = [
      "```toon",
      "title: No id here",
      "given[1]: precondition",
      "when: trigger",
      "whenTriggerType: api-call",
      "then[1]: outcome",
      "tags[1]: happy-path",
      "automatable: true",
      "```",
    ].join("\n");

    const { scenarios, errors } = parseScenarios(md);
    expect(scenarios).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/missing required field 'id'/);
  });

  it("emits a parse error for a block missing automatable", () => {
    const md = [
      "```toon",
      "id: S-02",
      "title: Some title",
      "given[1]: precondition",
      "when: trigger",
      "whenTriggerType: api-call",
      "then[1]: outcome",
      "tags[1]: happy-path",
      "```",
    ].join("\n");

    const { scenarios, errors } = parseScenarios(md);
    expect(scenarios).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].scenarioId).toBe("S-02");
    expect(errors[0].message).toMatch(/automatable/);
  });

  it("handles empty arrays — given[0]: produces an empty array, not a parse error", () => {
    // Parser passes empty arrays through; the validator decides this is blocking.
    const md = [
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

    const { scenarios, errors } = parseScenarios(md);
    expect(errors).toEqual([]);
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0].given).toEqual([]);
  });

  it("parses an empty stateRef as null and a populated one as a string", () => {
    const md = `${HAPPY}\n${EDGE_WITH_STATE}\n`;
    const { scenarios } = parseScenarios(md);
    expect(scenarios[0].stateRef).toBeNull();
    expect(scenarios[1].stateRef).toBe("archived");
  });

  it("parses multi-tag arrays preserving order", () => {
    const { scenarios } = parseScenarios(EDGE_WITH_STATE);
    expect(scenarios[0].tags).toEqual(["edge-case", "error"]);
  });

  it("treats omitted testTier as null", () => {
    const md = [
      "```toon",
      "id: S-10",
      "title: Some scenario without testTier",
      "given[1]: condition",
      "when: trigger",
      "whenTriggerType: api-call",
      "then[1]: outcome",
      "tags[1]: happy-path",
      "automatable: true",
      "```",
    ].join("\n");

    const { scenarios, errors } = parseScenarios(md);
    expect(errors).toEqual([]);
    expect(scenarios[0].testTier).toBeNull();
  });

  it("ignores unclosed fenced blocks rather than throwing", () => {
    const md = [
      "```toon",
      "id: S-11",
      "title: Unclosed",
      "given[1]: x",
      // no closing fence
    ].join("\n");

    const { scenarios, errors } = parseScenarios(md);
    expect(scenarios).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("parses CSV-style array values with quoted commas", () => {
    const md = [
      "```toon",
      "id: S-12",
      "title: Quoted comma",
      'given[2]: "one, two","three, four"',
      "when: A trigger",
      "whenTriggerType: api-call",
      "then[1]: outcome MUST happen",
      "tags[1]: happy-path",
      "automatable: true",
      "```",
    ].join("\n");

    const { scenarios, errors } = parseScenarios(md);
    expect(errors).toEqual([]);
    expect(scenarios[0].given).toEqual(["one, two", "three, four"]);
  });
});
