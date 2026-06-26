---
pageId: protocol-grilling
category: protocol
tags[5]: grilling,GR-01,12-question-cap,skip-escape,interactive-session
lastUpdated: 2026-06-26T00:00:00Z
updatedAt: 2026-06-26T00:00:00Z
updatedBy: wiki-maintainer-agent
staleness: fresh
summary: Defines the grilling discipline — 5 core rules (GR-01..GR-05) for structured one-question-at-a-time elicitation with a 12-question hard cap, [N of 12] progress indicator, /skip escape, and STUCK_AT_GRILL_CAP error code.
estimatedTokens: 950
bodySections[5]: Summary,Five Core Rules,12-Question Cap,Skip Escape,Session Log Format
relatedFiles[1]:
  protocols/grilling.md
crossRefs[3]{pageId,relationship}:
  command-loom-which,implements
  feature-f18-mattpocock-skills-adoption,implemented-by
  protocol-feedback-loop,relates-to
---

## Summary

`protocols/grilling.md` (F-18 Phase E, sub-17) governs how Loom skills extract information from a human operator: one question per turn, a recommendation with every question, full branch enumeration, codebase-first inference, and a hard 12-question cap. Compliance is binary — all five rules must be honored for every question asked.

Attributed to Matt Pocock's grilling discipline (MIT License, per `NOTICE`).

## Five Core Rules

```
rules[5]{id,rule}:
  GR-01,"Ask exactly one question per turn — never bundle multiple decisions into a single prompt."
  GR-02,"Recommend an answer with every question — surface the default the grilling agent would pick if pressed."
  GR-03,"Walk every branch — never collapse a multi-branch decision into the most likely path; enumerate alternatives before recommending."
  GR-04,"Prefer codebase exploration over asking — read files first; only ask when the answer cannot be inferred from existing artifacts."
  GR-05,"Cap the session — full content (12-question cap, /skip escape, progress indicator) lands in Phase 5a; the cap exists from day one."
```

## 12-Question Cap (GR-05)

A grilling session MUST NOT exceed **12 questions**. When a 13th question would be asked, the skill emits the following literal string and halts:

```
STUCK_AT_GRILL_CAP: This grilling session has reached the 12-question limit. No further questions can be asked. Use /skip to exit or answer the last open question to proceed.
```

Error code: `STUCK_AT_GRILL_CAP`. Machine-readable (starts with the error code).

### Progress Indicator

Every question prompt MUST begin with `[N of 12]` (1-based, no leading spaces, no decorators) as the very first token on the line:

```
[1 of 12] What kind of task is this? (bug / feature / design / planning / audit / unclear)
  Recommendation: feature
```

## `/skip` Escape

The operator may type `/skip` at any point during a session to advance past the current question without providing an answer. The skipped question is recorded in the session log with `skipped: true`. The session continues to the next question (if any remain under the cap).

## Model-Invoked Skill Guidance

A model-invoked skill MAY infer the answer silently (without asking) when:
1. The question is covered by GR-04 (answer derivable from codebase artifacts without ambiguity).
2. Inference confidence is ≥ 90%.
3. The inferred answer is recorded in the session log with `inferredSilently: true`.

Otherwise the skill MUST escalate to user-invoked grilling.

## Session Log Format

Every grilling session writes an atomic log to `.plan-execution/ephemeral/grilling-session-{sessionId}.toon`:

```toon
sessionId: {uuid}
skill: {invoking skill name}
startedAt: {ISO-8601}
endedAt: {ISO-8601 or null}
capFired: {true|false}
skipCount: {integer}
totalQuestions: {integer, ≤ 12}

questionLog[N]{index,text,answer,skipped,inferredSilently,at}:
  1,{question text},{answer or null},{true|false},{true|false},{ISO-8601}
```

## Skills Honoring This Protocol

- `/loom-which` — decision-tree router
- `/loom-roadmap converge` — roadmap Q&A refinement
- `/loom-plan` — scope-ambiguity resolution
- `/loom-bugfix` — reproduction-step confirmation

## Related Pages

- [/loom-which command](command-loom-which.md)
