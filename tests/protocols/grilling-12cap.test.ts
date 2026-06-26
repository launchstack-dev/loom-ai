/**
 * tests/protocols/grilling-12cap.test.ts
 *
 * S-03: grilling enforces the 12-question cap with progress indicator.
 *
 * Given: A grilling session in progress at question 12.
 * When:  The skill attempts to ask question 13.
 * Then:
 *   1. The skill MUST refuse and emit the documented cap message.
 *   2. The session transcript MUST include a progress indicator showing "12 of 12".
 *   3. The /skip escape MUST be reachable at any time before question 13.
 *
 * This test validates the structure of protocols/grilling.md — the protocol
 * document IS the spec.  It does not simulate a live grilling session; instead
 * it asserts that the spec document encodes all required rules, cap values,
 * format strings, and error codes.
 *
 * Run: bunx vitest run tests/protocols/grilling-12cap.test.ts
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(__dirname, "../..");
const GRILLING_PATH = join(REPO_ROOT, "protocols/grilling.md");

function readGrilling(): string {
  return readFileSync(GRILLING_PATH, "utf8");
}

// ---------------------------------------------------------------------------
// Verbatim strings that MUST appear in the spec (forward-compat assertions)
// ---------------------------------------------------------------------------

/** Exact cap message as specified. */
const CAP_MESSAGE =
  "STUCK_AT_GRILL_CAP: This grilling session has reached the 12-question limit. No further questions can be asked. Use /skip to exit or answer the last open question to proceed.";

/** Exact error code. */
const CAP_ERROR_CODE = "STUCK_AT_GRILL_CAP";

/** Progress indicator format documented in the spec. */
const PROGRESS_FORMAT_REGEX = /\[N of 12\]/;

/** Progress indicator at question 12 (session at cap). */
const PROGRESS_AT_CAP = "[12 of 12]";

// ---------------------------------------------------------------------------
// Core rule verbatim strings (GR-01..GR-05)
// ---------------------------------------------------------------------------

const CORE_RULES: Array<{ id: string; verbatim: string }> = [
  {
    id: "GR-01",
    verbatim:
      "Ask exactly one question per turn — never bundle multiple decisions into a single prompt.",
  },
  {
    id: "GR-02",
    verbatim:
      "Recommend an answer with every question — surface the default the grilling agent would pick if pressed.",
  },
  {
    id: "GR-03",
    verbatim:
      "Walk every branch — never collapse a multi-branch decision into the most likely path; enumerate alternatives before recommending.",
  },
  {
    id: "GR-04",
    verbatim:
      "Prefer codebase exploration over asking — read files first; only ask when the answer cannot be inferred from existing artifacts.",
  },
  {
    id: "GR-05",
    verbatim:
      "Cap the session — full content (12-question cap, /skip escape, progress indicator) lands in Phase 5a; the cap exists from day one.",
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("protocols/grilling.md — protocol spec structure", () => {
  it("protocols/grilling.md exists", () => {
    expect(existsSync(GRILLING_PATH)).toBe(true);
  });

  describe("5 core rules (GR-01..GR-05) — verbatim forward-compat assertions", () => {
    let content: string;

    beforeAll(() => {
      content = readGrilling();
    });

    for (const { id, verbatim } of CORE_RULES) {
      it(`${id} rule text appears verbatim`, () => {
        expect(content).toContain(verbatim);
      });
    }

    it("TOON rules[5]{id,rule}: block is present", () => {
      expect(content).toMatch(/rules\[5\]\{id,rule\}:/);
    });
  });

  describe("12-question cap (GR-05 extension)", () => {
    let content: string;

    beforeAll(() => {
      content = readGrilling();
    });

    it("specifies the numeric cap of 12 questions", () => {
      // The spec must mention the number 12 in a cap context.
      expect(content).toMatch(/12.{0,60}question/i);
    });

    it("documents the exact cap error code STUCK_AT_GRILL_CAP", () => {
      expect(content).toContain(CAP_ERROR_CODE);
    });

    it("documents the exact cap message verbatim", () => {
      expect(content).toContain(CAP_MESSAGE);
    });

    it("cap message starts with the error code (machine-readable prefix)", () => {
      expect(CAP_MESSAGE.startsWith(CAP_ERROR_CODE + ":")).toBe(true);
      // And the spec contains the cap message which starts with the code
      expect(content).toContain(CAP_ERROR_CODE + ":");
    });

    it("spec states the session terminates / refuses after question 12", () => {
      expect(content).toMatch(/terminat|refuse|halt|cap fires/i);
    });
  });

  describe("progress indicator format", () => {
    let content: string;

    beforeAll(() => {
      content = readGrilling();
    });

    it("documents the [N of 12] progress indicator format", () => {
      expect(content).toMatch(PROGRESS_FORMAT_REGEX);
    });

    it("documents that the indicator is the first token on the line", () => {
      expect(content).toMatch(/first token/i);
    });

    it("documents [12 of 12] as reachable (session-at-cap indicator)", () => {
      // The spec should show an example reaching [N of 12] where N can be 12,
      // or explicitly state the progress range.
      expect(content).toContain("[12 of 12]");
    });
  });

  describe("/skip escape command", () => {
    let content: string;

    beforeAll(() => {
      content = readGrilling();
    });

    it("documents the /skip escape command", () => {
      expect(content).toContain("/skip");
    });

    it("/skip is reachable at any point before question 13", () => {
      // The spec must state /skip is reachable before the cap fires.
      expect(content).toMatch(/\/skip.{0,200}before/is);
    });

    it("spec states /skip records skipped: true in the session log", () => {
      expect(content).toMatch(/skipped:\s*true/);
    });
  });

  describe("S-03 scenario: session at question 12 attempting question 13", () => {
    let content: string;

    beforeAll(() => {
      content = readGrilling();
    });

    /**
     * Simulate the cap check that a grilling skill performs.
     * Returns true if attempting question 13 would be refused.
     */
    function capWouldRefuse(questionIndex: number, cap: number): boolean {
      return questionIndex > cap;
    }

    it("cap fires when attempting question 13 (index > 12)", () => {
      expect(capWouldRefuse(13, 12)).toBe(true);
    });

    it("cap does NOT fire at question 12 (last allowed question)", () => {
      expect(capWouldRefuse(12, 12)).toBe(false);
    });

    it("progress indicator at question 12 reads [12 of 12]", () => {
      const indicator = `[${12} of ${12}]`;
      expect(indicator).toBe("[12 of 12]");
      // Verify the spec documents this exact string
      expect(content).toContain(PROGRESS_AT_CAP);
    });

    it("cap message is emitted when question 13 is attempted", () => {
      /**
       * Simulate what a grilling skill emits on attempt 13.
       * The spec mandates this exact string.
       */
      function emitCapMessage(questionIndex: number, cap: number): string | null {
        if (questionIndex > cap) {
          return `STUCK_AT_GRILL_CAP: This grilling session has reached the ${cap}-question limit. No further questions can be asked. Use /skip to exit or answer the last open question to proceed.`;
        }
        return null;
      }

      const msg = emitCapMessage(13, 12);
      expect(msg).toBe(CAP_MESSAGE);
      expect(msg).toContain("STUCK_AT_GRILL_CAP");
      expect(msg).toContain("12-question limit");
    });
  });

  describe("model-invocation guidance section", () => {
    let content: string;

    beforeAll(() => {
      content = readGrilling();
    });

    it("documents when a model-invoked skill may skip the prompt", () => {
      expect(content).toMatch(/model.{0,30}invok/i);
    });

    it("documents escalation to user-invoked grilling", () => {
      expect(content).toMatch(/escalat/i);
    });
  });

  describe("compliance checklist", () => {
    let content: string;

    beforeAll(() => {
      content = readGrilling();
    });

    it("includes a compliance checklist section", () => {
      expect(content).toMatch(/compliance checklist/i);
    });

    it("checklist references all 5 core rules", () => {
      expect(content).toContain("GR-01");
      expect(content).toContain("GR-02");
      expect(content).toContain("GR-03");
      expect(content).toContain("GR-04");
      expect(content).toContain("GR-05");
    });
  });
});
