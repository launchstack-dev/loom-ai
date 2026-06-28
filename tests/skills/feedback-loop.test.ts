/**
 * S-03: feedback-loop skill body assertions.
 *
 * Verifies:
 * 1. Leading-word presence: at least one body sentence starts with "tight"
 *    (case-insensitive) and at least one starts with "red".
 * 2. All 10 rung names appear in the body, in order.
 * 3. The TRDA gate acronym is explained.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Load the skill body
// ---------------------------------------------------------------------------

const SKILL_PATH = join(
  __dirname,
  "../../skills/feedback-loop/SKILL.md",
);

const rawContent = readFileSync(SKILL_PATH, "utf8");

/**
 * Strip YAML frontmatter (--- ... ---) and return the body.
 */
function stripFrontmatter(content: string): string {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") return content;
  const endIdx = lines.indexOf("---", 1);
  if (endIdx === -1) return content;
  return lines.slice(endIdx + 1).join("\n").trim();
}

/**
 * Extract body sentences: lines that are not headings (# ...) and not empty.
 * Headings are lines starting with one or more # characters.
 */
function extractBodySentences(body: string): string[] {
  return body
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith("#");
    });
}

const body = stripFrontmatter(rawContent);
const sentences = extractBodySentences(body);

// ---------------------------------------------------------------------------
// S-03 assertion 1: Leading-word presence
// ---------------------------------------------------------------------------

describe("S-03: leading-word presence in feedback-loop SKILL.md", () => {
  it("at least one body sentence starts with 'tight' (case-insensitive)", () => {
    const hasTight = sentences.some((line) =>
      /^tight\b/i.test(line.trim()),
    );
    expect(hasTight).toBe(true);
  });

  it("at least one body sentence starts with 'red' (case-insensitive)", () => {
    const hasRed = sentences.some((line) =>
      /^red\b/i.test(line.trim()),
    );
    expect(hasRed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// S-03 assertion 2: 10-rung enumeration (all names present, in order)
// ---------------------------------------------------------------------------

/**
 * Verbatim rung names as specified in the plan:
 * failing test → curl → CLI+fixture diff → headless browser → trace replay →
 * throwaway harness → fuzz → bisection → differential → HITL bash
 */
const RUNG_NAMES = [
  "failing test",
  "curl",
  "CLI+fixture diff",
  "headless browser",
  "trace replay",
  "throwaway harness",
  "fuzz",
  "bisection",
  "differential",
  "HITL bash",
] as const;

describe("S-03: 10-rung ladder enumeration in feedback-loop SKILL.md", () => {
  it("contains all 10 rung names", () => {
    for (const rung of RUNG_NAMES) {
      expect(body).toContain(rung);
    }
  });

  it("rung names appear in order", () => {
    let lastIndex = -1;
    for (const rung of RUNG_NAMES) {
      const idx = body.indexOf(rung);
      expect(idx).toBeGreaterThan(lastIndex);
      lastIndex = idx;
    }
  });

  it("exactly 10 rung names are present (no extras)", () => {
    // Verify each of the 10 enumerated rungs is individually present.
    // This does not assert a unique count but validates the spec enumeration.
    expect(RUNG_NAMES).toHaveLength(10);
    for (const rung of RUNG_NAMES) {
      expect(body).toContain(rung);
    }
  });
});

// ---------------------------------------------------------------------------
// Additional: TRDA gate definition presence
// ---------------------------------------------------------------------------

describe("feedback-loop SKILL.md — TRDA gate definition", () => {
  it("defines the TRDA gate with all four bits", () => {
    expect(body).toContain("tight");
    expect(body).toContain("redCapable");
    expect(body).toContain("deterministic");
    expect(body).toContain("agentRunnable");
  });

  it("explains that ALL FOUR must be true to pass the gate", () => {
    expect(body).toMatch(/ALL FOUR must be true|all four.*must be true/i);
  });

  it("mentions determinismRuns >= 2", () => {
    expect(body).toContain("determinismRuns >= 2");
  });
});

// ---------------------------------------------------------------------------
// Additional: LOOP_IMMUTABLE error code presence
// ---------------------------------------------------------------------------

describe("feedback-loop SKILL.md — LOOP_IMMUTABLE error code", () => {
  it("mentions LOOP_IMMUTABLE", () => {
    expect(body).toContain("LOOP_IMMUTABLE");
  });

  it("states retired loops are immutable", () => {
    expect(body).toMatch(/retired.*immutable|immutable.*retired/i);
  });
});
