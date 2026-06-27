# Loom Cheatsheet

One page. Organized by **what you want to do**, not by command grouping. For the full command tree see the README.

> If you don't know what a "scope contract" or "convergence" is yet, read [`concepts.md`](./concepts.md) first.

---

## Starting out

| I want to… | Run this |
|---|---|
| Onboard an existing project | `/loom-init` |
| Audit a project without writing anything | `/loom-init --audit-only` |
| Run a tiny task with Loom rigor (verify + impact + log) | `/loom-quick "<task>"` |
| Go fully autonomous from a one-line idea | `/loom-auto --from "<idea>"` |
| See what's installed vs. available | `/loom-library list` |
| Install a kit on demand | `/loom-library use <kit>` |
| Not sure which `/loom-*` command applies — get a decision-tree recommendation | `/loom-which` |

## Building a feature

| I want to… | Run this |
|---|---|
| Sketch a roadmap | `/loom-roadmap init` |
| Brainstorm a feature across personas | `/loom-roadmap explore "<idea>"` |
| Lock the roadmap | `/loom-roadmap approve` |
| Create the plan (plan + criteria, dual-track) | `/loom-plan create` |
| Have agents review the plan | `/loom-plan review` |
| Execute wave-by-wave | `/loom-plan execute` |
| Resume a halted execution | `/loom-plan execute --resume` |
| Run convergence until criteria pass | `/loom-converge --criteria --full` |
| Materialize finished milestone into wiki contract pages | `/loom-plan materialize` |

## Fixing a bug

| I want to… | Run this |
|---|---|
| Fix one bug with full rigor | `/loom-bugfix "<symptom>"` |
| Iterate convergence on one feature | `/loom-converge --criteria --feature F-01` |
| Run just unit tier | `/loom-converge --criteria --tier unit` |
| Run E2E with authenticated browser | `/loom-converge --criteria --tier e2e --chrome` |
| List active feedback loops | `/loom-converge --loops` |
| Retire a converged loop | `/loom-converge --retire-loop <loopId>` |
| Skip the loop-construction gate (escape hatch) | `/loom-bugfix --override-loop-gate "<reason>"` |

> **F-18 gate:** `loom-bugfix` and `loom-converge` halt at Phase-0/Phase-1 until a verified-red `loop.toon` exists (a tight, deterministic, agent-runnable red signal). If the harness can't produce one, escalate down the 10-rung ladder (`failing test → curl → CLI+fixture → headless browser → trace replay → throwaway harness → fuzz → bisection → differential → HITL bash`). The escape hatch `--override-loop-gate "<reason>"` proceeds without the gate but logs the reason prominently. See `protocols/feedback-loop.schema.md`.

## Codebase health (F-18)

| I want to… | Run this |
|---|---|
| Find shallow modules and deepening candidates | `/loom-deepen --target .` |
| Limit candidate count | `/loom-deepen --target . --limit 5` |
| Also emit an HTML report | `/loom-deepen --target . --html` |
| Author a throwaway logic prototype (terminal app) | `/loom-prototype <name> --branch logic` |
| Author a throwaway UI prototype (parallel UI variants on one route) | `/loom-prototype <name> --branch ui` |
| Link the prototype to an ADR for completion ceremony | `/loom-prototype <name> --branch <type> --adr ADR-NNNN` |

## Code review and fixes

| I want to… | Run this |
|---|---|
| Review unstaged changes | `/loom-code review` |
| Review staged only | `/loom-code review --staged` |
| Review a specific PR | `/loom-code review --pr 123` |
| Full review (all reviewers) | `/loom-code review --full` |
| Apply review findings as fixes | `/loom-code fix` |
| Dry-run the fix plan first | `/loom-code fix --dry-run` |
| Apply only critical findings | `/loom-code fix --severity critical` |

## Schema / spec changes (post-materialize)

| I want to… | Run this |
|---|---|
| Propose a change to a contract page | `/loom-change init "<description>"` |
| See open changes | `/loom-change list` |
| Review a proposed change | `/loom-change review <changeId>` |
| Approve a reviewed change | `/loom-change approve <changeId>` |
| Run the approved change | `/loom-change run <changeId>` |
| Archive a completed change (atomic) | `/loom-change archive <changeId>` |
| Reject a proposal | `/loom-change reject <changeId>` |

## Knowledge / wiki

| I want to… | Run this |
|---|---|
| Ask the wiki a question | `/loom-wiki query "<question>"` |
| Ingest fresh code into the wiki | `/loom-wiki ingest --diff` |
| Lint the wiki for drift | `/loom-wiki lint` |
| Show wiki health | `/loom-wiki status` |

## Session management

| I want to… | Run this |
|---|---|
| Pause active work (snapshot state) | `/loom pause` |
| Pause and compact context | `/loom pause --compact` |
| Resume after a pause / context clear | `/loom resume` |
| State-aware next-step suggestion | `/loom next` |
| Project overview (tests, convergence, budget) | `/loom-status` |
| Natural-language routing to the right command | `/loom do "<what you want>"` |

## When you're stuck

| I want to… | Run this |
|---|---|
| Two-agent debate over a decision | `/loom-debate "<topic>"` |
| Progressive refinement (draft → harden) | `/loom-chain "<task>"` |
| N parallel solutions, pick the best | `/loom-vote "<task>" --candidates 3` |
| Route mixed-complexity work to a specialist | `/loom-triage "<task>"` |
| Blow it all away and start over | `rm -r .plan-execution/ && /loom-plan create` |

## Git workflow

| I want to… | Run this |
|---|---|
| Commit (Loom-aware message) | `/loom-git commit` |
| Push branch | `/loom-git push` |
| Open a PR | `/loom-git pr` |
| Merge a PR | `/loom-git merge` |
| Review a PR | `/loom-git review-pr <num>` |

## Authoring (extending Loom + creating new artifacts)

| I want to… | Run this |
|---|---|
| Create a project-specific agent | `/loom-agent create` |
| List registered agents | `/loom-agent list` |
| Configure status line | `/loom-statusline-setup` |
| Author a new model-invoked or user-invoked skill (guided interview) | `/loom-skill create` |
| Author throwaway code as a deliberate phase (terminal app) | `/loom-prototype <name> --branch logic` |
| Author throwaway code (parallel UI variants on one route) | `/loom-prototype <name> --branch ui` |
| Link a prototype to an originating ADR (completion ceremony updates the ADR with a `prototypeAnswer:` line) | `/loom-prototype <name> --branch <type> --adr ADR-NNNN` |
| Author a new ADR — only when triggered: `loom-converge` resolves a blocking conflict OR `loom-roadmap converge` records a load-bearing rejection (not lazy-on-first-write) | Write `docs/adr/{NNNN}-{kebab-title}.md` per `docs/adr/README.md` |
| Construct a `loop.toon` for `loom-converge` (interactive Phase-0 walkthrough) | `/loom-converge --construct-loop` |
| Not sure which authoring surface applies — get a decision-tree recommendation | `/loom-which` |

---

## Common flags (most commands accept these)

| Flag | What it does |
|---|---|
| `--from "<desc>"` | Seed the command with a description (used by `/loom-auto`, `/loom-roadmap init`, etc.) |
| `--full` | Run the full / extended variant (all reviewers, all tiers, full convergence) |
| `--quick` | Faster, lighter variant (fewer reviewers, fewer tiers) |
| `--auto` | Accept all default choices, no interactive prompts |
| `--resume` | Continue from saved state instead of starting fresh |
| `--no-verify` | Skip verification (faster, less safe) |
| `--no-commit` | Skip the auto-commit offer |
| `--dry-run` | Show what would happen without doing it |

---

**Lost?** [`first-30-minutes.md`](./first-30-minutes.md) walks the happy path. [`troubleshooting.md`](./troubleshooting.md) decodes error messages.
