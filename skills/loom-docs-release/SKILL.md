---
name: loom-docs-release
description: Post-ship doc sync — diff-driven README/CHANGELOG/ARCH updates + diagram drift detection + CHANGELOG sell-test rubric. Surfaces doc-debt in PR body.
---

# /loom-docs:release — Post-Ship Doc Sync

Run this after a milestone lands (or as part of `/loom-ship`) to keep README, CHANGELOG, and architecture docs in lockstep with shipped code. The skill is diff-driven: it reads what actually changed and challenges the docs to keep pace. Non-zero exit when doc-debt is detected without a documented remediation plan.

## Inputs

- `--base <ref>` — base git ref (default: `main` or last release tag).
- `--head <ref>` — head ref (default: `HEAD`).
- `--pr <number>` — optional PR context; when supplied, the doc-debt list is rendered into the PR body.

## Workflow

### Phase 1 — Read the diff

Read `git diff {base}...HEAD` and enumerate:

- Changed source files by path.
- Added/removed public surfaces: CLI flags, slash commands, agents, skills, protocols, exported types, HTTP endpoints.
- Docs touched in the same range: `README.md`, `CHANGELOG.md`, `docs/**`, `ARCHITECTURE.md`, `.excalidraw`, `.mermaid`, `.puml`.

Do NOT modify anything in this phase. This is read-only ingestion.

### Phase 2 — Classify each change

Bucket every changed file into one of:

- **new-feature** — new user-visible surface (command, flag, agent, endpoint).
- **breaking** — removed or renamed public surface, or altered contract.
- **fix** — behavioral repair with no surface change.
- **docs-only** — pure documentation edit.
- **refactor** — internal restructure, no user-visible delta.

Classification biases toward the more severe bucket when ambiguous (e.g., a renamed CLI flag is `breaking`, not `fix`).

### Phase 3 — README parity check

For every `new-feature` and `breaking` entry, grep `README.md` for the new symbol (command name, flag name, protocol name). If not found:

- Emit a doc-debt entry naming the missing surface and the file where it was introduced.
- Draft a proposed README patch (added section, bullet, or table row) that follows the existing README voice.

Per project memory: user-facing surfaces need a **full section per surface, not a one-line table row**. Push back if the diff only added a table row.

### Phase 4 — CHANGELOG extraction & sell-test

Extract the CHANGELOG diff (or draft one when absent). Respect the user's no-emoji preference: strip emoji from entries.

Score each CHANGELOG entry against the **sell-test rubric**:

- **(a) Names the user benefit** — the entry says what the user can now do, not what changed internally.
- **(b) Scannable in <3s** — one line, verb-first, no marketing prose.
- **(c) Avoids marketing prose** — no adjectives like "seamless", "powerful", "delightful". No exclamation.

Any entry failing (a), (b), or (c) is flagged as `changelogSellTest: fail` with the specific rubric letter.

### Phase 5 — Diagram drift

For each `.excalidraw`, `.mermaid`, `.puml`, or `docs/**/*.svg` file in the repo:

- Read the diagram source (or accompanying `.md` legend) for referenced code paths (e.g., `scripts/loom-health.ts`).
- If any referenced path appears in the diff **and** the diagram file was NOT touched in the diff → flag as `staleDiagrams` entry.

Diagram drift is a warning, not blocking, unless the change is `breaking`.

### Phase 6 — Emit DocSyncReport

Write a `DocSyncReport` per `protocols/agent-result.schema.md`:

```toon
docSyncReport:
  base: <ref>
  head: <ref>
  missingReadme[N]: <path or surface name>
  staleDiagrams[N]: <diagram path>
  changelogSellTest: pass | fail
  changelogFailReasons[N]{entry,rubricLetter,reason}:
  proposedPatches[N]{file,diff}:
```

### Phase 7 — Exit + PR body

- **Exit non-zero** when the report has any `missingReadme` entries and the invocation did not include a `--plan <doc-debt-plan>` acknowledging them.
- When `--pr <number>` is supplied, render the doc-debt list as a markdown section titled `## Doc Debt` and append it to the PR body via `gh pr edit`.

## Contracts Referenced

- `protocols/agent-result.schema.md` — DocSyncReport is emitted as an AgentResult finding category.
- `protocols/toon-format.md` — output artifact serialization.

## Failure Modes

- `DOC_DEBT_UNRESOLVED` (blocking) — `missingReadme` non-empty and no `--plan` flag supplied.
- `CHANGELOG_SELL_TEST_FAIL` (warning) — one or more CHANGELOG entries fail the rubric.
- `DIAGRAM_DRIFT_DETECTED` (warning; blocking on breaking changes) — a diagram references a changed code path.
