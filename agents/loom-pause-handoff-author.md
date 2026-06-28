---
name: loom-pause-handoff-author
description: Composes the body of a loom-pause handoff document — suggestedSkills[], referencedArtifacts[], and redactedSecretsCount — then writes it to $TMPDIR/loom-handoff-{id}.md. Called by loom-pause as a subagent.
model: sonnet
---

# Loom Pause Handoff Author

You compose the body of a `loom-pause` handoff document and write it atomically
to `$TMPDIR/loom-handoff-{id}.md`.  You are called by the `loom-pause` command
as a subagent; you do NOT run autonomously.

## Inputs (from calling context)

The caller provides:

```toon
sessionId: {id string following HANDOFF-{ISO8601-compact}-{shortHash} pattern}
createdAt: {ISO-8601 timestamp}
continueHerePath: {absolute path to .plan-execution/continue-here.toon}
rollingContextPath: {absolute path to .plan-execution/rolling-context.md, or null}
rawAgentOutput: {the raw text body that will undergo secret redaction}
outPath: {absolute path to write the handoff file, defaults to $TMPDIR/loom-handoff-{id}.md}
```

## Steps

### Step 1: Derive suggested skills

Read `.plan-execution/continue-here.toon` (already written by `loom-pause`).
From the `command` and `phase` fields, determine which Loom skills the next
session operator is most likely to need.  Use this heuristic:

| command       | resumeStep contains       | suggestedSkills                              |
|---------------|--------------------------|----------------------------------------------|
| auto          | anything                 | loom-auto, loom-resume                       |
| execute-plan  | wave / wiring            | loom-plan, loom-resume                       |
| converge      | anything                 | loom-converge, loom-resume                   |
| (any)         | review / approval        | review-code, loom-plan                       |
| (any)         | bugfix                   | loom-bugfix, loom-resume                     |
| (fallback)    |                          | loom-resume                                  |

Always include `loom-resume` in the list.  De-duplicate.

### Step 2: Collect referenced artifacts

Scan `.plan-execution/` for the following file patterns (paths only — do NOT
copy or inline their content):

- `*.plan.md`, `PLAN*.md` — plan documents
- `ROADMAP.md`, `roadmap.md`
- `planning/plans/*.md`, `planning/plans/*.toon`
- `*.prd.md`, `prd-*.md`, `PRD-*.md`
- `*.adr.md`, `adr-*.md`, `docs/adr/*.md`
- Open GitHub issues referenced in rolling-context.md (extract `#NNN` refs and
  format as `github:issue#NNN`)

Record these as `referencedArtifacts[]` — path strings only.

### Step 3: Run secret redaction

Call `scripts/loom-pause/secret-redactor.ts` `redact()` on `rawAgentOutput`.
The function returns `{ redacted, count }`.

- Use `redacted` as the body text.
- Set `redactedSecretsCount` to `count`.

### Step 4: Compose the handoff document

Write the following TOON document to `outPath` (atomic write: `.tmp` then rename):

```toon
id: {sessionId}
createdAt: {createdAt}
suggestedSkills[N]: {comma-separated list from Step 1}
referencedArtifacts[N]: {comma-separated paths from Step 2}
redactedSecretsCount: {count from Step 3}

context:
  {redacted body from Step 3, indented 2 spaces, max 3000 tokens}
```

The `context:` block is a nested TOON block — the body text is indented 2 spaces
beneath the `context:` key.  Do NOT duplicate the full text of any referenced
artifact — reference by path only.

### Step 5: Return result

Print to stdout:

```
Handoff written: {outPath}
suggestedSkills: {comma-separated list}
referencedArtifacts: {count} paths
redactedSecretsCount: {count}
```

Exit 0 on success.  Exit 1 with an error message on any failure (missing input,
write error).

## Atomic write convention

1. Write to `{outPath}.tmp`
2. `fs.renameSync("{outPath}.tmp", "{outPath}")`

Never leave a partial file at the final path.

## Constraints

- Do NOT read files outside `.plan-execution/` and the paths passed as inputs.
- Do NOT modify any file other than the output handoff document.
- Do NOT include raw secret values in any output, even in error messages.
- The `context:` block MUST be ≤ 3000 tokens (approximately 12 000 characters).
  Truncate with `[truncated for handoff — see rolling-context.md for full context]`
  if needed.
