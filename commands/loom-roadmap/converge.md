---
description: "Drive a roadmap toward ready via iterative review → user-input → mutate cycles."
---

## Command: `converge`

Drive a roadmap toward "ready" via iterative review → batched-user-input → mutate cycles. Sibling to `/loom-converge`, NOT under `/loom-auto` — this loop pauses for human judgement.

Sign-off via `/loom-roadmap sign-off` is the only path to `converged`. This command alone never marks a roadmap converged.

### Frontmatter

```yaml
agent: agents/roadmap-converge-driver.md
```

Per CLAUDE.md mandatory model-resolution, the driver agent's frontmatter (`model: opus`) is honored when the orchestrator spawns it. The driver in turn spawns `agents/roadmap-converge-reviewer.md` (frontmatter `model: sonnet`) once per dimension in parallel.

### Flags

| Flag | Default | Behaviour |
|------|---------|-----------|
| `--roadmap <path>` | `planning/ROADMAP.md` | Target a specific roadmap (multi-roadmap; full support in Phase 4). |
| `--force` | off | Force-acquire the concurrency lock even when a fresh one is held. Use only when you are certain the prior pass is dead. |
| `--archetype <name>` | auto / `default` | Override archetype detection. Wave 1 ships the no-op hook; the override is wired and ready. |
| `--max-passes <N>` | from `[roadmap.converge].maxPasses` or `3` | Override the per-pass cap. Clamped to `[1, 5]`. |

### What this command does

1. Resolves the target roadmap (`--roadmap` or `planning/ROADMAP.md`) and derives a path-safe `slug` (filename sans extension).
2. Spawns `agents/roadmap-converge-driver.md` which calls `runConvergePass` in `scripts/roadmap-converge/driver.ts`.
3. The driver:
   - Acquires `.roadmap-converge/{slug}/.lock` atomically (10-min stale window; `--force` escapes).
   - Detects archetype via the seam (no-op default in Wave 1; Phase 4 fills it).
   - Hashes the roadmap and invalidates all dimensions when the hash changed since the last pass.
   - Fans out `agents/roadmap-converge-reviewer.md` once per dimension (parallel).
   - Aggregates reviewer envelopes, applies the per-dimension 5-finding cap, renders findings per the F-15 rule (yellow → green exemplar inline; red → both exemplars inline).
   - Writes `.roadmap-converge/{slug}/state.toon` atomically and `.plan-execution/stage-context/execute.toon` atomically.
   - Releases the lock.
4. Surfaces a short markdown digest to the user (per-dimension status, open-question count, suppressed count, sign-off eligibility).

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | Pass completed (whether or not the roadmap converged). |
| 1 | Pre-flight failure. Stderr contains the reason code: `ROADMAP_MISSING`, `LOCK_CONFLICT`. |

### Where things live

| Path | What |
|------|------|
| `.roadmap-converge/{slug}/state.toon` | Durable per-roadmap state (atomic writes). Tracked by git. |
| `.roadmap-converge/{slug}/.lock` | Concurrency lock. Ephemeral; gitignored. |
| `.plan-execution/stage-context/execute.toon` | Per-pass stage summary (atomic writes). Tracked by git. |
| `protocols/roadmap-converge-state.schema.toon` | Schema for state.toon. |
| `protocols/roadmap-rubrics/{dim}.md` | Per-dimension rubrics (Green/Yellow/Red exemplars). |

### What this command does NOT do (deferred)

- Sign-off (`/loom-roadmap sign-off` — Phase 2)
- 30-second diff view (Phase 2)
- Status digest (`/loom-roadmap status` already exists; integration in Phase 3)
- Multi-roadmap support beyond `--roadmap` (Phase 4)
- Archetype detection logic (Phase 4)
- Integrator/mutator (Phase 5)
- `/loom-resume` delegation when `.roadmap-converge/{slug}/state.toon` exists (Phase 6)

### Example

```bash
/loom-roadmap converge
# → pass 1/3 starts, 8 reviewers fan out in parallel, state.toon written

/loom-roadmap converge
# → second invocation within 10 min while first holds the lock:
#   stderr: "[roadmap-converge] LOCK_CONFLICT — another converge pass is in progress..."
#   exit 1

/loom-roadmap converge --force
# → steals the lock and proceeds. Use only after confirming the prior pass is dead.
```
