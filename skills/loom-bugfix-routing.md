# Loom Bugfix Routing

Use when the user reports a bug, describes broken behavior, or asks to fix an error in a loom-initialized project — and the request implies a real bug (not a feature request or refactor).

## Trigger Patterns

Match user intent against the following phrases. Matching is case-insensitive and intent-based.

### Bug reports / broken behavior
- "this is broken", "it's broken", "something broke", "this broke"
- "bug in", "there's a bug", "found a bug", "hitting a bug"
- "not working", "stopped working", "doesn't work", "won't work"
- "getting an error", "throws an error", "error when", "exception in"
- "returns 500", "returns 404", "returns null", "returns undefined"
- "crash", "crashes", "crashing", "segfault"

### Fix requests (bug-flavored, not feature-flavored)
- "fix this bug", "fix the error", "fix the crash"
- "debug this", "debug the issue", "figure out why"
- "why is this failing", "why does this break", "what's causing"
- "track down", "hunt down the bug", "investigate this error"

### Severity signals
- "urgent", "critical", "production is down", "prod issue", "hotfix needed"
- "hotfix", "hot fix", "hotfix this" (urgency implies a real bug, not a chore)
- "users are affected", "blocking release", "P0", "P1"

## Flag Detection

| User intent | Flag |
|-------------|------|
| "critical", "urgent", "prod down", "P0" | `--severity critical` |
| "important", "high priority", "P1" | `--severity high` |
| "minor", "cosmetic", "low priority" | `--severity low` |
| "just diagnose", "don't fix yet", "what's causing" | `--dry-run` |
| Mentions specific file/path | `--path <detected path>` |

## Exclusions

Do NOT intercept any of the following:

1. **Feature requests disguised as bugs**: "Fix it so that it also supports X" — this is a feature, not a bug.

2. **Refactoring requests**: "Fix the architecture of this module" — use `/loom-plan create`.

3. **Quick cosmetic fixes with no investigation needed**: "Fix the typo in README" — route to `/loom-quick` instead.

4. **Plan-level bug investigations**: "Create a plan to fix all the auth bugs" — route to `/loom-plan create`.

5. **Questions without fix intent**: "Why does this function exist?" — just answer the question.

6. **Already using /loom-bugfix**: If the user explicitly typed `/loom-bugfix`, don't re-route.

## Disambiguation: Bugfix vs Quick

If the request is ambiguous between a quick fix and a bugfix:

| Signal | Route to |
|--------|----------|
| User describes a **symptom** (error message, wrong behavior, crash) | `/loom-bugfix` |
| User describes the **fix** ("change X to Y", "add a null check") | `/loom-quick` |
| User says "investigate" or "figure out why" | `/loom-bugfix` |
| User says "just do" or "real quick" | `/loom-quick` |

When in doubt and the user describes broken behavior: route to `/loom-bugfix`. The overhead of context gathering and impact assessment is worth it for real bugs.

## Instructions

When triggered, invoke the Skill tool with `skill: 'loom-bugfix'` and the bug description as args. Pass any detected flags before the description.

Examples:

| User says | Skill invocation |
|-----------|-----------------|
| "The login page throws a 500 after resetting password" | `skill: "loom-bugfix", args: "The login page throws a 500 after resetting password"` |
| "Something broke in the payment flow — users can't check out" | `skill: "loom-bugfix", args: "--severity critical Something broke in the payment flow — users can't check out"` |
| "I'm getting a null reference error in src/utils/parser.ts" | `skill: "loom-bugfix", args: "--path src/utils/parser.ts null reference error in parser"` |
| "Why is the dashboard slow when filtering by date? Don't fix yet" | `skill: "loom-bugfix", args: "--dry-run dashboard slow when filtering by date"` |
| "Urgent — prod is down, auth tokens aren't being validated" | `skill: "loom-bugfix", args: "--severity critical auth tokens aren't being validated"` |
| "There's a bug in the middleware — not sure where exactly" | `skill: "loom-bugfix", args: "bug in the middleware"` |
