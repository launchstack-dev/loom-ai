---
name: loom-spec
description: 5-phase interview from vague idea to precise ROADMAP entry or GH issue, with optional worktree spawn and auto-close on merge.
---

# /loom-spec — Vague Idea to Precise Entry

Use this skill when the operator has an idea sentence and needs a precise deliverable — either a ROADMAP feature block or a standalone GitHub issue. `/loom-spec` sharpens fuzzy language, classifies the work, drafts the artifact, and optionally spawns a worktree so execution can begin immediately.

## When to use

- Operator has an idea in one sentence and wants it turned into a ticket.
- A `/loom-think` doc concluded with "next step: draft the wedge ticket".
- A bug report needs to become a tracked issue with a clear repro.

## When NOT to use

- The idea is still fuzzy — run `/loom-think` first.
- The change is a hotfix — use `/loom-bugfix`.
- The roadmap does not yet exist — start with `/loom-roadmap init`.
- The operator wants many voices weighing in on a specific topic before crystallizing — run `/loom-roadmap:explore` first. `explore` gathers multi-persona perspectives (design, strategy, UX, risk); `loom-spec` then crystallizes the chosen direction into a ticket.

### Rule of thumb

- `loom-think` — fuzzy problem, one operator wants to converge.
- `/loom-roadmap:explore` — specific topic, wants many voices.
- `loom-spec` — crystallize a chosen direction into a ticket.

## Inputs

- **Idea** (required, positional): the raw one-sentence idea. Free-text.
- **From** (optional): `--from <path>` — a `/loom-think` doc that seeded this spec.
- **Worktree** (optional): `--worktree` — after drafting, spawn a worktree via `wt new` (or the local equivalent).
- **Auto-mutate** (optional): `--auto-mutate` — after drafting a `roadmap-feature`, invoke `/loom-roadmap:mutate` to insert the block into the target roadmap. Default: draft to stdout only; operator runs mutate manually. Requires target=`roadmap-feature`; a no-op with `gh-issue`.
- **Auto-mutate roadmap target** (optional): `--name <slug>` — with `--auto-mutate`, targets `planning/ROADMAP-<slug>.md` instead of the default `planning/ROADMAP.md`.
- **Skip confirmation** (optional): `--yes` — with `--auto-mutate`, skip the y/n confirmation between draft and mutation. True one-shot mode.

## 5-Phase Workflow

### Phase 1 — Elicit the raw idea

Take the operator's idea sentence verbatim. Do NOT paraphrase. Store it as `originalIdea:` in the record.

If the operator did not provide a sentence, ask once: "In one sentence — what's the idea?"

Keep this phase terse. One question, one answer.

### Phase 2 — Sharpen

Ask 3–5 clarifying questions to nail scope. Pick from this menu based on what the raw idea leaves ambiguous:

1. **Trigger:** Who or what invokes this? User action, cron, agent, hook?
2. **Boundary:** What files, modules, or systems does this touch?
3. **Success shape:** What does "done" look like — a passing test, a screenshot, a metric, a merged PR?
4. **Anti-scope:** What is deliberately NOT included?
5. **Prior art:** Has this been tried before? Cite PR/plan/issue.
6. **Blast radius:** What breaks if this ships and is wrong?

Ask questions one at a time. Stop when the scope is nailed, even if you asked fewer than 5.

### Phase 3 — Classify

Assign exactly one class and exactly one target artifact.

**Class** — pick one:

- `bug` — existing behavior is wrong.
- `feature` — new user-facing capability.
- `enhancement` — improves an existing capability.
- `refactor` — internal restructuring, no behavior change.
- `debt` — repayment of prior shortcuts; may be invisible.

**Target artifact** — pick one:

- `roadmap-feature` — this belongs in `ROADMAP.md` as a new Feature block under the appropriate milestone. Use when the work is large enough to warrant a plan, or when it affects multiple modules.
- `gh-issue` — this is a standalone GitHub issue. Use for small, self-contained work — most bugs, most single-file refactors, most debt paydowns.

Rule of thumb: if it will produce a `PLAN-*.md`, it's a roadmap feature. If it's one PR of work, it's a gh-issue.

### Phase 4 — Draft

Draft the target artifact.

#### If target is `roadmap-feature`

Emit a ROADMAP feature block conforming to `protocols/roadmap.schema.md`:

```markdown
### F-NN <Feature Name>

**Status:** proposed
**Milestone:** M-NN
**Class:** <bug | feature | enhancement | refactor | debt>
**Origin:** <path to /loom-think doc, or "operator direct">

**Problem.** <one paragraph, from Phase 1 + Phase 2>

**Approach.** <one paragraph — the proposed shape>

**Acceptance.**
- [ ] <criterion 1, from Phase 2 success shape>
- [ ] <criterion 2>

**Anti-scope.** <from Phase 2 anti-scope>

**Blast radius.** <from Phase 2>
```

**Mutation cadence.** Behavior depends on `--auto-mutate`:

- **Default (no flag):** Emit the block to stdout and instruct the operator to run `/loom-roadmap:mutate` with the block as input. Preserves the User-Challenge boundary from `protocols/loom-decision-principles.md` — ROADMAP structure changes are strategic and never auto-answered.
- **`--auto-mutate`:** Emit the block, then prompt `Apply this to <roadmap-path>? (y/n)`. On `y`, invoke `/loom-roadmap:mutate` internally (or shell out to it) targeting `planning/ROADMAP.md` (default) or `planning/ROADMAP-<slug>.md` if `--name <slug>` was passed. On `n`, exit 0 with the block still visible in stdout.
- **`--auto-mutate --yes`:** Skip the confirmation. True one-shot from spec to roadmap mutation. Use for known-good asks where you've already exercised judgment upstream (e.g., inside `/loom-auto` or after a `/loom-think` doc explicitly recommended the ask).

Whichever path taken, the drafted block is always visible in stdout for the operator to review or copy.

#### If target is `gh-issue`

Emit GitHub issue markdown suitable for `gh issue create --body-file -`:

```markdown
## Summary
<one sentence, from Phase 1>

## Context
<paragraph — what triggered this, cite prior art from Phase 2 if any>

## Proposal
<paragraph — the sharpened scope from Phase 2>

## Acceptance criteria
- [ ] <from Phase 2 success shape>
- [ ] ...

## Anti-scope
- <from Phase 2>

## Blast radius
<from Phase 2>

---
_Drafted by /loom-spec. Class: `<class>`. Origin: `<think-doc-path or operator direct>`._
```

If the operator confirms, run `gh issue create` and capture the issue URL as `sourceIssue:` in the spec record.

### Phase 5 — Optional worktree

If the operator passed `--worktree` (or answers yes to "spawn a worktree?"):

1. Derive a branch slug from the artifact title.
2. Run `wt new <slug>` (or the local equivalent — the project may define this under `scripts/`).
3. Compose an initial commit message injecting the drafted spec so future context readers see it:

```
chore: seed <slug> worktree with /loom-spec draft

<the drafted ROADMAP block or GH issue body>

Spec-Id: S-NN
Origin: <think-doc-path or operator direct>
```

4. Do NOT commit yet — leave the message in the branch's stash or as a `.git/SPEC_DRAFT.md` scratch file for the operator to promote.

### Auto-close on merge

When the resulting PR merges, close the source GH issue automatically:

```
gh issue close <number> --reason completed --comment "Closed by merge of #<pr>."
```

**Note:** this is documented behavior for `/loom-git pr merge` to honor when it sees a `Closes #NNN` or `Spec-Id: S-NN` line in the PR body. Enforcement via a Git hook is future work (M-09 lease-registry milestone).

## Output — SpecRecord

Emit a TOON block to stdout:

```toon
spec:
  id: S-NN
  originalIdea: "<verbatim from Phase 1>"
  class: <bug|feature|enhancement|refactor|debt>
  targetArtifact: <roadmap-feature|gh-issue>
  sourceIssue: <URL or empty>
  roadmapFeatureRef: <F-NN or empty>
  status: drafted
  origin: <think-doc-path or operator-direct>
  worktree: <slug or empty>
```

The `status:` field follows the SpecRecord state machine defined in the gstack-adoption plan: `drafted → roadmapped → in-progress → merged → closed`. `/loom-spec` always emits `drafted`. Downstream commands (`/loom-roadmap:mutate`, `gh issue create`, `/loom-git pr`, PR merge) drive the later transitions.

## Contracts Referenced

- `protocols/roadmap.schema.md` — ROADMAP feature block shape.
- `protocols/loom-decision-principles.md` — user-challenge boundary; no auto-mutation of ROADMAP.
- SpecRecord conceptual entity in gstack-adoption plan (id, sourceIssue, roadmapFeatureRef, status).
- `/loom-think` — feeds this skill via `--from`.
- `/loom-roadmap:mutate` — consumes the drafted ROADMAP block.
- `/loom-git pr merge` — honors the auto-close-on-merge contract.
