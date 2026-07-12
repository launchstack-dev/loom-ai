# Should Loom fully refactor TOON → JSON?

- Date: 2026-07-11
- Question: C-05 (fable-readiness) freezes TOON — existing artifacts keep it, new schemas may use JSON. Should we instead do a full TOON→JSON refactor?
- Method: full blast-radius inventory of the ct6-to-loom branch plus the fable-readiness branch engine boundary (read via `git show`, no checkout).

## Recommendation: No. Keep the C-05 freeze, add a three-part attrition policy.

A full refactor is ~540 file-touches that breaks installed user state and in-flight runs to buy zero user-facing value. The freeze already stops the cost from growing; attrition retires it where a rewrite is happening anyway.

## The blast radius (measured, not estimated)

| Dimension | Count |
|---|---|
| Committed `.toon` files | 176 |
| Protocol schemas defining TOON formats | 80 (62 `.schema.md` + 18 `.schema.toon`) |
| Code parser import sites | 30 (11 via `hooks/lib/toon-reader.ts`, 19 via `lib/toon.ts`) |
| Agent/command prose files instructing TOON emit/read | ~105 (56 agents + 49 commands; `convergence-driver.md` alone has 116 refs) |
| Test files asserting TOON shapes | 66 (incl. property-based round-trip suites) |
| Wiki pages with TOON frontmatter | 48 (+4 structural index files, parsed by 3 hooks) |
| Long-lived user state files | 9+ under `.loom/`, plus `~/.loom/install-manifest.toon`, `~/.loom/version-slots.toon`, `~/.claude/skills/library/install-state.toon` |
| Estimated total file touches | **~540** |

Three fail-closed schemaVersion enforcement points (`convergence-state` v2, `install-state` v3, `update-check` v1) throw `MIGRATION_SCHEMA_MISMATCH` on unknown versions — a format flip without per-schema migrators hard-blocks in-flight executions and installed projects, exactly the resume-compatibility break C-05 names.

## Why the steelman for full JSON still loses

The real costs of TOON are true: it's a bespoke notation every agent must be taught (~105 prose files carry that tax), weaker worker models can emit it malformed where JSON + schema-validated structured output would retry automatically, and two parser implementations plus two hand-rolled serializers (`hooks/wiki-commit-ledger.ts`, `scripts/skill-autoload-audit/classify.ts`) are maintenance drag. But these costs are **sunk and capped** — the freeze stops new accrual — while the refactor's costs are **new and spread across every installed project**: user-global state migration in repos Loom doesn't control, 176 committed artifacts churned, 66 test files and golden fixtures regenerated, every wiki-writing and convergence agent re-prompted. The fable-readiness engine already proved the right boundary empirically: its driver-internal state went JSON (`execute-driver-state.json`, Workflow verdicts, `agent(schema)` outputs) while `state.toon` / `iter-{N}.toon` / `convergence-summary.toon` deliberately stayed TOON *because hooks read them* — the interop seam is where migration cost concentrates and value evaporates.

## The attrition policy (what to do instead)

1. **Adopt the engine boundary as the rule** (this is C-05 operationalized): anything new consumed by Workflow `agent(schema)` structured output or an engine CLI is JSON-with-schema; extending an existing TOON subsystem stays TOON; one artifact, one format, never both.
2. **Kill the two hand-rolled serializers now** — route `wiki-commit-ledger.ts` and `classify.ts` through the shared libs. Removes silent-drift risk with no format change; the only TOON *code* cleanup worth doing eagerly.
3. **Flip formats only on organic schemaVersion bumps**: when a schema takes a breaking bump for real reasons, that migration may also move it to JSON using the proven registry/migrator pattern (24 schemas registered). Never bump solely to change format. Wiki frontmatter (48 pages, 3 hook parsers, the most agent-visible format in the system) is explicitly exempt — it migrates never, or only with a dedicated wiki-schema project that has its own justification.

## Revisit triggers

Reopen the full-migration question only if: (a) external contributors via the plugin marketplace measurably trip on TOON (issues/PR feedback), or (b) malformed-TOON emission by worker models becomes a tracked defect class in convergence runs. Absent those signals, the freeze + attrition is strictly dominant.
