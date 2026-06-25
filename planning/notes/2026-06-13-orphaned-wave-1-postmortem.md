# Postmortem — Orphaned Wave 1 (convergence-generalization run)

**Date:** 2026-06-13
**Trigger:** `/loom-plan execute --resume --auto` resume preflight detected drift between state.toon (wave 1 = success) and on-disk file shapes (convergence-driver.md back at 520 lines instead of 921).

## What happened

- 2026-06-13 ~12:00Z: Wave 0 ran on branch `pr-16-followups`, commit `c9223e3` (`feat(wave-0): contracts`).
- 2026-06-13 ~12:15Z: Wave 1 ran serial on the same branch, producing commit `4d1f2f2` (`refactor(wave-1): convergence-driver document-mode generalization`).
- 2026-06-13 ~12:41Z: PR #17 (pr-16-followups → main) merged on GitHub. The merge source was `origin/pr-16-followups@ab63d66` (the remote head, which preceded the local Wave 1 commit by two commits). The merge commit `3edd86a` therefore did NOT include `4d1f2f2`.
- 2026-06-13 ~12:42Z: Wave 1 wrote its checkpoint and wave-1-summary; the orchestrator believed Wave 1 was complete and committed.
- Post-merge: local `pr-16-followups` branch was deleted (or implicit cleanup occurred); `4d1f2f2` became dangling, reachable only via the tag `plan-exec-convergence-generalization-wave-1-post`.
- Today: resume preflight halted because the file sizes on `main` HEAD did not match the wave-1-summary expectations.

**Recovery applied:** `git cherry-pick 4d1f2f2` onto main → commit `4787bbf`. Verified tsc clean + 400/400 protocol tests pass.

## Why our existing drift detection missed it

Per `state.schema.md` Rule 4: "Drift detection on resume. Before `--resume`, compare current file hashes against `fileHashes` from the last completed wave."

Two reasons this failed:

1. **`fileHashes` was never populated.** `state.schema.md:29` shows the intended shape (per-file sha256 entries per wave), but `commands/loom-plan/execute.md` does not provide a template in any of the wave-completion steps (Step 3, Step 8, Step 9). Our `state.toon` line 49: `fileHashes:` (empty). The drift check ran against nothing.
2. **The schema only watches file hashes.** Even if hashes had been populated, they'd watch file *contents*, not the commit lineage that contains them. The actual failure mode here was "the commit producing those file contents is not reachable from HEAD" — which `sha256(file) != recorded_sha256` would catch only by accident (and only if Wave 1's auto-commit had also recorded fresh hashes that were now stale on main).

## Four gaps identified

### Gap 1 — `state.toon` does not record git lineage

No fields for `branchAtStart`, `headAtStart`, `lastWaveCommit[N]`, `remoteAtStart`. Without these, no resume-time check can compare "where the executor was committing" against "where HEAD is now."

### Gap 2 — `fileHashes` is specced but never populated

`state.schema.md` defines the shape; `execute.md` doesn't write it. The drift detection rule in `state.schema.md:55` references it as if it were always present.

### Gap 3 — Auto-commit (Step 3.5/8.5) has no branch sanity check

The current logic is:

```
git add {filesCreated} {filesModified}
git commit -m "..."
```

It does not:

- Verify the current branch matches the branch the run started on.
- Verify the branch tracks a remote, and if so that local HEAD is reachable from the remote.
- Push the commit. (Wave commits stay local until a separate manual step.)

A wave's auto-commit on a soon-to-be-merged feature branch is a foot-gun: the upstream merge can race ahead without picking up the wave's commits.

### Gap 4 — `--resume` Step 3 doesn't verify commit reachability

The single test that would have caught this case:

```bash
git merge-base --is-ancestor {state.toon.lastWaveCommit[N]} HEAD
```

For each wave's recorded commit SHA, confirm it is reachable from current HEAD. If any wave commit is not reachable, halt with an explicit recovery prompt (cherry-pick, reset-to-tag, re-run wave, abort).

## Recommended hardening (surgical)

### Fix A — Extend `state.schema.md` with a `gitLineage` block

```toon
gitLineage:
  branchAtStart: main
  headAtStart: c9223e3...
  remoteAtStart: origin/main
  remoteHeadAtStart: c9223e3...
  lastWaveCommit:
    0: c9223e3...
    1: 4d1f2f2...
```

Also add a real `fileHashes` example so it gets populated.

### Fix B — `execute.md` Step 1 (Initialize)

After Step 1.5 git-tag creation, capture lineage:

```bash
branch=$(git rev-parse --abbrev-ref HEAD)
head=$(git rev-parse HEAD)
remote=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || echo "none")
remoteHead=$(git rev-parse "$remote" 2>/dev/null || echo "none")
```

Write `gitLineage.branchAtStart/headAtStart/remoteAtStart/remoteHeadAtStart` to state.toon. If the branch is `main` or `master` (or `.git/config` `loomDefaultBranch`), warn but allow. If the branch is feature-shaped (`pr-*`, `feat/*`, `wip/*`), warn that a mid-run PR merge can orphan wave commits and offer to abort.

### Fix C — `execute.md` Step 3.5 + 8.5 (Auto-Commit)

After `git commit`, record the new SHA:

```toon
gitLineage.lastWaveCommit.{N}: {git rev-parse HEAD}
```

Also populate `fileHashes` for files in this wave's ownership:

```toon
{N}.fileHashes:
  agents/convergence-driver.md: sha256:{shasum -a 256 agents/convergence-driver.md | awk '{print $1}'}
```

Before the commit, verify the current branch still matches `gitLineage.branchAtStart`. If not, halt with the same recovery prompt as the resume check.

### Fix D — `execute.md` `--resume` Step 3 (Check for drift)

Replace the single hash-compare with three checks, in order:

1. **Branch check.** If `git rev-parse --abbrev-ref HEAD` != `gitLineage.branchAtStart`, halt with diagnostic.
2. **Commit reachability.** For each `gitLineage.lastWaveCommit[N]`, run `git merge-base --is-ancestor {sha} HEAD`. If any returns non-zero exit, halt and surface "Wave {N} commit {sha} is not reachable from current HEAD — recover with cherry-pick or reset."
3. **File-hash drift.** Existing logic, now that `fileHashes` is actually populated.

## Scope of the fix

Two files touched:

| File | Edit | Lines roughly |
|------|------|---------------|
| `protocols/state.schema.md` | Add `gitLineage` block to the schema example + add rule under "Rules" for branch/lineage drift detection | +25 |
| `commands/loom-plan/execute.md` | Capture lineage in Step 1; populate in 3.5/8.5; check in --resume Step 3 | +60 |

No new schemas, no new agents, no new hooks. Pure protocol hardening.

## How this would have prevented today's incident

With Fix D's commit-reachability check in place, the resume preflight would have run:

```
git merge-base --is-ancestor 4d1f2f2 HEAD  # exit 1 — not reachable
```

…and halted with: **"Wave 1 commit 4d1f2f2 is not reachable from current HEAD. Available recovery: cherry-pick / reset / re-run wave / abort."** Same outcome as today's manual diagnosis, but caught automatically by the protocol.

## Not done in this session

- Did NOT apply Fix A-D. Reasons:
  - The convergence-generalization run is mid-execution (Wave 2 still pending).
  - Modifying `execute.md` while a `--resume` chain is live could destabilize the resume protocol mid-flight.
  - These fixes deserve their own small plan (or appended as a post-mortem follow-up phase) so they can be tested without entangling with Wave 2's domain.

**Suggested next action:** After M-02 closes on the convergence-generalization plan, file a small "execution-drift-hardening" plan that applies Fix A-D and adds a regression test in `test/protocol/state-schema.test.ts` covering the unreachable-wave-commit case.
