# /loom-git Manual Test Checklist

Manual verification checklist for the `/loom-git` command and all subcommands.

---

## Setup

### Create Throwaway Test Repo

- [ ] Create a temporary directory and initialize a git repo:
  ```bash
  mkdir /tmp/loom-git-test && cd /tmp/loom-git-test
  git init
  echo "# Test" > README.md
  git add README.md && git commit -m "initial commit"
  ```
- [ ] Create a GitHub remote (or use an existing throwaway repo):
  ```bash
  gh repo create loom-git-test --private --source=. --remote=origin --push
  ```
- [ ] Verify `gh auth status` exits 0
- [ ] Create a test branch with changes:
  ```bash
  git checkout -b feature/test-loom-git
  echo "new file" > test-file.txt
  git add test-file.txt && git commit -m "add test file"
  echo "modification" >> README.md
  ```

---

## 1. Help and Routing

### 1.1 No arguments shows help

- **Precondition:** None
- **Command:** `/loom-git`
- **Expected:** Prints help summary listing all six subcommands (commit, push, pr, merge, cleanup, review-pr) and stops
- [ ] Pass

### 1.2 `help` argument shows help

- **Precondition:** None
- **Command:** `/loom-git help`
- **Expected:** Same help output as no-argument case
- [ ] Pass

### 1.3 `--help` argument shows help

- **Precondition:** None
- **Command:** `/loom-git --help`
- **Expected:** Same help output as no-argument case
- [ ] Pass

### 1.4 Unknown subcommand

- **Precondition:** None
- **Command:** `/loom-git foobar`
- **Expected:** Prints `Unknown subcommand: foobar` followed by the help summary
- [ ] Pass

---

## 2. Preflight Checks

### 2.1 Not a git repo

- **Precondition:** Run from a directory that is not inside a git repository (e.g., `/tmp/not-a-repo`)
- **Command:** `/loom-git commit`
- **Expected:** `Not a git repository. Run this command from inside a git repo.`
- [ ] Pass

### 2.2 Detached HEAD

- **Precondition:** In the test repo, detach HEAD: `git checkout --detach`
- **Command:** `/loom-git commit`
- **Expected:** `HEAD is detached. Check out a branch before running this command.`
- **Cleanup:** `git checkout feature/test-loom-git`
- [ ] Pass

### 2.3 No remote configured

- **Precondition:** Create a fresh local repo with no remotes: `mkdir /tmp/no-remote && cd /tmp/no-remote && git init && git commit --allow-empty -m init`
- **Command:** `/loom-git push`
- **Expected:** `No remote configured. Add a remote with git remote add origin <url>.`
- [ ] Pass

### 2.4 gh CLI not installed (simulated)

- **Precondition:** Temporarily rename the `gh` binary or adjust PATH so `command -v gh` fails
- **Command:** `/loom-git pr`
- **Expected:** `GitHub CLI (gh) is not installed. Install it: https://cli.github.com/`
- **Cleanup:** Restore `gh` binary / PATH
- [ ] Pass

### 2.5 gh auth not authenticated (simulated)

- **Precondition:** Ensure `gh auth status` fails (e.g., `gh auth logout` in a test environment)
- **Command:** `/loom-git pr`
- **Expected:** `Not authenticated with GitHub. Run: gh auth login`
- **Cleanup:** Re-authenticate with `gh auth login`
- [ ] Pass

---

## 3. commit Subcommand

### 3.1 Auto-generated commit message

- **Precondition:** Modified tracked file staged via `git add -u` (the command does this internally). Have uncommitted changes to a tracked file (e.g., `echo "change" >> README.md`).
- **Command:** `/loom-git commit`
- **Expected:**
  1. Stages tracked modified files with `git add -u`
  2. Analyzes diff and proposes a conventional commit message (correct prefix, scope, summary)
  3. Shows confirmation prompt: `Use this message? (y/n/edit)`
  4. On `y`, creates the commit and prints commit hash
- [ ] Pass

### 3.2 Commit with `-m` flag override

- **Precondition:** Modified tracked file (e.g., `echo "more" >> README.md`)
- **Command:** `/loom-git commit -m "chore: manual override message"`
- **Expected:** Skips auto-generation and confirmation prompt. Creates commit directly with the provided message. Prints commit hash.
- [ ] Pass

### 3.3 Nothing to commit

- **Precondition:** Clean working tree (no modified tracked files, only untracked allowed)
- **Command:** `/loom-git commit`
- **Expected:** `Nothing to commit. Working tree is clean (or only untracked files exist).`
- [ ] Pass

### 3.4 User declines proposed message (n)

- **Precondition:** Modified tracked file
- **Command:** `/loom-git commit` then respond `n` at the prompt
- **Expected:** Prints `Aborted.` and no commit is created
- [ ] Pass

### 3.5 User edits proposed message

- **Precondition:** Modified tracked file
- **Command:** `/loom-git commit` then respond `edit` at the prompt, provide a custom message
- **Expected:** Commit is created with the user-provided message
- [ ] Pass

### 3.6 Correct prefix detection -- docs

- **Precondition:** Only a markdown file changed (e.g., edit README.md only)
- **Command:** `/loom-git commit`
- **Expected:** Proposed message starts with `docs` prefix
- [ ] Pass

### 3.7 Correct prefix detection -- test

- **Precondition:** Only test files changed (e.g., create/modify `foo.test.ts`)
- **Command:** `/loom-git commit`
- **Expected:** Proposed message starts with `test` prefix
- [ ] Pass

### 3.8 Scope detection

- **Precondition:** All changed files are in a single directory (e.g., `src/auth/`)
- **Command:** `/loom-git commit`
- **Expected:** Proposed message includes scope, e.g., `feat(auth): ...`
- [ ] Pass

---

## 4. push Subcommand

### 4.1 Normal push with upstream set

- **Precondition:** Branch has upstream tracking and commits ahead of remote
- **Command:** `/loom-git push`
- **Expected:** Prints `Pushing N commit(s) to origin/{branch}...`, runs `git push`, prints result
- [ ] Pass

### 4.2 Push with no upstream (sets -u)

- **Precondition:** New branch with no upstream: `git checkout -b new-branch && git commit --allow-empty -m "test"`
- **Command:** `/loom-git push`
- **Expected:** Detects no upstream, runs `git push -u origin new-branch`, prints result
- [ ] Pass

### 4.3 Nothing to push

- **Precondition:** Branch is up to date with remote (push all commits first)
- **Command:** `/loom-git push`
- **Expected:** `Nothing to push. Branch {branch} is up to date with remote.`
- [ ] Pass

### 4.4 Branch behind remote (warning)

- **Precondition:** Force-push an older commit to remote from another clone, so local is behind. Or: push, then reset local back one commit, then add a new commit so local is both ahead and behind.
- **Command:** `/loom-git push`
- **Expected:** Prints warning about being N commit(s) behind remote, asks whether to continue
- [ ] Pass

---

## 5. pr Subcommand

### 5.1 Clean tree PR creation

- **Precondition:** On a feature branch, all changes committed and pushed, clean working tree
- **Command:** `/loom-git pr`
- **Expected:**
  1. No dirty-tree warning
  2. Detects base branch (e.g., `main`)
  3. Generates PR title from branch name and body from commit log
  4. Shows confirmation summary (branch, title, changes)
  5. On `y`, creates PR and prints URL
- [ ] Pass

### 5.2 PR with uncommitted changes (dirty tree)

- **Precondition:** On a feature branch with uncommitted modifications to tracked files
- **Command:** `/loom-git pr`
- **Expected:**
  1. Warns about uncommitted changes, lists files
  2. Offers `Run /loom-git commit first? (y/n)`
  3. On `y`, delegates to commit subcommand, then re-checks
  4. On `n`, aborts PR creation
- [ ] Pass

### 5.3 PR with only untracked files (soft warning)

- **Precondition:** Clean tracked tree but untracked files present (e.g., `touch newfile.txt`)
- **Command:** `/loom-git pr`
- **Expected:**
  1. Shows note about untracked files
  2. Offers to commit them
  3. On `n`, continues with PR creation (does not abort)
- [ ] Pass

### 5.4 PR already exists for branch

- **Precondition:** PR already open for the current branch
- **Command:** `/loom-git pr`
- **Expected:** Shows existing PR number, title, and URL. Asks `Update this PR instead? (y/n)`. On `y`, delegates to push logic.
- [ ] Pass

### 5.5 Unpushed commits before PR

- **Precondition:** Local commits not yet pushed to remote
- **Command:** `/loom-git pr`
- **Expected:** Detects unpushed commits, offers to push. On `y`, pushes. On `n`, aborts (cannot create PR without pushing).
- [ ] Pass

### 5.6 Dirty tree -- two failed commit attempts

- **Precondition:** Uncommitted changes that the user declines or fails to commit twice
- **Command:** `/loom-git pr`, then decline or fail commit twice
- **Expected:** `Still have uncommitted changes after 2 commit attempts. Resolve manually, then re-run /loom-git pr.`
- [ ] Pass

---

## 6. merge Subcommand

### 6.1 Merge by PR number (squash, default)

- **Precondition:** Open PR with no merge conflicts
- **Command:** `/loom-git merge <PR-number>`
- **Expected:**
  1. Fetches and displays PR details (title, branches, mergeable status)
  2. Presents merge method menu (squash default)
  3. On Enter or `1`, asks for confirmation
  4. On `y`, executes squash merge, prints result
  5. Offers to delete remote branch
- [ ] Pass

### 6.2 Merge with `--rebase` flag

- **Precondition:** Open PR with no merge conflicts
- **Command:** `/loom-git merge <PR-number>` then select option `2` (rebase merge)
- **Expected:** Executes `gh pr merge {number} --rebase`, prints result
- [ ] Pass

### 6.3 Merge with standard merge commit

- **Precondition:** Open PR with no merge conflicts
- **Command:** `/loom-git merge <PR-number>` then select option `3`
- **Expected:** Executes `gh pr merge {number} --merge`, prints result
- [ ] Pass

### 6.4 Merge current branch's PR (no number given)

- **Precondition:** On a branch that has an open PR
- **Command:** `/loom-git merge`
- **Expected:** Detects current branch's PR via `gh pr view`, proceeds with merge flow
- [ ] Pass

### 6.5 No PR found

- **Precondition:** On a branch with no associated PR, no PR number given
- **Command:** `/loom-git merge`
- **Expected:** `No PR found for the current branch. Specify a PR number: /loom-git merge <number>`
- [ ] Pass

### 6.6 PR has merge conflicts

- **Precondition:** Open PR where `mergeable` is `CONFLICTING`
- **Command:** `/loom-git merge <PR-number>`
- **Expected:** `Warning: This PR has merge conflicts. Resolve conflicts before merging.` and stops
- [ ] Pass

### 6.7 User declines merge confirmation

- **Precondition:** Open, mergeable PR
- **Command:** `/loom-git merge <PR-number>`, select method, then respond `n`
- **Expected:** Prints `Aborted.` and no merge occurs
- [ ] Pass

### 6.8 Branch cleanup after merge

- **Precondition:** Successfully merged a PR
- **Command:** Answer `y` to the `Delete remote branch?` prompt
- **Expected:** Runs `git push origin --delete {headRefName}`, prints confirmation
- [ ] Pass

---

## 7. cleanup Subcommand

### 7.1 Cleanup merged branch (no open PR)

- **Precondition:** Branch whose PR state is `MERGED` or `CLOSED`
- **Command:** `/loom-git cleanup <branch-name>`
- **Expected:**
  1. No open-PR warning
  2. Confirms: `Will delete REMOTE branch: origin/{branch}`
  3. On `y`, deletes remote branch
- [ ] Pass

### 7.2 Cleanup with PR still OPEN (should warn)

- **Precondition:** Branch with an open PR
- **Command:** `/loom-git cleanup <branch-name>`
- **Expected:**
  1. Warning: `PR for branch {branch} is still OPEN. Deleting this remote branch will effectively close the PR.`
  2. Requires explicit `y` or `yes` to proceed
  3. Any other input aborts with `Aborted.`
- [ ] Pass

### 7.3 Cleanup current branch (no argument)

- **Precondition:** On a branch whose PR is merged
- **Command:** `/loom-git cleanup`
- **Expected:** Uses current branch name, proceeds with deletion flow
- [ ] Pass

### 7.4 Cleanup branch that does not exist on remote

- **Precondition:** Branch exists locally but not on remote
- **Command:** `/loom-git cleanup <branch-name>`
- **Expected:** `git push origin --delete` fails, error output is printed
- [ ] Pass

### 7.5 Cleanup branch with no PR history

- **Precondition:** Branch that never had a PR
- **Command:** `/loom-git cleanup <branch-name>`
- **Expected:** No PR warning, proceeds directly to deletion confirmation
- [ ] Pass

---

## 8. review-pr Subcommand

### 8.1 Review by PR number

- **Precondition:** An existing PR (open or closed)
- **Command:** `/loom-git review-pr <PR-number>`
- **Expected:**
  1. Fetches PR metadata (author, branches, state, size, mergeable, reviewDecision)
  2. Fetches and analyzes diff
  3. Fetches CI check status
  4. Fetches review comments and threads
  5. Prints structured summary with all sections: Overview, Changes, CI Status, Review Threads, Merge Readiness, Recommendations
- [ ] Pass

### 8.2 Review by PR URL

- **Precondition:** An existing PR
- **Command:** `/loom-git review-pr https://github.com/owner/repo/pull/123`
- **Expected:** Extracts PR number from URL, produces same structured summary
- [ ] Pass

### 8.3 Review with no argument

- **Precondition:** None
- **Command:** `/loom-git review-pr`
- **Expected:** `Usage: /loom-git review-pr <number|url>`
- [ ] Pass

### 8.4 Review PR with failing CI

- **Precondition:** PR where at least one CI check has failed
- **Command:** `/loom-git review-pr <PR-number>`
- **Expected:** CI Status section flags failures prominently. Recommendations mention addressing the failing check.
- [ ] Pass

### 8.5 Review PR with no reviews

- **Precondition:** PR with no review comments or approvals
- **Command:** `/loom-git review-pr <PR-number>`
- **Expected:** Review Threads section states "No review threads." Review Decision shows "No reviews yet."
- [ ] Pass

---

## 9. Edge Cases

### 9.1 Detached HEAD with push

- **Precondition:** `git checkout --detach`
- **Command:** `/loom-git push`
- **Expected:** `HEAD is detached. Check out a branch before running this command.`
- **Cleanup:** `git checkout feature/test-loom-git`
- [ ] Pass

### 9.2 Detached HEAD with pr

- **Precondition:** `git checkout --detach`
- **Command:** `/loom-git pr`
- **Expected:** `HEAD is detached. Check out a branch before running this command.`
- **Cleanup:** `git checkout feature/test-loom-git`
- [ ] Pass

### 9.3 review-pr skips git repo check

- **Precondition:** Run from a non-git directory, but with `gh` installed and authenticated
- **Command:** `/loom-git review-pr 1`
- **Expected:** Does NOT fail with "Not a git repository" (review-pr does not require git repo check). Proceeds to fetch PR metadata (may fail for other reasons if repo context is missing from gh, but should not fail on preflight).
- [ ] Pass

### 9.4 merge skips detached HEAD and remote checks

- **Precondition:** Detached HEAD state, but `gh` is installed and authenticated
- **Command:** `/loom-git merge <PR-number>`
- **Expected:** Does NOT fail on detached HEAD or missing remote checks (merge only requires git repo, gh CLI, gh auth). Proceeds to fetch PR details.
- [ ] Pass

---

## 10. Teardown

- [ ] Delete the test GitHub repo:
  ```bash
  gh repo delete loom-git-test --yes
  ```
- [ ] Remove local test directories:
  ```bash
  rm -rf /tmp/loom-git-test /tmp/no-remote
  ```
