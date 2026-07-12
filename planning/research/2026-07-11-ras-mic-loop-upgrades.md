# Ras Mic Loop Workflow → Loom Upgrade Assessment

- Date: 2026-07-11
- Source: "My Fable 5 workflow is insane" (Ras Mic / Michael Shimeles), https://www.youtube.com/watch?v=Ju81iK_5OD8 — full transcript + distillation: `planning/research/2026-07-11-ras-mic-transcript.md`
- Method: /fable-prompt-engine prompt package (`prompts/ras-mic-loom-upgrade-assessment.md`), executed with two read-only Explore surveys of this worktree (loop mechanics; intake/integrations), followed by gap analysis and red-team.
- Scope guard: research artifact only — no core files modified, nothing committed.

## 1. The source workflow in one paragraph

Ras Mic ships ~75 PRs/week with a two-loop "master loop": (Loop 1) a Linear ticket carrying a rich bug/feature schema (summary, steps-to-reproduce, expected behavior, actual behavior, impact) is assigned via Linear MCP to a cloud agent (Cursor Cloud / Devin) with desktop access; the agent reproduces the bug first, implements, tests via computer use, and exits the loop only when it has a **video recording of the desired state actually happening**; the PR it opens embeds that demo video. (Loop 2) Greptile reviews the PR and emits a confidence score /5; the /gp-loop skill makes the agent address feedback and resubmit until 5/5, which gates merge. The human authors tickets and reviews the video + function signatures, not the diff. His two meta-rules: loops only pay when the success state is cheap to state and check, and you build each loop manually before codifying it as a skill.

## 2. Assessment of Loom's latest upgrades against this workflow

Recent shipped work (v0.2.0, 2026-07-04..07-10) already covers — often more rigorously — the *internal* half of his system:

| Recent Loom upgrade | Relation to the source workflow |
|---|---|
| Browser-e2e capability (M-01..M-05, `planning/ROADMAP-browser-e2e.md`, daemon CDP mode, chrome-mcp mode, per-step screenshots + console dumps) | This is Loom's "computer use test" — Loop 1's verification step, minus video recording and minus autonomous triggering of the real-browser mode. |
| F-18 loop-construction gate (`loop.toon`, `verifiedRed: true` mandatory before convergence; error codes 4–8) | Strictly stronger than his "reproduce the bug so you know exactly what's the issue" prompt — Loom makes repro-first a *hard gate*, he relies on prompting. |
| Convergence circuit breakers (STALL/REGRESSION/BUDGET_EXHAUSTED/MAX_ITERATIONS, non-disableable; `agents/convergence-driver.md`) | Directly answers his loop-economics worry ("loops that burn your subscription"). Loom is ahead: he has no stall/regression detection at all. |
| Criteria-first planning (dual-track `criteria-plan.toon` + interpretation-reviewer; C-01/C-02) | His "the ticket IS the success criterion" idea, generalized — but Loom only applies it to work that enters via /loom-plan, not to tickets. |
| Thinking-gate (`/loom-think:review` fail-closed, bounded rewrites) | No analog in his workflow; Loom is ahead upstream of the build loop. |
| F-04 PR-review convergence (`scripts/pr-review-harness.ts` + pr-fixer-agent, gemini adapter, loop until `blockingCount == 0`) | His Loop 2, with a binary convergence signal instead of a /5 score, and only one bot adapter shipped. |
| F-39 injection defense, code-avoidance ponytail (#38) | Orthogonal hardening; no counterpart in his workflow. |

**Verdict:** Loom's loop *engine* is ahead (gates, breakers, criteria, budget caps). What Loom lacks is everything at the *edges* of the loop: structured work intake from a ticket system, human-consumable proof artifacts (video), evidence surfaced on the PR, a score-style merge gate, and any way for a loop to run without an operator at the keyboard.

## 3. Gap table — 8 distilled ideas vs Loom current state

| # | Ras Mic idea | Loom nearest capability (evidence) | Classification |
|---|---|---|---|
| 1 | Structured ticket intake (Linear as success-criterion store) | `/loom-spec` creates GH issues *outbound* (`skills/loom-spec/SKILL.md:148`); `.github/ISSUE_TEMPLATE/bug_report.md` has expected/actual/repro fields; `/loom-bugfix` takes free text only (`commands/loom-bugfix.md:16-76`). No Linear/Jira/GH-Issues *intake* path exists anywhere. | **MISSING** |
| 2 | MCP assignment to a cloud agent | No `.mcp.json`, no remote dispatch, no CI-triggered agents (`.github/workflows/*` run no agents). Fable-readiness fork's Workflow engine (PR #42) is the designated future execution substrate. | **MISSING** (dispatch) / **OUT-OF-SCOPE** (hosting the runtime — Loom is the planning/verification layer, not an agent cloud) |
| 3 | Build/verify loop with computer use; video is the exit condition | 4-tier convergence with e2e tier (`protocols/convergence-tier.schema.md` v2); 3 session modes incl. real-browser chrome-mcp and daemon CDP; per-step PNGs + console dumps (`agents/e2e-runner-agent.md`). No video/GIF/screencast anywhere; `gif_creator` tool exists but unwired; chrome-mcp mode is opt-in (`--chrome`), never autonomous. | **PARTIAL** |
| 4 | Demo video embedded in the PR | PR bodies are text-only: commit log + diffstat (`commands/loom-git.md:250-285`) or plan-completion ledger + test plan (`skills/loom-ship/SKILL.md:76-101`). E2E screenshots exist on disk but are never referenced in PR creation. | **MISSING** |
| 5 | Scored review loop; merge gated on 5/5 | F-04 loops until `blockingCount == 0` (a *cleaner* convergence signal than a score); plan-review agents already emit 0..10 scores with confidence (`agents/plan-eng-review-agent.md` et al.) but only for plans/roadmaps; no numeric PR score, no score-gated merge, one bot adapter (gemini). | **PARTIAL** |
| 6 | Human as policy author (review video + signatures, not diffs) | Loom's whole thesis points here (criteria before code; loom-ship's DIFF-VERIFIABLE ledger) but without proof artifacts the human still reviews text. | **PARTIAL** |
| 7 | Loop economics — evaluation must be cheap to state and check | `criteria-plan.toon` `automatable` flags, verified-red gate, budget caps, breakers. | **ALREADY-COVERED** (Loom is ahead) |
| 8 | Manual-first loop authoring, then codify as a skill | F-18 10-rung loop-construction ladder; `/loom-skill create` wizard. No bridge that promotes a proven `loop.toon` into a reusable skill/kit. | **PARTIAL** |

## 4. Ranked upgrade proposals

Primary signal stays `blockingCount == 0` everywhere — no proposal replaces Loom's convergence semantics; they add intake, evidence, and gating at the edges. All new artifacts are TOON per this branch's convention. **C-05 compatibility note:** the fable-readiness branch freezes TOON (existing artifacts keep it, no migration) and prefers JSON-with-schema for *new* schemas consumed by the Workflow engine — since C-17 re-platforms this class of work onto that engine, the new schemas proposed below (`ticket-intake`, `review-scorecard`) should be format-decided at design time under whichever convention has landed; nothing else in the proposals is format-sensitive.

### P1 — `linear-intake` kit: `/loom-linear` ticket ingestion (Track: integration) — **L**
- **Ports ideas:** 1, 2 (the in-scope half), 6.
- **Builds on:** `/loom-spec` (SpecRecord, gh-issue outbound), `/loom-bugfix` loop-gate, kit system (`protocols/kit.schema.md`), three-way command parity (`.loom/wiki/pages/convention-command-creation.md`).
- **Shape:** `commands/loom-linear.md` (`ingest | sync | close`), `agents/linear-intake-agent.md` (reads ticket via user-configured Linear MCP `mcp__linear__*` tools; Loom ships no `.mcp.json` — kit README documents setup), `protocols/ticket-intake.schema.md`. The intake agent maps ticket fields → a TicketIntake TOON, then routes: bug → `/loom-bugfix` with a **pre-seeded `loop.toon`** (symptom from actual-behavior, harness command proposed from repro steps — satisfying the verified-red gate instead of fighting it); feature → `/loom-spec` SpecRecord → roadmap/plan. `close` posts the convergence-summary + evidence links back to the ticket and GH cross-references (`Closes #NNN` parity preserved).
- **TOON sketch:**
  ```
  ticketIntake:
    source: linear            # linear | github
    ticketId: PLO-26
    kind: bug                 # bug | feature | enhancement
    summary: UI flicker during model provider connect
    stepsToReproduce[3]: open connect modal, select provider, observe flicker
    expectedBehavior: single stable connecting state
    actualBehavior: flicker between connecting and waiting
    impact: medium
    loopSeed:
      symptom: flicker between connecting and waiting states
      proposedCommand: bun test tests/e2e/provider-connect.story.ts
  ```
- **Risk:** dependency on user-level Linear MCP config; mitigate with a `github` source adapter sharing the same schema (see P5) so the kit works without Linear.
- **Acceptance criterion:** given a fixture ticket TOON, `/loom-linear ingest` produces a valid `ticket-intake.toon` + a `loop.toon` seed whose schema validates, and the command exists in all three parity locations (repo `commands/`, `library.yaml` prompts entry, installed symlink).

### P2 — E2E recording capture: video/GIF as a convergence artifact (Track: loops) — **M**
- **Ports idea:** 3.
- **Builds on:** shipped browser-e2e (all three session modes), existing artifact layout `.plan-execution/convergence/e2e/`.
- **Shape:** per-mode recorder — headless: Playwright `video: 'on'` (or trace) in the runner config; daemon: CDP `Page.startScreencast` in `scripts/loom-browser-daemon.ts`; chrome-mcp: wire the already-available `gif_creator`. `recordingPaths[]` column added to the DeltaReport rows (`.plan-execution/convergence/e2e/delta-report.toon`) alongside `screenshotPaths[]`. Recordings land in `recordings/{runId}/{storySessionName}/`.
- **Risk:** artifact size — gate with `recordingEnabled` in converge.config (default on for e2e tier at milestone level, off for wave-level runs).
- **Acceptance criterion:** running a fixture story with `recordingEnabled: true` yields a playable recording file and a `delta-report.toon` whose row references it; with `false`, behavior is byte-identical to today.

### P3 — PR evidence pack: proof-first review surface (Track: both) — **M**
- **Ports ideas:** 4, 6.
- **Builds on:** `/loom-git pr` body generation, `/loom-ship` plan-completion ledger, `convergence-summary.toon`, P2 recordings, F-18 `loop.toon`.
- **Shape:** an `## Evidence` section auto-assembled at PR time when artifacts exist: convergence-summary status line, red→green pair from `loop.toon` (verified-red timestamp → green run), e2e recording/screenshot links (uploaded as PR attachment or repo-ignored artifact link), criteria coverage count from `criteria-plan.toon`. Presubmit-sweep already runs at this seam — the evidence assembler slots beside it in `/loom-git pr` step 5.
- **Why ranked here:** this is the highest leverage-per-effort port — it converts artifacts Loom *already produces* into the "review starts from proof" experience, and P2 makes it strictly better.
- **Acceptance criterion:** `gh pr view --json body` on a fixture-branch PR contains an `## Evidence` section referencing an existing convergence-summary and at least one e2e artifact when those files exist, and omits the section cleanly when they don't.

### P4 — Scored review gate: PR ReviewScorecard + merge threshold (Track: loops) — **M**
- **Ports idea:** 5.
- **Builds on:** F-04 harness + adapters, plan-review agents' existing 0..10 scoring pattern, `/loom-git merge`.
- **Shape:** `protocols/review-scorecard.schema.md` — per-iteration `scorecard.toon` (dimensions 0..10 + overall, mirroring `BenchmarkScorecard`'s typed shape). F-04 keeps `blockingCount == 0` as its convergence signal; the scorecard is an *additional merge gate*: `[settings.prReview] mergeThreshold = 8` in `orchestration.toml`; `/loom-git merge` refuses (with override flag `--force-below-threshold`) when the latest scorecard is below threshold. Also the natural place to add a second bot adapter (coderabbit/copilot slots already registered in the `ADAPTERS` registry).
- **Risk:** score-chasing/goodharting — mitigated by keeping blockingCount primary and the threshold advisory-by-default (gate opt-in per project).
- **Acceptance criterion:** on a fixture PR with `scorecard.overall` below the configured threshold, `/loom-git merge` exits non-zero with the locked cause+recovery string pair; at/above threshold it proceeds.

### P5 — GitHub Issues ingest: `/loom-spec ingest #NNN` (Track: integration) — **S**
- **Ports idea:** 1 (no new external dependency).
- **Builds on:** `bug_report.md` template fields (already expected/actual/repro-shaped), `gh` CLI (already the PR surface), `/loom-spec` SpecRecord + `sourceIssue` field.
- **Shape:** inverse of the existing outbound path — `gh issue view --json` → same `ticket-intake.toon` schema as P1 (`source: github`) → same routing (bug → seeded loop.toon → `/loom-bugfix`; feature → SpecRecord). Ship this *before or with* P1: it validates the intake schema with zero MCP setup and makes the Linear kit an adapter rather than a monolith.
- **Acceptance criterion:** ingesting a fixture issue that follows the bug-report template yields a schema-valid `ticket-intake.toon` and a seeded `loop.toon`; ingesting a non-conforming issue degrades to a SpecRecord draft with a warning, never a crash.

### P6 — `verifiedGreen` evidence on loop retirement (Track: loops) — **S**
- **Ports ideas:** 3 (exit condition), 8 (explicit stop points).
- **Builds on:** F-18 `loop.toon` (`verifiedRed`, `rung`, `retiredAt`), P2 recordings.
- **Shape:** symmetric field — `greenEvidence: {path, kind: recording|screenshot|test-output, capturedAt}` required before a loop can set `retiredAt` when its rung is at a browser-reachable tier; test-output paths satisfy it at lower rungs. This is Ras Mic's "do not stop until you have a successful run *and a recording to show me*" made schema-enforced, matching how Loom already enforces red.
- **Acceptance criterion:** attempting to retire a browser-rung loop without `greenEvidence` fails schema validation with a distinct error code; with evidence present, retirement succeeds and `/loom-bugfix` surfaces the evidence path in its completion summary.

### Watch item (not proposed now) — overnight/cloud loop dispatch
His "go to bed, wake up to a finished PR" depends on a hosted agent runtime, which Loom deliberately is not (positioning: planning/verification layer). The correct seam is the fable-readiness fork's `scripts/lib/engine/*` Workflow driver (PR #42) that Track B re-platforms onto — revisit remote/scheduled dispatch *after* that re-platform lands, rather than building a markdown-prompt-era background loop that Track B would immediately obsolete.

### Proposal summary (TOON)

```
proposals[6]{id,name,track,effort,portsIdeas,dependsOn,headlineAcceptance}:
  P1,linear-intake kit /loom-linear,integration,L,1;2;6,P5-schema,fixture ticket → valid ticket-intake.toon + seeded loop.toon + three-way parity
  P2,e2e recording capture,loops,M,3,none,fixture story → playable recording referenced in delta-report.toon
  P3,PR evidence pack,both,M,4;6,P2-optional,PR body gains ## Evidence citing convergence-summary + e2e artifact
  P4,review scorecard + merge threshold,loops,M,5,none,merge exits non-zero below configured scorecard threshold
  P5,gh issues ingest /loom-spec ingest,integration,S,1,none,fixture issue → schema-valid ticket-intake.toon + loop.toon seed
  P6,verifiedGreen loop retirement evidence,loops,S,3;8,P2-optional,browser-rung loop cannot retire without greenEvidence
```

Suggested sequencing: **P5 → P2 → P3 → P6 → P1 → P4.** P5 proves the intake schema cheaply; P2+P3 convert existing verification into visible proof; P6 closes the loop-discipline symmetry; P1 is the flagship integration once the schema is validated; P4 is independent and can slot anywhere.

## 5. Red-team notes

- **Duplication check:** P2/P3/P6 extend (not duplicate) shipped browser-e2e — recording was explicitly absent (no Playwright `video:`, `gif_creator` unwired). P4's scorecard reuses the BenchmarkScorecard/plan-review 0..10 pattern rather than inventing a new scale. P1/P5 overlap nothing shipped; `/loom-spec` is outbound-only today.
- **Fable-readiness compatibility (C-17):** none of P1–P6 touch the loop *driver* internals, so the Track B re-platform onto the Workflow engine doesn't invalidate them; P2/P3/P6 are artifact-layer, P1/P5 are intake-layer, P4 gates at `/loom-git merge`. The watch item is deliberately deferred to post-re-platform.
- **CT6 cartography:** no overlap (cartography is maps/freshness); P1–P6 don't depend on M-09 and don't jump the C-16 gate — but they *do* compete for roadmap slots against M-06 Phase 2 (OSS launch). Prioritization vs M-06 is a maintainer call, not assumed here.
- **Convention compliance:** all new artifacts TOON; `/loom-linear` spec includes three-way parity + `loom.md` dispatch row + kit `suggestedConfig`; no fable-tier agent spawns proposed (intake agent: sonnet-class); no new telemetry (C-12 respected — evidence is repo-state artifacts).
- **Goodhart risk on P4:** flagged; mitigated by advisory-default and blockingCount primacy.
- **Known unknowns:** Linear MCP tool surface (`mcp__linear__*` names/schemas) unverified against a live server — labeled *weak inference*, to be confirmed during P1 design; PR attachment mechanics for video on GitHub (may need artifact-link fallback) — *likely inference*; sponsor-segment content (Framer) excluded from analysis per calibration.

## 6. Definition-of-done self-check

- [x] Transcript captured and cited (`2026-07-11-ras-mic-transcript.md`)
- [x] Current-state claims carry file-path evidence (from two Explore surveys of this worktree)
- [x] All 8 ideas classified (1 ALREADY-COVERED, 4 PARTIAL, 2 MISSING, 1 split MISSING/OUT-OF-SCOPE)
- [x] 6 proposals across both tracks, each with wiring target + machine-checkable acceptance criterion
- [x] Recent-upgrade duplication check performed (v0.2.0, thinking-gate, F-39, #38, fable-readiness, CT6)
- [x] No commits, no core-file modifications, no external side effects
