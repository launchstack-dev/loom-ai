---
description: "Mark a roadmap as converged — the only path from sign_off_state=eligible to signed-off."
---

## Command: `sign-off`

Mark a roadmap as `converged`. Sign-off is the ONLY path from
`sign_off_state = "eligible"` to `sign_off_state = "signed-off"` — neither
`/loom-roadmap converge` nor any other code path may write that terminal
value. A vitest grep guard (`test/roadmap-converge/sign-off-purity.test.ts`)
enforces this invariant.

### Frontmatter

```yaml
agent: scripts/roadmap-converge/sign-off.ts
```

This command is implemented directly by `scripts/roadmap-converge/sign-off.ts`
— it does not spawn a subagent. Per CLAUDE.md the model-resolution rule
applies only to Agent tool calls; sign-off runs as a deterministic script.

### Flags

| Flag | Default | Behaviour |
|------|---------|-----------|
| `--roadmap <path>` | `planning/ROADMAP.md` | Target a specific roadmap. Slug derived as filename without extension; state path resolved as `.roadmap-converge/{slug}/state.toon`. |
| `--yes` | off | Skip the interactive y/n confirmation. The diff view still renders so the user can audit before confirming via the flag in CI. |

### What this command does

1. Reads `.roadmap-converge/{slug}/state.toon` via the F-13 migrator entrypoint.
2. Refuses sign-off when `state.sign_off_state != "eligible"`. The refusal
   sub-code is resolved in tiebreaker order per the Error Categories table:
   - `SIGNOFF_NOT_ELIGIBLE:NO_PASS` — `state.round == 0` or no dimensions recorded.
   - `SIGNOFF_NOT_ELIGIBLE:OPEN_QUESTIONS` — at least one `open_questions[]` entry without `resolved_at`.
   - `SIGNOFF_NOT_ELIGIBLE:RED_DIMENSIONS` — at least one dimension with `status != "green"`.

   If multiple conditions hold, the primary code is the first in order and
   the others land in `additionalBlockers[]` of
   `.plan-execution/ephemeral/last-error.toon` so the user fixes them in
   one batch.
3. Renders a "30-second" diff between `state.sign_off_diff_hash` (the
   roadmap as it was at the last sign-off) and the current ROADMAP.md.
   On a TTY the diff pipes through `$PAGER` (or `less`); off-TTY it goes
   straight to stdout.
4. Prompts `y/N` unless `--yes`. A `no` answer exits 1 with `USER_REJECTED`.
5. On confirmation, writes `sign_off_state = "signed-off"`,
   `sign_off_at = <ISO now>`, `sign_off_diff_hash = sha256(current ROADMAP.md)`
   atomically (`.tmp` + `fs.renameSync`).
6. Writes `.plan-execution/stage-context/execute-signoff.toon` atomically
   per `protocols/execution-conventions.md`.

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | Sign-off recorded (or state was already `signed-off`). |
| 1 | Refused. Stderr contains the reason code; details in `.plan-execution/ephemeral/last-error.toon`. |

Reason codes: `STATE_MISSING`, `SIGNOFF_NOT_ELIGIBLE:NO_PASS`,
`SIGNOFF_NOT_ELIGIBLE:OPEN_QUESTIONS`, `SIGNOFF_NOT_ELIGIBLE:RED_DIMENSIONS`,
`USER_REJECTED`.

### Where things live

| Path | What |
|------|------|
| `.roadmap-converge/{slug}/state.toon` | Read for eligibility, written atomically on sign-off. |
| `.plan-execution/stage-context/execute-signoff.toon` | Stage summary (always written on a terminal outcome). |
| `.plan-execution/ephemeral/last-error.toon` | Diagnostic, written on refused/rejected paths. |

### What this command does NOT do (deferred)

- Status digest of the signed-off roadmap (Phase 3 wires this into `/loom-roadmap status`).
- Batch sign-off across multiple roadmaps (planned for a later phase).

### Example

```bash
/loom-roadmap sign-off
# → diff view of ROADMAP.md since last sign-off, paged through less
# → "Confirm sign-off — mark this roadmap as converged? [y/N] "
# → on "y": writes sign_off_state = signed-off, exits 0

/loom-roadmap sign-off --yes
# → diff view still renders, but no prompt
# → writes sign_off_state = signed-off, exits 0

/loom-roadmap sign-off
# (with one yellow dimension remaining)
# stderr: "[roadmap-signoff] SIGNOFF_NOT_ELIGIBLE:RED_DIMENSIONS — Non-green dimensions: vision(yellow)."
# exit 1
```
