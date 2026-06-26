# Grilling Discipline

This protocol governs the grilling discipline Loom skills use when extracting
information from a human operator: how to ask questions, when to recommend
defaults, when to walk branches, and when to stop.

Every Loom skill or agent that enters an interactive information-gathering
session MUST follow this protocol.  Compliance is binary: either all five core
rules are honored for every question asked, or the session is non-compliant.

---

## Core Rules

The five rules below are the minimum compliance surface.  They MUST appear
verbatim in every `protocols/grilling.md` file — they are the forward-compat
assertion that Phase 1+ code compiles against.

```toon
rules[5]{id,rule}:
  GR-01,"Ask exactly one question per turn — never bundle multiple decisions into a single prompt."
  GR-02,"Recommend an answer with every question — surface the default the grilling agent would pick if pressed."
  GR-03,"Walk every branch — never collapse a multi-branch decision into the most likely path; enumerate alternatives before recommending."
  GR-04,"Prefer codebase exploration over asking — read files first; only ask when the answer cannot be inferred from existing artifacts."
  GR-05,"Cap the session — full content (12-question cap, /skip escape, progress indicator) lands in Phase 5a; the cap exists from day one."
```

---

## 12-Question Session Cap (GR-05 extension)

A grilling session MUST NOT exceed **12 questions**.  This is a hard cap — the
session terminates automatically when question 13 would be asked.

### Cap message

When a 13th question is attempted, the skill MUST emit the following literal
string (exact whitespace and punctuation) and halt without asking the question:

```
STUCK_AT_GRILL_CAP: This grilling session has reached the 12-question limit. No further questions can be asked. Use /skip to exit or answer the last open question to proceed.
```

Error code: `STUCK_AT_GRILL_CAP`

The cap message is machine-readable (starts with the error code) so downstream
tooling can detect it without regex heuristics.

### Why 12?

Twelve questions is enough to fully resolve any decision tree this protocol
governs (verified across all Phase 1+ `/loom-which` decision trees).  More than
12 questions indicates either a loop in the decision tree (bug) or a scope that
belongs in a planning document rather than an interactive session.

---

## Progress Indicator

Every question prompt MUST begin with a bracketed progress indicator in the
exact format:

```
[N of 12]
```

where `N` is the 1-based index of the current question (1..12).

Examples:

```
[1 of 12] What kind of task is this? (bug / feature / design / planning / audit / unclear)
  Recommendation: feature

[6 of 12] Does the change touch public API surface?
  Recommendation: yes

[12 of 12] Should we gate deployment behind a feature flag?
  Recommendation: yes
```

The indicator `[12 of 12]` marks the final allowed question.  After the operator
answers (or `/skip`s) question 12, the session ends normally.  If the skill
attempts to ask question 13, the cap fires instead.

The indicator MUST be the very first token on the line — no leading spaces,
no decorators, no emoji prefix.

---

## `/skip` Escape Command

At any point during a grilling session, the operator may type `/skip` to
advance past the current question without providing an answer.

Behavior:
- The current question is recorded in the session log with `skipped: true`.
- The session continues to the next question (if any remain under the cap).
- If `/skip` is entered when there are no more questions, the session ends
  normally (equivalent to completing the session).
- `/skip` is reachable at any point **before** question 13 is attempted.
  Once the cap fires, `/skip` is no longer meaningful (the session is already
  terminating).

Session log entry for a skipped question:

```toon
questionLog[N]{index,text,answer,skipped,at}:
  {N},{question text},{null},true,{ISO-8601 timestamp}
```

---

## Model-Invocation Guidance

### When a model-invoked skill MAY skip the prompt and infer silently

A model-invoked skill (called by an orchestrator agent rather than a human
operator) MAY infer the answer to a question silently — without asking — when
ALL of the following hold:

1. The question is covered by GR-04 (the answer is derivable from codebase
   artifacts without ambiguity).
2. The inference confidence is ≥ 90 % (the model would give the same answer
   on 9 out of 10 runs given the same context).
3. The inferred answer is recorded in the session log with `inferredSilently: true`.

When any of these conditions fails, the skill MUST escalate to user-invoked
grilling (surface the question to the operator).

### When escalation to user-invoked grilling is mandatory

- Confidence < 90 %.
- The answer has irreversible consequences (e.g., deleting data, changing a
  public API contract, selecting a billing tier).
- The operator has previously overridden an inferred answer in the same session.

---

## Invoking Skills that Use This Protocol

The following Loom skills honor the grilling discipline:

- `/loom-which` — routes the operator to the right command.
- `/loom-roadmap converge` — refines a roadmap through structured Q&A.
- `/loom-plan` — resolves scope ambiguity before plan creation.
- `/loom-bugfix` — confirms reproduction steps and impact before generating a fix.

When invoking these skills programmatically, pass `grillingConfig: { cap: 12, skipEnabled: true }` in the invocation context.  The skill reads this config to configure its session; the defaults match this protocol.

---

## Session Log Format

Every grilling session MUST produce a session log written atomically to
`.plan-execution/ephemeral/grilling-session-{sessionId}.toon`:

```toon
sessionId: {uuid or short hash}
skill: {invoking skill name, e.g. loom-which}
startedAt: {ISO-8601}
endedAt: {ISO-8601 or null if in progress}
capFired: {true | false}
skipCount: {integer}
totalQuestions: {integer, ≤ 12}

questionLog[N]{index,text,answer,skipped,inferredSilently,at}:
  1,{question text},{answer or null},{true|false},{true|false},{ISO-8601}
  ...
```

---

## Compliance Checklist

A skill passes grilling-discipline review if and only if:

- [ ] GR-01: Every turn asks exactly one question.
- [ ] GR-02: Every question carries a visible recommendation.
- [ ] GR-03: Multi-branch decisions enumerate all alternatives before recommending.
- [ ] GR-04: Files are read before asking (evidence of codebase exploration in the session log).
- [ ] GR-05: The session terminates at or before question 12; the cap message fires verbatim on attempt 13.
- [ ] Progress indicator `[N of 12]` is the first token on every question line.
- [ ] `/skip` is honored at any question before the cap fires.
- [ ] Cap message starts with `STUCK_AT_GRILL_CAP:` exactly.

---

*This file is the canonical specification.  Tests in
`tests/protocols/grilling-12cap.test.ts` assert the structure of this document
and the cap/progress/skip rules defined herein.*
