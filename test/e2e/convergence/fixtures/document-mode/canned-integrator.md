---
name: canned-integrator
model: haiku
---

# Canned Integrator (Fixture)

This is a fixture agent file used exclusively by the document-mode e2e suite at
`test/e2e/convergence/document-mode.test.ts`. The test resolves
`converge.config.integrator` against `{configDir}/canned-integrator.md` via the
fixture-local `resolveIntegratorPath` function, which mirrors production's
"agent name -> on-disk `.md` file" dispatch contract.

The frontmatter `name:` and `model:` fields exist so the file is resolvable by
the same logic that production uses when reading
`~/.claude/agents/{name}.md` — model resolution per CLAUDE.md is satisfied by
the `model:` field below.

The actual spawn is intercepted by the test harness via the
`SpawnIntegratorFn` injection point. No LLM is invoked. The intercepted spawn
returns one of three scripted edits to the subject file:

- happy-path: no edit (the iteration converges before the integrator runs).
- progress: rewrite the existing `### Phase 1` body (acceptable edit per C-06).
- scope-expansion: append a new top-level heading (`### Phase 99`) that trips
  the scope-expansion guard.

The choice between progress and scope-expansion edits is governed by the
canned-harness config (see `canned-harness.config.json` for the script).
