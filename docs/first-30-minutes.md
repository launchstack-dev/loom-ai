# Your First 30 Minutes with Loom

A single-path quickstart. We're going to do two commands on a real project of yours: `/loom-init` to onboard it, then `/loom-quick` to run a small task with full rigor. By the end you'll have seen what Loom puts on disk, what it says when it works, and what changed in your repo.

> **Time honest:** budget 30 minutes. ~5 for install + verify, ~5 for `/loom-init`, ~15 for `/loom-quick` (most of which is Loom thinking, not you typing).

> **Before you start, read [`concepts.md`](./concepts.md)** (5 min). You'll see the words "scope contract," "wave," "convergence" in the first command's output. The concepts page makes them stop being noise.

---

## Before you start

Three prereqs (full list in the README):

- **Claude Code** CLI or IDE extension — Loom installs into `~/.claude/`.
- **bash 4+** (macOS Homebrew bash works; the default shell does not).
- **Node 18+** with **bun** (recommended) or `npx tsx` fallback — Loom's hooks are TypeScript.

Platforms: macOS Apple Silicon + Intel, Ubuntu 22.04+. Windows is not supported today.

> **Not sure which `/loom-*` command applies to your task?** Run `/loom-which` at any point. It walks a short decision tree (1–3 questions) and recommends the right command. Different from `/loom-do` (which infers intent silently from a natural-language prompt) and `/loom-reference` (which is a flat lookup table).

---

## Install (~30 seconds)

One-liner:

```bash
curl -fsSL https://raw.githubusercontent.com/launchstack-dev/loom-ai/main/install.sh | bash
```

This fetches commands + hooks + the statusline renderer into `~/.claude/`, validated against `checksums.sha256`. Nothing outside `~/.claude/` or `~/.cache/loom/` is touched.

**Verify it took:**

```bash
ls ~/.claude/commands/loom*.md          # expect ~25 files
```

Then **inside a Claude Code session** (start a new one if needed — Claude Code only re-scans commands on session start):

```
/loom
```

You should see the root help text. If you get `Unknown command`, restart Claude Code or check that `~/.claude/commands/loom.md` exists. (More in [`troubleshooting.md`](./troubleshooting.md).)

---

## Step 1: Onboard your project — `/loom-init`

Pick a real project of yours. Brownfield (existing code) is fine — this is what `/loom-init` is for. `cd` into it inside Claude Code, then:

```
/loom-init
```

### What it does

`/loom-init` runs 4 discovery agents **in parallel** for ~2-3 minutes:

- **project-guidance-agent** — reads your manifests, detects tech stack, infers conventions.
- **api-explorer** — finds internal endpoints and external integrations.
- **docs-auditor** — audits existing docs for staleness and gaps.
- **planning-docs-agent** — finds existing PRDs, ADRs, vision docs and extracts decisions.

Then it generates `CLAUDE.md` + `CONTEXT.md`, seeds a `.loom/wiki/` knowledge base, and registers wiki-health hooks in `.claude/settings.json`.

### What you'll see (real output shape)

The terminal walks you through three blocks. First a project scan:

```
## Project Scan

Existing Loom artifacts:
  CLAUDE.md       -- not found
  CONTEXT.md      -- not found
  ROADMAP.md      -- not found
  ...
Project files:
  package.json    -- found (Node.js / TypeScript)
  README.md       -- found (42 lines)
  src/            -- 23 files
  tests/          -- 8 files
Planning documents found:
  docs/PRD.md             -- 142 lines (product requirements)
```

If your `.gitignore` excludes `.loom/` or `planning/history/`, you'll get a "Gitignore Conflict Detected" prompt — say yes; those directories need to survive across sessions.

Then a discovery report (tech stack, architecture pattern, API surface, doc status, conventions, known tech debt, planning docs).

Then the completion summary:

```
## Onboarding Complete

Files created:
  CLAUDE.md     -- 94 lines (project guidance for Claude Code)
  CONTEXT.md    -- 67 lines (project context and locked decisions)
  .loom/wiki/   -- 14 pages (component(4), api-surface(3), convention(2), tech-debt(3), decision(2))

Discovery:
  Tech stack:     TypeScript, Next.js, Prisma, PostgreSQL
  API endpoints:  14 internal, 3 external integrations
  Doc status:     README current, API docs missing, 0 ADRs

Next steps:
  /loom-roadmap init --brownfield       Create a roadmap informed by this analysis
  /loom-note "your observation"        Start capturing notes for the roadmap
  ...
```

### What appeared on disk

```
CLAUDE.md                            # Claude Code project guidance (≤200 lines)
CONTEXT.md                           # Always-loaded domain glossary (≤50 terms — F-18 split)
DECISIONS.md                         # Locked decisions, constraints, doc gaps (was the old monolithic CONTEXT.md)
.claude/settings.json                # Wiki health hooks registered (3 entries)
.loom/wiki/                          # Persistent knowledge base
  index.toon                         # Page catalog
  pages/                             # ~10-30 generated pages
  log.toon                           # Wiki operation log
planning/                            # Planning skeleton
  README.md                          # One-paragraph orientation
  plans/                             # (empty for now)
  archive/                           # (empty)
  history/                           # (empty)
.plan-execution/
  init-report.toon                   # Snapshot of what discovery found
```

**Open `CLAUDE.md` and skim it.** It should describe your codebase in a way that's accurate — if anything is fabricated (paths that don't exist, frameworks you don't use), tell me; that's a bug.

**Open `.loom/wiki/index.toon`.** See the page list. These pages are the knowledge base every future Loom command will consult.

**Open `CONTEXT.md` and `DECISIONS.md`.** `CONTEXT.md` is the domain glossary — ≤50 terms Claude Code loads at the start of every session, so agents speak your vocabulary in their first response. `DECISIONS.md` is where locked decisions live (formerly mixed into the monolithic `CONTEXT.md` before F-18 split them apart). If you upgraded from a pre-F-18 Loom install, run `bun scripts/migrate-context-split.ts .` to perform the split idempotently.

---

## Step 2: Run a small task — `/loom-quick`

`/loom-quick` is **zero-ceremony task execution with Loom rigor**: wiki context + impact assessment + verification + audit log, in one command. Pick something genuinely small — a one-file fix, a small feature, a refactor in one module. Don't pick "rewrite the auth system."

```
/loom-quick "Add input validation to the signup form"
```

(Substitute your own task. If you can't think of one, try something like "Rename the `logger` variable to `log`" or "Add a TODO comment above the broken function" — anything where you can see whether Loom did it.)

> **Bug fix instead?** Reach for `/loom-bugfix "<symptom>"` rather than `/loom-quick`. F-18 added a Phase-1 gate: `loom-bugfix` (and `/loom-converge` in default mode) now refuses to produce a hypothesis until a verified-red `loop.toon` exists — a tight, deterministic, agent-runnable red signal. If your harness can't reliably reproduce the bug, the gate halts with a named state (`stuck-at-loop-construction`) and HITL escalation guidance. Exit codes 4–10 each map to a specific recovery step in [`troubleshooting.md`](./troubleshooting.md#5b-loom-bugfix--loom-converge-halted-at-the-loop-construction-gate-f-18).

### The four phases

`/loom-quick` runs:

1. **Mode detection** — checks for `PLAN.md` and `.plan-execution/state.toon`. No plan present → `standalone` mode. Prints `Mode: standalone`.
2. **Context gather** — reads `CLAUDE.md`, scans the codebase, queries `.loom/wiki/` to find pages relevant to your task. If your task is user-facing-language ("users can't sign up"), it tries `flow-*` pages first.
3. **Execute** — actually does the work. Writes/edits files.
4. **Post-execution** — runs your verification commands (auto-detected from `package.json`: `bun run test`, `bun run lint`, `bun run typecheck`); does impact assessment (traces dependents, classifies scope); writes an audit log; offers a commit.

### What you'll see at the end

```
--- Quick Task Complete ---
Mode:         standalone
Task:         Add input validation to the signup form
Files:        src/auth/signup.ts, src/auth/signup.test.ts
Impact:       low risk, module scope
Regression:   none
Verification: pass
Log:          planning/history/quick-tasks/2026-06-13-add-input-validation-to.toon
Commit:       a3f7e2c
```

Then a prompt: `Commit changes with /loom-git commit? (y/n)`. Say yes.

### What appeared on disk

- The file(s) Loom edited (from the `Files:` line).
- `planning/history/quick-tasks/{YYYY-MM-DD}-{slug}.toon` — the **QuickTaskLog**, an audit record of what just happened (description, files changed, verification result, impact assessment, commit hash, wiki pages consulted).
- A git commit (if you accepted the offer).

**Open the QuickTaskLog.** TOON format, ~30 lines. This is the trail of breadcrumbs that lets future you (or future Loom agents) understand why a change happened.

---

## What just happened

In ~20 minutes you saw three of the five concepts from [`concepts.md`](./concepts.md) in action:

- **Wiki knowledge** — `/loom-init` built a knowledge base; `/loom-quick` read it to ground the task in your project's actual conventions and components instead of generic LLM guesses.
- **Impact assessment** — `/loom-quick` didn't just edit code; it traced dependents and classified the blast radius. If you had touched something high-impact, it would have surfaced regression areas to watch.
- **Audit trail** — every task leaves a `QuickTaskLog` behind. There is no "I changed something three months ago and forgot why" — the log is the why.

You did NOT see (yet): the scope contract (it's pre-flight for `/loom-auto`, not `/loom-quick`), waves (only `/loom-plan execute` uses them), or the change lifecycle (kicks in after you materialize contract pages).

---

## Three things to try next

Pick one based on what your project needs:

1. **`/loom-status`** — see what Loom now thinks about your project (test metrics, convergence state, context budget). 30 seconds.
2. **`/loom-wiki query "<a real question about your codebase>"`** — ask the wiki something. E.g., "where is auth handled?" or "what tests cover the billing module?" Tests whether the wiki is actually useful for your project.
3. **`/loom-deepen --target .`** — F-18's codebase-health pass. Fans out `Explore` subagents, surfaces shallow modules (modules with thin or low-leverage interfaces), applies the deletion test, and emits before/after diagrams for ≥3 deepening candidates. Default TOON output; `--html` opt-in adds an HTML report. Useful early — it points at the parts of your codebase Loom thinks are easiest to refactor.
4. **`/loom-auto --from "<a real feature you want>"`** — the full autonomous pipeline (scope contract → roadmap → plan → execute → converge → review). This is where Loom really shows what it does. Budget ~30-60 min.

If you hit anything weird, [`troubleshooting.md`](./troubleshooting.md) is the first stop. If it's not there, that's a doc bug — tell me.

---

## A note on what to NOT do yet

- **Don't** run `/loom-roadmap init` on a half-baked idea just to see what happens. Roadmap creation is interview-heavy; do it when you have a real next-milestone goal.
- **Don't** edit files inside `.plan-execution/` or `.loom/wiki/pages/` directly. Hooks will mostly block you; the parts that don't block will create drift later.
- **Don't** skip `/loom-init` and jump straight to `/loom-auto` on an existing project. Loom needs the wiki + CLAUDE.md context for its agents to make sense of your code.
- **Don't** hand-author `loop.toon` files. Let `/loom-converge --construct-loop` build them — the TRDA gate (tight, redCapable, deterministic, agentRunnable) enforces a specific shape and the 10-rung ladder picks the right harness type. Writing one by hand bypasses the gate that exists to keep iterations against verified-red signals.
