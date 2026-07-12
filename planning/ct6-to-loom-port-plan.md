# CT6 → Loom-AI Port Plan

_Consolidated port catalog · 2026-07-08 · grounded in primary-source research of both repos_

Everything worth porting from **Claude Team 6 (CT6)** into **Loom-AI**, with where each change lands and a copy-paste prompt to have Loom implement it against itself.

## Guiding principle

CT6 and Loom share primitives (SKILL.md skills, tool-gated agents, hook-enforced producer/checker separation, disk-routed state). CT6's genuine edge is **architect-grade rigor**: an adversarial checker, a re-validation gate, and a *verified codebase map as a fail-closed precondition for reasoning about code*. Loom's edge is **containment**: a hard 100k-token/spawn cap, ~12 CI workflows, tagged releases, and a governed kit model.

**The rule for every port below:** take CT6's *structural/verification* ideas; implement them over Loom's existing machinery (convergence loops, 18 tool-call hooks, TOON-on-disk, the kit/orchestration model). **Do not** import CT6's resource-blowout ideas (1M contexts, unbounded solving) or its heavyweight SQLite memory daemon — they contradict Loom's whole thesis.

---

## Critical context: CT6 is an *enforced* pipeline, not a skill repo

Before porting anything, understand what makes CT6 work. It is **not** a la carte skills — it is a hook-enforced, ordered pipeline (verified from the actual hook source, not marketing):

- **One controller runs everything.** `/architect-team` invokes the `architect-team-pipeline` skill *once*, which auto-drives ordered **Phases -1 → 8** (triage → intake/mapping → normalize → plan → implement → verify → review → complete). No manual invocation between phases.
- **Enforcement is real.** `hooks/pretool_skill_gate.py` **exits code 2 (deny)** to hard-block `Edit`/`Write`/`Agent`/`Task` until the pipeline skill is engaged (`Read`/`Grep`/`Bash` stay allowed). A **Stop hook** blocks completion until an OpenSpec-validation + evidence audit passes; a **SessionStart "sticky-run"** re-arms the block across session boundaries.
- **Hybrid only at the edges.** ~8 skills are workflow-embedded; ~7 (mempalace, phenotype-absorption, closeout, helpdesk, test-run-monitor, etc.) stay standalone utilities.

**Implication for these ports:** CT6's real product is the **enforcement backbone** that makes skills non-optional, not the skills themselves. A skill without its gate is just a utility. Loom already shares this instinct (18 tool-call hooks, fail-closed tables) — which is exactly why the fail-closed *gate* ports (A2, B4, and C1 below) are the high-leverage ones. **Port the gate, not just the skill.** Several Track C entries are the *generalized enforcement patterns* that specific Track A/B ports are instances of (noted inline).

---

## Port catalog at a glance

| ID | Port | Track | Target in Loom | Effort | Priority |
|----|------|-------|----------------|--------|----------|
| A1 | Adversarial reviewer role | Architect | `agents/`, `orchestration.toml`, `/loom-plan review` | Low | ★★★ |
| A2 | Stop-hook re-validation gate | Architect | Stop hook (`docs/hooks.md` set), `/loom-converge` | Low–Med | ★★★ |
| A3 | Spec→coverage matrix + auto-fix-per-gap | Architect | `/loom-converge` (criteria-TDD mode), `/loom-plan` | Med | ★★ |
| A4 | Persistent named specialists (scoped identity) | Architect | agent spawn layer, `.plan-execution/` | Med | ★ |
| B1 | First-class convergence-reviewed codebase map | Cartography | new `/loom-map` or `/loom-wiki map`, `.loom/wiki/maps/` | Med | ★★★ |
| B2 | Serialize the integration map | Cartography | `agents/wiki-maintainer-agent.md` | Low | ★★★ |
| B3 | Git-HEAD map freshness gate | Cartography | PreToolUse hook, map frontmatter | Low–Med | ★★ |
| B4 | Mapping as fail-closed precondition | Cartography | precondition hook on `/loom-plan create`, `/loom-converge` | Low* | ★★★ |
| B5 | "Reuse must cite the map" rule | Cartography | plan-lint / hook | Low | ★★ |
| B6 | Runtime "wake-up query" injection | Cartography | agent spawn / contract builder | Med | ★ |
| C1 | Verified-agent-output (multi-layer machine verification) | Data/Knowledge | Stop + PreToolUse hook set, `/loom-converge` | Med | ★★★ |
| C2 | Endpoint / call-trace mapping (LSP-first, witness-grounded) | Data/Knowledge | `/loom-map`, `.loom/wiki/maps/`, `/loom-bugfix` | Med–High | ★★ |
| C3 | Data-lineage mapping (asset layer on the trace graph) | Data/Knowledge | **`/loom-data lineage`** (exists), `.loom/wiki/maps/` | Med | ★★★ |
| C4 | Reuse-first design hierarchy | Data/Knowledge | plan-lint/hook, `/loom-plan`, `DECISIONS.md` | Low–Med | ★★ |
| C5 | Inter-agent token compression | Data/Knowledge | agent spawn / message-passing layer | Med | ★★ |
| C6 | Phenotypes (architecture-pattern library) | Data/Knowledge | `/loom-library` kits (converge, not new) | Low | ★ |

\* Low *once B1 exists.*

**Overlap map:** C1 generalizes A2 (A2 is one verification layer; C1 is the full set). C4 generalizes B5 (B5 is one rule; C4 is the extend→compose→reuse→build hierarchy). C2 + C3 extend B1/B2 (they share one graph artifact). Build the specific instance first if you want a quick win, or the general framework if you want the whole capability.

---

# Track A — Architect & Verification

### A1 — Adversarial reviewer role ★★★
- **CT6 does:** review is a triad — `structure-analyst` designs, `reference-tracer` verifies, and **`structure-adversary` exists to *refute*.** (`skills/…` reviewer roles; README producer/checker separation.)
- **Loom gap:** `/loom-plan review` fans out multiple reviewers, but they are checkers, not a dedicated steelman-the-failure role.
- **Where to port:**
  - Add `agents/adversary-agent.md` — system prompt: "Build the strongest case this work is wrong. Default to rejecting on uncertainty."
  - Register it in `.claude/orchestration.toml` (per Loom's DECISIONS.md D-01: reviewers registered via orchestration.toml, never hardcoded) so teams can toggle it.
  - Add it to the reviewer fan-out in the `/loom-plan review` and `/loom-converge` review rounds.
- **Fit:** 100% aligned with fail-closed containment; reuses existing fan-out. **Effort: low.**

### A2 — Stop-hook re-validation gate ★★★
- **CT6 does:** a Stop hook (`_audit_openspec_validation`) independently **re-runs validation when an agent tries to declare done**, blocking skipped/self-asserted verdicts.
- **Loom gap:** Loom enforces invariants at the tool call (18 hooks, PreToolUse file-ownership locks) but has no *Stop-time* "re-run the acceptance criteria before you're allowed to finish" gate.
- **Where to port:**
  - Add a **Stop hook** to Loom's hook set (documented in `docs/hooks.md`) that, on an agent's completion attempt, re-executes the phase's acceptance criteria / convergence target and blocks completion if any verdict was skipped or unmet.
  - Wire it into `/loom-converge` so a convergence pass cannot self-certify.
- **Fit:** identical philosophy to Loom's fail-closed decision tables; reuses hook machinery. **Effort: low–medium.**

### A3 — Spec→coverage matrix with auto-fix-per-gap ★★
- **CT6 does:** OpenSpec loop maps every Solution Requirement to coverage and **auto-spawns a fix unit per uncovered requirement.**
- **Loom gap:** `/loom-converge` has criteria-TDD mode, but no explicit *requirement → coverage → dispatch-a-bounded-fix-per-gap* matrix.
- **Where to port:**
  - Extend `/loom-converge` criteria-TDD mode to emit a `coverage-matrix.toon` (requirement × covered?/test-ref) into `.plan-execution/`.
  - For each uncovered row, spawn **one bounded fix** (respecting the 100k cap) — not an unbounded loop.
- **Fit:** turns convergence into requirement-complete verification; stays bounded. **Effort: medium.**

### A4 — Persistent named specialists (scoped identity) ★
- **CT6 does:** long-lived named teammates (1M context) coordinating on a shared task list.
- **Loom gap:** spawns are fire-and-forget with disk handoff — no persistent role identity.
- **Where to port (containment-safe version):** keep the 100k cap and fire-and-forget execution, but let a named role **persist its charter + history on disk** (`.plan-execution/roles/<role>.toon`) and re-hydrate a *scoped summary* each spawn. Identity persists; context does not.
- **Fit:** captures the "architect team" feel without breaking the cap. **Effort: medium.** *Do NOT* port the 1M live context.

> **Note on cross-run memory:** CT6's MemPalace idea is *already largely covered* by Loom's `.loom/learnings.toon` (append-only, confidence-scored, auto-searched on recall phrases). No port needed — at most, feed A3's coverage gaps and A1's adversary rejections into `learnings.toon`.

---

# Track B — Cartography & Knowledge

Context: CT6 treats a **verified codebase map as a hard gate before planning** ("the pipeline cannot reason about a codebase it has not mapped"). Loom's mapping is *emergent* (wiki pages + scattered `crossRefs[]`), one-off (`/loom-deepen`), and never a precondition.

### B1 — First-class, convergence-reviewed codebase map ★★★
- **CT6 does:** `intake-and-mapping` produces standing `CODEBASE_MAP.md` / `ROUTE_MAP.md` / `INTEGRATION_MAP.md`, driven to 100% coverage by 3 `codebase-map-reviewer` agents in a loop.
- **Loom gap:** no standing map; `/loom-deepen` "explicitly does NOT produce a codebase/architecture map."
- **Where to port:**
  - New command `commands/loom-map.md` (or a `map` subcommand of `/loom-wiki`) writing **TOON** artifacts into `.loom/wiki/maps/`: `codebase-map.toon`, `route-map.toon`, `integration-map.toon`.
  - Drive **map coverage** to consensus using Loom's *existing* convergence machinery (`/loom-converge` + the `/loom-plan review` reviewer fan-out) — do not import CT6's ralph-loop.
- **Fit:** TOON-on-disk, reuses convergence, turns emergent knowledge into a governable artifact. **Effort: medium.**

### B2 — Serialize the integration map ★★★
- **CT6 does:** `INTEGRATION_MAP.md` as a first-class synthesized file.
- **Loom gap:** the 8-relation cross-ref graph is real but "scattered in `crossRefs[]` frontmatter — no separate graph artifact file exists."
- **Where to port:** have `agents/wiki-maintainer-agent.md` (already the single owner of the graph) **serialize** it to `.loom/wiki/maps/integration-map.toon` each maintenance pass. No new discovery — just persist what it already computes.
- **Fit:** lowest-risk, single-owner (preserves governance), makes an invisible graph auditable. **Effort: low. Do this first.**

### B3 — Git-HEAD map freshness gate ★★
- **CT6 does:** `last_mapped` vs git HEAD + `map_invalidated` forces a re-map.
- **Loom gap:** page staleness exists; no map-level invalidation.
- **Where to port:** stamp each map artifact with `lastMappedCommit`; add a **PreToolUse hook** that marks the map stale once HEAD moves past a touched-file threshold and blocks stale-map planning.
- **Fit:** pure fail-closed containment — Loom's existing hook idiom. **Effort: low–medium.**

### B4 — Mapping as a hard precondition for planning ★★★ (the core idea)
- **CT6 does:** mapping gates PLAN.
- **Loom gap:** planning/converge don't require a map.
- **Where to port:** precondition check in `commands/loom-plan.md` (`create`) and `/loom-converge` that **fails closed if no fresh map exists**, with remedy `run /loom-map first`. This makes B1–B3 load-bearing rather than optional.
- **Fit:** the cartography analog of A2's re-validation ethos — the most philosophically-aligned port. **Effort: low, once B1 exists.**

### B5 — "Reuse must cite the map" anti-hallucination rule ★★
- **CT6 does:** PLAN reuse decisions must cite files that exist in `CODEBASE_MAP` (Conditions 9/10).
- **Loom gap:** nothing enforces that "reuse existing auth" points at a real path.
- **Where to port:** a plan-lint / hook rule — any "reuse existing X" claim in a PLAN must reference a path present in `codebase-map.toon`, else block.
- **Fit:** kills a common agent failure (inventing modules); reuses lint + hook machinery. **Effort: low.**

### B6 — Runtime "wake-up query" injection ★ (cautious)
- **CT6 does:** agents semantically query MemPalace at pipeline start instead of inlining maps.
- **Loom gap:** wiki `query` is on-demand only; no auto-injection at spawn.
- **Where to port:** at spawn, auto-inject a **scoped** map excerpt (only the components/routes in the agent's contract) into the contract, sourced from the map TOON via wiki `query`. Keep it a bounded summary, not the whole map.
- **Fit:** improves grounding without breaking the 100k cap; needs care to avoid contract bloat. **Effort: medium.**

---

# Track C — Data, Knowledge & Enforcement skills

These come from CT6's wider catalog (47 skills / 39 agents). Two of them (C1, C4) are the *generalized enforcement patterns* behind Track A/B ports; the rest add data-grade tracing and cost control.

### C1 — Verified-agent-output: multi-layer machine verification ★★★ (generalizes A2)
- **CT6 does:** `verified-agent-output` replaces agent self-attestation with **six deterministic, machine-checked layers** — an agent cannot claim "done"; a hook re-checks it. This is the backbone the whole pipeline trusts.
- **Loom gap:** Loom has tool-call hooks and fail-closed tables, but no *named, layered* output-verification standard an agent's completion is measured against.
- **Where to port:**
  - Define a `verified-output` contract (which layers apply: tests pass, criteria met, files-in-map, no skipped verdicts, diff-scope respected, lint clean) as TOON in `.plan-execution/`.
  - Enforce via the **Stop hook** from A2 plus PreToolUse checks — A2 is the first layer; C1 is the full set.
  - Feed rejections into `.loom/learnings.toon`.
- **Fit:** the single highest-value CT6 idea for any agent framework; pure fail-closed. **Effort: medium.** *Do A2 first as the seed, then generalize into C1.*

### C2 — Endpoint / call-trace mapping ★★ (extends B1/B2)
- **CT6 does:** `endpoint-trace-mapping` builds a per-endpoint call-tree (entry → functions → assets), **LSP-first static** with LLM only for ambiguity, **grounded against a runtime witness**. Emits `ENDPOINT_TRACE_MAP.md` + `lineage-graph.json` with rename-stable `func://` IDs and a **hallucination gate** that blocks use of unverified nodes.
- **Loom gap:** no call-graph / request-flow trace; wiki `flow-*` pages are prose, not a verified graph.
- **Where to port:**
  - Extend `/loom-map` (B1) to emit `.loom/wiki/maps/endpoint-trace.toon` with stable `func://` node IDs.
  - Prefer LSP/static extraction; use an agent only for ambiguous edges; carry the hallucination gate (a node not in the graph can't be cited).
- **Fit:** upgrades cartography from "pages" to a verified graph; powers `/loom-bugfix` routing. **Effort: medium–high** (the LSP-first extraction is the work).

### C3 — Data-lineage mapping ★★★ (direct upgrade to an existing Loom command)
- **CT6 does:** `data-lineage-mapping` adds a **data-asset layer** to the same trace graph — `asset://<store>/<schema>/<table>` nodes with reads/writes/modifies/originates edges — answering "who populates/reads this table" from a diffable graph. Emits `DATA_LINEAGE_MAP.md`.
- **Loom gap:** **Loom already ships `/loom-data lineage`, backed by an existing `data-lineage-tracker` agent** (verified) — but it lacks CT6's stable-ID asset graph and diffable artifact.
- **Where to port:** enrich the *existing* `/loom-data lineage` subcommand and its `data-lineage-tracker` agent to emit `.loom/wiki/maps/data-lineage.toon` sharing C2's graph (endpoint-trace + data-lineage are one artifact in CT6). Reuse the `func://`/`asset://` ID scheme. **Do not add a new command or agent.**
- **Fit:** highest fit of the trio — it lands on an existing command and Loom's data track. **Effort: medium.** *Build C2 and C3 together — one graph.*

### C4 — Reuse-first design hierarchy ★★ (generalizes B5)
- **CT6 does:** `reuse-first-design` enforces an **extend → compose → reuse → build-new** hierarchy with an audit and a decision log — curbs AI code sprawl.
- **Loom gap:** nothing pushes agents to reuse before building; B5 only checks that a *claimed* reuse cites a real path.
- **Where to port:** a plan-lint / hook rule in `/loom-plan` that requires new-code decisions to first document why extend/compose/reuse was rejected, logged to `DECISIONS.md` (Loom already has the decision-log culture).
- **Fit:** matches Loom's `DECISIONS.md` discipline exactly; B5 is the citation half, C4 is the hierarchy half. **Effort: low–medium.**

### C5 — Inter-agent token compression ★★
- **CT6 does:** `token-compression` losslessly*/lossily compresses **inter-agent messages only** (external/user-facing output untouched) — a direct multi-agent cost lever.
- **Loom gap:** Loom caps context (100k/spawn) but doesn't compress the handoffs between spawns.
- **Where to port:** a compression step in the message-passing / stage-summary layer that shrinks agent-to-agent payloads (stage summaries, contracts) while leaving deliverables verbatim.
- **Fit:** philosophically perfect for the 100k-cap ethos — squeeze more signal under the cap. **Effort: medium** (must guarantee no lossy compression of anything user-facing or contract-normative).

### C6 — Phenotypes (architecture-pattern library) ★ (converge with kits, don't rebuild)
- **CT6 does:** `phenotypes` captures a proven, deployable **app-architecture pattern** once, then discovers/scaffolds/reuses it (confirm-gated). *Not* a persona or testing concept.
- **Loom equivalent:** this is conceptually **≈ Loom's `/loom-library` typed kits.** Loom already has the packaging primitive.
- **Where to port:** rather than a new skill, extend `/loom-library` to capture a *whole-architecture* kit (multi-resource scaffold) with a confirm-gate on reuse. Treat as a kit-model enhancement, not a port.
- **Fit:** low urgency; Loom's kit model already covers most of the value. **Effort: low.**

---

## What NOT to port (and why)

- **1M-token teammates / "unbounded solving, loops until success."** Loom's convergence loops are the bounded, cheaper answer; CT6 pairs these with *no per-spawn cap and no CI* — the exact runaway/token-burn failure mode Loom is built against.
- **MemPalace SQLite store (`.mempalace/palace`) + Librarian background daemon.** A per-workspace DB and a long-running daemon clash with Loom's file-based, no-daemon, TOON-on-disk simplicity and are an opacity/bus-factor liability. Take the *ideas* (persistent map, wake-up query, func-level lineage) over Loom's wiki + TOON + `learnings.toon`.
- **`func://` lineage as a separate SQLite-mined `lineage-graph.json`.** If you want function-level callers/callees for `/loom-bugfix` routing, fold a lightweight version into `integration-map.toon` — stretch goal, not v1.
- **`INSTRUCTION_COMPLIANCE_RUBRIC.md`.** It governs CT6's own 112 instruction files; irrelevant to Loom.

---

## Recommended build sequence

1. **B2** — serialize the integration map (cheapest; instant artifact).
2. **A1** — adversary reviewer (small, high-value, reuses fan-out).
3. **B1** — first-class codebase map via convergence (the cartography foundation).
4. **A2 → C1** — the verification gate: ship A2 (Stop-hook re-validation) as the seed, then generalize into C1 (full verified-output layers). *The single most important capability.*
5. **B4** — mapping as a fail-closed precondition (pairs with the gate above). *This is where the plan gets teeth.*
6. **B3 + B5 + C4** — freshness invalidation + reuse-must-cite + the reuse hierarchy (cheap correctness wins; C4 subsumes B5 if you do both).
7. **C2 + C3** — endpoint-trace + data-lineage as one shared graph; wire C3 into the existing `/loom-data lineage`.
8. **A3** — spec→coverage matrix with bounded auto-fix.
9. **C5** — inter-agent token compression (cost lever once multi-agent volume is real).
10. **A4 + B6** — persistent role identity + runtime injection (watch the cap).
11. **C6** — phenotypes-as-kits (optional; converge with `/loom-library`).

**Through-line:** CT6's best idea isn't "do more" — it's "make a *verified* artifact a *fail-closed precondition* for reasoning." That maps 1:1 onto Loom's convergence loops and tool-call hooks, so Loom gets architect-grade grounding using machinery it already ships — no SQLite, no daemon, no cap-busting contexts.

---

## Prompt for Loom to update itself

> Paste this into a Claude Code session **inside the `loom-ai` repo** (with Loom installed). It uses Loom's own roadmap → plan → converge → change workflow and respects its conventions (TOON artifacts, fail-closed hooks, the 100k cap, `orchestration.toml` registration, `DECISIONS.md` logging, Apache-2.0).
>
> **Command/agent names verified 2026-07-08** against the live `commands/` and `agents/` listings: all 17 referenced commands and all 22 referenced agents exist; `/loom-map` and `/loom-restructure` confirmed absent (safe as net-new); `/loom-data lineage` is an existing subcommand backed by the existing `data-lineage-tracker` agent. If your Loom version differs, adjust names.

```
We are enhancing Loom-AI itself by porting a set of architect-grade rigor and
cartography features from the CT6 framework, adapted to Loom's containment
philosophy. Read this repo's CLAUDE.md, DECISIONS.md, docs/hooks.md,
docs/concepts.md, commands/, and agents/ first so every change matches existing
conventions. Do NOT import CT6's 1M-token contexts, unbounded solving, or any
SQLite/daemon-based memory — Loom stays file-based, TOON-on-disk, fail-closed,
and 100k-capped per spawn.

Use Loom's own workflow to do this:

1. Run /loom-roadmap add to create a milestone "CT6 rigor & cartography ports"
   with the phases below across Tracks A-D (IDs preserved; ~20 phases). For each,
   honor Loom's existing
   patterns — register new reviewers via orchestration.toml (never hardcode,
   per DECISIONS D-01), add hooks to the documented hook set, emit TOON
   artifacts, and add a DECISIONS.md entry with rationale + alternatives.

   TRACK A — Architect & Verification
   - A1 Adversarial reviewer: add agents/adversary-agent.md ("build the
     strongest case this is wrong; reject on uncertainty"), register in
     orchestration.toml, add to the /loom-plan review + /loom-converge fan-out.
   - A2 Stop-hook re-validation gate: add a Stop hook that re-runs the phase's
     acceptance criteria / convergence target on a completion attempt and blocks
     self-certified or skipped verdicts; wire into /loom-converge.
   - A3 Spec->coverage matrix: extend /loom-converge criteria-TDD mode to emit
     .plan-execution/coverage-matrix.toon (requirement x covered?/test-ref) and
     spawn ONE bounded fix per uncovered row (no unbounded loops).
   - A4 Persistent named specialists: let a named role persist charter+history to
     .plan-execution/roles/<role>.toon and re-hydrate a scoped summary each spawn;
     identity persists, context does not (keep the 100k cap).

   TRACK B — Cartography & Knowledge
   - B1 First-class codebase map: add /loom-map (or a /loom-wiki map subcommand)
     writing .loom/wiki/maps/{codebase-map,route-map,integration-map}.toon,
     driven to coverage consensus by the EXISTING convergence + reviewer fan-out.
   - B2 Serialize the integration map: have wiki-maintainer-agent serialize its
     8-relation cross-ref graph to .loom/wiki/maps/integration-map.toon each pass.
   - B3 Git-HEAD freshness gate: stamp maps with lastMappedCommit; add a
     PreToolUse hook that marks the map stale past a touched-file threshold and
     blocks stale-map planning.
   - B4 Mapping as precondition: add a fail-closed check to /loom-plan create and
     /loom-converge that requires a fresh map, with remedy "run /loom-map first".
   - B5 Reuse-must-cite: plan-lint/hook rule — any "reuse existing X" in a PLAN
     must cite a path present in codebase-map.toon, else block.
   - B6 Runtime wake-up injection: at spawn, auto-inject a SCOPED map excerpt
     (only the agent's contract's components/routes) sourced via wiki query;
     bounded summary only, must respect the 100k cap.

   TRACK C — Data, Knowledge & Enforcement
   - C1 Verified-agent-output: generalize A2 into a named verified-output
     contract in .plan-execution/ (layers: tests pass, criteria met,
     files-in-map, no skipped verdicts, diff-scope respected, lint clean),
     enforced by the Stop + PreToolUse hooks; feed rejections to learnings.toon.
   - C2 Endpoint/call-trace mapping: extend /loom-map to emit
     .loom/wiki/maps/endpoint-trace.toon; LSP/static-first extraction, agent
     only for ambiguous edges, stable func:// node IDs, hallucination gate
     (a node not in the graph cannot be cited).
   - C3 Data-lineage mapping: ENRICH the existing /loom-data lineage to emit
     .loom/wiki/maps/data-lineage.toon sharing C2's graph (asset:// nodes;
     reads/writes/modifies/originates edges). Build C2 and C3 as ONE graph.
   - C4 Reuse-first hierarchy: plan-lint/hook in /loom-plan requiring new-code
     decisions to first document why extend/compose/reuse was rejected, logged
     to DECISIONS.md. (Subsumes B5.)
   - C5 Inter-agent token compression: compress agent-to-agent payloads (stage
     summaries, contracts) in the message-passing layer; NEVER compress
     user-facing output or contract-normative text.
   - C6 Phenotypes: do NOT build a new skill — extend /loom-library to capture a
     whole-architecture (multi-resource) kit with a confirm-gate on reuse.

   TRACK D — Agents & Architect (create via /loom-agent create; register in
   .claude/orchestration.toml per D-01; naming: critics -reviewer, workers -agent;
   drop CT6 tool-gating, repoint .architect-team/ -> .plan-execution/ + .loom/)
   - D1 adversarial-reviewer -> [review] default+full (this is A1's agent).
   - D2 task-reviewer -> [review] (diff-vs-acceptance + anti-stub; backs A2/C1).
   - D3 reference-tracer-agent -> [execution.agents] (reference-closure; used by
     execute waves and by /loom-restructure).
   - D4 synthesizer-agent -> convergence/[review] (merge N drafts, resolve
     contradictions); codebase-map-reviewer -> [review] (drives B1).
   - D5 endpoint-tracer-agent -> [execution.agents] (C2); oracle-deriver-agent ->
     convergence (C1 parity spec); reconciler-agent -> [execution.agents] post-wave;
     fix-sensibility-reviewer + test-completeness-reviewer -> [review].
   - D6 system-architect -> agents/system-architect.md (model opus); port ONLY 3
     modes (Default design/tradeoff, Diagnostic Plan Review, Restructure Plan
     Audit); invoke from /loom-think and /loom-plan create as a decisive design
     authority (distinct from the diff-critiquing architecture-reviewer).
   - D7 NEW /loom-restructure command + safe-refactor pipeline:
     restructure-analyst-agent (x3) -> reference-tracer-agent ->
     restructure-adversary-reviewer (x3); converge to ONE identical machine-
     checkable movements[] table; pass ONLY after 2 consecutive all-clean
     adversary rounds AND a deterministic partition-check hook (every git-tracked
     file maps to exactly one of move/stays). Do NOT port scaffold-agent
     (/loom-agent create already covers it).

   WORKFLOW WIRING — attach each phase to its exact Loom lifecycle seam. Do NOT
   invent new commands except /loom-map and /loom-restructure; everything else
   extends an existing command. Wire as follows:
     * Onboard & map: /loom-init, /loom-wiki, NEW /loom-map
         - B1 codebase map -> /loom-map, driven to consensus by codebase-map-reviewer
         - B2 integration map -> /loom-wiki (wiki-maintainer-agent serializes graph)
         - B3 freshness GATE on the map artifacts (PreToolUse hook)
         - C2 endpoint-tracer-agent -> /loom-map ; C3 -> enrich the EXISTING
           /loom-data lineage subcommand and its EXISTING data-lineage-tracker agent
           (do NOT add a new command or agent — extend both in place)
     * Think & design: /loom-think, /loom-spec
         - D6 system-architect returns ONE decisive recommendation here
         - A3 coverage matrix is seeded from /loom-spec acceptance criteria
     * Plan: /loom-plan create + review
         - A1/D1 adversarial-reviewer joins the /loom-plan review fan-out
         - D6 system-architect makes the design-decision call
         - B4 fresh-map precondition GATE on /loom-plan create (fail closed)
         - B5 + C4 reuse-first / reuse-must-cite GATE (plan-lint/hook)
     * Execute: /loom-plan execute (waves)
         - D3 reference-tracer-agent on refactor-touching waves
         - reconciler-agent post-wave alongside wiring-agent
         - C5 token compression in the message layer; A4 role identity; B6 wake-up injection
     * Converge & verify: /loom-converge
         - A2 Stop-hook re-validation GATE -> generalize to C1 verified-output layers GATE
         - D2 task-reviewer (diff-vs-acceptance + anti-stub); A3 coverage matrix (criteria-TDD)
         - test-completeness-reviewer; D5 oracle-deriver-agent (target-matching);
           D4 synthesizer-agent merges parallel review drafts
     * Code review & fix: /loom-code review + fix -> A1/D1 adversarial-reviewer, D2 task-reviewer
     * Bug fix: /loom-bugfix -> C2 endpoint-trace routing, fix-sensibility-reviewer
     * Refactor: NEW /loom-restructure -> D7 pipeline (analyst x3 -> reference-tracer ->
       adversary x3), partition-check GATE, system-architect Restructure Plan Audit mode
     * Ship: /loom-git pr, /loom-canary -> C1 verified-output as the pre-PR GATE
     * Knowledge/memory: /loom-wiki, /loom-learn -> route A1 adversary rejections,
       A3 coverage gaps, and restructure adversary findings into .loom/learnings.toon
   Finally, make /loom-auto (plan->build->test->review->fix) orchestrate the above so the
   GATEs (A2, B4, C1, C4, partition-check) render each stage non-optional end to end.

   ENFORCEMENT NOTE: CT6's value is that skills are gated, not optional. Wire
   every new gate (A2/C1/B4/C4/partition-check) into Loom's existing hook set so
   they fail closed — porting a skill without its gate only yields a utility.

2. Build order: B2, A1+D1, B1+(codebase-map-reviewer), then A2->C1 (+D2), then
   B4, then B3+B5+C4, then D7 /loom-restructure (+D3), then C2+C3 (+D5 tracers),
   then D6 system-architect, then A3, then C5, then A4+B6, then C6+D4 (optional).

3. For each phase: /loom-plan create -> /loom-plan execute -> /loom-converge to
   its acceptance criteria -> ensure the existing CI workflows (pr-gate,
   manifest-drift, checksums) pass -> open a PR via /loom-git pr. Add tests for
   every new hook and command. Update docs/hooks.md, README, and the relevant
   command/agent docs. Log each decision in DECISIONS.md.

Start by proposing the roadmap and the B2 plan for my review before executing.
```

---

## Sources (primary, fetched 2026-07-08)

**CT6 / paulingram/claude-skills:** `skills/intake-and-mapping/SKILL.md`, `skills/cartographer-team/SKILL.md`, `skills/mempalace-integration/SKILL.md`, `skills/endpoint-trace-mapping/SKILL.md`, `skills/data-lineage-mapping/SKILL.md`, `skills/verified-agent-output/SKILL.md`, `skills/reuse-first-design/SKILL.md`, `skills/token-compression/SKILL.md`, `skills/phenotypes/SKILL.md`, `commands/architect-team.md`, `commands/architect-team-setup.md`, `hooks/pretool_skill_gate.py`, `hooks/lineage_graph.py`, `README.md`, `ct6.blackraveninc.com/pipeline`.
**Loom-AI / launchstack-dev/loom-ai:** `commands/loom-init.md`, `commands/loom-wiki.md`, `commands/loom-deepen.md`, `commands/loom-learn.md`, `commands/loom-agent.md`, `commands/loom-code.md`, `commands/loom-plan.md`, `agents/wiki-ingest-agent.md`, `agents/wiki-maintainer-agent.md`, `agents/contracts-agent.md`, `agents/security-reviewer.md`, `.claude/orchestration.toml`, `docs/hooks.md`, `docs/concepts.md`, `DECISIONS.md`.
**CT6 agent files:** `agents/system-architect.md`, `agents/structure-analyst.md`, `agents/structure-adversary.md`, `agents/adversarial-reviewer.md`, `agents/task-reviewer.md`, `agents/reference-tracer.md`, `agents/endpoint-tracer.md`, `agents/master-synthesizer.md`, `agents/oracle-deriver.md`, `agents/reconciler.md`, `agents/scaffold-agent.md`.

---

# Appendix A — Agent & Architect Registry Ports

CT6 has ~39 agents; Loom already has a deep roster (contracts/implementer/wiring/verification agents, a `-reviewer` family, roadmap-converge trio, plan reviewers). Port only the gap-fillers.

## A.1 Placement mechanics (Loom)

- **File:** `agents/<name>.md` (contribute to Loom) or `.claude/agents/<name>.md` (project-local). Frontmatter: `name` / `description` (+ "Use PROACTIVELY…" trigger) / `model`. Loom has no `allowed-tools` — boundaries are hook-enforced, so drop CT6 tool-gating on import; repoint `.architect-team/` paths to `.plan-execution/` + `.loom/`.
- **Register in `.claude/orchestration.toml`** (never hardcode — DECISIONS **D-01**): reviewers → `[review]` (modes quick/default/full); wave/worker/tracer agents → `[execution.agents]`; convergence agents → the convergence pipeline section.
- **Naming:** critics end `-reviewer`; workers/tracers end `-agent`.
- **Automation:** `/loom-agent create` writes the file + the `orchestration.toml` registration in one wizard.

## A.2 Gap-filling agents to port

| CT6 agent | Loom name | `orchestration.toml` | Fills gap | Pri |
|---|---|---|---|---|
| adversarial-reviewer | `adversarial-reviewer` | `[review]` default+full | No refute-only reviewer (= A1) | ★★★ |
| task-reviewer | `task-reviewer` | `[review]` | Diff-vs-acceptance + anti-stub (backs A2/C1) | ★★★ |
| reference-tracer | `reference-tracer-agent` | `[execution.agents]` | Reference-closure for safe moves | ★★★ |
| master-synthesizer | `synthesizer-agent` | convergence / `[review]` | Merge N drafts, resolve contradictions | ★★ |
| codebase-map-reviewer | `codebase-map-reviewer` | `[review]` | Drives B1 map to consensus | ★★ |
| endpoint-tracer | `endpoint-tracer-agent` | `[execution.agents]` | Verified call/endpoint trace (= C2) | ★★ |
| oracle-deriver | `oracle-deriver-agent` | convergence | Parity spec for target-matching (= C1) | ★★ |
| reconciler | `reconciler-agent` | `[execution.agents]` post-wave | Semantic/contract conflict resolution | ★ |
| fix-sensibility-checker | `fix-sensibility-reviewer` | `[review]` (bugfix) | Regression-impact check on a fix | ★ |
| test-completeness-verifier | `test-completeness-reviewer` | `[review]` | Detect vacuous/vacuously-passing tests | ★ |

**Skip (Loom has an equivalent):** prompt-refiner → `prompt-refiner-agent`; backend/frontend/integration → `implementer-agent`; security → `security-reviewer`; doc-updater/closeout → `/loom-docs`; scaffold-agent → `/loom-agent create`; visual-capture/analyzer → `/loom-design` (low priority).

## A.3 Architect ports

- **`system-architect` (partial) ★★** — a *decisive design authority* (returns ONE recommendation), distinct from Loom's diff-critiquing `architecture-reviewer`. Port **3 of its 9 modes** only (Default design/tradeoff, Diagnostic Plan Review, Restructure Plan Audit) — the other 6 are CT6 pipeline phases Loom lacks. File `agents/system-architect.md`, model opus; invoke from `/loom-think` and `/loom-plan create`.
- **Restructure pipeline (new capability) ★★★** — `structure-analyst`(×3) → `reference-tracer` → `structure-adversary`(×3), converging to an identical machine-checkable `movements[]` table that survives **two consecutive all-clean adversary rounds** + a deterministic partition check (every git-tracked file maps to exactly one of move/stays). Loom has no safe-refactor capability; this is the top architect port. Ships as a new **`/loom-restructure`** command; partition check = a deterministic verification hook.

## A.4 Where every port fits in the Loom workflow

Mapped onto Loom's actual command lifecycle. **Bold = new command/agent; (gate) = fail-closed hook.**

| Loom stage | Command(s) | Ports / agents that plug in here |
|---|---|---|
| **Onboard & map** | `/loom-init`, `/loom-wiki`, **`/loom-map`** | B1 codebase map (**`/loom-map`**, `codebase-map-reviewer` drives convergence); B2 integration map (`wiki-maintainer` serializes); B3 freshness **(gate)**; C2 `endpoint-tracer-agent`; C3 enrich `/loom-data lineage` |
| **Think & design** | `/loom-think`, `/loom-spec` | `system-architect` (decisive recommendation); A3 coverage matrix seeded from spec criteria |
| **Plan** | `/loom-plan create` + `review` | A1 `adversarial-reviewer` (review fan-out); `system-architect` (design decision); B4 fresh-map precondition **(gate)**; B5/C4 reuse-first + reuse-must-cite **(gate)** |
| **Execute** | `/loom-plan execute` (waves) | `reference-tracer-agent` (refactor-touching waves); `reconciler-agent` (post-wave, with `wiring-agent`); C5 token compression (message layer); A4 persistent role identity; B6 wake-up injection (contract builder) |
| **Converge & verify** | `/loom-converge` | A2 Stop-hook re-validation **(gate)** → C1 verified-output full layers **(gate)**; `task-reviewer`; A3 coverage matrix (criteria-TDD); `test-completeness-reviewer`; `oracle-deriver-agent` (target-matching); `synthesizer-agent` (merge review drafts) |
| **Code review & fix** | `/loom-code review`, `/loom-code fix` | A1 `adversarial-reviewer`; `task-reviewer` |
| **Bug fix** | `/loom-bugfix` | C2 endpoint-trace (routing); `fix-sensibility-reviewer` (regression impact) |
| **Refactor** | **`/loom-restructure`** (new) | `restructure-analyst-agent`(×3) → `reference-tracer-agent` → `restructure-adversary-reviewer`(×3); partition-check **(gate)**; `system-architect` Restructure Plan Audit mode |
| **Autonomous** | `/loom-auto` (plan→build→test→review→fix) | orchestrates all the above; the A2/B4/C1/C4/partition **(gate)s** are what make each stage non-optional |
| **Ship** | `/loom-git pr`, `/loom-canary` | C1 verified-output as a pre-PR gate **(gate)** |
| **Knowledge & memory** | `/loom-wiki`, `/loom-learn` | `learnings.toon` receives A1 adversary rejections, A3 coverage gaps, restructure adversary findings |

**The through-line:** the ports cluster into two of Loom's existing seams — **(1) the map/knowledge front-end** (`/loom-init` → `/loom-map` → `/loom-wiki`, feeding a fresh-map precondition) and **(2) the verify/converge back-end** (`/loom-converge` → `/loom-code` → `/loom-git`, gated by verified-output). The one genuinely new surface is **`/loom-restructure`**. Everything else extends a command Loom already ships.
