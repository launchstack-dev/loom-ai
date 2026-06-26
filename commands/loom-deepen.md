---
description: "Periodic codebase deepening report. Fan-out Explore subagents surface shallow modules, apply the deletion test, and emit TOON candidates with before/after diagrams. Opt-in HTML render via --html."
---

## Command: loom-deepen

You surface shallow Modules in a codebase and recommend how to deepen them, using the vocabulary from `protocols/codebase-design.md`: **Module**, **Seam**, **Depth**, **Adapter**, **Leverage**, **Locality**.

### Arguments

| Argument | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `--html` | flag | no | false | Emit an HTML render alongside the canonical TOON file. |
| `--target <path>` | string | no | repo root | Scope the deepening scan to a subtree. |
| `--limit <N>` | integer | no | 10 | Cap on deepening candidates emitted. |

### Output

- Canonical TOON at `.plan-execution/reports/deepen-{YYYY-MM-DD}.toon` (always written).
- Optional HTML at `.plan-execution/reports/deepen-{YYYY-MM-DD}.html` (only when `--html` is passed).
- stdout prints the TOON-rendered summary table.

### Error codes

| Exit | Code | When |
|------|------|------|
| 2 | `EXPLORE_AGENT_FAILED` | At least one Explore subagent returned a non-success AgentResult; report still emits with `partial: true`. |
| 0 | `HTML_OPEN_FAILED` | `--html` was passed and `open`/`xdg-open`/`start` all failed. Falls back to printing the HTML path and the literal line `open this in a browser`. |

### Instructions

#### Step 0: Parse arguments

1. Parse `--html`, `--target <path>`, and `--limit <N>` from the remaining args.
2. Derive the date stem: `YYYY-MM-DD` from today (ISO local date).
3. Resolve target path: if `--target` was passed, use it verbatim; otherwise use the repo root (the directory containing `CLAUDE.md` or `.git/`).

#### Step 1: Invoke the explore runner

Run:
```bash
bunx tsx scripts/loom-deepen/explore-runner.ts --target <resolvedTarget> --limit <N>
```

If `bun` is not available, fall back to `npx tsx`.

The runner fans out Explore subagents over the target subtree and writes a JSON-lines stream to stdout. Each line is an object:
```json
{ "moduleName": "...", "depthBefore": 0.4, "depthAfter": 0.8, "deletionTestResult": "...", "recommendation": "...", "beforeDiagram": ".plan-execution/reports/diagrams/before-{module}.toon", "afterDiagram": ".plan-execution/reports/diagrams/after-{module}.toon" }
```

Collect all lines. If the runner exits non-zero, set `partial: true` and continue with whatever rows were collected (at least emit the report). If zero rows were collected and the runner failed, exit 2 with code `EXPLORE_AGENT_FAILED`.

#### Step 2: Validate vocabulary usage

Each candidate row MUST cite at least one term from `{Module, Seam, Depth, Adapter, Leverage, Locality}` in its `recommendation` field. If a row is missing vocabulary, prepend the most applicable term based on the `depthBefore`/`depthAfter` delta:
- High Depth gain → "Depth"
- Mentions substitution → "Seam"
- Mentions translation/bridging → "Adapter"
- Mentions downstream change → "Leverage"
- Mentions co-location → "Locality"

#### Step 3: Write the TOON report

Write atomically (`.tmp` + rename) to `.plan-execution/reports/deepen-{YYYY-MM-DD}.toon`:

```toon
date: {YYYY-MM-DD}
target: {resolvedTarget}
limit: {N}
partial: {true|false}
candidateCount: {N}
candidates[N]{moduleName,depthBefore,depthAfter,deletionTestResult,recommendation,beforeDiagram,afterDiagram}:
  {moduleName},{depthBefore},{depthAfter},{deletionTestResult},{recommendation},{beforeDiagram},{afterDiagram}
  ...
```

Print the TOON report to stdout.

#### Step 4: Write HTML (--html only)

If `--html` was passed, invoke the HTML renderer:
```bash
bunx tsx scripts/loom-deepen/render-html.ts --input .plan-execution/reports/deepen-{YYYY-MM-DD}.toon --output .plan-execution/reports/deepen-{YYYY-MM-DD}.html
```

If `bun` is not available, fall back to `npx tsx`.

After the HTML file is written, attempt to open it using:
1. `open` (macOS)
2. `xdg-open` (Linux)
3. `start` (Windows)

Try them in order; stop at the first that succeeds. If all three fail, do NOT exit non-zero. Instead:
1. Print the HTML file path to stdout.
2. Print the literal line: `open this in a browser`
3. Emit `HTML_OPEN_FAILED` to stderr at info severity.
4. Exit 0.

**Important:** when `--html` is NOT passed, no `.html` file is created and no open is attempted.

#### Step 5: Status summary

Print a one-line summary to stdout:
```
loom-deepen complete: {candidateCount} candidates, report at .plan-execution/reports/deepen-{YYYY-MM-DD}.toon
```
