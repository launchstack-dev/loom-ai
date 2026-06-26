---
description: "Render the convergence digest from state.toon — pure read, never writes state."
---

## Command: `status`

Render the convergence digest from `state.toon` — pure read, never writes state.

### Frontmatter

```yaml
agent: scripts/roadmap-converge/digest.ts
```

This command is implemented directly by `scripts/roadmap-converge/digest.ts` and
`scripts/roadmap-converge/resume-delegate.ts`. It does not spawn a subagent.
Per CLAUDE.md the model-resolution rule applies only to Agent tool calls; status
runs as a deterministic script.

### Flags

| Flag | Default | Behaviour |
|------|---------|-----------|
| `--roadmap <path>` | `planning/ROADMAP.md` | Target roadmap. Slug derived as filename sans extension. |
| `--all` | off | Scan `.roadmap-converge/*/state.toon` and render one digest per slug, ordered by mtime descending. |
| `--json` | off | Emit `RoadmapConvergeDigest` as a JSON object to stdout (one object per slug with `--all`). Suppresses glyphs. Stable schema for `/loom-next`, `/loom-status`, and CI consumers. |
| `--html` | off | Render output as an HTML file and attempt to open it in the OS default browser. Plain-text/TOON output to stdout is ALWAYS produced; `--html` is strictly additive. See § HTML rendering below. |

### HTML Rendering (`--html`)

When `--html` is passed:

1. Produce the normal digest output to stdout as usual.
2. Pipe that same output to `scripts/html-renderer/loom-roadmap-status.ts --slug {slug}`, which:
   - Writes an HTML file atomically to `.plan-execution/reports/loom-roadmap-status-{slug}-{ISO8601}.html`.
   - Calls the OS open shim (`open` on macOS, `xdg-open` on Linux).
   - **Headless fallback:** if the open shim is unavailable or returns non-zero, the renderer prints `open this in a browser: {path}` to stdout and exits 0. The HTML file is still written.
3. `--html` is incompatible with `--json` (both flags together → error: "cannot combine --html and --json"). The `--json` flag takes precedence; warn and ignore `--html`.
4. Exit code is 0 whenever the HTML file was written successfully.

### What this command does

1. Derives the slug from the target roadmap path (filename without extension,
   path-safe). Default slug = `ROADMAP` (from `planning/ROADMAP.md`).

2. **Single-slug mode (default):**
   - When `.roadmap-converge/{slug}/state.toon` does NOT exist: exits 0 with
     stdout: `"No convergence session found for {roadmapPath}. To start one, run: /loom-roadmap converge [--roadmap {roadmapPath}]"`.
     Absence of state is NOT an error for a read-only status command.
   - When the file exists and is readable: reads via the F-13 migrator entrypoint
     (`readState(slug)` from `scripts/roadmap-converge/state-io.ts`), builds a
     `RoadmapConvergeDigest` via `buildDigest(state)`, renders to stdout via
     `renderDigest(digest)`, exits 0.
   - When the file exists but is unreadable or fails migration: exits 1 with a
     stderr error message.

3. **`--all` mode:**
   - Scans `.roadmap-converge/*/state.toon` for all slugs present on disk.
   - For each slug, renders a digest and emits it to stdout separated by
     a `---` divider.
   - Digests are ordered by `state.toon` mtime descending (most recently
     modified first).
   - If no slugs exist, exits 0 with stdout:
     `"No convergence sessions found. To start one, run: /loom-roadmap converge"`.

4. **`/loom-resume` dual-state mode (via `resume-delegate.ts`):**
   When invoked from `/loom-resume` AND both `.plan-execution/pipeline-state.toon`
   and `.roadmap-converge/{slug}/state.toon` exist, `resume-delegate.ts` orders
   both by mtime and renders both digests with the most recently modified first.
   The `/loom-resume` command calls `buildResumeDigests(probeStatePaths(slug))`
   and emits each rendered string separated by `---`.

5. **`--json` mode:**
   Calls `buildDigest(state)` without `renderDigest`. Serializes the
   `RoadmapConvergeDigest` object as `JSON.stringify(digest, null, 2)` to
   stdout. Multiple slugs (from `--all`) each emit a separate JSON object
   separated by newlines.

### Purity invariant

No code path in this command or in `scripts/roadmap-converge/digest.ts` writes
to disk. The vitest grep guard in
`tests/roadmap-converge/digest-purity.test.ts` enforces this.

### Exit codes

| Code | Condition |
|------|-----------|
| 0 | Digest rendered successfully (or empty-state onboarding message printed). |
| 1 | `state.toon` exists but is unreadable or fails schema migration. |

### Where things live

| Path | What |
|------|------|
| `.roadmap-converge/{slug}/state.toon` | Read-only source of digest data. |
| `scripts/roadmap-converge/digest.ts` | `buildDigest` + `renderDigest` — pure renderer. |
| `scripts/roadmap-converge/resume-delegate.ts` | `buildResumeDigests` — dual-state ordering for `/loom-resume`. |
| `.plan-execution/pipeline-state.toon` | Read by `resume-delegate.ts` when invoked from `/loom-resume`. |

### What this command does NOT do

- Write or mutate any state (pure read).
- Run a reviewer pass (use `/loom-roadmap converge`).
- Transition to sign-off (use `/loom-roadmap sign-off`).
- Full `/loom-resume` pipeline-state rendering (Phase 6 wires the pipeline-state renderer).

### Example

```bash
/loom-roadmap status
# → reads .roadmap-converge/ROADMAP/state.toon
# → stdout:
#   === Roadmap Convergence Status: ROADMAP ===
#   Pass: 2/3   Last touched: 2026-06-17T12:00:00Z   Sign-off: not-eligible
#   Diff since last pass: +12 -3
#
#   Dimensions:
#     ✓ vision
#     ⚠ milestones
#     ✗ tool-selection
#
#   Open questions: 2 open questions
#     Q: What is the target deployment environment?
#
#   Next: /loom-roadmap converge

/loom-roadmap status --all
# → scans .roadmap-converge/*/state.toon
# → emits one digest per slug, mtime-descending, separated by ---

/loom-roadmap status --json
# → stdout: { "slug": "ROADMAP", "passNumber": 2, ... }

/loom-roadmap status --roadmap planning/ROADMAP.md
# → same as default; slug derived as "ROADMAP"

/loom-roadmap status
# (no state.toon yet)
# stdout: "No convergence session found for planning/ROADMAP.md. To start one, run: /loom-roadmap converge [--roadmap planning/ROADMAP.md]"
# exit 0
```
