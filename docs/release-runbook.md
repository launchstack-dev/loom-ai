# Release runbook

This runbook covers the Phase 6 release pipeline (`.github/workflows/release.yml`)
and the recovery procedures for partial-release failures. Read this end-to-end
before pushing a release tag.

## Happy path

1. Bump `package.json` and `.claude-plugin/plugin.json` `version` on `main`.
2. Tag: `git tag v0.1.0 && git push --tags`.
3. The `release` workflow runs:
   - `build-tarball` — produces `dist/loom-0.1.0.tar.gz` + `dist/manifest.toon`.
   - `upload-release-asset` — creates the GitHub Release with both files.
   - `commit-changelog` — prepends a `## v0.1.0 (YYYY-MM-DD)` block to
     `CHANGELOG.md` and pushes to `main`.
   - `open-marketplace-pr` — gate-checks the sigstore-attest run on the same
     commit, then opens a PR against the marketplace registry repo titled
     `Loom v0.1.0`.

Total wall time: ~4 minutes. No manual steps between tag-push and PR-open.

## Dry-run locally

```sh
act push --eventpath fixtures/v0.1.0-test-event.json
```

The fixture's tag (`v0.1.0-test`) triggers dry-run mode. The workflow:
- builds `dist/loom-local-test.tar.gz` (Phase 8's Docker harness fixture);
- generates `dist/manifest.toon`;
- skips `upload-release-asset`, `commit-changelog`, and
  `open-marketplace-pr`;
- runs `dry-run-summary` to print the artifacts.

If `act` is not installed, validate the workflow YAML with
`actionlint .github/workflows/release.yml` instead and run the three scripts
directly (see the "Smoke verification" section below).

### Smoke verification (without `act`)

```sh
bunx tsx scripts/build-release-tarball.ts --dry-run
bunx tsx scripts/generate-manifest.ts --tarball dist/loom-local-test.tar.gz --tag v0.1.0-test --out dist/manifest.toon
sha256sum dist/loom-local-test.tar.gz   # must match dist/manifest.toon sha256
bunx tsx scripts/generate-changelog.ts --tag v0.1.0-test --dry-run
```

## Partial-release recovery

The pipeline is sequenced so that downstream jobs can detect upstream
incompleteness, but GitHub Actions can still leave you in a half-shipped state
if a job is canceled or a runner dies. The following matrix lists the recovery
step per failure mode.

### Tarball uploaded but marketplace PR not opened

**Symptom:** GitHub Release for `vX.Y.Z` exists with `loom-X.Y.Z.tar.gz` +
`manifest.toon`, but no PR has been opened against the marketplace registry
repo (either `open-marketplace-pr` failed, the sigstore-attest workflow has not
completed, or the marketplace PAT lapsed).

**Recovery:**

1. **Delete the GitHub Release asset.** Use the GitHub UI or
   `gh release delete vX.Y.Z --repo launchstack-dev/loom-ai --yes`. This
   removes the tarball *and* the `manifest.toon` so the next attempt does not
   collide.
2. **Delete the tag locally and on the remote.**
   `git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z`.
3. **Re-tag with a patch bump.** Increment the patch number (e.g.
   `vX.Y.Z+1`) so consumers see a clean monotonic version sequence — do
   not reuse the failed tag.
4. **Re-run the workflow** by pushing the new tag. The pipeline restarts
   from `build-tarball`.

### CHANGELOG committed but marketplace PR not opened

`commit-changelog` runs before `open-marketplace-pr`. If the changelog
landed on `main` but the PR step failed, the `generate-changelog.ts` script is
idempotent — re-running it with the same `--tag` is a no-op. Follow the
"Tarball uploaded but marketplace PR not opened" recovery; the CHANGELOG entry
for the failed tag will remain on `main` but is harmless because the next tag
generates its own entry below it.

### Sigstore workflow did not complete

`open-marketplace-pr.ts` exits with `SIGSTORE_NOT_VERIFIED` when no
successful `sigstore-attest` run is found for the commit SHA. Recovery:

1. Re-run the sigstore-attest workflow (Phase 7) for the same commit.
2. Once it succeeds, re-run the failed `open-marketplace-pr` job from the
   GitHub Actions UI. No re-tag required — the gate check is the only side
   effect that was missing.

### Marketplace PR token expired

Symptom: the `open-marketplace-pr` job fails inside `gh pr create` with a 401
or 403. Recovery:

1. Rotate `LOOM_MARKETPLACE_PR_TOKEN` in the repo's GitHub Actions secrets.
2. Re-run the failed job. Do not re-tag.

## Reference: dry-run vs release behavior

| Step                    | Tag `vX.Y.Z` | Tag `vX.Y.Z-test` |
|-------------------------|--------------|-------------------|
| build-tarball           | runs         | runs (writes `dist/loom-local-test.tar.gz`) |
| upload-release-asset    | runs         | skipped |
| commit-changelog        | runs         | skipped |
| open-marketplace-pr     | runs         | skipped |
| dry-run-summary         | skipped      | runs |

## Owned files

- `.github/workflows/release.yml`
- `scripts/build-release-tarball.ts`
- `scripts/generate-manifest.ts`
- `scripts/generate-changelog.ts`
- `scripts/open-marketplace-pr.ts`
- `fixtures/v0.1.0-test-event.json`
- `docs/release-runbook.md` (this file)

## Contracts shared with other phases

- **Marketplace registry filename:** `marketplace-registry.toon`. Phase 7's
  sigstore-attest workflow must reference this name for the gate check;
  Phase 12 (marketplace submission) appends to it.
- **Sigstore workflow name:** `sigstore-attest`. The
  `open-marketplace-pr.ts` script's `gh run list --workflow sigstore-attest`
  call depends on Phase 7 naming its workflow this exact string.
- **Dry-run artifact name:** `dist/loom-local-test.tar.gz`. Phase 8's Docker
  install harness consumes this filename verbatim.
