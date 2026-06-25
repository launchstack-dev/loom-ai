---
description: "Fix Archive Schema"
---

# Fix Archive Schema

Defines the structure of fix archive entries stored in `.loom/fix-archive/`. Each entry is a short TOON summary of a bug fix — NOT a git diff, but a human-readable record of what broke, why, what was done, and what else might be affected.

## Archive Directory

```
.loom/fix-archive/
  {YYYY-MM-DD}-{slug}.toon       # individual fix entries
  index.toon                      # cumulative index for quick lookup
```

## Fix Entry Format

```toon
fixId: {YYYY-MM-DD}-{slug}
title: Short description of the bug
severity: critical | high | medium | low
category: runtime | logic | type | data | config | integration | ui | perf

reportedAt: ISO-8601
fixedAt: ISO-8601
fixedBy: human | bugfix-analyst-agent

symptom: What the user or system observed (1-2 sentences)
rootCause: Why it happened (1-2 sentences)
fix: What was changed to resolve it (1-2 sentences)

filesChanged[N]: src/auth.ts, src/middleware.ts
modulesAffected[N]: auth, middleware

impactAssessment:
  risk: low | medium | high
  scope: isolated | module | cross-module | system-wide
  regressionAreas[N]: login flow, token refresh
  relatedWikiPages[N]: component-auth-middleware, pattern-error-handling
  confidence: high | medium | low

wikiContext[N]: page IDs consulted during diagnosis
priorFixes[N]: fix IDs of related past fixes (pattern detection)

recurringPattern: true | false
notes: Optional free-text for analyst observations

verificationResult: pass | fail | skipped
verificationCommands[N]: bun run test, bun run typecheck
commitHash: abc1234 | null
```

## Field Reference

| Field | Required | Description |
|-------|----------|-------------|
| `fixId` | yes | Unique identifier. Format: `{YYYY-MM-DD}-{slug}`. Matches filename. |
| `title` | yes | One-line summary of the bug. |
| `severity` | yes | How bad the bug was: `critical` (prod down), `high` (major feature broken), `medium` (degraded), `low` (cosmetic/minor). |
| `category` | yes | Classification of the bug type. |
| `reportedAt` | yes | When the bug was reported or discovered. |
| `fixedAt` | yes | When the fix was applied. |
| `fixedBy` | yes | Who or what applied the fix. |
| `symptom` | yes | Observable behavior — what went wrong from the user/system perspective. |
| `rootCause` | yes | Technical explanation of why it happened. |
| `fix` | yes | What was changed — not a diff, but a plain-language summary. |
| `filesChanged` | yes | Files that were modified to fix the bug. |
| `modulesAffected` | yes | Logical modules or domains touched by the fix. |
| `impactAssessment` | yes | Structured assessment of downstream risk. |
| `wikiContext` | yes | Wiki pages used for diagnosis context. Empty array if wiki not available. |
| `priorFixes` | yes | IDs of related past fixes. Empty array if none. Enables pattern detection (recurring bugs). |
| `verificationResult` | yes | Whether verification commands passed after the fix. |
| `verificationCommands` | yes | Commands run to verify. Empty if skipped. |
| `recurringPattern` | yes | `true` if 3+ fixes hit the same module within 30 days. |
| `notes` | no | Free-text for analyst observations (tech-debt flags, unusual circumstances). |
| `commitHash` | yes | Git commit SHA or null if not committed. |

## Impact Assessment Detail

The `impactAssessment` block is the key differentiator from a simple fix log. It answers: "what else could this break?"

| Field | Description |
|-------|-------------|
| `risk` | Overall risk that the fix introduces regressions: `low` (isolated, well-tested), `medium` (touches shared code), `high` (cross-cutting change). |
| `scope` | Blast radius: `isolated` (single function/component), `module` (one module), `cross-module` (multiple modules), `system-wide` (affects everything). |
| `regressionAreas` | Specific features or flows that should be tested after this fix. |
| `relatedWikiPages` | Wiki pages describing components/patterns touched by the fix. |
| `confidence` | How confident the analyst is in the impact assessment. |

## Index Format

The index file `.loom/fix-archive/index.toon` provides a cumulative lookup table:

```toon
lastUpdated: ISO-8601
totalFixes: 42

entries[N]{fixId,title,severity,category,date,modules}:
  2026-04-19-auth-token-expiry,Token expiry not checked on refresh,high,logic,2026-04-19,auth/middleware
  2026-04-18-css-overflow,Dashboard card overflow on mobile,low,ui,2026-04-18,dashboard

Note: The `modules` column uses `/`-separated values when a fix touches multiple modules (e.g., `auth/middleware`). Pattern detection scans should split on `/` and match any segment.
```

## Slug Generation

1. Take the title, lowercase it.
2. Split on whitespace, take the first 6 words.
3. Join with hyphens.
4. Replace any character not `[a-z0-9-]` with a hyphen.
5. Collapse consecutive hyphens, trim leading/trailing.
6. Truncate to 50 characters at the last complete segment.

## Pattern Detection

When writing a new fix entry, the analyst SHOULD:

1. Read `index.toon` and scan for fixes in the same `category` and `modulesAffected`.
2. If similar fixes exist, populate `priorFixes` with their IDs.
3. If 3+ fixes hit the same module within 30 days, set `recurringPattern: true` and add a note in the `notes` field flagging it as a recurring problem area — this suggests a deeper architectural issue worth a wiki `tech-debt` page.
