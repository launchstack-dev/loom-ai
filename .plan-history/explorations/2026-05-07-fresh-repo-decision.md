# Fresh Repo Decision — A vs B

**Status:** DECIDED 2026-05-07 — Option B confirmed by maintainer. Audit + rewrite execution scheduled at end of Phase 0 / start of Phase 1.
**Context:** OSS launch precondition. Current repo has accumulated WIP that shouldn't ship publicly. Two paths to a clean public repo.

## Option A — Brand new repo, single root commit

- Create `launchstack-dev/loom` (new name) or repurpose `launchstack-dev/loom-ai`.
- Single root commit: "feat: initial public release of Loom v0.0.1".
- Archive existing `loom-ai` repo as `loom-ai-private` (private), kept for reference.
- All future development lands on the new public repo.

**Pros**
- Maximum clarity. No history to audit, no leak surface from old commits.
- Clean slate for `git log` — first impression of the project is "v0.0.1, day one."
- Simplest mental model going forward: one repo, one history, public.

**Cons**
- **Loses social proof.** Devil's advocate flagged this hardest: a day-one repo with 3 commits reads as abandoned-on-arrival to strangers evaluating an OSS tool. Contributor activity, commit cadence, and history depth are first-glance trust signals.
- **Loses contributor trail.** Even if it's been solo, commits document evolution of the architecture. Discarding them discards the only evidence that decisions were made deliberately.
- **Loses issue archaeology.** Past issues / PRs (if any in the current repo) are gone. Future maintainers cannot cite "we tried X in #42 and it failed."
- Bigger one-time cost: setting up a new repo, transferring license metadata, recreating Actions, updating remote refs.

## Option B — `git filter-repo` on current repo

- Use `git filter-repo` to scrub:
  - WIP files: `PLAN-context-mode.md`, `commands/loom-cmux.md`, `hooks/cmux-dev-server.ts`, `.plan-history/explorations/*` (selectively).
  - Any commits authored under accounts other than `jensen@mylaunchstack.com` (none observed today, but verify with `git log --format='%ae' | sort -u`).
  - Any sensitive content found by `gitleaks` / `trufflehog` sweep.
- Force-push the rewritten history to `launchstack-dev/loom-ai` once the rewrite is verified clean.
- Old SHAs are invalidated — anyone with a fork must rebase.

**Pros**
- **Preserves history depth.** Strangers see a project that has been worked on for months. Commit cadence intact.
- **Preserves provenance.** Architectural decisions traceable in git log (the converge engine, wave-based execution, TOON adoption — all documented in commit messages).
- **No new repo to wire up.** Existing CI, Actions, branch protection, etc. carry over.
- **Cheap recovery.** A bad scrub is fixable by re-running `git filter-repo` from a backup.

**Cons**
- `git filter-repo` is a heavy hammer; rewriting is irreversible without backups.
- Force-push to a public repo erases history visible to anyone who already cloned. Since the repo is currently private, the blast radius is small — but still a discipline to get right.
- More upfront care: must enumerate WIP paths and verify the rewrite produced what was expected before force-push.
- Devil's advocate's "social proof" upside is partial — if the visible commits are dense Loom development that doesn't quite match the public README's framing, it could read as confused.

## Recommendation: **B**

`git filter-repo` preserves the social-proof signal that matters for a tool asking strangers to grant elevated permissions on their machine. The "fresh-cut clarity" of A is a one-time aesthetic gain; the cost (lost history) is permanent.

The execution risk of `git filter-repo` is well-understood and tractable: backup → rewrite → review → force-push. The current repo has ~60 commits — manageable to audit by hand after the rewrite.

**Required steps for B:**

1. **Backup**: `git clone --mirror` of current state to a separate path, kept until a week post-launch.
2. **Audit current state**: enumerate all paths to scrub. Run `gitleaks detect --source .` and `gh gitleaks` over the entire history. Read each non-trivial WIP file and decide: drop entirely, or keep and clean up.
3. **Rewrite**: `git filter-repo --invert-paths` for paths to drop; `--replace-text` for any sensitive strings found.
4. **Verify**: clone the rewritten repo to a sandbox and:
   - Run the full test suite.
   - Run gitleaks again to confirm no leaks.
   - Skim `git log` for any commit message that references dropped paths in a way that's now confusing.
5. **Force-push**: only after verification. Tag the pre-rewrite state (`pre-scrub-2026-05-07`) on the backup mirror.
6. **Make repo public** as the v0.1.0 launch.

## Alternative scenario: A wins if...

A becomes the right call if the audit in step 2 finds:
- Sensitive content in commit messages (not just files) — `git filter-repo --replace-text` works but messages get noisy.
- Commits authored under a non-public identity that would be visible in `git log`.
- More than a handful of commits referencing internal/proprietary work that can't be cleanly excised.

Decision: pause B, switch to A if any of these surface during the audit.

## Action item

Maintainer to confirm Option B and authorize the audit + rewrite. Audit is ~half a day; rewrite + verify is ~half a day; total ~1 day inside Phase 0. Force-push happens at the start of Phase 1 once a Phase 0 spike confirms the new state actually works.
