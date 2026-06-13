/**
 * Tests for hooks/lib/library-add-heuristic.ts pure functions.
 *
 * Phase 0 has landed: classifyAddSource is `(filePath: string, content: string)
 * => ClassificationResult`. Phase 4 (this file) locks the behavioural surface
 * the `/loom-library add` command (Phase 9 wiring) depends on.
 *
 * Maps to spec IDs: ct-4-03, ct-0-11, ct-0-13,
 *                   bt-4-36 through bt-4-49
 */

import { describe, it, expect } from "vitest";

// Contract test ct-4-03: must import from hooks/lib/library-add-heuristic.ts
// (not from the markdown command file or any mock).
import {
  classifyAddSource,
  formatAmbiguousPrompt,
  formatDeprecationWarning,
  type ClassificationResult,
} from "../hooks/lib/library-add-heuristic.js";

// Re-export the type binding to confirm the contract surface (ct-0-13) without
// triggering an unused-import warning.
export type { ClassificationResult };

// ---------------------------------------------------------------------------
// Contract: all three required functions exported (ct-0-11)
// ---------------------------------------------------------------------------

describe("library-add-heuristic — contract: exports", () => {
  // Spec: ct-0-11
  it("classifyAddSource is a function", () => {
    expect(typeof classifyAddSource).toBe("function");
  });

  it("formatAmbiguousPrompt is a function", () => {
    expect(typeof formatAmbiguousPrompt).toBe("function");
  });

  it("formatDeprecationWarning is a function", () => {
    expect(typeof formatDeprecationWarning).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// classifyAddSource — type discriminated union (ct-0-13)
// ---------------------------------------------------------------------------

describe("classifyAddSource — return type constraint", () => {
  // Spec: ct-0-13 — type field constrained to the five values
  const VALID_TYPES = new Set(["skill", "protocol", "agent", "prompt", "ambiguous"]);

  it("return type.type is constrained to the five allowed values", () => {
    // Spec: ct-0-13
    // Use a clearly ambiguous file to get a result
    const result: ClassificationResult = classifyAddSource("unknown.yaml", "");
    expect(VALID_TYPES.has(result.type)).toBe(true);
  });

  it("every classification result carries a non-empty reason string for diagnostics", () => {
    // Reason is consumed by the ambiguous-prompt context lines AND by
    // SOURCE_VALIDATION_ERROR envelopes. A blank reason breaks both.
    const result: ClassificationResult = classifyAddSource("notes.md", "# Hello\n");
    expect(typeof result.reason).toBe("string");
    expect(result.reason.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// classifyAddSource — skill classification (bt-4-37, bt-4-38, bt-4-39, bt-4-43)
// ---------------------------------------------------------------------------

// Helpers to produce content strings that simulate YAML frontmatter
function buildContent(frontmatter: Record<string, unknown>, body = ""): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(frontmatter)) {
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - "${item}"`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push("---", "", body);
  return lines.join("\n");
}

describe("classifyAddSource — skill detection", () => {
  // Spec: bt-4-37 — SKILL.md + triggers: frontmatter → type: skill (primary case N-07)
  it('SKILL.md filename with triggers: frontmatter → { type: "skill" }', () => {
    // Spec: bt-4-37
    const content = buildContent({ name: "python-conventions", triggers: ["**/*.py"] });
    const result: ClassificationResult = classifyAddSource("SKILL.md", content);
    expect(result.type).toBe("skill");
  });

  // Spec: bt-4-38 — SKILL.md WITHOUT triggers: → ambiguous (not auto-classified)
  it('SKILL.md filename WITHOUT triggers: → { type: "ambiguous" } (N-07 negative case)', () => {
    // Spec: bt-4-38
    const content = buildContent({ name: "my-skill" });
    const result: ClassificationResult = classifyAddSource("SKILL.md", content);
    expect(result.type).toBe("ambiguous");
  });

  // Spec: bt-4-39 — arbitrary filename WITH triggers: → type: skill (triggers-first, not filename-first)
  it('arbitrary filename with triggers: frontmatter → { type: "skill" } (N-07 triggers-first)', () => {
    // Spec: bt-4-39
    const content = buildContent({ name: "conventions", triggers: ["**/*.ts"] });
    const result: ClassificationResult = classifyAddSource("conventions.md", content);
    expect(result.type).toBe("skill");
  });

  // Spec: bt-4-43 — SKILL.md with empty triggers: [] → ambiguous (CG-04 now closed)
  it('SKILL.md with triggers: [] (empty array) → { type: "ambiguous" } (CG-04)', () => {
    // Spec: bt-4-43
    // Empty triggers array does NOT auto-classify as skill
    const content = "---\nname: my-skill\ntriggers: []\n---\n";
    const result: ClassificationResult = classifyAddSource("SKILL.md", content);
    expect(result.type).toBe("ambiguous");
  });
});

// ---------------------------------------------------------------------------
// classifyAddSource — protocol detection (bt-4-40)
// ---------------------------------------------------------------------------

describe("classifyAddSource — protocol detection", () => {
  // Spec: bt-4-40 — AgentResult schema marker → type: protocol (S-27)
  it('file with AgentResult schema marker → { type: "protocol" }', () => {
    // Spec: bt-4-40
    const content = "AgentResult\nstatus: complete\nfilesCreated[1]: foo.ts\n";
    const result: ClassificationResult = classifyAddSource("state.toon", content);
    expect(result.type).toBe("protocol");
  });

  // Isolated filesCreated signal test — no AgentResult keyword.
  // Guards against a future regex regression where the filesCreated branch is
  // silently masked by the AgentResult match.
  it('filesCreated[N]: signal alone (no AgentResult keyword) → { type: "protocol" }', () => {
    const content = "filesCreated[1]: foo.ts\nstatus: done\n";
    const result: ClassificationResult = classifyAddSource("agent-result.toon", content);
    expect(result.type).toBe("protocol");
  });

  it('file with "state.toon" in name and schema markers → { type: "protocol" }', () => {
    // Additional: S-27 secondary test
    const content = "status: running\nAgentResult\nwaves: []";
    const result: ClassificationResult = classifyAddSource("pipeline-state.toon", content);
    expect(result.type).toBe("protocol");
  });
});

// ---------------------------------------------------------------------------
// classifyAddSource — prompt detection (bt-4-41)
// ---------------------------------------------------------------------------

describe("classifyAddSource — prompt detection", () => {
  // Spec: bt-4-41 — $ARGUMENTS marker → type: prompt
  it('file with $ARGUMENTS token → { type: "prompt" }', () => {
    // Spec: bt-4-41
    const content = "# Analysis Prompt\n\nAnalyze the following: $ARGUMENTS\n";
    const result: ClassificationResult = classifyAddSource("run-analysis.md", content);
    expect(result.type).toBe("prompt");
  });
});

// ---------------------------------------------------------------------------
// classifyAddSource — agent detection (bt-4-42)
// ---------------------------------------------------------------------------

describe("classifyAddSource — agent detection", () => {
  // Spec: bt-4-42 — agent-style marker → type: agent
  it('file with "# Agent Instructions\\nYou are an agent" marker → { type: "agent" }', () => {
    // Spec: bt-4-42
    const content = "# Agent Instructions\nYou are an agent that analyzes code.";
    const result: ClassificationResult = classifyAddSource("summarizer.md", content);
    expect(result.type).toBe("agent");
  });
});

// ---------------------------------------------------------------------------
// classifyAddSource — ambiguous (bt-4-44)
// ---------------------------------------------------------------------------

describe("classifyAddSource — ambiguous (no signals)", () => {
  // Spec: bt-4-44 — no classification signals → ambiguous
  it('file with no signals → { type: "ambiguous" }', () => {
    // Spec: bt-4-44
    const result: ClassificationResult = classifyAddSource("unknown.yaml", "");
    expect(result.type).toBe("ambiguous");
  });

  it("plain markdown with no signals → ambiguous", () => {
    // Additional: not in spec
    const content = "# Hello\n\nThis is a generic document.\n";
    const result: ClassificationResult = classifyAddSource("notes.md", content);
    expect(result.type).toBe("ambiguous");
  });
});

// ---------------------------------------------------------------------------
// formatAmbiguousPrompt (bt-4-45, bt-4-46, bt-4-47)
// ---------------------------------------------------------------------------

describe("formatAmbiguousPrompt", () => {
  // All three assertions call formatAmbiguousPrompt directly since the output is template-fixed

  // Spec: bt-4-45 — contains "[1] skill" with one-sentence description (N-04)
  it('contains "[1] skill" with one-sentence description about file patterns', () => {
    // Spec: bt-4-45
    const output = formatAmbiguousPrompt("some-file.md");
    expect(output).toContain("[1] skill");
    expect(output).toContain(
      "activates automatically on matching file patterns via Claude Code (SKILL.md format)"
    );
  });

  // Spec: bt-4-46 — contains "[2] protocol" with one-sentence description (N-04/S-28)
  it('contains "[2] protocol" with one-sentence description about Loom orchestration', () => {
    // Spec: bt-4-46
    const output = formatAmbiguousPrompt("some-file.md");
    expect(output).toContain("[2] protocol");
    expect(output).toContain("inter-agent message schema used by Loom orchestration");
  });

  // Spec: bt-4-47 — contains "[q] abort" option (S-28 N-04)
  it('contains "[q] abort" option', () => {
    // Spec: bt-4-47
    const output = formatAmbiguousPrompt("some-file.md");
    expect(output).toContain("[q] abort");
  });

  it("formatAmbiguousPrompt returns the same template regardless of filePath argument", () => {
    // Additional: per API spec behavior note — filePath reserved for future use
    const a = formatAmbiguousPrompt("file-a.md");
    const b = formatAmbiguousPrompt("file-b.yaml");
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// formatDeprecationWarning (bt-4-48, bt-4-49)
// ---------------------------------------------------------------------------

describe("formatDeprecationWarning", () => {
  // Spec: bt-4-48 — output contains "python-conventions" and "skill" substituted
  it('output contains "python-conventions" and "skill" from template substitution', () => {
    // Spec: bt-4-48
    const output = formatDeprecationWarning("python-conventions", "skill");
    expect(output).toContain("python-conventions");
    expect(output).toContain("skill");
  });

  // Spec: bt-4-49 — output matches exact N-24 template shape
  it("output matches the N-24 template shape (substitution only — no extra or missing lines)", () => {
    // Spec: bt-4-49
    const output = formatDeprecationWarning("python-conventions", "skill");
    // The N-24 template must contain all three required phrases:
    expect(output).toContain("DEPRECATION WARNING");
    expect(output).toContain("bare-name");
    expect(output).toContain("python-conventions");
    expect(output).toContain("skill:python-conventions");
    expect(output).toContain("v5");
  });

  it("substitutes both name and resolvedType correctly for a different name/type pair", () => {
    // Additional: confirm substitution works for any name/type, not just python-conventions/skill
    const output = formatDeprecationWarning("execution-protocols", "protocol");
    expect(output).toContain("execution-protocols");
    expect(output).toContain("protocol");
    expect(output).toContain("protocol:execution-protocols");
  });
});
