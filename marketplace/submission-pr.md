<!--
  Marketplace submission PR body.

  This file is the body of the pull request opened against the Anthropic
  Claude Code marketplace registry repository to list Loom. Section ordering
  is load-bearing and conforms to `marketplace/listing-content-spec.md`:
    Header → Outcomes → Quickstart → Decision matrix → Differentiation → Support.

  Before opening the submission PR, an operator MUST replace every TBD-marked
  token (search for the literal string `TBD`). See `marketplace/submission-evidence.toon`
  for the parallel list of placeholder URLs and the Phase 12 runbook in
  `integrationNotes` of the wave-6b implementer-agent result for the
  pre-flight checklist.

  Referenced artifacts (all on disk in this repo):
    - marketplace/listing.md
    - marketplace/listing-content-spec.md
    - docs/install-decision-matrix.md
-->

# Loom

Ship plans, not prompts — Loom orchestrates planning waves, convergence loops, and a repo-committed wiki across your Claude Code agents.

**Listing copy:** see `marketplace/listing.md` (the full listing markdown, which is the source of truth for the marketplace card and detail page).

**Conformance contract:** this PR body conforms to `marketplace/listing-content-spec.md` (section ordering + per-section character budgets). The listing-content-spec is the contract between the listing file and this submission body.

**Tags:** `agentic`, `planning`, `convergence`, `wiki`, `code-review`, `orchestration`, `claude-code`

## Outcomes

- **Planning waves that actually parallelize.** Wave-based execution with explicit file ownership lets multiple implementer agents work concurrently without stomping on each other's files.
- **Convergence loops that finish.** Acceptance-criteria-driven review-fix cycles run until the change matches the spec.
- **A repo-committed wiki that compounds.** Every decision, plan, and review lands in versioned markdown alongside the code.
- **Brownfield onboarding in one command.** `/loom-init` reads your existing codebase, drafts CLAUDE.md, and seeds a roadmap.
- **Composable rigor.** `/loom-doctor` + `/loom-converge` chain into any existing workflow.

## Quickstart

```
/plugin marketplace add launchstack-dev/loom-ai
/plugin install loom
```

Enterprise / network-blocked installs use the curl path — see docs.

## Decision matrix

Brownfield vs greenfield vs network-blocked? See `docs/install-decision-matrix.md` for the full picker.

## Differentiation

Loom is composable orchestration, not another prompt pack. `/loom-doctor` diagnoses installation and config drift; `/loom-converge` runs acceptance-criteria-driven review-fix loops. Wave-based planning yields parallel implementers with file-ownership guarantees, and every artifact lands as versioned markdown in your repo — so your delivery process compounds.

## Support

Community-supported. GitHub issues only. No SLA.

---

## Submission metadata

The fields below are the audit trail captured in `marketplace/submission-evidence.toon` (schema: `agents/protocols/submission-evidence.schema.md`). Each value MUST be replaced before this PR is opened; see the TBD markers.

- **Release tag:** `v0.1.0` — corresponds to the Phase 7 signed release. (Update to the actual tag at submission time.)
- **Sigstore attestation:** https://example.invalid/sigstore-TBD — replace with the Sigstore transparency-log URL for the release artifact. CI gates submission on `cosign verify` passing against this artifact (Phase 12 acceptance criterion 4).
- **Maintainer Review Gate issue:** https://example.invalid/issue-TBD — TODO: replace with the resolved internal maintainer-approval tracking issue URL (`launchstack-dev/loom-ai` issue tracker). The Phase 12 submission CI check (S-02) blocks the PR when this issue is still open; it MUST be resolved before this PR opens.
- **Plugin-install E2E:** `test/e2e/plugin-install.spec.ts` — green against the signed release tag on CI (Phase 12 acceptance criterion 1).

### Verification checklist (operator)

- [ ] All `TBD` tokens in this file and in `marketplace/submission-evidence.toon` have been replaced with real URLs.
- [ ] `cosign verify` against the release asset linked above exits 0.
- [ ] The Maintainer Review Gate issue is closed/resolved.
- [ ] `bunx vitest run test/e2e/plugin-install.spec.ts` is green on CI against the signed release tag.
- [ ] `marketplace/submission-evidence.toon` `outcome` field is `pending` at submission time; it is updated to `accepted` or `rejected` by the post-merge automation.

### Why merge this

Loom turns Claude Code into a disciplined delivery system: planning waves, convergence loops, and a repo-committed wiki. It is brownfield-friendly (`/loom-init` bootstraps from any existing codebase) and ships composable primitives (`/loom-doctor`, `/loom-converge`) that chain into existing workflows. Full listing copy and screenshots live in `marketplace/listing.md`.
