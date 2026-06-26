/**
 * tests/agents/architecture-review-vocab-collision.test.ts
 *
 * S-07: architecture-reviewer flags Module/phase vocabulary collisions.
 *
 * Given:
 *   1. agents/architecture-reviewer.md contains a vocab-collision check section.
 *   2. That section cites protocols/codebase-design.md Section 0.
 *   3. A fixture diff string with mixed Module/phase wording.
 *
 * Then:
 *   - The reviewer body MUST contain the vocabulary collision pass section.
 *   - The reviewer body MUST cite protocols/codebase-design.md Section 0 by anchor.
 *   - The fixture diff contains vocabulary that WOULD trigger the collision check
 *     (asserted by verifying the reviewer's detection rules are present).
 *
 * Run: bunx vitest run tests/agents/architecture-review-vocab-collision.test.ts
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const AGENT_PATH = join(REPO_ROOT, "agents/architecture-reviewer.md");
const PROTOCOL_PATH = join(REPO_ROOT, "protocols/codebase-design.md");

// ---------------------------------------------------------------------------
// Fixture: diff with mixed Module/phase vocabulary collision
// ---------------------------------------------------------------------------

/**
 * A fixture diff that mixes "Module" and "phase" as synonyms in the same
 * paragraph. This is the kind of prose the architecture-reviewer vocab-collision
 * pass should catch.
 */
const FIXTURE_DIFF_WITH_COLLISION = `
diff --git a/docs/architecture-notes.md b/docs/architecture-notes.md
index abc1234..def5678 100644
--- a/docs/architecture-notes.md
+++ b/docs/architecture-notes.md
@@ -10,6 +10,12 @@ ## Design Overview
+
+## Phase 3 Module Boundary
+
+In this phase, the Module defines the wave boundary for all deliverables.
+The phase acts as the Module interface — any changes to the wave must go
+through this phase's public surface, which functions as a Seam for the
+entire deliverable set.
+
`;

/**
 * A fixture diff WITHOUT vocabulary collision (terms appear in separate
 * well-scoped clauses — should NOT be flagged).
 */
const FIXTURE_DIFF_NO_COLLISION = `
diff --git a/src/adapters/db.ts b/src/adapters/db.ts
index abc1234..def5678 100644
--- a/src/adapters/db.ts
+++ b/src/adapters/db.ts
@@ -1,3 +1,10 @@
+// The Adapter translates the repository interface to the DB driver shape.
+// It exposes read and write methods that the upstream caller uses directly.
+//
+// (Scheduled for Phase 5 — the planning surface tracks rollout separately.)
`;

// ---------------------------------------------------------------------------
// Tests: agent file structure
// ---------------------------------------------------------------------------

describe("architecture-reviewer — vocab-collision pass section", () => {
  it("agents/architecture-reviewer.md exists", () => {
    expect(existsSync(AGENT_PATH)).toBe(true);
  });

  it("contains a Vocabulary Collision Pass section", () => {
    const content = readFileSync(AGENT_PATH, "utf8");
    expect(content).toMatch(/## Vocabulary Collision Pass/i);
  });

  it("cites protocols/codebase-design.md Section 0 by anchor", () => {
    const content = readFileSync(AGENT_PATH, "utf8");
    // Must reference the protocol file AND Section 0 or its anchor
    expect(content).toContain("protocols/codebase-design.md");
    expect(content).toMatch(
      /protocols\/codebase-design\.md.*[Ss]ection 0|protocols\/codebase-design\.md#section-0/,
    );
  });

  it("names the anchor protocols/codebase-design.md#section-0-vocabulary-mapping-table", () => {
    const content = readFileSync(AGENT_PATH, "utf8");
    expect(content).toContain(
      "protocols/codebase-design.md#section-0-vocabulary-mapping-table",
    );
  });

  it("defines Set A — Loom execution vocabulary terms", () => {
    const content = readFileSync(AGENT_PATH, "utf8");
    // Must list at least: phase, wave, deliverable
    expect(content).toContain("`phase`");
    expect(content).toContain("`wave`");
    expect(content).toContain("`deliverable`");
  });

  it("defines Set B — Codebase-design vocabulary terms", () => {
    const content = readFileSync(AGENT_PATH, "utf8");
    // Must list at least: Module, Seam, Adapter
    expect(content).toContain("`Module`");
    expect(content).toContain("`Seam`");
    expect(content).toContain("`Adapter`");
  });

  it("specifies the citation field value for collision findings", () => {
    const content = readFileSync(AGENT_PATH, "utf8");
    expect(content).toContain(
      "protocols/codebase-design.md#section-0-vocabulary-mapping-table",
    );
  });

  it("includes a false-positive guard rule", () => {
    const content = readFileSync(AGENT_PATH, "utf8");
    expect(content).toMatch(/false.?positive/i);
  });

  it("escalates to blocking severity when 3+ collisions are in the same file", () => {
    const content = readFileSync(AGENT_PATH, "utf8");
    expect(content).toMatch(/\bblocking\b/i);
    expect(content).toMatch(/three or more|3 or more|\bsystemic\b/i);
  });
});

// ---------------------------------------------------------------------------
// Tests: existing sections are preserved (non-regression)
// ---------------------------------------------------------------------------

describe("architecture-reviewer — existing sections preserved", () => {
  it("still contains the ADR Cross-Check section (Phase 4 carve-out)", () => {
    const content = readFileSync(AGENT_PATH, "utf8");
    expect(content).toMatch(/## ADR Cross-Check/i);
  });

  it("still contains the full verbatim ADR framing string", () => {
    const content = readFileSync(AGENT_PATH, "utf8");
    expect(content).toContain(
      "contradicts ADR-NNNN but worth reopening because",
    );
  });

  it("still references docs/adr/ for ADR lookup", () => {
    const content = readFileSync(AGENT_PATH, "utf8");
    expect(content).toContain("docs/adr/");
  });
});

// ---------------------------------------------------------------------------
// Tests: protocols/codebase-design.md Section 0 content
// ---------------------------------------------------------------------------

describe("protocols/codebase-design.md — Section 0 vocabulary table", () => {
  it("protocols/codebase-design.md exists", () => {
    expect(existsSync(PROTOCOL_PATH)).toBe(true);
  });

  it("contains Section 0 — Vocabulary mapping table", () => {
    const content = readFileSync(PROTOCOL_PATH, "utf8");
    expect(content).toMatch(/## Section 0/i);
    expect(content).toMatch(/[Vv]ocabulary mapping table/i);
  });

  it("defines Module term with a non-empty disambiguation note", () => {
    const content = readFileSync(PROTOCOL_PATH, "utf8");
    expect(content).toContain("Module");
    expect(content).toMatch(/Module.*cohesive unit|A cohesive unit.*Module/is);
  });

  it("defines Seam term", () => {
    const content = readFileSync(PROTOCOL_PATH, "utf8");
    expect(content).toContain("Seam");
  });

  it("defines Adapter term", () => {
    const content = readFileSync(PROTOCOL_PATH, "utf8");
    expect(content).toContain("Adapter");
  });

  it("distinguishes Vertical Slice from Phase in the mapping table", () => {
    const content = readFileSync(PROTOCOL_PATH, "utf8");
    // Section 0 table must contain a row that distinguishes these two
    expect(content).toContain("Vertical Slice");
    expect(content).toContain('"Phase" in PLAN.md');
  });
});

// ---------------------------------------------------------------------------
// Tests: fixture diff analysis
// ---------------------------------------------------------------------------

describe("fixture diff — vocabulary collision detection logic", () => {
  const LOOM_TERMS = ["phase", "wave", "deliverable", "gate", "implementer"];
  const DESIGN_TERMS = ["Module", "Seam", "Adapter", "Interface", "Depth", "Leverage"];

  /**
   * Checks whether a paragraph contains terms from both Set A and Set B,
   * used in a way that suggests synonymous usage (same clause).
   * This mirrors the logic the architecture-reviewer would apply.
   */
  function paragraphHasCollision(paragraph: string): boolean {
    const hasLoomTerm = LOOM_TERMS.some((t) =>
      new RegExp(`\\b${t}\\b`, "i").test(paragraph),
    );
    const hasDesignTerm = DESIGN_TERMS.some((t) =>
      new RegExp(`\\b${t}\\b`).test(paragraph),
    );
    if (!hasLoomTerm || !hasDesignTerm) return false;

    // Check if they appear to be used as synonyms: look for "as", "acts as",
    // "defines", "is the", "functions as" linking the two term types
    const synonymPatterns = [
      /\b(?:phase|wave|deliverable)\b.{0,40}\b(?:Module|Seam|Adapter)\b/i,
      /\b(?:Module|Seam|Adapter)\b.{0,40}\b(?:phase|wave|deliverable)\b/i,
    ];
    return synonymPatterns.some((p) => p.test(paragraph));
  }

  it("fixture diff with collision contains vocabulary from both Set A and Set B", () => {
    const hasLoomTerm = LOOM_TERMS.some((t) =>
      new RegExp(`\\b${t}\\b`, "i").test(FIXTURE_DIFF_WITH_COLLISION),
    );
    const hasDesignTerm = DESIGN_TERMS.some((t) =>
      new RegExp(`\\b${t}\\b`).test(FIXTURE_DIFF_WITH_COLLISION),
    );
    expect(hasLoomTerm).toBe(true);
    expect(hasDesignTerm).toBe(true);
  });

  it("fixture diff with collision is detected as a collision by the paragraph heuristic", () => {
    // Extract paragraphs from the added lines in the diff
    const addedLines = FIXTURE_DIFF_WITH_COLLISION
      .split("\n")
      .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
      .map((l) => l.slice(1))
      .join(" ");

    expect(paragraphHasCollision(addedLines)).toBe(true);
  });

  it("fixture diff WITHOUT collision is not flagged by the paragraph heuristic", () => {
    const addedLines = FIXTURE_DIFF_NO_COLLISION
      .split("\n")
      .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
      .map((l) => l.slice(1))
      .join(" ");

    // This one should NOT trigger the synonym pattern
    expect(paragraphHasCollision(addedLines)).toBe(false);
  });
});
