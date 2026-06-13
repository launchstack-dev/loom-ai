/**
 * Tests for hooks/lib/wizard-interview.ts pure functions.
 *
 * Phase 0 has landed; the SlugValidationResult field name is `error` (locked
 * per ct-0-12). The WizardState shape uses `step` (locked per bt-4-22 et al.).
 * Phase 4 (this file) locks the behavioural surface that the `/loom-skill
 * create` command (Phase 8 wiring) depends on.
 *
 * Maps to spec IDs: ct-4-02, ct-0-10, ct-0-12,
 *                   bt-4-10 through bt-4-35
 */

import { describe, it, expect } from "vitest";

// Contract test ct-4-02: must import from hooks/lib/wizard-interview.ts
// (not from the markdown command file or any mock).
import {
  validateSkillSlug,
  detectExistingSkill,
  interviewStep,
  generateSkillMdContent,
  generateLibraryYamlEntry,
  yamlQuoteString,
  type WizardState,
  type WizardAnswers,
} from "../hooks/lib/wizard-interview.js";

// Silence the unused-type warning — re-exporting in a type-only namespace
// confirms the types are exported as named bindings (ct-0-10 contract surface)
// without forcing a runtime reference.
export type { WizardState, WizardAnswers };

// ---------------------------------------------------------------------------
// Contract: all five required functions exported (ct-0-10)
// ---------------------------------------------------------------------------

describe("wizard-interview — contract: exports", () => {
  // Spec: ct-0-10
  it("validateSkillSlug is a function", () => {
    expect(typeof validateSkillSlug).toBe("function");
  });

  it("detectExistingSkill is a function", () => {
    expect(typeof detectExistingSkill).toBe("function");
  });

  it("interviewStep is a function", () => {
    expect(typeof interviewStep).toBe("function");
  });

  it("generateSkillMdContent is a function", () => {
    expect(typeof generateSkillMdContent).toBe("function");
  });

  it("generateLibraryYamlEntry is a function", () => {
    expect(typeof generateLibraryYamlEntry).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// validateSkillSlug — valid slugs (bt-4-11, bt-4-12)
// ---------------------------------------------------------------------------

describe("validateSkillSlug — valid slugs", () => {
  // Spec: bt-4-11
  it('returns { valid: true } for "python-conventions"', () => {
    // Spec: bt-4-11
    const result = validateSkillSlug("python-conventions");
    expect(result.valid).toBe(true);
  });

  // Spec: bt-4-12
  it('returns { valid: true } for minimal slug "my-skill"', () => {
    // Spec: bt-4-12
    const result = validateSkillSlug("my-skill");
    expect(result.valid).toBe(true);
  });

  it('returns { valid: true } for single-word lowercase "myskill"', () => {
    // Additional: not in spec — single lowercase word is valid per [a-z][a-z0-9-]*
    const result = validateSkillSlug("myskill");
    expect(result.valid).toBe(true);
  });

  it('returns { valid: true } for slug with digits "skill2"', () => {
    // Additional: digits after first char are valid per [a-z][a-z0-9-]*
    const result = validateSkillSlug("skill2");
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateSkillSlug — invalid slugs (bt-4-13 through bt-4-18)
// ---------------------------------------------------------------------------

describe("validateSkillSlug — invalid slugs", () => {
  // Spec: bt-4-13 — space and uppercase
  it('returns { valid: false, error: string } for "My Skill" (space and uppercase)', () => {
    // Spec: bt-4-13
    const result = validateSkillSlug("My Skill");
    expect(result.valid).toBe(false);
    expect(typeof result.error).toBe("string");
    expect(result.error!.length).toBeGreaterThan(0);
  });

  // Spec: bt-4-14 — leading digit
  it('returns { valid: false, error: string } for "123bad" (leading digit)', () => {
    // Spec: bt-4-14
    const result = validateSkillSlug("123bad");
    expect(result.valid).toBe(false);
    expect(typeof result.error).toBe("string");
    expect(result.error!.length).toBeGreaterThan(0);
  });

  // Spec: bt-4-15 — underscore not allowed
  it('returns { valid: false, error: string } for "kebab_case_with_underscore" (underscore)', () => {
    // Spec: bt-4-15
    const result = validateSkillSlug("kebab_case_with_underscore");
    expect(result.valid).toBe(false);
    expect(typeof result.error).toBe("string");
    expect(result.error!.length).toBeGreaterThan(0);
  });

  // Spec: bt-4-16 — empty string
  it('returns { valid: false, error: string } for "" (empty string)', () => {
    // Spec: bt-4-16
    const result = validateSkillSlug("");
    expect(result.valid).toBe(false);
    expect(typeof result.error).toBe("string");
    expect(result.error!.length).toBeGreaterThan(0);
  });

  // Spec: bt-4-17 — leading dash
  it('returns { valid: false, error: string } for "-leading-dash" (must start with [a-z])', () => {
    // Spec: bt-4-17
    const result = validateSkillSlug("-leading-dash");
    expect(result.valid).toBe(false);
    expect(typeof result.error).toBe("string");
    expect(result.error!.length).toBeGreaterThan(0);
  });

  // Spec: bt-4-18 — trailing dash
  it('returns { valid: false, error: string } for "trailing-dash-" (trailing dash violates terminal constraint)', () => {
    // Spec: bt-4-18
    const result = validateSkillSlug("trailing-dash-");
    expect(result.valid).toBe(false);
    expect(typeof result.error).toBe("string");
    expect(result.error!.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// detectExistingSkill (bt-4-19, bt-4-20, bt-4-21)
// ---------------------------------------------------------------------------

const LIBRARY_YAML_WITH_PYTHON_CONVENTIONS = `\
catalog_version: 4
library:
  skills:
    - name: python-conventions
      description: Python ecosystem conventions
      source: skills/python-conventions/SKILL.md
`;

const LIBRARY_YAML_WITHOUT_PYTHON_CONVENTIONS = `\
catalog_version: 4
library:
  skills:
    - name: some-other-skill
      description: Another skill
      source: skills/other/SKILL.md
`;

describe("detectExistingSkill", () => {
  // Spec: bt-4-19 — name absent from library.skills → { exists: false }
  it('returns { exists: false } when "python-conventions" is absent from library.skills', () => {
    // Spec: bt-4-19
    const result = detectExistingSkill(LIBRARY_YAML_WITHOUT_PYTHON_CONVENTIONS, "python-conventions");
    expect(result.exists).toBe(false);
  });

  // Spec: bt-4-20 — name present in library.skills → { exists: true, entry: SkillEntry }
  it('returns { exists: true, entry } when "python-conventions" is present in library.skills', () => {
    // Spec: bt-4-20
    const result = detectExistingSkill(LIBRARY_YAML_WITH_PYTHON_CONVENTIONS, "python-conventions");
    expect(result.exists).toBe(true);
    expect(result.entry).toBeDefined();
    expect(result.entry?.name).toBe("python-conventions");
    // The entry MUST be enough to feed back into the idempotency path
    // (N-15 crash-recovery): description and source are required SkillEntry
    // fields so callers can present "already installed" diagnostics.
    expect(result.entry?.description).toBe("Python ecosystem conventions");
    expect(result.entry?.source).toBe("skills/python-conventions/SKILL.md");
  });

  // Spec: bt-4-21 — malformed YAML returns { exists: false, error: string } without throwing
  it("returns { exists: false, error: string } for malformed YAML without throwing", () => {
    // Spec: bt-4-21
    const malformedYaml = "catalog_version: {\n  broken: [unclosed";
    let result!: ReturnType<typeof detectExistingSkill>;
    expect(() => {
      result = detectExistingSkill(malformedYaml, "any-name");
    }).not.toThrow();
    expect(result.exists).toBe(false);
    expect(typeof result.error).toBe("string");
    expect(result.error!.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// interviewStep — state transitions (bt-4-22 through bt-4-28, bt-4-34, bt-4-35)
// ---------------------------------------------------------------------------

function makeState(step: string, answers: Record<string, unknown> = {}): any {
  return { step, answers };
}

describe("interviewStep — state transitions", () => {
  // Spec: bt-4-22 — ask-name → ask-description
  it('transitions from "ask-name" with valid slug to { step: "ask-description" } and captures answers.name', () => {
    // Spec: bt-4-22
    const state = makeState("ask-name");
    const next = interviewStep(state, "my-skill");
    expect(next.step).toBe("ask-description");
    expect(next.answers.name).toBe("my-skill");
  });

  // Spec: bt-4-23 — ask-description → ask-trigger-type
  it('transitions from "ask-description" to { step: "ask-trigger-type" } and captures answers.description', () => {
    // Spec: bt-4-23
    const state = makeState("ask-description", { name: "my-skill" });
    const next = interviewStep(state, "Enforces team conventions");
    expect(next.step).toBe("ask-trigger-type");
    expect(next.answers.description).toBe("Enforces team conventions");
  });

  // Spec: bt-4-24 — ask-trigger-type + "file-triggered" → ask-trigger-glob
  it('transitions from "ask-trigger-type" with "file-triggered" to { step: "ask-trigger-glob" }', () => {
    // Spec: bt-4-24
    const state = makeState("ask-trigger-type", { name: "my-skill", description: "..." });
    const next = interviewStep(state, "file-triggered");
    expect(next.step).toBe("ask-trigger-glob");
    expect(next.answers.triggerType).toBe("file-triggered");
  });

  // Spec: bt-4-25 — ask-trigger-type + "description-activated" skips glob step → ask-confirm
  it('transitions from "ask-trigger-type" with "description-activated" directly to { step: "ask-confirm" }', () => {
    // Spec: bt-4-25
    const state = makeState("ask-trigger-type", { name: "my-skill", description: "..." });
    const next = interviewStep(state, "description-activated");
    expect(next.step).toBe("ask-confirm");
    expect(next.answers.triggerType).toBe("description-activated");
  });

  // Spec: bt-4-28 — ask-trigger-glob + glob pattern → ask-confirm
  it('transitions from "ask-trigger-glob" with "**/*.ts" to { step: "ask-confirm", answers.triggers: ["**/*.ts"] }', () => {
    // Spec: bt-4-28
    const state = makeState("ask-trigger-glob", {
      name: "my-skill",
      description: "...",
      triggerType: "file-triggered",
    });
    const next = interviewStep(state, "**/*.ts");
    expect(next.step).toBe("ask-confirm");
    expect(Array.isArray(next.answers.triggers)).toBe(true);
    expect(next.answers.triggers).toContain("**/*.ts");
  });

  // Spec: bt-4-26 — ask-confirm + "y" → finalize
  it('transitions from "ask-confirm" with "y" to { step: "finalize" } without throwing and marks answers.confirmed', () => {
    // Spec: bt-4-26
    const state = makeState("ask-confirm", {
      name: "my-skill",
      description: "Enforces team conventions",
      triggerType: "description-activated",
    });
    let next!: WizardState;
    expect(() => {
      next = interviewStep(state, "y");
    }).not.toThrow();
    expect(next.step).toBe("finalize");
    expect(next.answers.confirmed).toBe(true);
  });

  // Spec: bt-4-27 — ask-confirm + "N" → restart at ask-name
  it('transitions from "ask-confirm" with "N" to { step: "ask-name", answers.revision: true }', () => {
    // Spec: bt-4-27
    const state = makeState("ask-confirm", {
      name: "my-skill",
      description: "...",
      triggerType: "description-activated",
    });
    const next = interviewStep(state, "N");
    expect(next.step).toBe("ask-name");
    expect(next.answers.revision).toBe(true);
  });

  // Spec: bt-4-34 — crash recovery: detectExistingSkill returns exists:true → ask-name prompts overwrite
  it("at ask-name: when existing skill detected, interviewStep prompts for overwrite rather than proceeding", () => {
    // Spec: bt-4-34
    // Simulate: state contains existingSkillDetected flag (set by caller after detectExistingSkill)
    const stateWithConflict = makeState("ask-name", { existingSkillDetected: true });
    const next = interviewStep(stateWithConflict, "python-conventions");
    // Must hold at ask-name with an error so the caller can prompt for
    // overwrite/abort. No duplicate entry is silently emitted.
    expect(next.step).toBe("ask-name");
    expect(typeof next.error).toBe("string");
    expect(next.error!.length).toBeGreaterThan(0);
  });

  // Spec: bt-4-35 — decline kit-registration at ask-kit-registration
  it('at "ask-kit-registration" with input "n": transitions to finalize with answers.registerInKit === false (CG-03)', () => {
    // Spec: bt-4-35
    const state = makeState("ask-kit-registration", {
      name: "my-skill",
      description: "...",
      triggerType: "description-activated",
      confirmed: true,
    });
    const next = interviewStep(state, "n");
    expect(next.step).toBe("finalize");
    expect(next.answers.registerInKit).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// generateSkillMdContent (bt-4-29, bt-4-30)
// ---------------------------------------------------------------------------

describe("generateSkillMdContent", () => {
  // Spec: bt-4-29 — file-triggered: YAML frontmatter includes triggers: containing "**/*.ts"
  it("produces YAML frontmatter with name:, description:, triggers: for file-triggered", () => {
    // Spec: bt-4-29
    const answers: WizardAnswers = {
      name: "my-skill",
      description: "Enforces coding conventions",
      triggerType: "file-triggered",
      triggers: ["**/*.ts"],
      confirmed: true,
    };
    const content = generateSkillMdContent(answers);
    expect(content).toContain("name: my-skill");
    expect(content).toContain('description: "Enforces coding conventions"');
    expect(content).toContain("triggers:");
    expect(content).toContain('- "**/*.ts"');
    // Frontmatter is delimited by leading and trailing `---`
    expect(content.startsWith("---\n")).toBe(true);
  });

  // Spec: bt-4-30 — description-activated: NO triggers: key at all
  it("produces YAML frontmatter WITHOUT triggers: key for description-activated", () => {
    // Spec: bt-4-30
    const answers: WizardAnswers = {
      name: "my-skill",
      description: "Enforces coding conventions",
      triggerType: "description-activated",
      confirmed: true,
    };
    const content = generateSkillMdContent(answers);
    expect(content).toContain("name: my-skill");
    expect(content).toContain('description: "Enforces coding conventions"');
    // triggers: key must be absent (not triggers: [] — fully omitted, per
    // bt-4-30 / bt-4-33). Use a non-anchored check too because the entire
    // document also must not contain a `triggers:` line anywhere.
    expect(content).not.toMatch(/^triggers:/m);
    expect(content).not.toContain("triggers:");
  });
});

// ---------------------------------------------------------------------------
// generateLibraryYamlEntry (bt-4-31, bt-4-32, bt-4-33)
// ---------------------------------------------------------------------------

describe("generateLibraryYamlEntry", () => {
  // Spec: bt-4-31 — produces a SkillEntry YAML fragment with name and description
  it("returns a YAML string fragment with name: and description: fields", () => {
    // Spec: bt-4-31
    const answers: WizardAnswers = {
      name: "my-skill",
      description: "Enforces coding conventions",
      triggerType: "description-activated",
      confirmed: true,
    };
    const entry = generateLibraryYamlEntry(answers);
    expect(typeof entry).toBe("string");
    expect(entry).toContain("name: my-skill");
    expect(entry).toContain('description: "Enforces coding conventions"');
    expect(entry).toContain("source: skills/my-skill/SKILL.md");
  });

  // Spec: bt-4-32 — file-triggered: includes triggers: array
  it("entry includes triggers: array when triggerType is file-triggered", () => {
    // Spec: bt-4-32
    const answers: WizardAnswers = {
      name: "my-skill",
      description: "Enforces coding conventions",
      triggerType: "file-triggered",
      triggers: ["**/*.ts", "**/*.tsx"],
      confirmed: true,
    };
    const entry = generateLibraryYamlEntry(answers);
    expect(typeof entry).toBe("string");
    expect(entry).toContain("triggers:");
    expect(entry).toContain('- "**/*.ts"');
    expect(entry).toContain('- "**/*.tsx"');
  });

  // Spec: bt-4-33 — description-activated: omits triggers: key (CG-10 partial closure)
  it("entry omits triggers: key when triggerType is description-activated", () => {
    // Spec: bt-4-33
    const answers: WizardAnswers = {
      name: "my-skill",
      description: "Enforces coding conventions",
      triggerType: "description-activated",
      confirmed: true,
    };
    const entry = generateLibraryYamlEntry(answers);
    expect(typeof entry).toBe("string");
    // The triggers key must be fully absent, not present as triggers: []
    expect(entry).not.toMatch(/triggers:/);
  });

  // AC: fragment is insertable verbatim under `library.skills:` at the correct
  // indent. The catalog uses 2-space indent for `library:` children, so list
  // items must start with 4 spaces (`    - name: ...`).
  it("the entry's first list item line starts with 4-space indent (insertable under library.skills:)", () => {
    const answers: WizardAnswers = {
      name: "my-skill",
      description: "Enforces coding conventions",
      triggerType: "description-activated",
      confirmed: true,
    };
    const entry = generateLibraryYamlEntry(answers);
    const firstLine = entry.split("\n").find((line) => line.trim().length > 0);
    expect(firstLine).toBe("    - name: my-skill");
  });

  it("the entry ends with a trailing newline so concatenation does not glue entries together", () => {
    const answers: WizardAnswers = {
      name: "my-skill",
      description: "Enforces coding conventions",
      triggerType: "description-activated",
      confirmed: true,
    };
    const entry = generateLibraryYamlEntry(answers);
    expect(entry.endsWith("\n")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// yamlQuoteString — YAML escaping (Finding #4)
// ---------------------------------------------------------------------------

describe("yamlQuoteString — YAML escaping", () => {
  it('wraps plain text in double-quotes (e.g., "Polars: faster DataFrames")', () => {
    const answers: WizardAnswers = {
      name: "my-skill",
      description: "Polars: faster DataFrames",
      triggerType: "description-activated",
      confirmed: true,
    };
    const content = generateSkillMdContent(answers);
    expect(content).toContain('description: "Polars: faster DataFrames"');
  });

  it('escapes embedded double-quote in description (she said \\"hi\\")', () => {
    const answers: WizardAnswers = {
      name: "my-skill",
      description: 'she said "hi"',
      triggerType: "description-activated",
      confirmed: true,
    };
    const content = generateSkillMdContent(answers);
    expect(content).toContain('description: "she said \\"hi\\""');
  });

  it("yamlQuoteString throws when value contains a newline character", () => {
    expect(() => yamlQuoteString("line one\nline two")).toThrow(/newlines/i);
  });

  it("interviewStep at ask-description returns error when description contains newline", () => {
    const state = makeState("ask-description", { name: "my-skill" });
    const next = interviewStep(state, "bad\nvalue");
    expect(next.step).toBe("ask-description");
    expect(typeof next.error).toBe("string");
    expect(next.error!.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// interviewStep coverage gaps (Finding #14)
// ---------------------------------------------------------------------------

describe("interviewStep — coverage gaps", () => {
  // Finding #14 test 1: ask-kit-registration with "y" → finalize + registerInKit: true
  it('at "ask-kit-registration" with input "y": transitions to finalize with answers.registerInKit === true', () => {
    const state = makeState("ask-kit-registration", {
      name: "my-skill",
      description: "Enforces team conventions",
      triggerType: "description-activated",
      confirmed: true,
    });
    const next = interviewStep(state, "y");
    expect(next.step).toBe("finalize");
    expect(next.answers.registerInKit).toBe(true);
  });

  // Finding #14 test 2: finalize is idempotent — returns state unchanged for any input
  it('at "finalize": interviewStep is idempotent — returns structurally equal state for any input', () => {
    const inputState: WizardState = {
      step: "finalize",
      answers: { confirmed: true, name: "x", description: "y" },
    };
    const next = interviewStep(inputState, "anything");
    expect(next).toEqual(inputState);
  });
});
