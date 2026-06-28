---
pageId: command-loom-deepen
category: command
tags[4]: loom-deepen,deepening,shallow-module,explore-subagent
lastUpdated: 2026-06-26T00:00:00Z
updatedAt: 2026-06-26T00:00:00Z
updatedBy: wiki-maintainer-agent
staleness: fresh
summary: /loom-deepen runs a periodic codebase health pass that fans out Explore subagents to surface shallow modules, applies the deletion test, and emits a TOON candidates report with before/after diagrams; --html enables an optional HTML render.
estimatedTokens: 750
bodySections[4]: Summary,Arguments,Output,Explore Runner Fan-Out
relatedFiles[1]:
  commands/loom-deepen.md
crossRefs[3]{pageId,relationship}:
  protocol-codebase-design,consumes
  feature-f18-mattpocock-skills-adoption,implemented-by
  command-loom-which,relates-to
---

## Summary

`/loom-deepen` (F-18 Phase C, sub-10) surfaces shallow modules in a codebase using the vocabulary from `protocols/codebase-design.md`: **Module**, **Seam**, **Depth**, **Adapter**, **Leverage**, **Locality**. It fans out Explore subagents over a target subtree and emits a TOON candidates report with before/after diagrams. Source of truth: `commands/loom-deepen.md`.

## Arguments

| Argument | Type | Default | Description |
|----------|------|---------|-------------|
| `--html` | flag | false | Emit an HTML render alongside the canonical TOON file. |
| `--target <path>` | string | repo root | Scope the scan to a subtree. |
| `--limit <N>` | integer | 10 | Cap on deepening candidates emitted. |

## Output

- **Always:** TOON report at `.plan-execution/reports/deepen-{YYYY-MM-DD}.toon`
- **`--html` only:** HTML at `.plan-execution/reports/deepen-{YYYY-MM-DD}.html`
- stdout prints the TOON-rendered summary table.

When `--html` is passed, the command attempts to open the file via `open` (macOS) → `xdg-open` (Linux) → `start` (Windows). If all three fail, it prints the file path + `open this in a browser` and exits 0 (`HTML_OPEN_FAILED` warning, not failure).

## Explore Runner Fan-Out

The command delegates to `scripts/loom-deepen/explore-runner.ts` which fans out Explore subagents over the target subtree. Each candidate row in the JSON-lines stream carries: `moduleName`, `depthBefore`, `depthAfter`, `deletionTestResult`, `recommendation`, `beforeDiagram`, `afterDiagram`.

Each row's `recommendation` field must cite at least one vocabulary term from `{Module, Seam, Depth, Adapter, Leverage, Locality}`. If missing, the command prepends the most applicable term based on the `depthBefore`/`depthAfter` delta.

## Error Codes

| Exit | Code | When |
|------|------|------|
| 2 | `EXPLORE_AGENT_FAILED` | At least one Explore subagent failed; report emits with `partial: true` |
| 0 | `HTML_OPEN_FAILED` | `--html` passed but OS open shim failed |

## Related Pages

- [Codebase design vocabulary](protocol-codebase-design.md)
- [/loom-which router](command-loom-which.md)
