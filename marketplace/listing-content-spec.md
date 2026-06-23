# Marketplace Listing Content Specification

This document is the contract between `marketplace/listing.md` and the Phase 12 marketplace submission. Any edit to `listing.md` MUST keep it conformant with this spec; the Phase 12 publish agent reads this file as the source of truth.

## Section list with character budgets

| Section | Char budget | Required content |
|---|---|---|
| Header | 140 | One-line summary — outcome-first, NOT a feature list. Must fit the marketplace summary slot exactly. |
| Outcomes | 500 | 3–5 outcome bullets covering planning waves, convergence loops, repo-committed wiki, brownfield onboarding, and composability. |
| Quickstart | 200 | The two plugin install commands in order (`/plugin marketplace add launchstack-dev/loom-ai` then `/plugin install loom`) plus the verbatim curl-path sentence. |
| Decision matrix | 100 | One-line pointer to `docs/install-decision-matrix.md` for brownfield vs greenfield vs network-blocked. |
| Differentiation | 300 | `/loom-doctor` + `/loom-converge` composability claim — wave-based planning, file-ownership guarantees, versioned-markdown artifacts. |
| Support | 80 | Verbatim line: `Community-supported. GitHub issues only. No SLA.` |

**Section ordering is load-bearing:** Header → Outcomes → Quickstart → Decision matrix → Differentiation → Support. The Support section MUST appear above the Quickstart install command block (line-ordering assertion in Phase 12 validation).

## Screenshot rules

- **Minimum count:** 3 screenshots. Current spec ships 4.
- **Path convention:** `marketplace/screenshots/NN-<slug>.png` (zero-padded ordinal).
- **Alt-text rule:** Every screenshot reference MUST include descriptive alt text in the markdown `![alt](path)` syntax. Empty alt text (`![](path)`) is a spec violation. Alt text describes what the screenshot shows, not the filename.

## Categorization tags

Required tag set (must all be present in listing.md tag line): `agentic`, `planning`, `convergence`, `wiki`, `code-review`, `orchestration`, `claude-code`.

## Support contact

GitHub issues at `launchstack-dev/loom-ai`. No private email, no Slack, no SLA. The Support section MUST repeat this verbatim: `Community-supported. GitHub issues only. No SLA.`

## Version-bump cadence promise

The listing implicitly commits to: **semver patch within 7 days for security fixes; minor releases on a monthly cadence; major releases are pre-announced via roadmap entries.** This cadence is enforced by `marketplace/listing-checklist.md` (version must match `plugin.json`) and by the Phase 6 release pipeline.

## Verbatim phrases (must appear in listing.md, byte-exact)

1. `Community-supported. GitHub issues only. No SLA.`
2. `Enterprise / network-blocked installs use the curl path — see docs`
3. `/plugin marketplace add launchstack-dev/loom-ai`
4. `/plugin install loom` (exactly one occurrence — single-CTA assertion)

## Outcomes-not-features rule

The first paragraph of the Outcomes section is parsed by the convergence check; the count of bullets that read as **feature nouns** (e.g., "hooks system", "agent registry", "config file") must be zero. Bullets MUST be phrased as user-visible outcomes (e.g., "planning waves that actually parallelize").
