---
description: "Convert an approved roadmap + completed plan into per-domain contract-* wiki pages."
---

## Subcommand: materialize

You are the materializer dispatcher for the contract-page lifecycle. Per D-02 in PLAN-spec-upgrades.md, this command is the **primary trigger surface** for converting an approved roadmap + completed plan into per-domain `contract-*` wiki pages.

### Arguments

Parse remaining arguments:

- No args: run materialization against the current working directory's `ROADMAP.md`, `PLAN.md`, and `.loom/wiki/contract-partition.toon`. Writes pages to `.loom/wiki/pages/contract-*.md` and updates `.loom/wiki/index.toon`.
- `--dry-run`: print the materialization plan (per-domain summary of scenarios + requirements + entities) without writing pages or updating the wiki index.
- `--propose-partition`: scaffold `.loom/wiki/contract-partition.toon` from entities discovered in the source roadmap+plan. **Does not materialize.** Exits after writing the manifest; the user must review and commit it before running materialize for real.
- `--wiki-root <path>`: override the wiki root (default `.loom/wiki`).
- `--roadmap <path>`: override the roadmap path (default `ROADMAP.md`).
- `--plan <path>`: override the plan path (default `PLAN.md`).
- `--partition <path>`: override the partition path (default `<wiki-root>/contract-partition.toon`).

### Instructions

#### Step 0: Preconditions

Check that the materializer script exists at `scripts/materialize-contracts.ts`. If not, this is a stale install — instruct the user to run `/loom-upgrade` and stop.

#### Step 1: Dispatch to the script

Invoke the materializer:

```bash
npx tsx scripts/materialize-contracts.ts [flags...]
```

(or `bunx tsx` if `bun` is available — both are supported.)

Forward all remaining arguments verbatim. The script handles flag parsing internally.

#### Step 2: Surface the result

The script writes structured output to stdout and warnings to stderr:

- **`--propose-partition` mode**: prints the path to the new manifest and the entity count. Tell the user to review `.loom/wiki/contract-partition.toon`, split the `default` partition into coherent bounded contexts, then re-run `/loom-plan materialize`.
- **`--dry-run` mode**: prints a per-domain summary (scenarios, requirements, entities counts) without writing anything. Surface this directly to the user.
- **Normal mode**: prints the list of materialized `contract-{domain}.md` pages with their `contentChecksum` values plus the updated `wikiVersion` and `pageCount`. Echo back to the user.

#### Step 3: Error handling

- **Exit code 1 with "partition manifest not found"**: tell the user to run `/loom-plan materialize --propose-partition` first.
- **Exit code 1 with a validation error** (duplicate domain, non-kebab-case domain, entity overlap): surface the script's error verbatim and instruct the user to edit `.loom/wiki/contract-partition.toon`.
- **Exit code 2**: unknown flag — surface the script's stderr.

#### Step 4: Suggest next steps

If pages were materialized successfully, suggest:

1. Inspect one or more pages with `cat .loom/wiki/pages/contract-{domain}.md`.
2. Verify integrity with `loom-wiki lint` (Phase 7 will add the contract-page body-section validator).
3. Begin using `/loom-change init` for subsequent mutations rather than editing pages directly — manual edits are detected via `contentChecksum` drift.

### Notes

- The materializer is the **only** authorized writer for greenfield content. Steady-state mutations come from archived change proposals (Phase 6).
- Re-running against unchanged inputs is byte-identical (when the same `now` is provided — the writer stamps `createdAt`/`updatedAt`). When timestamps differ across runs, the body content checksum remains stable.
- If the source roadmap+plan contain no scenarios, the generated pages include a `## Scenarios` placeholder and the materializer logs a warning. Upgrade the plan to `planVersion: 2` and add scenarios, then re-run.
