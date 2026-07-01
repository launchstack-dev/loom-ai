---
agent: skills/loom-skillify/SKILL.md
description: "Retrospective codification — walks back the conversation transcript, distills successful one-shot flows into a runnable script.ts + companion test.ts + TOON fixture under scripts/skillified/, and runs vitest before registering. The backward-direction pair to /loom-agent create and /loom-skill create."
---

# /loom-skillify

Retrospective codification of a successful ad-hoc flow into a reusable, tested script. See `skills/loom-skillify/SKILL.md` for the full 6-phase workflow — locate transcript, distill script, generate test, emit fixture, atomic writes, run vitest.

## Flags

- `--slug <kebab>` — required. Identifier for the codified artifact.
- `--from <path>` — optional transcript slice (JSONL). Defaults to `.claude/session-history/latest.jsonl`.
- `--dry-run` — plan the three files but do not write or run vitest.

## Outputs

Three files under `scripts/skillified/`:

- `scripts/skillified/{slug}.ts` — the runnable script (Bun shebang).
- `scripts/skillified/{slug}.test.ts` — Vitest suite covering the flow.
- `scripts/skillified/fixtures/{slug}.toon` — inputs + expected outputs.

On test pass, the script + test are registered in `skills/library.yaml` under `library.infrastructure:`.

See SKILL.md.
