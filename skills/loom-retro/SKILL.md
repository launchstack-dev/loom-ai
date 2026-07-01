---
name: loom-retro
description: Retrospective ceremony that reads git activity + closed PRs + planning artifacts and appends structured insights to .loom/learnings.toon and .loom/regressions.toon. Also suggests ROADMAP mutations when recurring themes emerge.
---

# /loom-retro — Retrospective Ceremony

Run this at the end of a milestone, sprint, or notable body of work to codify what was learned. The output is durable: it lands in Loom's append-only learnings and regressions files where downstream reviewer agents pick it up.

## Inputs

- **Window** (optional): `--since <ref>` (git ref or ISO date). Defaults to the last 14 days.
- **Scope** (optional): `--plan <path>` to focus on one plan; otherwise scans all recently modified `planning/plans/PLAN-*.md`.

## 5-Phase Workflow

### Phase 1 — Gather activity

Read (do NOT modify) the following signals for the window:

- `git log --since=<window> --pretty=format:'%h %ad %s' --date=short`
- `gh pr list --state closed --search 'closed:>=<date>' --json number,title,mergedAt,body,files`
- Recently modified planning artifacts: `planning/plans/PLAN-*.md`, `planning/ROADMAP*.md`, `.plan-execution/state.toon`, `.plan-execution/pipeline-state.toon`.
- Existing `.loom/learnings.toon` and `.loom/regressions.toon` (to avoid duplicates).

Emit a compact activity summary to stdout: PR count, commit count, plan count, per-plan status.

### Phase 2 — Structured interview

Prompt the operator (or fill from context if running unattended) through 3 questions per plan or milestone:

1. **What worked?** — habits, patterns, tools, or agent choices that produced good outcomes.
2. **What didn't?** — specific frictions, wasted iterations, or surprising breakages.
3. **What to change?** — the concrete next-behavior delta. Must be actionable.

Capture free-text responses. Do NOT paraphrase; carry the operator's words.

### Phase 3 — Extract learnings (with confidence scores)

For each "what worked" or "what to change" that meets the threshold, append a row to `.loom/learnings.toon` conforming to `protocols/learnings.schema.toon`:

```toon
learnings[N]{id,key,description,confidence,sourcePlan,sourceDate,domain,tags}:
  L-NNN,<kebab-key>,"<one-sentence lesson>",<1-10>,<plan-path or manual>,<YYYY-MM-DD>,<domain>,"<comma-tags>"
```

Confidence rubric (per `protocols/agent-result.schema.md` § Confidence Semantics):
- **9–10** — repeated across ≥3 signals or explicitly ratified by the operator as invariant.
- **7–8** — observed twice or once with strong operator conviction.
- **5–6** — single observation; likely but not proven.
- **1–4** — hunch. Store for offline analysis; downstream consumers will suppress.

Rules:
- Append-only. Never mutate historic rows.
- `key` MUST be kebab-case and unique per file (check existing rows).
- `id` is `L-NNN` sequential — read the highest existing `L-` id and increment.
- Atomic write: write to `.loom/learnings.toon.tmp`, then rename.

### Phase 4 — Extract regressions (anti-patterns)

For each "what didn't" that names a repeatable failure mode, append a row to `.loom/regressions.toon` conforming to `protocols/regressions.schema.toon`:

```toon
regressions[N]{id,title,description,detectedDate,sourceIncident,antiPattern,detectionRegex}:
  R-NNN,"<short title>","<what went wrong>",<YYYY-MM-DD>,"<PR # or plan path>","<snippet>","<regex or empty>"
```

Rules:
- Append-only. `id` is `R-NNN` sequential.
- Provide a `detectionRegex` only when you can express the anti-pattern as a valid JS/ECMA regex; otherwise leave the empty string. Reviewer agents cite the row by name in their preambles either way.
- Atomic write via `.tmp` + rename.

### Phase 5 — Suggest ROADMAP mutations

Cross-tabulate this retro against the last 2 retros (if any). When ≥2 retros share a theme (e.g., "scenarios are duplicated across features", "convergence never terminates on Tier-3 stories"), emit a suggestion block to stdout:

```
Recommended ROADMAP mutation:
  Feature: F-NN <name>
  Rationale: <cite the recurring learning IDs>
  Suggested action: <one sentence for /loom-roadmap:mutate>
```

Do NOT auto-mutate the ROADMAP; the operator invokes `/loom-roadmap:mutate` if they concur. This is per `protocols/loom-decision-principles.md`: roadmap changes are user-challenge, never mechanical.

## Output Summary

At completion, print a TOON block summarizing what was written:

```toon
retro:
  date: <YYYY-MM-DD>
  windowStart: <YYYY-MM-DD>
  windowEnd: <YYYY-MM-DD>
  learningsAdded: <N>
  regressionsAdded: <N>
  roadmapSuggestions: <N>
```

## Contracts Referenced

- `protocols/learnings.schema.toon`
- `protocols/regressions.schema.toon`
- `protocols/agent-result.schema.md` (§ Confidence Semantics)
- `protocols/loom-decision-principles.md` (user-challenge boundary for ROADMAP mutations)
- `protocols/retrospective-artifact.schema.toon` (RetrospectiveArtifact envelope, if emitting one)
