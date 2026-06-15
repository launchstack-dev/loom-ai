---
description: "commit, push, pr, merge, cleanup, review-pr — git workflow automation"
---
# Loom Git

A unified git workflow command for Claude Code. Routes to subcommands for committing, pushing, creating PRs, merging, cleaning up branches, and reviewing pull requests.

## Requirements

$ARGUMENTS

Parse `$ARGUMENTS` by splitting on whitespace. The first token is the subcommand. All remaining tokens are flags and positional arguments for that subcommand.

If `$ARGUMENTS` is empty, or the first token is `help` or `--help`, print the help summary below and stop:

```
/loom-git <subcommand> [flags]

Subcommands:
  commit      Stage and commit with a conventional commit message
  push        Push current branch to remote
  pr          Create a pull request (runs dirty-tree check first)
  merge       Merge a pull request by number or URL
  cleanup     Delete merged branches (local + remote)
  review-pr   Review a pull request by number or URL

Run /loom-git <subcommand> --help for subcommand-specific usage.
```

If the first token does not match a known subcommand, print:

```
Unknown subcommand: {token}
```

Then print the help summary above and stop.

Otherwise, route to the matching subcommand section below.

## Preflight Checks

Before executing any subcommand, run the applicable preflight checks in the order listed. Stop at the first failure and print its failure message.

| # | Check | Command | Failure Message |
|---|-------|---------|-----------------|
| 1 | git repo | `git rev-parse --git-dir 2>/dev/null` | `Not a git repository. Run this command from inside a git repo.` |
| 2 | not detached HEAD | `git symbolic-ref -q HEAD` | `HEAD is detached. Check out a branch before running this command.` |
| 3 | has remote | `git remote` produces at least one line | `No remote configured. Add a remote with git remote add origin <url>.` |
| 4 | gh CLI installed | `command -v gh` | `GitHub CLI (gh) is not installed. Install it: https://cli.github.com/` |
| 5 | gh auth | `gh auth status 2>&1` exits 0 | `Not authenticated with GitHub. Run: gh auth login` |

Each subcommand requires only a subset of these checks:

| Check | commit | push | pr | merge | cleanup | review-pr |
|-------|--------|------|----|-------|---------|-----------|
| git repo | x | x | x | x | x | |
| not detached HEAD | x | x | x | | | |
| has remote | | x | x | | x | |
| gh CLI installed | | | x | x | x | x |
| gh auth | | | x | x | x | x |

Run only the checks marked for the current subcommand, in order from top to bottom. Exit on the first failure.

## Instructions

### commit

**Preflight:** git repo, not detached HEAD.

**Step 1: Check for flags.**

Check if the remaining arguments contain `-m "..."` or `-m '...'`. If so, extract the message and skip to Step 5 using that message directly (no auto-generation, no confirmation prompt).

**Step 2: Stage tracked modified files.**

Run `git add -u` to stage all tracked files that have been modified or deleted. Do NOT stage untracked files.

Run `git diff --cached --stat` to get a summary of staged changes. If there are no staged changes, print:

```
Nothing to commit. Working tree is clean (or only untracked files exist).
```

Stop.

**Step 3: Analyze diff and generate commit message.**

Run `git diff --cached` to get the full staged diff. Also run `git diff --cached --stat` for the file-level summary.

Determine the conventional commit prefix by analyzing the diff:

| Prefix | Trigger |
|--------|---------|
| `feat` | New files added, new exports, new routes, new components, new test describe blocks for features not yet tested |
| `fix` | Modifications to existing logic that correct behavior (bug references, error handling changes, null checks, edge case handling) |
| `refactor` | Structural changes with no behavior change (renames, extractions, moves, import reorganization) |
| `docs` | Only markdown, JSDoc/docstring, or comment changes |
| `chore` | Config files only (package.json, tsconfig, CI configs, linting, dependency bumps) |
| `test` | Only test files changed (files matching `*.test.*`, `*.spec.*`, `__tests__/*`) |

When the diff spans multiple categories, use the prefix that covers the primary intent. If a feature includes its tests, use `feat`. If a fix includes a test for the fix, use `fix`. When truly ambiguous, default to `feat` for additions or `refactor` for modifications.

Determine the scope: if all changed files share a common directory or module, include it as scope in parentheses. If changes span multiple unrelated directories, omit the scope.

Format: `<prefix>[(<scope>)]: <summary>` -- summary is one line, lowercase start, no trailing period, max 72 characters. The summary describes the **what**, not the **how**.

**Step 4: Confirm with user.**

Show the proposed message:

```
Proposed commit message:
  <generated message>

Use this message? (y/n/edit)
```

- **y:** proceed to Step 5 with the proposed message.
- **n:** abort the commit. Print `Aborted.` and stop.
- **edit:** ask the user for a replacement message, then proceed to Step 5 with their message.

**Step 5: Create the commit.**

Run `git commit -m "<message>"`. Print the commit hash and summary on success.

If the commit fails, print the error output and stop.

---

### push

**Preflight:** git repo, not detached HEAD, has remote.

**Step 1: Determine current branch.**

Run `git branch --show-current` to get the branch name.

**Step 2: Check upstream tracking.**

Run `git rev-parse --abbrev-ref @{upstream} 2>/dev/null`. If this fails (no upstream set), note that the push will use `-u` to set upstream.

**Step 3: Fetch and compare.**

Run `git fetch` to update remote refs.

Run `git rev-list --count @{upstream}..HEAD 2>/dev/null` to get the number of commits ahead of remote. If there is no upstream, run `git rev-list --count origin/$(git branch --show-current)..HEAD 2>/dev/null` instead. If that also fails (branch does not exist on remote), count all commits on the branch that are not on the default remote branch.

If the count is 0 and upstream exists, print:

```
Nothing to push. Branch {branch} is up to date with remote.
```

Stop.

Run `git rev-list --count HEAD..@{upstream} 2>/dev/null` to check if behind remote. If behind, print a warning:

```
Warning: Branch {branch} is {count} commit(s) behind remote. Consider pulling first.
```

Ask the user whether to continue pushing anyway. If they decline, stop.

**Step 4: Push.**

Print:

```
Pushing {count} commit(s) to origin/{branch}...
```

If upstream is set, run `git push`.
If upstream is NOT set, run `git push -u origin {branch}`.

Print the result. If the push fails, print the error output.

---

### pr

**Preflight:** git repo, not detached HEAD, has remote, gh CLI installed, gh auth.

**Step 1: Check for existing PR.**

Run `gh pr view --json number,title,url 2>/dev/null`. If a PR already exists for this branch, print:

```
PR already exists: #{number} "{title}"
  {url}

Update this PR instead? (y/n)
```

If the user confirms, inform them that pushing new commits will update the PR, then delegate to the `push` subcommand logic and stop. If they decline, stop.

**Step 2: Dirty-tree check (MANDATORY).**

Run `git status --porcelain`. Classify each line:
- Lines starting with `??` are untracked files.
- All other non-empty lines are uncommitted changes.

**If uncommitted changes exist (non-`??` lines):**

```
Warning: You have uncommitted changes:
  {list each file with its status}

These changes will NOT be included in the PR.
Run /loom-git commit first? (y/n)
```

If the user confirms, run the `commit` subcommand (with its own full preflight checks), then re-run `git status --porcelain`. If uncommitted changes still exist after the commit, offer again. Loop at most 2 times, then abort with:

```
Still have uncommitted changes after 2 commit attempts. Resolve manually, then re-run /loom-git pr.
```

If the user declines, abort PR creation entirely.

**If only untracked files exist (`??` lines only):**

```
Note: You have untracked files:
  {list each file}

These files will NOT be included in the PR.
Run /loom-git commit to include them? (y/n)
```

If the user confirms, run the `commit` subcommand, then continue. If the user declines, continue with PR creation (untracked files are a soft warning, not a blocker).

**If the tree is clean:** proceed with no warning.

**Step 3: Detect base branch.**

Run `gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'` to get the default branch (e.g., `main` or `master`).

**Step 4: Check if ahead of remote.**

Run `git rev-list --count @{upstream}..HEAD 2>/dev/null`. If the count is greater than 0, or if no upstream is set, offer to push:

```
You have {count} unpushed commit(s). Push to remote before creating PR? (y/n)
```

If the user confirms, run `git push` (or `git push -u origin {branch}` if no upstream). If push fails, abort.

If the user declines, abort (cannot create a PR without pushing).

**Step 5: Generate PR title and body.**

Auto-generate the PR title from the branch name: convert kebab-case or slash-separated names to title case. For example, `feature/add-user-auth` becomes `Add User Auth`. Strip common prefixes like `feature/`, `fix/`, `chore/`, `bugfix/`, `hotfix/`.

Generate the body from the commit log. Run `git log {base_branch}..HEAD --pretty=format:"- %s"` to get commit summaries as a bulleted list. Format the body as:

```
## Summary

{bulleted list of commit messages}

## Changes

{run git diff --stat {base_branch}..HEAD and include the output}
```

**Step 6: Confirm and create.**

Show the summary:

```
Will create PR:
  Branch: {current_branch} -> {base_branch}
  Title: {title}
  Changes: {files changed summary from git diff --stat}

Create PR? (y/n)
```

If the user confirms, run:

```bash
gh pr create --base {base_branch} --title "{title}" --body "{body}"
```

Print the resulting PR URL on success.

If the user declines, print `Aborted.` and stop.

---

### merge

**Preflight:** git repo, gh CLI installed, gh auth.

**Step 1: Determine PR.**

Check the remaining arguments for a PR number or URL. If none provided, run `gh pr view --json number,title,url` to get the current branch's PR. If no PR is found, print:

```
No PR found for the current branch. Specify a PR number: /loom-git merge <number>
```

Stop.

**Step 2: Fetch PR details.**

Run `gh pr view {number} --json number,title,headRefName,baseRefName,mergeable,mergeStateStatus`. Print:

```
PR #{number}: {title}
  {headRefName} -> {baseRefName}
  Mergeable: {mergeable}
```

If `mergeable` is `CONFLICTING`, print:

```
Warning: This PR has merge conflicts. Resolve conflicts before merging.
```

Stop.

**Step 3: Choose merge method.**

Default is squash merge. Present:

```
Will merge PR #{number} "{title}" into {baseRefName}.
Method: squash merge (default)

Options:
  1. Squash merge (default)
  2. Rebase merge
  3. Standard merge commit

Choose method (1/2/3) or press Enter for default:
```

Map the selection: 1 or Enter -> `--squash`, 2 -> `--rebase`, 3 -> `--merge`.

**Step 4: Confirm.**

```
Proceed with {method} merge? (y/n)
```

If the user declines, print `Aborted.` and stop.

**Step 5: Execute merge.**

Run `gh pr merge {number} {method_flag}`. Print the result.

**Step 6: Offer branch cleanup.**

After a successful merge, ask:

```
Delete remote branch {headRefName}? (y/n)
```

If the user confirms, run `git push origin --delete {headRefName}`. Print confirmation.

---

### cleanup

**Preflight:** git repo, has remote, gh CLI installed, gh auth.

**Step 1: Determine target branch.**

Check remaining arguments for a branch name. If none provided, use the current branch (`git branch --show-current`).

**Step 2: Check PR state.**

Run `gh pr view {branch} --json state --jq '.state' 2>/dev/null`. Evaluate:

- If the state is `OPEN`, print:

  ```
  Warning: PR for branch {branch} is still OPEN.
  Deleting this remote branch will effectively close the PR.

  Are you sure you want to delete the remote branch? (y/n)
  ```

  Require explicit `y` or `yes` to proceed. Any other input aborts with `Aborted.`

- If the state is `MERGED` or `CLOSED`, proceed without extra warning.

- If no PR exists for the branch, proceed without warning (the branch may never have had a PR).

**Step 3: Confirm deletion.**

```
Will delete REMOTE branch: origin/{branch}
(Local branch will NOT be deleted)

Proceed? (y/n)
```

If the user declines, print `Aborted.` and stop.

**Step 4: Delete remote branch.**

Run `git push origin --delete {branch}`. Print the result.

If the deletion fails (e.g., branch does not exist on remote), print the error and stop.

---

### review-pr

**Preflight:** gh CLI installed, gh auth.

**Step 1: Determine PR.**

Check remaining arguments for a PR number or URL. If a URL is provided, extract the PR number from it. If no argument is provided, print:

```
Usage: /loom-git review-pr <number|url>
```

Stop.

**Step 2: Fetch PR metadata.**

Run `gh pr view {number} --json number,title,author,headRefName,baseRefName,body,createdAt,mergeable,state,reviewDecision,additions,deletions,changedFiles`. Store the result.

**Step 3: Fetch diff.**

Run `gh pr diff {number}`. Read and analyze the diff.

**Step 4: Fetch CI status.**

Run `gh pr checks {number}` to get the CI check results. Note which checks passed, failed, or are pending.

**Step 5: Fetch review comments and threads.**

Run `gh api repos/{owner}/{repo}/pulls/{number}/comments` to get inline review comments.

Run `gh api repos/{owner}/{repo}/pulls/{number}/reviews` to get review summaries.

Determine `{owner}` and `{repo}` by running `gh repo view --json nameWithOwner --jq '.nameWithOwner'` and splitting on `/`.

**Step 6: Check merge conflict status.**

Use the `mergeable` field from the PR metadata fetched in Step 2.

**Step 7: Produce structured summary.**

Print a comprehensive review summary in this format:

```
## PR Review: #{number} — {title}

### Overview
- **Author:** {author}
- **Branch:** {headRefName} -> {baseRefName}
- **Created:** {createdAt}
- **State:** {state}
- **Review Decision:** {reviewDecision or "No reviews yet"}
- **Size:** +{additions} -{deletions} across {changedFiles} files

### Changes
{Summarize the diff by category: what was added, modified, deleted. Group related changes. Highlight the key changes and their purpose. Keep this concise but thorough.}

### CI Status
{List each check with its status: passed/failed/pending. Flag any failures prominently.}

### Review Threads
{Summarize each review thread: who commented, what the concern was, whether it's resolved. If no reviews exist, state "No review threads."}

### Merge Readiness
- **Mergeable:** {yes/no/unknown}
- **CI:** {all passing / N failures / pending}
- **Reviews:** {approved / changes requested / pending / none}
- **Conflicts:** {none / has conflicts}

### Recommendations
{Based on all the above, provide 2-5 actionable recommendations. For example: "Address the failing lint check before merging", "Resolve the open thread about error handling in auth.ts", "Consider adding tests for the new utility function".}
```

This summary is informational only. Do not take any action on the PR.

---

### review-pr --autoconverge

The `--autoconverge` flag turns `review-pr` from an informational summary into a full F-04 PR-review convergence loop. Per the convergence-applications plan, this drives the canned `(scripts/pr-review-harness.ts + pr-fixer-agent + Gemini adapter)` triple through `/loom-converge` and produces per-iteration commits per OQ-05.

**Preflight:** gh CLI installed, gh auth (same as plain `review-pr`).

**Step 1: Determine PR.**

Check remaining arguments for a PR number or URL.

- If a URL is provided, extract the PR number from it.
- If no argument is provided, run `gh pr view --json number --jq '.number'` against the current branch and use its PR number. If no PR is associated with the current branch, print:

  ```
  Usage: /loom-git review-pr --autoconverge <number|url>
  ```

  Stop.

**Step 2: Resolve bot adapter.**

Check remaining arguments for `--bot <gemini|coderabbit|copilot>`. Default to `gemini` if absent. Reject any other value with:

```
Unknown bot adapter: {value}. Supported: gemini, coderabbit, copilot.
```

Only `gemini` ships in this plan; `coderabbit` and `copilot` are reserved in the converge.config schema but not yet wired (the dispatcher returns `CODE: ADAPTER_UNKNOWN` and exits 1).

**Step 3: Generate the converge.config.**

Invoke `scripts/lib/pr-review-harness/wrapper-config.ts::buildWrapperConfig({ prNumber, botAdapter })` and atomically write the encoded TOON to `.plan-execution/pr-review/converge.config.toon`. The resulting config is the F-04 binding from `agents/protocols/converge.config.applications.md`:

```toon
mode: document
subject: .plan-execution/pr-review/pr-state.toon
harness: scripts/pr-review-harness.ts
integrator: pr-fixer-agent
maxIterations: 5
snapshotEnabled: true
botAdapter: gemini
prNumber: {N}
```

`pr-state.toon` is a synthetic projection produced by the harness on each iteration (per OQ-02) so the existing `hooks/lib/iteration-snapshot.ts` snapshot mechanism works without modification.

**Step 4: Invoke /loom-converge.**

Run:

```bash
/loom-converge --config .plan-execution/pr-review/converge.config.toon --auto
```

The driver:

1. Calls `scripts/pr-review-harness.ts --config <path> --iteration <N>` to refresh `pr-state.toon` and write `iter-{N}/findings.toon`.
2. If `blockingCount > 0`, spawns `pr-fixer-agent` (Integrator Mode) to apply the findings.
3. Commits with the message:

   ```
   fix(pr-iter-{N}/gemini): {summary}
   ```

   where `{N}` is the 1-indexed iteration number and `{summary}` is the integrator's first-line summary. Per OQ-05, every iteration produces exactly one commit; squash-on-merge collapses them into a single PR commit.
4. Re-invokes the harness for iteration `N+1`, passing `--prior-findings .plan-execution/convergence/iterations/iter-{N}/findings.toon` so the Gemini adapter applies OQ-04 cross-iteration dedup.
5. Stops at the first iteration with `blockingCount == 0` (CONVERGED) or after `maxIterations = 5` (HALTED). The terminal-state transition writes `.plan-execution/convergence-summary.toon`.

**Step 5: Report the outcome.**

After `/loom-converge` exits, read `.plan-execution/convergence-summary.toon` and print:

```
PR #{number} — F-04 convergence: {status}
  Iterations run: {iterationsRun}
  Final blockingCount: {finalBlockingCount}
  Halt reason: {haltReason or "(none — converged)"}
```

If `status != converged`, surface the per-iteration `findings.toon` paths so the user can inspect what kept blocking.

