/**
 * Phase 0: protocols/skill-authoring.md ships the 6 principle section
 * headings AND each carries a non-empty `noOpTestRule:` line.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DOC_PATH = resolve(__dirname, "../../protocols/skill-authoring.md");

const PRINCIPLES = [
  "predictability",
  "leading-word",
  "completion-criterion",
  "premature-completion",
  "sediment",
  "duplication",
];

describe("protocols/skill-authoring.md", () => {
  const content = readFileSync(DOC_PATH, "utf8");

  it("documents all 6 SkillAuthoringPrinciple rows as section headings", () => {
    for (const name of PRINCIPLES) {
      const re = new RegExp(`^##\\s+Principle\\s+\\d+\\s+—\\s+${name}\\b`, "m");
      expect(re.test(content)).toBe(true);
    }
  });

  it("each principle has a non-empty noOpTestRule", () => {
    // Split body by principle headings, then assert each section contains a
    // **noOpTestRule:** marker followed by non-empty body.
    for (const name of PRINCIPLES) {
      const section = extractPrincipleSection(content, name);
      const m = /\*\*noOpTestRule:\*\*\s+(.+)/.exec(section);
      expect(m, `principle ${name} missing noOpTestRule`).not.toBeNull();
      expect(m![1].trim().length).toBeGreaterThan(0);
    }
  });

  it("includes the model-invoked vs user-invoked trade-off subsection", () => {
    expect(content).toMatch(/##\s+Model-invoked vs user-invoked trade-off/);
  });
});

function extractPrincipleSection(content: string, name: string): string {
  const re = new RegExp(
    `^##\\s+Principle\\s+\\d+\\s+—\\s+${name}\\b([\\s\\S]*?)(?=^##\\s|\\Z)`,
    "m",
  );
  const m = re.exec(content);
  if (!m) throw new Error(`section for ${name} not found`);
  return m[1];
}
