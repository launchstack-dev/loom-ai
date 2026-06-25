```toon
pageId: convention-toon-format
title: TOON Format
category: convention
domain: code
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-04-25T22:00:00Z
createdBy: human
updatedBy: human
sourceRefs[1]: protocols/toon-format.md
crossRefs[2]{pageId,relationship}:
  convention-agent-result,depended-by
  concept-execution-pipeline,relates-to
tags[4]: toon, format, serialization, artifacts
staleness: fresh
confidence: high
```

# TOON Format

TOON (Token-Oriented Object Notation) is the default serialization format for all Loom on-disk artifacts and agent-to-agent communication. It is a compact, human-readable alternative to JSON optimized for token efficiency in LLM contexts.

Source: `protocols/toon-format.md`

---

## Syntax

TOON has four constructs:

### Flat Scalars

```toon
agent: contracts-agent
wave: 0
status: success
durationMs: 34500
```

Key-value pairs with no quotes. Types are preserved: numbers stay numbers, booleans stay booleans.

### Inline Arrays

```toon
filesCreated[3]: src/auth/middleware.ts, src/auth/token.ts, src/auth/types.ts
```

The count `[N]` is declared in the header. For empty arrays: `filesDeleted[0]:` — empty arrays must be present.

### Typed Arrays (Tables)

```toon
exportsAdded[2]{name,file,kind}:
  authMiddleware,src/auth/middleware.ts,function
  TokenPayload,src/auth/types.ts,interface
```

The header declares column names in `{col1,col2,...}`. Each row is a comma-separated line with 2-space indent. This is the most common pattern for structured data in agent results.

### Nested Blocks

```toon
context:
  task: Build auth module
  location: src/auth
  deadline: 2026-04-10
```

Child keys are indented 2 spaces under the parent key.

---

## Where TOON Is Used

TOON is mandatory for all Loom runtime artifacts. The `CLAUDE.md` mandate: "All Loom on-disk artifacts, agent output formats, protocol schemas, state files, and inter-agent communication MUST use TOON."

| File | Purpose |
|------|---------|
| `state.toon` | Execution state (resumable) |
| `pipeline-state.toon` | `/loom-auto` pipeline state |
| `contracts/manifest.toon` | Contract file registry |
| `progress/{taskId}.toon` | Agent heartbeat/progress |
| `requests/{taskId}.toon` | Cross-boundary change requests |
| `wave-N-summary.toon` | Per-wave results |
| `scope-coverage.toon` | Acceptance criteria coverage matrix |
| `stage-context/{stage}.toon` | Stage summaries |
| `convergence-plan.toon` | Convergence target definitions |
| `convergence/iterations/iter-N.toon` | Per-iteration convergence summaries |
| Wiki frontmatter blocks | Wiki page metadata |

Agent outputs are also returned as fenced ` ```toon ` blocks in agent responses. The orchestrator accepts both TOON and JSON output and normalizes internally.

---

## Exceptions

These formats use their **native format** rather than TOON:

| Format | Files |
|--------|-------|
| JSON | `package.json`, `tsconfig.json`, AJV schema files (`*.schema.json`), third-party API payloads |
| TOML | `orchestration.toml`, `library.yaml` |
| Hook I/O | Follows Claude Code's JSON protocol per Claude Code spec |

App-specific data being compared or generated (e.g., JSON API responses, SQL result sets, HTML output) also uses its native format — TOON is for Loom metadata, not application data.

---

## Roundtrip Guarantee

TOON is a lossless encoding of the JSON data model:

```
encode(json) → toon
decode(toon) → json
decode(encode(json)) === json  // always true
```

Types are preserved through the roundtrip. This means TOON can be used anywhere JSON would be used within the Loom system.

---

## Atomic Writes

All TOON state files must be written atomically:

1. Write content to `{path}.tmp`
2. `fs.renameSync('{path}.tmp', '{path}')`

Never write directly to the target path. This prevents partial reads by concurrent agents or the orchestrator.

---

## Reading and Writing in Agents

**Reading:**
1. Read the `.toon` file from disk
2. Parse using TOON format rules (or `decode()` from `@toon-format/toon`)
3. Use the resulting data structure

**Writing:**
1. Construct data as a structured object
2. Encode to TOON
3. Write atomically (`.tmp` → rename)

---

## If You Find JSON Where TOON Should Be

The `CLAUDE.md` mandate states: "If you find an existing Loom artifact using JSON where TOON should be used, convert it." Use the `loom-upgrade` command to scan for and migrate old-format artifacts.
