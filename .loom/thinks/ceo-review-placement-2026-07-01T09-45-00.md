---
slug: ceo-review-placement
datetime: 2026-07-01T09:45:00Z
branch: ceo-review-placement
repo: https://github.com/launchstack-dev/loom-ai
supersedes:
status: DRAFT-READY-FOR-SIGNOFF
---

# Think: CEO review placement — post-plan reviewer vs pre-plan thinking gate

## Phase 0 — Situation (repo evidence, gathered before the interview)

Fresh grep confirms the operator's premise:

- `agents/plan-ceo-review-agent.md` frontmatter: `plan-ceo-review-agent — a CEO-lens planning reviewer that fans out in parallel during /loom-plan review`. Ships as one of four M-04 reviewers (ceo / eng / design / devex), all wired to run AFTER a PLAN.md draft exists.
- `commands/loom-plan.md` line 103: `/loom-plan review` = "6-agent parallel plan review" — the M-04 agents extend that fan-out; CEO review is invoked as review-of-artifact.
- gstack precedent (per `planning/ROADMAP-gstack-adoption.md` F-10 and by the operator's own testimony): gstack autoplan sequences CEO → Design → Engineering **upfront** — the review lens shapes the plan's DNA before any milestones or waves exist.
- Loom's `/loom-think` (M-03, this skill) is the current "pre-plan" surface but is a single-model 5-phase interview with a `Phase 3.5 Cross-Model Second Opinion` PENDING marker — no explicit CEO / Design / Engineering lens sequencing.
- Loom's `/loom-roadmap:explore` (older, still shipping) does multi-persona brainstorm (engineer / designer / pm / security / ops / user / skeptic / data) — closer to gstack's upfront pattern in mechanism (many personas in parallel) but not in method (breadth-first divergence, not CEO-then-design-then-eng sequenced convergence).

## Phase 1 — Problem

### Q1: What's broken? *(carried forward verbatim from operator prompt)*

> "our implementation of the ceo-review is insufficient as its after a plan. gstack uses ceo review upfront as evidenced by the autoplan which goes ceo > design > engineering review. ceo review fits more in the thinking phase"

The felt pain: the M-04 CEO review lens is spent on plan critique when its highest-leverage moment — vision fit, positioning, scope discipline, distribution — is BEFORE the plan crystallizes. Reviewing a plan through a CEO lens can, at best, recommend REDUCTION or HOLD; it cannot shape the throughline that would have made those recommendations unnecessary.

### Q2: What triggered this now? *(carried forward from operator prompt)*

> gstack precedent — the autoplan sequence CEO → Design → Engineering review as **upfront** stages, not post-plan critique. Operator surfaced this while reviewing the M-04 landing on branch `exploregstack` (PR #31, commit `5e17c14`).

### Q3: Who is asking?

**Both — self-critical author on behalf of future operators.** The operator is fixing this now precisely because future operators will inherit the mispositioning. Framing: *"I am the operator today and the guardian of the operator tomorrow."*

This matters because it rules out the low-effort resolution ("leave post-plan review, mark it as advisory only") — that helps neither constituency. It also rules out the high-effort resolution ("wait until N operators complain") — the author-guardian frame says fix it before wider adoption teaches the wrong pattern.

## Phase 2 — Demand Evidence

### Q1: Signals that this matters

Operator selected all three seeded signals AND added a scope-narrowing reframe:

- **[selected] gstack autoplan evidence.** Operator has watched gstack sequence CEO → Design → Engineering upfront and observed it re-shape plan DNA in ways post-plan review could not.
- **[selected] M-04 post-plan CEO would be ignored.** Intuition: once a `PLAN.md` is drafted and load-bearing, a CEO `REDUCTION` or `HOLD` verdict is unlikely to actually reduce or halt — sunk-cost and interpretive drift win.
- **[selected] `/loom-think` Phase 3.5 is empty.** The `Cross-Model Second Opinion` section is a PENDING placeholder; no CEO/design/engineering lens sequencing exists at the pre-plan phase where it would compound most.

### Q1-Other: Operator scope-narrowing reframe *(verbatim)*

> "i want planning to be more robust not plan review which is already sufficient. gstack ceo review seems more engaged on taking a think artifact and questioning it from a business opportunity perspective. this should definitely precede loom plan artifacts"

**Consequence — this reframes the whole question.** The problem is NOT "M-04 CEO review is in the wrong place" (M-04 stays as-is; post-plan review is sufficient). The problem is "**there is no CEO-lens interrogation of a `/loom-think` artifact from a business-opportunity perspective before it feeds `/loom-roadmap init` or `/loom-plan create`**". The design surface is: **add a new pre-plan CEO interrogation gate that consumes a `/loom-think` artifact and produces a decision (proceed / rewrite think / kill)**, keeping M-04's post-plan CEO review untouched.

This eliminates the "restructure M-04" option and rules out the "run CEO twice — pre-plan + post-plan" option only if they materially duplicate. Worth checking under Phase 3.5.

### Q2: Past attempts

**No prior serious attempts.** The mis-slotting in M-04 (shipped yesterday) plus the empty `/loom-think` Phase 3.5 hook are the whole prior surface. No earlier design doc, scrapped feature, or ROADMAP entry addressed pre-plan CEO interrogation.

Demand-evidence risk read: this doc is *not* SPARSE — the operator has direct gstack-autoplan evidence and just-shipped Loom evidence — but it IS a first pass. No accumulated pattern of failed attempts to lean on.

### Q3: If we do nothing for 6 months

**`/loom-auto` ships weak plans.** The autonomous pipeline runs `/loom-think → /loom-roadmap init → /loom-plan create → /loom-plan review`. Without a CEO-lens interrogation of the think artifact, weak vision-fits slip into the roadmap and become expensive to unwind. Post-plan CEO `REDUCTION` fires too late to help — by that point the plan is load-bearing and REDUCTION verdicts get interpreted-away.

This is the operator's confirmed counterfactual and the load-bearing motivation. Every downstream design choice must pay rent against "does this make `/loom-auto` ship stronger plans."

## Phase 3 — Status Quo

### Q1: How does the current system handle this today?

Captured in Phase 0. Summary: `/loom-think` writes a design doc; `/loom-roadmap init --from <doc>` consumes it verbatim; `/loom-plan create` derives a plan; `/loom-plan review` fires the M-04 lenses (CEO / eng / design / devex). There is NO CEO-lens gate between think and roadmap. `/loom-think` Phase 3.5 has a `Cross-model review: PENDING` marker but no wiring.

### Q2: Load-bearing constraints *(operator answer, verbatim)*

> "i'm open to this being a subcommand in loom-think (so separate the office hours from the ceo review somehow). i also want an auto sequencing that goes ceo > design > engineering but need to consider how the surface interacts with roadmap and plan"

Three explicit constraints from this reframe:

- **[C1] Subcommand shape is on the table.** The CEO gate can live *inside* `/loom-think` as a subcommand (e.g., `/loom-think:review` or `/loom-think:interrogate`) rather than a separate `/loom-*` top-level. This separates office-hours (the 5-phase interview → doc) from CEO review (interrogation of that doc). Rules OUT the earlier seeded constraint "must not modify /loom-think itself" — modification IS on the table, provided the interview stays separable.
- **[C2] Must sequence CEO → Design → Engineering.** Full gstack autoplan shape, not just CEO. Three lenses fire pre-plan in that order. This is a bigger surface than the operator's opening prompt suggested (which named only CEO) but it's what "honor the gstack pattern" means in practice.
- **[C3] Surface interaction with `/loom-roadmap` and `/loom-plan` needs design.** The gate must feed cleanly into `/loom-roadmap init --from <path>` or `/loom-plan create --from <path>`. Options: (a) gate writes an augmented think doc that /loom-roadmap consumes; (b) gate writes a separate `interrogation.toon` artifact that /loom-roadmap reads alongside the think doc; (c) gate returns a decision `{proceed | rewrite-think | kill}` that /loom-auto uses as a branch condition.

Two seeded constraints not explicitly selected by the operator but carried forward as **operator-implicit** (worth reconfirming at Phase 5):

- **[C4-implicit] Must not duplicate M-04 post-plan CEO.** Different frame, different output shape — pre-plan CEO interrogates business opportunity on a think artifact; post-plan CEO reviews plan critique on a PLAN.md draft. Rubrics may share sections but must differ in method.
- **[C5-implicit] Must emit a decision, not just findings.** Pre-plan gate terminates in `{proceed | rewrite-think | kill}` (or equivalent) so `/loom-auto` has a signal to act on. Otherwise the gate is advisory-only and Loom repeats the M-04 mistake at a new phase.

### Q3: What's ruled out and why *(operator answer, verbatim)*

> "all these are ok actually. decisions are preferred but sometimes advisory findings are helpful"

Locks these rejections in:

- **[R1] No separate `/loom-*` top-level command.** The gate lives as a subcommand of `/loom-think` (per C1). Prevents surface sprawl.
- **[R2] No advisory-only-always output.** The default terminates in `{proceed | rewrite-think | kill}`. Advisory-findings-only is a supported *mode* via an explicit flag, not the default. This refines C5 from an absolute constraint into a mode-selectable one.
- **[R3] No automatic gating of `/loom-roadmap init`.** `/loom-roadmap init` does not auto-refuse to proceed absent a pre-plan interrogation. Interrogation is opt-in for operators, on-by-default for `/loom-auto`. Keeps the quick spec-to-roadmap flow unencumbered.
- **[R4] No verbatim import of the gstack rubric.** Adapt as Loom-native per the M-13 locked decision.

## Phase 3.5 — Approach Candidates (for cross-model review)

Given constraints C1–C5, rulings R1–R4, and the Phase 2 counterfactual (make `/loom-auto` ship stronger plans), three candidate approaches:

### Candidate A — `/loom-think:review`: one command, sequenced lenses, single artifact
  Sketch: `/loom-think:review <path-to-think-doc>` runs CEO → Design → Engineering in sequence over the think doc. Each lens reads the doc + prior lens output. Terminates in a decision `{proceed | rewrite-think | kill}` written to `.loom/thinks/{slug}-interrogation.toon` alongside the source doc. `--advisory` flag suppresses decision, emits findings only. `/loom-roadmap init --from <think-doc>` reads the interrogation artifact if present, warns (not refuses) on `kill`, and `/loom-auto` treats `kill` as a branch condition.
  Assumes: sequenced CEO→Design→Engineering is the correct gstack shape (per operator's C2 and Phase 2 Q1 evidence).
  Risk if wrong: sequential execution is ~3× LLM latency. If CEO fires `kill` but Design/Engineering context would flip it, the sequential order buries that signal. Mitigation: `kill` is a soft signal at the CEO stage; final decision aggregates after all three lenses.

### Candidate B — `/loom-think:review`: parallel lenses, arbiter synthesizes
  Sketch: same command name and artifact shape as A, but CEO, Design, and Engineering fire IN PARALLEL over the think doc. An arbiter agent reads the three per-lens `AgentResult` envelopes and produces the terminal decision.
  Assumes: the three lenses are independent enough that they don't need to see each other's output; the arbiter's synthesis rule is well-defined.
  Risk if wrong: departs from gstack's sequenced shape (operator explicitly asked for sequencing in C2). Arbiter's synthesis rule is a new load-bearing surface — get it wrong and decisions become unpredictable.

### Candidate C — Three parallel subcommands + a fourth to decide
  Sketch: `/loom-think:ceo`, `/loom-think:design`, `/loom-think:eng` — three subcommands, each fires one lens. `/loom-think:decide` reads all three findings and emits the terminal decision. Operator invokes in order; `/loom-auto` chains all four.
  Assumes: fine-grained control over which lenses fire is worth the surface cost.
  Risk if wrong: four commands where one would do. Surface sprawl inside `/loom-think` violates the spirit of R1 (keep the surface small). Operator burden to sequence correctly.

Cross-model review: PENDING

## Phase 4 — Target User / Narrowest Wedge

### Q1: Who benefits first?

**You — the operator running `/loom-think` today.** The gate is the missing piece of `/loom-think` Phase 3.5. First beneficiary is the operator running `/loom-think` right now (in this very session) who wants to close the `PENDING` placeholder immediately, before roadmapping the current backlog.

This is a more intimate scope than "future `/loom-auto` operators" — it commits to landing the gate on THIS think doc's follow-through path, not deferring to a hypothetical future run. It also implies the gate must be usable *manually* by an operator with a think doc in hand, not just as a step in `/loom-auto`.

### Q2: Smallest slice

**One-lens MVP: `/loom-think:review` with CEO only.** Runs the CEO lens over a supplied think doc; emits `{proceed | rewrite-think | kill}` + findings to `.loom/thinks/{slug}-interrogation.toon`. Design and Engineering lenses land in a follow-up milestone. Est: ~2 days. Dogfoodable on THIS think doc today.

Rationale: proves the subcommand shape, the artifact shape, and the decision surface with the lens that has the highest evidence base (M-04 `plan-ceo-review-agent` frontmatter and rubric already exist — the wedge is *repointing* that rubric at a think doc rather than a plan doc, plus wiring the decision terminus). Design and Engineering lenses can be modeled on the same shape once CEO proves out.

### Q3: What to NOT include in the wedge

Operator questioned their own C2 mid-answer ("maybe the right shape becomes think and plan > spec > review spec > loom plan formality? again read the gstack docs!"). Interview paused to fetch first-party gstack material (github.com/garrytan/gstack) — see next section.

## Phase 4-bis — gstack Ground Truth *(fetched via gh api during Phase 4 Q3)*

Read: `autoplan/SKILL.md`, `plan-ceo-review/SKILL.md`, tree listing under `plan-{design,eng,devex}-review/`.

Confirmed facts:

1. **`plan-ceo-review` operates on a design doc, not a plan.** Frontmatter: `benefits-from: [office-hours]`; `context_queries` pulls `~/.gstack/projects/{slug}/*-design-*.md` as `recent-design-docs`; Step 1 (line 956): "If a design doc exists (from `/office-hours`), read it. Use it as the source of truth for the problem statement, constraints, and chosen approach."
2. **The name is misleading — it's a *design-doc → CEO plan* skill.** Step 0 ("Nuclear Scope Challenge + Mode Selection") is the interrogation: Premise Challenge, Existing Code Leverage, Dream State Mapping, Implementation Alternatives (mandatory 2–3 approaches with completeness score), Mode Selection (SCOPE_EXPANSION / SELECTIVE / HOLD / REDUCTION). Persists an artifact to `~/.gstack/projects/{slug}/ceo-plans/`.
3. **`/autoplan` sequences all four review skills over the design doc.** Description (verbatim): *"Auto-review pipeline — reads the full CEO, design, eng, and DX review skills from disk and runs them sequentially with auto-decisions using 6 decision principles."* The reviews fire CEO → Design → Eng → DevEx.
4. **`/office-hours` is gstack's `/loom-think`.** Autoplan's "Prerequisite Skill Offer" step reads: *"No design doc found for this branch. `/office-hours` produces a structured problem statement, premise challenge, and explored alternatives — it gives this review much sharper input to work with."*
5. **The CLAUDE.md routing rules that gstack writes are diagnostic.** Line-for-line: *Product ideas/brainstorming → `/office-hours`; Strategy/scope → `/plan-ceo-review`; Architecture → `/plan-eng-review`; Design system/plan review → `/design-consultation` or `/plan-design-review`; Full review pipeline → `/autoplan`; Author a backlog-ready spec/issue → `/spec`.*

Implications for this think doc:

- **C2 stands, and with new information.** All four review lenses fire pre-plan (over the think doc), sequentially, per gstack's actual behavior. The earlier "CEO pre-plan; Design/Eng stay post-plan" refinement I seeded was wrong.
- **M-04 shipped in the wrong slot.** Loom's `plan-ceo-review-agent` currently fires during `/loom-plan review` on a PLAN.md draft — parallel with the other three. That's a double mistake: (a) wrong trigger stage; (b) wrong input artifact. gstack fires them upstream on the design doc, sequentially.
- **Rubric shape ≈ correct; wiring incorrect.** Loom's plan-ceo-review-agent already has the 4-mode selector and 11 sections. The rubric maps to gstack's Nuclear Scope Challenge + Mode-Specific Analysis. We do NOT need to rewrite the agent's rubric — we need to move where and when it fires and repoint its input from a plan to a think doc.
- **The interrogation is interactive**, not batch. gstack's plan-ceo-review uses AskUserQuestion during Step 0C-bis (Implementation Alternatives) and Step 0D (Mode-Specific Analysis). Loom's agent currently emits a findings envelope only. If we want fidelity, the pre-plan CEO gate must support interactive interrogation, not just findings emission.

### Q3 (resumed): What to NOT include in the wedge

Given the ground truth, the wedge deliberately EXCLUDES:

- **[NG1] Design lens** — lands in a follow-up milestone once CEO shape proves out. Rubric already exists at `agents/plan-design-review-agent.md`; wedge does not touch it.
- **[NG2] Engineering lens** — same as above, `agents/plan-eng-review-agent.md`.
- **[NG3] DevEx lens** — same, `agents/plan-devex-review-agent.md`.
- **[NG4] `/loom-auto` sequenced wiring** — no auto-invocation from `/loom-auto` in the wedge. Manual invocation only. `/loom-auto` adoption comes after operator-driven usage validates the shape.
- **[NG5] `/loom-roadmap init` consumption of the interrogation artifact** — no `/loom-roadmap init` behavior change in the wedge. Artifact sits on disk unread by roadmap. Roadmap wiring lands after we know the artifact shape is correct.
- **[NG6] Rewriting M-04's post-plan CEO review** — post-plan review stays as-is (per Phase 2 Q1 operator reframe). We are ADDING a pre-plan CEO gate, not moving the existing one.
- **[NG7] Interactive AskUserQuestion inside the CEO agent** — the wedge emits a decision + findings envelope only. Interactive interrogation matches gstack fidelity but adds a session-runtime dependency; defer to follow-up.


## Phase 5 — Synthesis

### Constraints (locked)

- **C1** Subcommand shape — CEO gate lives as a subcommand of `/loom-think` (e.g., `/loom-think:review`), not a separate top-level `/loom-*` command.
- **C2** Full CEO → Design → Eng → DevEx sequencing eventually — but wedge ships CEO only. Ground truth confirms all four fire pre-plan over the think doc in gstack's autoplan.
- **C3** Surface interaction with `/loom-roadmap` and `/loom-plan` — deferred out of the wedge (NG5). Roadmap and plan wiring lands after the artifact shape proves out.
- **C4** Must not duplicate M-04 post-plan CEO — different frame (interrogation of a think doc vs review of a plan draft), different input artifact, different output artifact. Rubric may share sections; method differs.
- **C5** Decision by default; advisory mode via flag — terminates in `{proceed | rewrite-think | kill}` unless `--advisory` sets findings-only mode.

### Load-bearing premises

- **P1** Loom's existing `agents/plan-ceo-review-agent.md` rubric (11 sections + 4-mode selector) maps to gstack's Nuclear Scope Challenge without a rewrite. We repoint its trigger and input contract, not its rubric text. *Risk if wrong: the agent needs a rewrite, wedge doubles in size.*
- **P2** A `/loom-think` doc is a valid substitute for gstack's design doc — Loom's 5-phase interview output (problem / evidence / status quo / approach candidates / wedge / synthesis) contains the fields gstack's plan-ceo-review reads (problem statement, constraints, chosen approach). *Risk if wrong: the CEO agent asks for fields the think doc doesn't have; wedge needs a shim.*
- **P3** A batch-emitted decision + findings envelope is enough for MVP. gstack's interactive interrogation (AskUserQuestion during Step 0C-bis) is higher fidelity but not required for the operator's Phase 4 wedge ("dogfood on THIS think doc today"). *Risk if wrong: the operator finds the batch output too shallow to act on; interactive interrogation must land sooner than expected.*
- **P4** M-04's post-plan CEO review stays useful as a formality check even after pre-plan lands — different frame, different findings. *Risk if wrong: post-plan CEO becomes redundant and gets removed; net loss of coverage.*
- **P5** The artifact path `.loom/thinks/{slug}-interrogation.toon` is a reasonable convention — sits next to the think doc it interrogates, discoverable via `ls .loom/thinks/`. *Risk if wrong: a different location (e.g., `.loom/interrogations/`) is more consistent with future extensibility.*

### Approach A — one-command wedge: `/loom-think:review <think-doc-path>`

**Mechanism.**
- New subcommand under `/loom-think` (per C1): `/loom-think:review [--advisory] <path-to-think-doc>`.
- Reads the think doc as source of truth (problem statement, constraints, chosen approach candidates).
- Invokes `plan-ceo-review-agent` (existing M-04 agent, unchanged rubric per P1) with the think doc as input contract instead of a PLAN.md.
- Emits `.loom/thinks/{slug}-interrogation.toon` with: mode declaration ({SCOPE_EXPANSION | SELECTIVE | HOLD | REDUCTION}), 11-section findings (with confidence:1..10 per M-04 convention), terminal decision {proceed | rewrite-think | kill}.
- `--advisory` mode suppresses the terminal decision and emits findings-only.
- Registers under `library.prompts:` in `skills/library.yaml` with `kit: plan-review` (same kit as the M-04 CEO agent).

**Wedge fit.**
- Operator can invoke `/loom-think:review .loom/thinks/ceo-review-placement-2026-07-01T09-45-00.md` on THIS artifact within days of shipping (matches Phase 4 Q1 first beneficiary).
- No `/loom-auto`, `/loom-roadmap init`, or `/loom-plan` wiring — pure manual invocation, matches NG4 + NG5.
- No Design / Eng / DevEx lenses — matches NG1–NG3.

**Cost.** ~2 days. Repoints the existing M-04 CEO agent's input contract from `PLAN.md` to a think doc; writes the subcommand; writes the artifact schema; adds a test that exercises the wedge on a fixture think doc.

**Risk.** If P2 is wrong (think doc shape ≠ what CEO agent reads), the wedge needs a shim adapter between think-doc frontmatter and CEO agent input. If P3 is wrong (batch output insufficient), operator will feel the shallowness on the first dogfood run and interactive interrogation must land in follow-up.

### Approach B — two-command wedge: `/loom-think:review` + `/loom-think:review-status`

Same as A, but adds a separate command to inspect prior interrogation artifacts (`/loom-think:review-status [slug]` reads `.loom/thinks/{slug}-interrogation.toon` and pretty-prints). Trades a slightly larger surface for discoverability. Cost: +½ day. Risk: adds surface before we know if operators need it. Probably not worth it at wedge scope.

### Recommendation

**Approach A.** Justification: it is the minimum viable slice that lets the operator (Phase 4 Q1) dogfood the gate on this think doc TODAY, honors gstack ground truth (design-doc-as-input, decision-terminating), does not duplicate M-04 post-plan review (per C4 and NG6), and defers every surface interaction (roadmap, plan, auto) that we don't yet know we need (NG4, NG5). Premises P1 and P2 are the load-bearing ones — validate them first with a fixture think doc, then unblock the follow-up milestones for Design / Eng / DevEx.

### Next step

Author a ROADMAP feature (via `/loom-spec` or `/loom-roadmap:mutate`) titled *"F-XX: Pre-plan CEO interrogation gate — `/loom-think:review`"* attached to a new milestone **M-14 (Pre-plan judgment gate)**. Wedge scope: Approach A above. Follow-up milestone M-15 lands Design / Eng / DevEx pre-plan lenses + `/loom-auto` sequencing (once P2 and P3 have validated on operator dogfood).

Also-do: fix a downstream artifact drift I introduced this session — `README.md` line 143 ("adopted from Garry Tan's [gstack](...)") and NOTICE section on gstack were written before this ground truth was confirmed. Sentences are correct in spirit but were speculative when written. No text change needed; leaving this note for the next docs pass.

## Output summary

```toon
think:
  slug: ceo-review-placement
  path: .loom/thinks/ceo-review-placement-2026-07-01T09-45-00.md
  supersedes:
  branch: ceo-review-placement
  status: DRAFT
  approachCandidates: 3
  nextStep: /loom-spec F-XX pre-plan CEO interrogation gate for new M-14
```
