---
pageId: convergence-target-ct-06-vocab-diff
category: convergence-target
tags[4]: CT-06,vocab-diff,context.md,harness
lastUpdated: 2026-06-26T00:00:00Z
updatedAt: 2026-06-26T00:00:00Z
updatedBy: wiki-maintainer-agent
staleness: fresh
summary: CT-06 verifies that a fresh agent reading CONTEXT.md at session start uses ≥3 domain glossary terms in its first response, measured by scripts/context-vocab-diff.ts which parses glossary headings and counts verbatim matches in a candidate response file.
estimatedTokens: 580
bodySections[4]: Summary,Harness Implementation,Threshold Semantics,Passing and Failing
relatedFiles[2]:
  scripts/context-vocab-diff.ts
  CONTEXT.md
crossRefs[2]{pageId,relationship}:
  decision-context-decisions-split,relates-to
  feature-f18-mattpocock-skills-adoption,implemented-by
---

## Summary

CT-06 (F-18 Phase 1, sub-2) is the convergence target that validates the CONTEXT.md split's effectiveness: a fresh agent reading `CONTEXT.md` at session start must use domain terms (not generic words) in its first response. Because a real fresh-agent spawn cannot be automated from inside an existing Claude Code session, `scripts/context-vocab-diff.ts` provides a programmatic stand-in gate that is CI-checkable.

## Harness Implementation

`scripts/context-vocab-diff.ts` (exported function: `analyseVocabularyDiff`):

1. **Parse `CONTEXT.md` as a glossary.** Glossary entries are extracted from `## {term}` heading lines (post-frontmatter, post-intro). Each `##`-level heading becomes a glossary term.

2. **Read a `--response` file** containing a candidate first response and count how many distinct glossary terms appear verbatim (case-insensitive, whole-word match).

3. **Pass when `count >= --min`** (default 3, matching plan §903).

### Not-Yet-Applicable Mode

If `CONTEXT.md` has not yet been migrated (still a decisions-only file), the harness reports `glossaryTerms: 0` and treats the gate as "not yet applicable" rather than failing. This allows the script to be committed and exercised once the live migration lands.

### Exported Interface

```typescript
export interface VocabularyDiffResult {
  glossaryTerms: string[];
  matchedTerms: string[];
  count: number;
  threshold: number;
  passed: boolean;
  notYetApplicable?: boolean;
}

export function analyseVocabularyDiff(
  contextMd: string,
  responseText: string,
  minThreshold?: number
): VocabularyDiffResult
```

## Threshold Semantics

| `count` | Meaning |
|---------|---------|
| `>= min` (default 3) | Gate passes — the agent is using CONTEXT.md vocabulary, indicating the always-loaded glossary is effective. |
| `< min` | Gate fails — the agent's first response relies on generic language; CONTEXT.md terms are not loaded or not effective. |
| N/A (0 glossary terms) | Not yet applicable — CONTEXT.md has not been migrated; gate is skipped. |

The threshold of 3 was chosen as the minimum number of domain-specific terms that would distinguish Loom-aware output from generic English (verified across the plan §903 analysis).

## Passing and Failing

**Passing:** The candidate response contains ≥3 distinct verbatim glossary terms from `CONTEXT.md` (e.g., "FeedbackLoop", "TRDA", "Seam"). This is evidence that the glossary is shaping the agent's output vocabulary.

**Failing:** The candidate response uses only generic terms (e.g., "feedback", "loop", "test") without the domain-specific capitalisation and compound forms in the glossary. This indicates either the glossary is too short, too abstract, or not being loaded.

## Related Pages

- [CONTEXT.md / DECISIONS.md split](decision-context-decisions-split.md)
