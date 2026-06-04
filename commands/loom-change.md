---
description: "list, status, diff, init, review, approve, run, archive, reject, quick-archive — change-proposal lifecycle over contract pages"
---

# Loom Change

You manage the OpenSpec-style change-proposal lifecycle for Loom (PLAN-spec-upgrades.md, Upgrade B). Change proposals are durable artifacts under `.loom/changes/{changeId}/` that mutate `contract-*` wiki pages through a validated init → review → approve → run → archive flow. `/loom-quick` integrates via the `quick-archive` subcommand to keep small work zero-ceremony while preserving contract-page coherence.

## Requirements

$ARGUMENTS

Parse the first positional argument as the subcommand. Remaining arguments are passed to the subcommand handler.

### Available subcommands

| Subcommand | Status | Purpose |
|------------|--------|---------|
| `list` | **Phase 5 — query** | Enumerate every change with status, conflicts, and supersession flag. |
| `status <id>` | **Phase 5 — query** | Show one change's full lifecycle state (proposal frontmatter + transitions + conflicts). |
| `diff <id>` | **Phase 5 — query** | Show the per-domain deltas a change WILL apply when archived. |
| `init "..."` | **Phase 6 — mutation** | Create a new proposal directory and seed `proposal.md` from the schema. |
| `review <id>` | **Phase 6 — mutation** | Stamp `reviewedBy/reviewedAt/reviewNotes`; transition `proposed` → `reviewed`. |
| `approve <id>` | **Phase 6 — mutation** | Stamp `approvedBy/approvedAt`; transition `reviewed` → `approved`. |
| `run <id>` | **Phase 6 — mutation** | Mark in-flight; transition `approved` → `in-progress`. |
| `archive <id>` | **Phase 6 — mutation** | Atomically apply deltas across `affectedSpecs`; transition `in-progress` → `archived`. |
| `reject <id> --reason "..."` | **Phase 6 — mutation** | Stamp rejection; transition from `{proposed, reviewed, in-progress}` → `rejected`. |
| `quick-archive` | **Phase 6 — mutation** | Zero-ceremony retroactive proposal + archive (invoked by `/loom-quick`). |

If no subcommand is provided, print the help text (see § Help Output) and stop.

If an unknown subcommand is provided, print:

```
Unknown /loom-change subcommand: '{name}'
Run /loom-change for the list of available subcommands.
```

Exit non-zero.

## Protocols

Before executing any subcommand, read the relevant schemas:

- `~/.claude/agents/protocols/change-proposal.schema.md` — ChangeProposal + DeltaBlock field tables, directory layout, atomic archive semantics
- `~/.claude/agents/protocols/change-state.schema.md` — runtime ChangeState format and status lifecycle
- `~/.claude/agents/protocols/contract-page-extensions.schema.md` — what `contract-*` pages look like and what changes mutate
- `~/.claude/agents/protocols/scenario.schema.md` — scenario block format used in DeltaBlock added/modified scenarios
- `~/.claude/agents/protocols/execution-conventions.md` — atomic-write convention (`.tmp` + rename) for runtime state
- `~/.claude/agents/protocols/validation-rules.md` — severity conventions for validator findings

Path constants for both proposal artifacts and runtime state are exported from `hooks/lib/change-paths.ts`. Runtime ChangeState read/write goes through `hooks/lib/change-state.ts`. Use these — do NOT hard-code paths.

## Field-Lock Awareness

The following field names are **LOCKED** as of Phase 0 of PLAN-spec-upgrades.md. Do not rename them:

`changeId, status, intent, scope, approach, affectedSpecs, deltas, linkedPlan, reviewedBy, reviewedAt, reviewNotes, approvedBy, approvedAt, createdAt, archivedAt, transitions, conflicts, supersededBy, updatedAt`

---

## Subcommand Dispatch

### Query subcommands (Phase 5 — fully implemented)

Each query subcommand runs a TypeScript script via `tsx` (Bun preferred, `npx tsx` fallback). The scripts are pure readers — they never write to `.loom/changes/` or `.plan-execution/`.

| Subcommand | Script |
|------------|--------|
| `list` | `scripts/loom-change/list.ts` |
| `status <id>` | `scripts/loom-change/status.ts` |
| `diff <id>` | `scripts/loom-change/diff.ts` |

**Execution recipe (applies to all three):**

1. Detect runtime: prefer `bunx tsx <script> -- <args>`; fall back to `npx tsx <script> -- <args>`.
2. Pass remaining arguments verbatim. Both scripts accept `--json` for machine-readable output.
3. Surface stdout to the user; surface stderr as warnings; relay the exit code.

**Subcommand: `list`**

```
/loom-change list           # human-readable table
/loom-change list --json    # machine-readable
```

Enumerates every directory under `.loom/changes/` whose name matches `chg-{YYYYMMDD}-{kebab-slug}`. For each change it merges the proposal.md frontmatter with the runtime ChangeState file and surfaces:

- changeId
- status (proposal value wins per schema; mismatch surfaced as warning)
- conflict count
- supersededBy pointer (if set)
- createdAt
- truncated intent

Orphan ChangeState files (state without proposal) and orphan proposal directories (proposal without state) are surfaced as warnings on stderr.

**Subcommand: `status <id>`**

```
/loom-change status chg-20260520-add-refund-flow
/loom-change status chg-20260520-add-refund-flow --json
```

Shows one change's full lifecycle. Sections in order:

1. Header — changeId, proposal status, state status, mismatch warning if any
2. Identity — intent, approach, affectedSpecs, scope.included, scope.excluded, linkedPlan
3. Lifecycle stamps — createdAt, reviewedBy/At, reviewNotes (truncated), approvedBy/At, archivedAt
4. Transitions — the append-only state-machine log from ChangeState
5. Conflicts — any in-flight overlaps with other changes
6. Supersession — supersededBy pointer when set
7. Rollback log presence (Phase 6 produces these on partial archive failures)

Exit codes: 0 success, 1 unknown changeId, 2 parse error.

**Subcommand: `diff <id>`**

```
/loom-change diff chg-20260520-add-refund-flow
/loom-change diff chg-20260520-add-refund-flow --json
```

Renders the deltas a change WILL apply when archived. Parses the `## Deltas` body of `proposal.md` and groups output per domain:

- `+ req <text>` — added requirement
- `~ req <id>` with before/after — modified requirement
- `- req <id>` — removed requirement
- `+ scen <id> "title"` — added scenario
- `~ scen <id>` — modified scenario (summary; see proposal for full body)
- `- scen <id>` — removed scenario
- `rationale: ...`
- `migration: ...` when `breakingChange: true`

The `[BREAKING]` flag is appended to the domain heading when `breakingChange: true`.

Exit codes: 0 success, 1 unknown changeId, 2 parse error.

### Mutation subcommands (Phase 6 — fully implemented)

Each mutation subcommand runs a TypeScript script via `tsx` (Bun preferred, `npx tsx` fallback). All scripts use atomic-write conventions from `execution-conventions.md` and respect the status lifecycle from `change-state.schema.md`.

| Subcommand | Script | Transition |
|------------|--------|------------|
| `init` | `scripts/loom-change/init.ts` | (none) → `proposed` |
| `review` | `scripts/loom-change/review.ts` | `proposed` → `reviewed` |
| `approve` | `scripts/loom-change/approve.ts` | `reviewed` → `approved` |
| `run` | `scripts/loom-change/run.ts` | `approved` → `in-progress` |
| `archive` | `scripts/loom-change/archive.ts` | `in-progress` → `archived` |
| `reject` | `scripts/loom-change/reject.ts` | `{proposed, reviewed, in-progress}` → `rejected` |
| `quick-archive` | `scripts/loom-change/quick-archive.ts` | (none) → `archived` (auto-stamped via `loom-quick`) |

**Execution recipe (applies to all seven):**

1. Detect runtime: prefer `bunx tsx <script> -- <args>`; fall back to `npx tsx <script> -- <args>`.
2. Pass remaining arguments verbatim.
3. Surface stdout to the user; surface stderr as warnings; relay the exit code.

**Subcommand: `init "<title>"`**

```
/loom-change init "Add refund flow to billing"
/loom-change init "Fix idempotency" --id=chg-20260523-fix-idempotency
```

Creates `.loom/changes/chg-{YYYYMMDD}-{kebab-slug}/proposal.md` from the schema template plus an initial ChangeState in `.plan-execution/ephemeral/changes/{changeId}.toon`. Also writes a `deltas.toon` mirror (zero rows until the author fills in `## Deltas` in proposal.md). If the directory already exists with `status: rejected`, init revives it. If it exists with any other status, init refuses with exit code 1.

Flags:
- `--id=<changeId>` — explicit changeId override.
- `--actor=<identity>` — `human:{name}` or `agent:{name}` (default `human:cli`).

**Subcommand: `review <id> [--notes "..."]`**

Stamps `reviewedBy`, `reviewedAt`, and (optionally) `reviewNotes` on proposal.md. Appends a `proposed → reviewed` transition to ChangeState. Rejects illegal source states with exit code 1.

**Subcommand: `approve <id>`**

Stamps `approvedBy` and `approvedAt`. Appends `reviewed → approved` transition. Rejects illegal source states with exit code 1.

**Subcommand: `run <id>`**

Transitions `approved` → `in-progress`. If proposal.linkedPlan is set, the linkedPlan path is surfaced to stdout for the caller to dispatch via `/loom-plan execute`. Otherwise, run is a no-op-mutation: the change is marked in-progress for manual implementation, then archived via `/loom-change archive`.

**Subcommand: `archive <id>`**

THE BIG ONE. Atomically applies the DeltaBlocks from proposal.md across all `affectedSpecs` contract pages:

1. Pre-flight validates every modified/removed R-NN and S-NN ID exists on each target page; verifies `modifiedRequirements[].before` text matches current page text.
2. Runs a conflict scan against all in-flight ChangeStates. If overlap is detected on shared domains, populates `conflicts[]` on BOTH peers and aborts with exit code 1.
3. Snapshots each target page to `.bak`, then writes new bodies via `contract-page-writer.ts` (which uses `.tmp`+rename internally). If any page write fails mid-archive, restores all snapshots in reverse order and emits a rollback log to `.plan-execution/ephemeral/changes/{changeId}-rollback.toon` (exit code 3).
4. On success: refreshes the wiki index, updates proposal.md `status: archived` + `archivedAt`, appends `in-progress → archived` transition, writes `archive-log.toon`, runs supersession scan — any in-flight peer whose targeted requirements were removed gets `supersededBy: <this-id>` and its proposal.md `status: superseded`.

**Subcommand: `reject <id> --reason "..."`**

Required `--reason` (≥5 chars). Legal source states: `proposed`, `reviewed`, `in-progress`. Stamps proposal.md `status: rejected` and appends the rejection transition. Rejected proposals can be revived via `/loom-change init` against the same directory.

**Subcommand: `quick-archive`**

Library entry-point for `/loom-quick` integration. Reads a deltas + rationale payload (via `--input <json-file>` in CLI mode), synthesizes a retroactive proposal stamped `reviewedBy: loom-quick` and `approvedBy: loom-quick`, then runs the standard archive path (full atomicity, conflict, supersession checks intact). The retroactive proposal lives in `.loom/changes/` for audit. No interactive prompts.

---

## Help Output

When invoked with no arguments or `--help`, print:

```
/loom-change -- Change-proposal lifecycle over contract-* wiki pages

Query subcommands (available now):
  list             List every change with status, conflicts, supersession
  status <id>      Show full lifecycle state for one change
  diff <id>        Show the deltas a change WILL apply on archive

Mutation subcommands (available now):
  init "..."           Create a new change-proposal directory
  review <id>          Stamp reviewedBy/At; transition proposed → reviewed
  approve <id>         Stamp approvedBy/At; transition reviewed → approved
  run <id>             Mark in-flight; transition approved → in-progress
  archive <id>         Atomically apply deltas; transition in-progress → archived
  reject <id> --reason "..."   Stamp rejection
  quick-archive ...    Zero-ceremony path used by /loom-quick

Flags (any subcommand):
  --json     Emit JSON instead of a human-readable table/report

Examples:
  /loom-change list
  /loom-change status chg-20260520-add-refund-flow
  /loom-change diff chg-20260520-add-refund-flow --json
```

---

## Output and Error Handling

- All query subcommands write their primary output to stdout. Warnings (orphan files, parse errors that did not block the report) go to stderr.
- The `--json` flag swaps the human-readable table/report for JSON. Useful for tests and pipeline consumers.
- Exit codes follow the standard: `0` success, `1` unknown changeId (where applicable), `2` parse / IO error.
- Atomic-write conventions from `execution-conventions.md` apply to every artifact in `.loom/changes/` and `.plan-execution/ephemeral/changes/`. Query subcommands never write; mutation subcommands (Phase 6) MUST use `.tmp` + rename.
