# scripts/skillified/

Codified one-shot flows produced by `/loom-skillify`. Each artifact triple:

- `{slug}.ts` — the runnable script (Bun runtime).
- `{slug}.test.ts` — Vitest suite that asserts the script's observable behavior against the fixture.
- `fixtures/{slug}.toon` — TOON fixture holding inputs and expected outputs (per project convention: TOON for every Loom artifact).

## Lifecycle

1. Operator completes a valuable one-off flow in a Claude Code session.
2. Operator runs `/loom-skillify --slug <kebab>` — the skill walks back the transcript, distills the flow, writes the triple, and runs `bunx vitest run scripts/skillified/{slug}.test.ts`.
3. On pass, the triple is registered in `skills/library.yaml` under `library.infrastructure:`. On fail, the operator refines and re-runs.
4. Optional later promotion: `/loom-skill create --from-skillified {slug}` turns the codified triple into a formal `skills/{name}/SKILL.md` skill with description triggers.

## Conventions

- **Scripts are headless.** No interactive prompts. Anything the original flow decided interactively lands as a `TODO_HUMAN_DECISION_KEY` marker in the fixture.
- **Side effects are scoped.** Filesystem writes go to a tempdir in tests; non-idempotent effects (git commits, `.loom/` writes) are flagged in a script header comment.
- **Fixtures are TOON.** Never hand-hardcode fixture values in the script.
- **Atomic writes.** Write to `.tmp`, then rename — matches Loom-wide convention.

## Do NOT

- Do not treat `scripts/skillified/` as a graveyard for abandoned experiments. If the test fails, either fix it or delete the triple; do not leave broken artifacts here.
- Do not import from `scripts/skillified/` in production Loom code paths. Promote to a real skill first.
