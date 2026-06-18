# Marketplace Submission Pre-Flight Checklist

Phase 12 publish agent MUST verify every box below before opening the marketplace-repo submission PR. Unchecked boxes block submission.

## Copy and content

- [ ] `marketplace/listing.md` copy approved by named maintainer (see Maintainer Review Gate below)
- [ ] `marketplace/listing.md` conforms to `marketplace/listing-content-spec.md` section ordering and char budgets
- [ ] Summary ≤ 140 chars (including whitespace)
- [ ] Description ≤ 500 chars
- [ ] Outcomes-not-features rule passes (zero feature-noun bullets in the first Outcomes paragraph)
- [ ] Verbatim phrase `Community-supported. GitHub issues only. No SLA.` present
- [ ] Verbatim phrase `Enterprise / network-blocked installs use the curl path — see docs` present
- [ ] Single grep match for `/plugin install loom` in listing.md
- [ ] Support section appears above the Quickstart install command block (line-ordering)

## Screenshots

- [ ] At least 3 screenshots present under `marketplace/screenshots/`
- [ ] Every screenshot reference in listing.md has non-empty alt text
- [ ] Screenshot file paths in listing.md resolve to real files on disk

## Versioning and release artifacts

- [ ] `plugin.json` version matches the git tag for this submission
- [ ] `marketplace/listing.md` does not contradict the version in `plugin.json`
- [ ] Sigstore attestation present for the release tarball (Phase 6 workflow output)
- [ ] CHANGELOG.md has an entry for this version with user-visible changes
- [ ] `docs/install-decision-matrix.md` exists and the listing's Decision-matrix section points at it

## Submission evidence

- [ ] `marketplace/submission-evidence.toon` fields populated: `maintainerReviewIssue`, `sigstoreAttestationUrl`, `releaseTagSha`, `changelogEntryPath`, `screenshotsCommitSha`
- [ ] Submission PR description links to the resolved maintainer-review issue

## Maintainer Review Gate (explicit pre-submission step)

**Before the marketplace submission PR opens (Phase 12), a GitHub issue titled `Marketplace listing copy approval — vX.Y.Z` MUST be:**

- [ ] Opened against `launchstack-dev/loom-ai`
- [ ] Assigned to the named repo maintainer (repo owner)
- [ ] Resolved with an explicit approval comment ("LGTM, ship it" or equivalent) on the exact `listing.md` commit SHA going into the submission PR
- [ ] Linked from the submission PR description (`Closes #N` or `Reviewed-in: #N`)

If the maintainer requests changes, the gate resets: re-open or re-comment after edits, get a fresh approval on the new commit SHA.
