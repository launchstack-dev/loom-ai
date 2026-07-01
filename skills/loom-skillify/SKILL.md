---
name: loom-skillify
description: Retrospective codification — walks back conversation transcript, codifies successful one-shot flows into script.ts + test.ts + fixture, runs test before committing. The backward-direction pair to /loom-agent create and /loom-skill create.
---

# /loom-skillify — Retrospective Codification

`/loom-agent create` and `/loom-skill create` are the **forward** path: you know what capability you want, you scaffold it. `/loom-skillify` is the **backward** path: you already did a valuable flow once, and now you want it captured as a re-runnable script with a test and a fixture so it stops being a one-off.

## Inputs

- `--slug <kebab>` — required. The identifier for the codified artifact.
- `--from <path>` — optional. Path to a transcript slice (JSONL). Defaults to `.claude/session-history/latest.jsonl` when present.
- `--dry-run` — plan only; do not write files.

## Workflow

### Phase 1 — Locate the transcript slice

Try in order:

1. If `--from <path>` is supplied, read that.
2. Else if `.claude/session-history/latest.jsonl` exists, read the last N turns (default 40).
3. Else prompt the operator to paste the transcript slice into stdin.

Extract from the slice:

- Sequence of tool calls with arguments (Bash, Read, Edit, Write, WebFetch, etc.).
- File paths touched, with their pre/post contents where recoverable.
- User directives (natural-language goals stated by the operator).

### Phase 2 — Distill the minimal reproducible script

Collapse the extracted sequence into a TypeScript script that reproduces the flow deterministically:

- **Runtime:** Bun (`#!/usr/bin/env bun` shebang). Fall back to Node when Bun is not available in-project (rare in Loom).
- **Inputs from a fixture:** every value the flow depended on (URLs, file contents, LLM responses) lands in the fixture, NOT hardcoded in the script.
- **No interactive prompts:** the script must run headless. If the original flow had operator-in-the-loop decisions, encode them as fixture entries with clear `TODO_HUMAN_DECISION_KEY` markers.
- **Idempotent where possible:** re-running produces the same output. Non-idempotent side effects (writes to `.loom/`, git commits) are flagged in a comment header.

### Phase 3 — Generate the companion test

Choose the test shape from the flow:

- **Unit** — pure data transformation, no external side effects. Write against Vitest with the fixture as input.
- **E2E** — flow touches the filesystem or spawns subprocesses. Use Vitest's `beforeEach`/`afterEach` for tempdir setup.

Test asserts:

- The script exits 0 on the fixture input.
- The observable outputs (files written, stdout content) match a golden snapshot embedded in the fixture.
- No unexpected side effects (guard by scoping writes under a tempdir).

### Phase 4 — Emit the fixture

Write a TOON fixture at `scripts/skillified/fixtures/{slug}.toon` per project convention (TOON for all Loom artifacts). Fixture shape:

```toon
slug: <slug>
capturedAt: <ISO datetime>
inputs:
  <key>: <value>
expectedOutputs{path,content|checksum}:
  <observed>
notes: |
  Free-form provenance notes; cite the transcript slice.
```

### Phase 5 — Write the three files atomically

Write in this order (each via `.tmp` + rename):

1. `scripts/skillified/fixtures/{slug}.toon`
2. `scripts/skillified/{slug}.ts`
3. `scripts/skillified/{slug}.test.ts`

### Phase 6 — Run the test

Execute:

```bash
bunx vitest run scripts/skillified/{slug}.test.ts
```

- **On pass:** append a registration entry to `skills/library.yaml` under `library.infrastructure:` for the script and its test. Emit a `SkillifyArtifact` TOON envelope naming the three paths. Print a hint: `Consider promoting: /loom-skill create --from-skillified {slug}`.
- **On fail:** do NOT register. Print the vitest failure output and prompt the operator to refine the fixture or the script. `--dry-run` mode always skips this step.

## Optional Promotion

Later, the operator can run `/loom-skill create --from-skillified {slug}` (when that flag ships in the skill wizard) to turn the codified script into a full `skills/{name}/SKILL.md` skill with description triggers. Until then, `/loom-skillify` output stays under `scripts/skillified/` as codified-but-not-yet-formalized capability.

## Contracts Referenced

- `protocols/agent-result.schema.md` — SkillifyArtifact envelope.
- `protocols/toon-format.md` — fixture format.
- `CLAUDE.md` — TOON everywhere, atomic writes, bun-first toolchain.

## Failure Modes

- `TRANSCRIPT_NOT_FOUND` (blocking) — no `--from` path and no `.claude/session-history/latest.jsonl`.
- `SKILLIFY_TEST_FAIL` (blocking) — vitest exited non-zero; script not registered.
- `FIXTURE_SCHEMA_INVALID` (blocking) — emitted fixture fails TOON parse.
