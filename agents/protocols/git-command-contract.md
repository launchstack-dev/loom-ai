# Git Command Contract

Shared patterns for the `/loom-git` command. All subcommand implementers must follow these conventions to ensure consistent behavior, safe error handling, and predictable user interaction.

## Subcommand Routing

The command receives `$ARGUMENTS` from the user. Routing works as follows:

1. Split `$ARGUMENTS` on whitespace.
2. The **first token** is the subcommand name. Valid subcommands: `commit`, `push`, `pr`, `merge`, `cleanup`, `review-pr`.
3. All **remaining tokens** are passed through as flags and positional args to the subcommand handler.
4. If `$ARGUMENTS` is empty or the first token is `help` or `--help`, print the help summary and stop.

**Help fallback output:**

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

Then print the help summary above.

## Preflight Check Sequence

Before executing any subcommand, run the applicable preflight checks in the order listed below. Stop at the first failure.

### Check Definitions

| # | Check | Command / Test | Failure Message |
|---|-------|---------------|-----------------|
| 1 | **git repo** | `git rev-parse --git-dir 2>/dev/null` succeeds | `Not a git repository. Run this command from inside a git repo.` |
| 2 | **not detached HEAD** | `git symbolic-ref -q HEAD` succeeds | `HEAD is detached. Check out a branch before running this command.` |
| 3 | **has remote** | `git remote` produces at least one line | `No remote configured. Add a remote with git remote add origin <url>.` |
| 4 | **gh CLI installed** | `command -v gh` succeeds | `GitHub CLI (gh) is not installed. Install it: https://cli.github.com/` |
| 5 | **gh auth** | `gh auth status 2>&1` exits 0 | `Not authenticated with GitHub. Run: gh auth login` |

### Check Matrix

Each subcommand requires a subset of these checks. A check marked with **x** must pass before the subcommand runs.

| Check | commit | push | pr | merge | cleanup | review-pr |
|-------|--------|------|----|-------|---------|-----------|
| git repo | x | x | x | x | x | |
| not detached HEAD | x | x | x | | | |
| has remote | | x | x | | x | |
| gh CLI installed | | | x | x | x | x |
| gh auth | | | x | x | x | x |

**Implementation note:** Run only the checks marked for the current subcommand, in order from top to bottom. Exit on the first failure, printing the failure message and returning a non-zero exit code.

## Error Handling

### Fatal Errors (block execution)

These conditions prevent the subcommand from running. Print the message and stop.

| Condition | Affected Subcommands | Behavior |
|-----------|---------------------|----------|
| Not a git repo | commit, push, pr, merge, cleanup | Print failure message, exit |
| Detached HEAD | commit, push, pr | Print failure message, exit |
| No remote configured | push, pr, cleanup | Print failure message, exit |
| gh CLI missing | pr, merge, cleanup, review-pr | Print install URL, exit |
| gh auth failed | pr, merge, cleanup, review-pr | Print `gh auth login` instruction, exit |

### Non-Fatal Warnings

These conditions are informational and do not block execution.

| Condition | Affected Subcommands | Behavior |
|-----------|---------------------|----------|
| Upstream not set for branch | push | Warn, then push with `-u` to set upstream automatically |
| No commits ahead of remote | push | Inform user "Nothing to push", exit cleanly |
| PR already exists for branch | pr | Show existing PR URL, ask if user wants to update it |

## Confirmation Gate

Subcommands that perform destructive or externally-visible actions must show a summary of what will happen and wait for explicit user confirmation before proceeding.

**Applies to:** `merge`, `cleanup`, `pr`

### Pattern

1. **Show the action summary.** Describe exactly what will happen, including branch names, PR numbers, and file counts where applicable.
2. **Ask for confirmation.** Use a clear yes/no prompt.
3. **Proceed only on explicit yes.** Any input other than `y` or `yes` (case-insensitive) aborts with `Aborted.`

**Examples by subcommand:**

**merge:**
```
Will merge PR #42 "Add user authentication" into main.
Method: squash merge (default)

Proceed? (y/n)
```

**cleanup:**
```
Will delete 3 merged branches:
  - feature/auth (local + remote)
  - fix/typo (local only)
  - feature/nav (local + remote)

Proceed? (y/n)
```

**pr:**
```
Will create PR:
  Branch: feature/auth -> main
  Title: feat: add user authentication
  Changes: 4 files changed, 120 insertions, 15 deletions

Create PR? (y/n)
```

## Dirty-Tree Check (PR Creation)

This check is **mandatory** before creating a pull request. It runs after all preflight checks pass but before the confirmation gate.

### Procedure

1. Run `git status --porcelain`.
2. Classify each line:
   - Lines starting with `??` are **untracked files**.
   - All other non-empty lines are **uncommitted changes** (staged or unstaged modifications, deletions, renames).
3. Evaluate the result:

**If uncommitted changes exist (non-`??` lines):**

```
Warning: You have uncommitted changes:
  M  src/auth.ts
  M  src/routes.ts
  D  src/old-handler.ts

These changes will NOT be included in the PR.
Run /loom-git commit first? (y/n)
```

If the user confirms, delegate to the `commit` subcommand, then re-run the dirty-tree check. If the user declines, abort PR creation.

**If only untracked files exist (`??` lines only):**

```
Note: You have untracked files:
  ?? src/new-util.ts
  ?? tests/auth.test.ts

These files will NOT be included in the PR.
Run /loom-git commit to include them? (y/n)
```

If the user confirms, delegate to `commit`. If the user declines, continue with PR creation (untracked files are a soft warning, not a blocker).

**If the tree is clean:** proceed to the confirmation gate with no warning.

### Re-check After Commit

After delegating to `commit`, re-run `git status --porcelain`. If uncommitted changes still exist (the user may have partially committed), warn again and offer the same choice. Loop at most 2 times, then abort with:

```
Still have uncommitted changes after 2 commit attempts. Resolve manually, then re-run /loom-git pr.
```

## Conventional Commit Message Generation

Used by the `commit` subcommand to generate a commit message from the current diff.

### Prefix Detection

Analyze the staged diff (`git diff --cached --stat` and `git diff --cached`) to determine the conventional commit prefix:

| Prefix | Trigger Heuristic |
|--------|------------------|
| `feat` | New files added, new exports, new routes, new components, new test describe blocks for features not yet tested |
| `fix` | Modifications to existing logic that correct behavior (bug references, error handling changes, null checks added, edge case handling) |
| `refactor` | Structural changes with no behavior change (renames, extractions, moves, import reorganization) |
| `docs` | Only markdown, JSDoc/docstring, or comment changes |
| `chore` | Config files only (package.json, tsconfig, CI configs, linting, dependency bumps) |
| `test` | Only test files changed (files matching `*.test.*`, `*.spec.*`, `__tests__/*`) |

**Ambiguous cases:** When the diff spans multiple categories, use the prefix that covers the primary intent. If a feature includes its tests, use `feat`. If a fix includes a test for the fix, use `fix`. When truly ambiguous, default to `feat` for additions or `refactor` for modifications.

### Scope Detection (Optional)

If all changed files share a common directory or module, include it as scope:

```
feat(auth): add login endpoint
fix(dashboard): handle null user in chart render
```

If changes span multiple unrelated directories, omit the scope:

```
feat: add user authentication flow
```

### Message Format

```
<prefix>[(<scope>)]: <summary>
```

- **Summary** is one line, lowercase start, no trailing period, max 72 characters.
- The summary describes the **what**, not the **how**. Focus on the user-visible or developer-visible effect.

### User Override

After generating the commit message, show it to the user:

```
Proposed commit message:
  feat(auth): add login endpoint with JWT validation

Use this message? (y/n/edit)
```

- **y:** commit with the proposed message.
- **n:** abort the commit.
- **edit:** ask the user for a replacement message, then commit with that instead.

## Data Flow Between Subcommands

When one subcommand delegates to another (e.g., `pr` delegates to `commit` via the dirty-tree check), the delegated subcommand runs its own preflight checks independently. Do not skip preflight checks for delegated calls.

The delegating subcommand resumes from where it left off after the delegated subcommand completes successfully. If the delegated subcommand fails, the delegating subcommand aborts.
