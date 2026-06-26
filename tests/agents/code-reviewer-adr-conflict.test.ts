/**
 * tests/agents/code-reviewer-adr-conflict.test.ts
 *
 * Asserts that ALL 9 reviewer agent files AND roadmap-converge-reviewer
 * contain the FULL verbatim framing "contradicts ADR-NNNN but worth reopening
 * because" (substring match against the unabridged sentence per IC-002).
 *
 * Run: bunx vitest run tests/agents/code-reviewer-adr-conflict.test.ts
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

// ── Agent files to check ──────────────────────────────────────────────────────

const REVIEWER_AGENTS = [
  "agents/accessibility-reviewer.md",
  "agents/api-design-reviewer.md",
  "agents/architecture-reviewer.md",
  "agents/data-schema-reviewer.md",
  "agents/database-schema-reviewer.md",
  "agents/infra-reviewer.md",
  "agents/observability-reviewer.md",
  "agents/performance-reviewer.md",
  "agents/security-reviewer.md",
  // Plus the roadmap-converge-reviewer
  "agents/roadmap-converge-reviewer.md",
];

/**
 * The FULL verbatim framing string per IC-002 (plan §1508).
 * Must be present as a substring in every file checked.
 */
const VERBATIM_FRAMING = "contradicts ADR-NNNN but worth reopening because";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ADR cross-check — all reviewer agents contain the FULL verbatim framing", () => {
  for (const agentPath of REVIEWER_AGENTS) {
    const fullPath = join(REPO_ROOT, agentPath);

    it(`${agentPath} exists`, () => {
      expect(existsSync(fullPath)).toBe(true);
    });

    it(`${agentPath} contains the FULL verbatim framing "${VERBATIM_FRAMING}"`, () => {
      const content = readFileSync(fullPath, "utf8");
      expect(content).toContain(VERBATIM_FRAMING);
    });

    it(`${agentPath} has an ADR Cross-Check section`, () => {
      const content = readFileSync(fullPath, "utf8");
      expect(content).toMatch(/## ADR Cross-Check/i);
    });

    it(`${agentPath} references docs/adr/ for ADR lookup`, () => {
      const content = readFileSync(fullPath, "utf8");
      expect(content).toContain("docs/adr/");
    });

    it(`${agentPath} states the full sentence including "worth reopening because" is mandatory`, () => {
      const content = readFileSync(fullPath, "utf8");
      // The phrase must appear — not just "contradicts" in isolation
      expect(content).toContain("worth reopening because");
    });
  }
});

// ── Consistency check: all files have the SAME framing ───────────────────────

describe("ADR framing consistency across all reviewer agents", () => {
  it("all 10 reviewer files contain exactly the same verbatim framing string", () => {
    const missingFiles: string[] = [];

    for (const agentPath of REVIEWER_AGENTS) {
      const fullPath = join(REPO_ROOT, agentPath);
      if (!existsSync(fullPath)) {
        missingFiles.push(agentPath);
        continue;
      }
      const content = readFileSync(fullPath, "utf8");
      if (!content.includes(VERBATIM_FRAMING)) {
        missingFiles.push(agentPath);
      }
    }

    expect(missingFiles).toHaveLength(0);
  });

  it("roadmap-converge-reviewer.md is explicitly included in the check", () => {
    expect(REVIEWER_AGENTS).toContain("agents/roadmap-converge-reviewer.md");
  });

  it("9 code reviewer agents are all included in the check", () => {
    const codeReviewers = REVIEWER_AGENTS.filter(
      (p) => p !== "agents/roadmap-converge-reviewer.md",
    );
    expect(codeReviewers).toHaveLength(9);
  });
});
