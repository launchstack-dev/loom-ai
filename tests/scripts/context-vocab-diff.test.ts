/**
 * CT-06 vocabulary-diff harness — pure-function unit tests.
 */
import { describe, it, expect } from "vitest";
import {
  analyseVocabularyDiff,
  extractGlossaryTerms,
} from "../../scripts/context-vocab-diff.js";

const GLOSSARY_CONTEXT = `# CONTEXT.md

Project glossary.

## Loop
A tight, deterministic, red-capable feedback signal.

## Adapter
Translates an interface to a driver-specific shape.

## Seam
A planned point of substitution between modules.

## Tracer Bullet
A vertical end-to-end slice exercised before broad implementation.
`;

const DECISIONS_ONLY_CONTEXT = `# Project Decisions

Locked decisions.

## D-01: Reviewer Agent Registration
Some decision content.

## D-02: Convergence Pattern Scope
Some decision content.
`;

describe("extractGlossaryTerms", () => {
  it("extracts term headings from a glossary view", () => {
    const terms = extractGlossaryTerms(GLOSSARY_CONTEXT);
    expect(terms).toEqual(["Loop", "Adapter", "Seam", "Tracer Bullet"]);
  });

  it("skips D-NN decision headings", () => {
    const terms = extractGlossaryTerms(DECISIONS_ONLY_CONTEXT);
    expect(terms).toEqual([]);
  });

  it("skips section dividers like 'Project Decisions'", () => {
    const content = `# X
## Project Decisions
## Foo
`;
    expect(extractGlossaryTerms(content)).toEqual(["Foo"]);
  });
});

describe("analyseVocabularyDiff", () => {
  it("passes when response uses ≥3 glossary terms", () => {
    const response =
      "The Loop carries the red signal; the Adapter translates it; we cut a Tracer Bullet across the Seam.";
    const r = analyseVocabularyDiff(GLOSSARY_CONTEXT, response, 3);
    expect(r.status).toBe("passed");
    expect(r.passed).toBe(true);
    expect(r.count).toBe(4);
    expect(r.matchedTerms.sort()).toEqual(
      ["Adapter", "Loop", "Seam", "Tracer Bullet"].sort(),
    );
  });

  it("fails when response uses < threshold glossary terms", () => {
    const response = "Generic words about software with no domain terms.";
    const r = analyseVocabularyDiff(GLOSSARY_CONTEXT, response, 3);
    expect(r.status).toBe("failed");
    expect(r.passed).toBe(false);
    expect(r.count).toBe(0);
  });

  it("is case-insensitive and whole-word", () => {
    const response = "The loop and the adapter — plus a seam.";
    const r = analyseVocabularyDiff(GLOSSARY_CONTEXT, response, 3);
    expect(r.passed).toBe(true);
    expect(r.matchedTerms.sort()).toEqual(["Adapter", "Loop", "Seam"].sort());
  });

  it("does NOT match a glossary term embedded in a longer word", () => {
    // "Adapterized" should not count as "Adapter"
    const response = "The Adapterized layer wraps the Loopholes near a Seamstress.";
    const r = analyseVocabularyDiff(GLOSSARY_CONTEXT, response, 1);
    expect(r.count).toBe(0);
  });

  it("returns 'not-applicable' when CONTEXT.md has no glossary entries", () => {
    const r = analyseVocabularyDiff(DECISIONS_ONLY_CONTEXT, "any response", 3);
    expect(r.status).toBe("not-applicable");
    expect(r.glossaryTerms.length).toBe(0);
  });
});
