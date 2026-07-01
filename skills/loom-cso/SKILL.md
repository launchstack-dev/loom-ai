---
name: loom-cso
description: "Chief Security Officer plan/code audit — two-tier: daily 8/10 gate + monthly 2/10 deep-scan with trend tracking."
---

# /loom-cso — Chief Security Officer Two-Tier Security Review (M-07 F-19)

`/loom-cso` audits the working tree and current plan for security regressions
across seven lenses, tracks scores over time, and blocks PRs when the fast
gate detects a regression.

## Two modes

| Mode | Budget | Threshold | Purpose |
|------|--------|-----------|---------|
| `daily`   | ~2 min  | **8/10 gate** — block PR when the new score is lower than the most-recent history entry, or when it drops below 8/10. | Fast pre-PR check invoked automatically by `/loom-git pr` and `/loom-auto`. |
| `monthly` | ~30 min | **2/10 exhaustive** — surface even low-severity, low-confidence findings. | Deep periodic scan; results feed the CSO retro. |

`daily` is intended to run cheaply on every PR; `monthly` runs on a schedule
(see `/loom-schedule`) or manually before a release.

## Seven review lenses

Every finding must carry `confidence: 1-10`. Findings under `daily` are
filtered to `confidence >= 8`; `monthly` keeps everything down to `confidence
>= 2`.

1. **Secrets in code** — regex + entropy sweep of the diff (daily) or full
   tree (monthly). Flags AWS/GCP/GH/Stripe/OpenAI keys, private-key PEM
   blocks, and `.env`-shaped literals.
2. **Dependency vulnerabilities** — runs `bun audit` when available, falling
   back to `npm audit --json`; if `bunx snyk` is installed and authenticated,
   also runs `bunx snyk test --json` and merges the findings.
3. **Auth boundaries** — every network handler / route / RPC entrypoint must
   have an explicit auth check upstream. Missing checks are flagged with a
   file:line pointer.
4. **Input validation** — user-controlled inputs (query params, body, headers,
   env, argv, stdin) must hit a validator (`zod`, `valibot`, hand-rolled
   guard) before reaching business logic.
5. **LLM trust boundaries** — delegates to
   `agents/code-llm-trust-review-agent.md` (shipped by Phase 5 M-05 F-15).
   The agent's findings are merged in with their original `confidence`
   scores.
6. **File permissions** — new files with `chmod 777`, world-writable dirs, or
   `.env`-family files not covered by `.gitignore`.
7. **CI/CD supply chain** — third-party GitHub Actions pinned by SHA (not tag
   or `@main`), workflow `permissions:` blocks present, and `npm ci` /
   `bun install --frozen-lockfile` used in CI (never `npm install`).

## Trend tracking — `.loom/security-history.toon`

Append-only history file. Schema mirrors `.loom/health-history.toon`:

```
schemaVersion: 1
entries[N]{timestamp,mode,score,confidenceFloor,secretsCount,depVulnCount,authGaps,inputValidationGaps,llmTrustIssues,filePermIssues,cicdIssues,gitSha}:
  2026-06-30T15:00:00Z,daily,9,8,0,0,0,0,0,0,0,abc1234
```

- `score`: integer 0-10 (10 = clean).
- `confidenceFloor`: 8 for `daily`, 2 for `monthly`.
- Every column beyond `gitSha` is a per-lens count.
- Writes are atomic: `.toon.tmp` then rename.

## Fast-gate exit semantics

`scripts/loom-cso.ts daily` (invoked by the command) exits **non-zero** when
either:

1. The new `score` is strictly less than the most-recent `daily` entry in
   `.loom/security-history.toon`, or
2. The new `score` is below 8/10 in absolute terms.

Otherwise it exits 0 and appends the new entry.

## Output envelope

```
mode: daily
score: 9
previousScore: 9
delta: 0
gateResult: pass
findings[N]{lens,severity,confidence,file,line,description,suggestedFix}:
  secrets,high,10,src/foo.ts,42,AWS access key literal,Move to env + rotate
```

`gateResult` is one of `pass`, `block` (regression), or `warn` (below floor
but not a regression).

## Dependencies

- Phase 5 F-15 `agents/code-llm-trust-review-agent.md` — LLM lens delegate.
- Phase 2 F-05 `.loom/health-history.toon` — schema precedent for the history
  file.
- Optional: `bun audit`, `npm audit`, `bunx snyk`, `bunx gitleaks`. Missing
  tools degrade gracefully and are noted in the output with `confidence`
  reduced by 2.

## Non-goals

- No autofix. `/loom-cso` reports and gates; fixes are up to the developer or
  a downstream `/loom-code fix` invocation.
- No runtime dynamic analysis (no fuzzing, no live traffic replay). Those
  belong to `/loom-qa` (F-20).
