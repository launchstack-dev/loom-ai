<!-- Marketplace listing copy. Section ordering is load-bearing: Header → Outcomes → Quickstart → Decision matrix → Differentiation → Support. The support-expectation line MUST appear above the install command block (line-ordering assertion in Phase 12). -->

# Loom

**Summary:** Ship plans, not prompts — Loom orchestrates planning waves, convergence loops, and a repo-committed wiki across your Claude Code agents.

**Tags:** `agentic`, `planning`, `convergence`, `wiki`, `code-review`, `orchestration`, `claude-code`

**Description:**

Loom turns Claude Code into a disciplined delivery system. Plan in waves with parallel implementers, converge on acceptance criteria through automated review-fix loops, and capture every decision in a repo-committed wiki your team actually reads. Brownfield-friendly /loom-init bootstraps CLAUDE.md and a roadmap from any existing codebase; greenfield projects start from a single command. Built for teams that want repeatable outcomes, not prompt-of-the-day improvisation.

## Outcomes

- **Planning waves that actually parallelize.** Wave-based execution with explicit file ownership lets multiple implementer agents work concurrently without stomping on each other's files.
- **Convergence loops that finish.** Acceptance-criteria-driven review-fix cycles run until the change matches the spec — no half-merged PRs, no "ship it and pray."
- **A repo-committed wiki that compounds.** Every decision, plan, and review lands in versioned markdown alongside the code, so the next agent (or human) starts with the full history.
- **Brownfield onboarding in one command.** `/loom-init` reads your existing codebase, drafts CLAUDE.md, and seeds a roadmap — no green-field reset required.
- **Composable rigor.** `/loom-doctor` + `/loom-converge` chain into any existing workflow without forcing a methodology rewrite.

## Support

Community-supported. GitHub issues only. No SLA.

## Quickstart

```
/plugin marketplace add launchstack-dev/loom-ai
/plugin install loom
```

Then run `/loom-init` in any repo to bootstrap, or `/loom-roadmap init --full` for a greenfield deliberate path.

Enterprise / network-blocked installs use the curl path — see docs.

## Decision matrix

Brownfield vs greenfield vs network-blocked? See `docs/install-decision-matrix.md` for the full picker.

## Differentiation

Loom is not another prompt pack. It is composable orchestration: `/loom-doctor` diagnoses installation and config drift; `/loom-converge` runs acceptance-criteria-driven review-fix loops; both chain cleanly into any existing Claude Code workflow. The wave-based planning model gives you parallel implementers with file-ownership guarantees, and every artifact (plans, reviews, wiki pages) lands as versioned markdown in your repo — so your delivery process compounds instead of evaporating between sessions.

## Screenshots

![Loom roadmap planning view — waves, phases, and convergence targets at a glance](marketplace/screenshots/01-roadmap.png)

![Wave execution with parallel implementer agents and live progress heartbeats](marketplace/screenshots/02-wave-execution.png)

![Repo-committed wiki page generated from a completed convergence loop](marketplace/screenshots/03-wiki.png)

![/loom-doctor diagnostic output highlighting config drift](marketplace/screenshots/04-doctor.png)
