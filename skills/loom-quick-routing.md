# Loom Quick Routing

Use when the user asks to quickly perform a small task, make a quick fix, or do something without full plan ceremony in a loom-initialized project.

## Trigger Patterns

Match user intent against the following phrases. Matching is case-insensitive and intent-based -- the user does not need to use these exact phrases.

### Quick fix / just do it
- "quickly fix", "quick fix", "just fix", "just do", "just add", "just update"
- "can you just", "go ahead and", "do this real quick"

### Small / one-off tasks
- "real quick", "quick task", "small task", "one-off task"
- "quick change", "small change", "tiny fix"

### Hotfix / patch
- "hotfix", "patch this", "hot fix", "quick patch"

## Flag Detection

When the user's request includes intent to attach the task to an existing plan or execution run, pass the corresponding flag:

| User intent | Flag |
|-------------|------|
| "append this to the plan", "add this to the plan" | `--append` |
| "inject this into the current run", "inject into the run", "slip this into the run" | `--inject` |

## Exclusions

Do NOT intercept any of the following:

1. **Plan-oriented requests**: Requests that explicitly mention plans, roadmaps, reviews, or execution pipelines. Examples:
   - "create a plan for this"
   - "add this to the roadmap"
   - "review the execution"
   - "run the convergence pipeline"

2. **Complex multi-step requests**: Requests that clearly describe multiple dependent steps requiring a plan. Examples:
   - "refactor the auth system, add OAuth, and migrate the database"
   - "build a new module with tests, docs, and CI integration"

3. **Questions about the codebase**: Requests that are questions rather than tasks. Examples:
   - "how does the auth module work"
   - "what does this function do"
   - "where is the config loaded"

4. **Kit colon-subcommands**: Requests that match the `<word>:<word>` pattern (e.g., "data:validate", "ml:train"). These are kit commands routed through Kit Dispatch, not quick tasks. Examples:
   - "run data:validate"
   - "loom data:lineage"
   - "data:profile this project"

5. **Bug reports and broken behavior**: Requests that describe **symptoms** (errors, crashes, broken behavior) rather than a known fix. These should route to `/loom-bugfix` instead. Examples:
   - "the login page throws a 500"
   - "getting a null reference error"
   - "this crashes when I filter by date"
   - "hotfix — users can't check out" (symptom + urgency = bugfix, not quick)
   
   **Rule of thumb**: If the user describes *what's wrong*, route to bugfix. If the user describes *what to change*, route to quick.

## Instructions

When triggered, invoke the Skill tool with `skill: 'loom-quick'` and the task description as args. Pass any detected flags before the task description.

Examples:

| User says | Skill invocation |
|-----------|-----------------|
| "quickly fix the typo in README" | `skill: "loom-quick", args: "fix the typo in README"` |
| "just add a .gitignore entry for .env" | `skill: "loom-quick", args: "add a .gitignore entry for .env"` |
| "can you just update the version to 2.0" | `skill: "loom-quick", args: "update the version to 2.0"` |
| "hotfix the broken import in utils.ts" | `skill: "loom-quick", args: "fix the broken import in utils.ts"` |
| "patch this -- the timeout is too low" | `skill: "loom-quick", args: "the timeout is too low"` |
| "quickly append this to the plan: add retry logic" | `skill: "loom-quick", args: "--append add retry logic"` |
| "inject this into the current run: fix the lint error" | `skill: "loom-quick", args: "--inject fix the lint error"` |
