# Loom Git Routing

Use when the user asks to perform git or GitHub operations in a loom-initialized project. Routes natural-language requests to /loom-git subcommands.

## Trigger Patterns

Match user intent against the following subcommands. Matching is case-insensitive and intent-based -- the user does not need to use these exact phrases.

### commit
- "commit", "commit changes", "save my changes", "commit this", "commit what I have", "stage and commit"

### push
- "push", "push to remote", "push changes", "push this up", "push to origin"

### pr
- "create a PR", "open a PR", "make a pull request", "PR this", "open pull request", "submit a PR", "create pull request"

### merge
- "merge PR", "merge the PR", "merge pull request", "merge this PR", "merge #123"

### cleanup
- "delete branch", "clean up branch", "remove remote branch", "delete merged branches", "clean up old branches"

### review-pr
- "review PR", "check PR", "look at PR", "PR review", "review pull request", "review #123", "check the PR"

## Compound Requests

When the user's message contains multiple actions, chain the subcommands in sequence. Common compound patterns:

- "commit and push" --> commit, then push
- "commit push pr" --> commit, then push, then pr
- "commit and create a PR" --> commit, then push, then pr
- "push and open a PR" --> push, then pr
- "merge and clean up" --> merge, then cleanup

When chaining, invoke each subcommand in order. If any subcommand fails, stop the chain and report the failure. Do not proceed to the next subcommand after a failure.

## Exclusions

Do NOT intercept any of the following:

1. **Shell-escaped commands**: User input prefixed with `!` (e.g., `! git commit -m "msg"`). These are direct shell commands and must pass through unmodified.

2. **Conceptual or learning questions**: Requests about git concepts, history, or explanations rather than actions. Examples:
   - "how does git rebase work"
   - "what is the difference between merge and rebase"
   - "explain git cherry-pick"
   - "what does git stash do"

3. **Non-routable git operations**: Git operations that have no corresponding /loom-git subcommand. Examples:
   - "rebase my branch"
   - "stash my changes"
   - "cherry-pick that commit"
   - "reset to the last commit"
   - "show me the git log"

   For these, fall through to normal Claude behavior (run the git commands directly).

## Instructions

When triggered, invoke the Skill tool with `skill: 'loom-git'` and the appropriate subcommand as args.

Examples:

| User says | Skill invocation |
|-----------|-----------------|
| "commit my changes" | `skill: "loom-git", args: "commit"` |
| "push to remote" | `skill: "loom-git", args: "push"` |
| "create a PR" | `skill: "loom-git", args: "pr"` |
| "merge PR #42" | `skill: "loom-git", args: "merge 42"` |
| "delete the feature branch" | `skill: "loom-git", args: "cleanup"` |
| "review PR 15" | `skill: "loom-git", args: "review-pr 15"` |

For compound requests, invoke the Skill tool multiple times in sequence:

| User says | Invocations (in order) |
|-----------|----------------------|
| "commit and push" | `skill: "loom-git", args: "commit"` then `skill: "loom-git", args: "push"` |
| "commit push pr" | `skill: "loom-git", args: "commit"` then `skill: "loom-git", args: "push"` then `skill: "loom-git", args: "pr"` |
| "merge and clean up" | `skill: "loom-git", args: "merge"` then `skill: "loom-git", args: "cleanup"` |

When the user provides additional context (PR numbers, branch names, commit message hints), pass them through as args. For example:

- "merge PR #42" --> `args: "merge 42"`
- "review PR 15" --> `args: "review-pr 15"`
- "delete the feature/auth branch" --> `args: "cleanup feature/auth"`
