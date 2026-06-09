---
description: "Zero-ceremony task execution with wiki context, impact assessment, and archiving"
---

# Loom Quick

Zero-ceremony task execution with Loom rigor. Describe what you need done and Loom Quick handles wiki context, implementation, verification, impact assessment, archiving, and optional commit -- adapting its behavior based on whether a plan is active.

## Requirements

$ARGUMENTS

### Arguments

Parse arguments after `quick`:

If arguments are empty or equal `--help`, print the following help text and stop:

```
/loom-quick [flags] <task description>

Execute a task with wiki context, impact assessment, verification, and archiving.

Flags:
  --no-verify   Skip verification commands after execution
  --no-commit   Skip the auto-commit offer after execution
  --no-impact   Skip impact assessment (faster, less rigor)
  --append      Force plan-aware mode (requires PLAN.md)
  --inject      Force injection mode (requires active plan execution)

Modes (auto-detected):
  standalone    No plan present. Execute, verify, log.
  plan-aware    PLAN.md exists. Choose to append as new phase or run independently.
  injection     Plan execution is running. Inject into current wave or queue for next.

Examples:
  /loom-quick Add input validation to the signup form
  /loom-quick --no-verify Fix the broken CSS on the dashboard
  /loom-quick --append Add a caching layer to the API
  /loom-quick --inject --no-commit Add retry logic to the webhook handler
  /loom-quick --no-impact Rename the logger variable
```

### Instructions

#### Step 1: Flag Parsing

Parse arguments by iterating tokens left to right:

1. Any token starting with `--` is a flag. Consume it and continue.
2. The first token that does NOT start with `--` marks the beginning of the task description. All remaining tokens (including any that look like flags) become the task description.

Supported flags: `--no-verify`, `--no-commit`, `--no-impact`, `--append`, `--inject`.

If a token starts with `--` but is not in the supported list, print a warning and continue:

```
Unknown flag: {flag} (ignored)
```

If both `--append` and `--inject` are present, `--inject` takes precedence.

After parsing, if the task description is empty, print the help text and stop.

#### Step 2: Mode Detection

Detect the execution mode before any work begins.

1. Check if `PLAN.md` exists in the project root. Record as `planExists`.
2. Check if `.plan-execution/state.toon` exists. If it does, read its `status` field. Record `executionRunning` as true only if the file exists AND `status` is `in-progress`.
3. Derive mode from this table:

| `executionRunning` | `planExists` | Derived Mode |
|--------------------|--------------|--------------|
| true | true | `injection` |
| false | true | `plan-aware` |
| false | false | `standalone` |
| true | false | `standalone` (print warning: `Warning: execution state found but no PLAN.md. Running in standalone mode.`) |

4. Apply flag overrides:
   - `--inject` forces `injection` mode. Error if `.plan-execution/state.toon` does not exist or `status` is not `in-progress`: print `Cannot use --inject: no active plan execution.` and stop.
   - `--append` forces `plan-aware` mode. Error if `PLAN.md` does not exist: print `Cannot use --append: no PLAN.md found.` and stop.

5. Print the detected mode:

```
Mode: {mode}
```

#### Step 3: Execute by Mode

Route to the appropriate mode section below.

---

##### Mode: Standalone

**3a. Gather context.**

Read `CLAUDE.md` if it exists. Scan the project structure and relevant source files to understand the codebase context needed for the task.

**Wiki context.** If `.loom/wiki/` exists:
1. Read `.loom/wiki/index.toon`.
2. **User-facing-language keying (run BEFORE component matching).** When the task description is framed in user-facing terms, match `flow-*` page titles FIRST, then resolve flows to the components they exercise via `crossRefs`. Prefer a flow title hit over a component-name hit — flow titles describe user-visible behavior, component titles describe code topology, and a user-framed task is more likely shaped by the flow's success path than by an arbitrary code-named module.

   a. **Detect user-facing language in the task description.** Apply these patterns (case-insensitive). If any pattern matches, set `userFacingMode: true`. Keep the pattern set conservative — these patterns will over-match if broadened (calibration risk, same principle as Hook B):

      - `/user(s)? (can'?t|cannot|fails? to|are? unable to|is unable to) \w+/i`
      - `/(checkout|signup|sign-up|login|sign-in|password reset|onboarding|payment|subscription|dashboard) (broken|fails?|doesn'?t work|hangs?|times? out|returns? \d+)/i`
      - `/(error|crash|hang|timeout) (when|while|during|after) \w+/i`
      - `/(can'?t|cannot|unable to) (check ?out|sign ?up|sign ?in|log ?in|reset|submit|complete)/i`
      - `/(button|form|page|screen) (returns?|throws?|shows?) \d+/i`

   b. **If `userFacingMode` is true:**
      - Scan `index.toon` for `flow-*` pages whose `title` or `summary` fuzzy-matches tokens from the task description (lowercase, strip punctuation, drop stopwords; a match is any non-stopword token of length >=4 appearing in the title or summary).
      - For each matched flow page, read its body and add all `crossRefs` entries where `relationship: exercises` to the wiki-lookup candidate set — these are the components the flow touches.
      - Record matched flow pageIds as `matchedFlows[]` (passed to the implementer so it knows which user-facing behaviors to preserve; also logged in the QuickTaskLog `wikiContext` block).
      - Continue with the existing component-matching logic below as a fallback in case no flow matches.

3. **Component matching (existing logic, runs whether or not flows matched).** Find pages relevant to the task (match module names, component names, keywords from description). Prefer flow-derived components from step 2b when ranking candidates.
4. Read up to 3 most relevant pages for context — understand architecture decisions, conventions, and dependencies before making changes. When `matchedFlows[]` is non-empty, prioritize the matched flow pages and their `exercises` components in this top-3.
5. Record consulted page IDs as `wikiContext` for the log. If `matchedFlows[]` is non-empty, also record it in the log so downstream analysis (impact assessment, wiki update prompt) can preserve the user-facing framing.

**Prior task/fix check.** If `.loom/fix-archive/index.toon` exists, scan for prior fixes in the same area. If `planning/history/quick-tasks/` has recent entries touching the same files, note them. This prevents repeating past mistakes or duplicating recent work.

**3b. Execute the task.**

Implement the described task. Write or modify code as needed. Stay focused on exactly what the user described -- no scope creep. Respect any conventions or architectural decisions found in wiki context.

If `matchedFlows[]` from step 3a is non-empty, treat the listed flows' `exitStates` as user-facing behaviors that must be preserved across the change. When making edits that touch a component the flow exercises, verify the flow's success exits still hold (per `agents/protocols/wiki-page.schema.md`, `flow-*` pages declare `exitStates` as the success criteria).

**3c. Continue to Step 4 (Post-Execution).**

---

##### Mode: Plan-Aware

**3a. Present choice to user.**

Print:

```
PLAN.md detected. How should this task relate to the plan?

  1. Append as new phase to PLAN.md, then execute
  2. Execute independently (standalone mode with plan context)
```

Wait for user selection.

**3b. If user chose "Append" (option 1):**

1. Read `PLAN.md` in full.
2. Find the last phase number and last wave number.
3. Create a new phase section in PLAN.md with:
   - Phase number: last phase + 1
   - Wave number: last wave + 1
   - Title derived from the task description
   - Auto-generated file ownership: analyze the task description for file paths, module names, and component references. Check the codebase for matching files. List the files this task will likely touch.
   - Auto-generated acceptance criteria: derive 2-4 testable criteria from the task description.
   - Dependencies: the last existing phase.
4. Record `planContext` as the path to PLAN.md.
5. Read CLAUDE.md if it exists. Scan relevant source files.
6. **Wiki context.** If `.loom/wiki/` exists, read index and find relevant pages (same as standalone 3a). Record `wikiContext`.
7. Execute the task.
8. Continue to Step 4.

**3c. If user chose "Independent" (option 2):**

Record `planContext` as the path to PLAN.md (for the log) but execute in standalone mode. Read CLAUDE.md, scan relevant files, gather wiki context (same as standalone 3a), execute the task, continue to Step 4.

---

##### Mode: Injection

**3a. Read execution state.**

Parse `.plan-execution/state.toon`. Extract:
- `currentWave` -- the wave number currently executing.
- `tasks` -- all tasks with their status, assigned agent, and file ownership.

**3b. Determine file ownership.**

Analyze the task description and the codebase to predict which files this task will modify:
- Parse the task description for file paths, module names, and component references.
- Check the codebase for matching files.
- Produce a candidate `filesOwned[]` list.

**3c. Check for ownership conflicts.**

Compare `filesOwned[]` against every task in the current wave that has `status: in-progress`. A conflict exists if any file in `filesOwned[]` overlaps with another in-progress task's `filesOwned[]`.

**3d. Inject or queue.**

| Conflict? | Action |
|-----------|--------|
| No | Inject into `currentWave`. Add a new task entry to `state.toon` with `status: in-progress` and `agent: quick-task`. Execute the task immediately. |
| Yes | Queue for `currentWave + 1`. Add a new task entry with `status: queued` and `targetWave: currentWave + 1`. Print: `File conflict with in-progress task "{taskId}". Queued for wave {N+1}.` Do NOT execute the task now -- it will be picked up by the plan executor in the next wave. Skip to Step 4 with `verificationResult: skipped`. |

**3e. Update state.toon.**

Write the updated state atomically: write to `.plan-execution/state.toon.tmp`, then rename to `.plan-execution/state.toon`. Include the new task with all standard task fields.

**3f. Execute (if injected, not queued).**

Read CLAUDE.md if it exists. Scan relevant files. Gather wiki context (same as standalone 3a). Execute the task respecting ownership boundaries -- do NOT modify files owned by other in-progress tasks.

**3g. Post-execution state update.**

After the task completes (or fails), update `state.toon` again:
- Set the injected task's `status` to `completed` or `failed`.
- Record `filesChanged[]` in the task entry.

**3h. Continue to Step 4.**

---

#### Step 4: Post-Execution

Run this section for all modes after task execution completes.

##### 4a. Verification

If `--no-verify` was set, set `verificationResult: skipped` and skip to 4b.

Otherwise, discover verification commands using this priority:

1. **PLAN.md extraction.** If `PLAN.md` exists, look for a `## Verification Commands` section. Parse each line as a command. Skip blank lines, lines starting with `#`, and pure prose. Parse fenced code blocks line-by-line for commands.

2. **Auto-detection.** If no plan-based commands were found, probe these files:

| File | Condition | Command |
|------|-----------|---------|
| `package.json` | `scripts.typecheck` exists | `bun run typecheck` |
| `package.json` | `scripts.test` exists | `bun run test` |
| `package.json` | `scripts.lint` exists | `bun run lint` |
| `tsconfig.json` | File exists (and no `scripts.typecheck`) | `bunx tsc --noEmit` |
| `Makefile` | File exists and has a `check` or `test` target | `make check` or `make test` |

3. **No commands found.** Set `verificationResult: skipped` with an empty verification output block.

Run each discovered command sequentially. For each command:
- Capture exit code.
- Capture combined stdout+stderr, truncated to the last 50 lines on failure.
- Record in verification output as `commandName: exit N` (success) or a block with truncated output (failure).

Overall result:
- All commands exit 0: `verificationResult: pass`
- Any command exits non-zero: `verificationResult: fail`

##### 4b. Impact Assessment

If `--no-impact` was set, set `impactAssessment: skipped` and skip to 4c.

Otherwise, perform a lightweight impact assessment on the files changed:

1. **Trace dependents.** For each changed file, use Grep to find importers/callers across the codebase. This does not need to be exhaustive — focus on direct dependents (one level up).

2. **Classify scope:**
   - `isolated` — change is self-contained, no external dependents found
   - `module` — other files in the same directory/module import the changed code
   - `cross-module` — files in other modules depend on the changed code
   - `system-wide` — shared utilities, types, config, or barrel files were changed

3. **Identify regression areas.** List 1-3 user-facing features or flows that exercise the changed code. If the scope is `isolated`, this can be empty.

4. **Cross-reference wiki.** If wiki pages describe affected components, note them.

5. **Record** the assessment as `impactAssessment` for the log:
   ```
   risk: low | medium | high
   scope: isolated | module | cross-module | system-wide
   regressionAreas[N]: feature1, feature2
   relatedWikiPages[N]: page-id-1, page-id-2
   ```

This step should be fast — spend no more than 30 seconds on it. The goal is a quick sanity check, not a deep analysis.

##### 4c. Write Log File

Generate the log file path and taskId:

1. Take the task description, lowercase it.
2. Split on whitespace, take the first 5 words. (Note: loom-bugfix uses 6 words for bug titles which tend to be longer.)
3. Join with hyphens.
4. Replace any character not `[a-z0-9-]` with a hyphen.
5. Collapse consecutive hyphens into one, trim leading/trailing hyphens.
6. Truncate to 50 characters (at the last complete hyphen-delimited segment within the limit).

Path: `planning/history/quick-tasks/{YYYY-MM-DD}-{slug}.toon`

Create the `planning/history/quick-tasks/` directory if it does not exist.

If a file with the same name already exists, append `-2`, `-3`, etc. before `.toon`.

Write the log in TOON format with all QuickTaskLog fields:

```toon
taskId: {YYYY-MM-DD}-{slug}
description: {user's original task description, verbatim}
mode: {standalone|plan-aware|injection}

startedAt: {ISO-8601 timestamp from when execution began}
completedAt: {ISO-8601 timestamp from when post-execution finished}

filesChanged[N]: {list of files created, modified, or deleted}

wikiContext[N]: {page IDs consulted during context gathering, or empty}
matchedFlows[N]: {flow-* pageIds matched via user-facing-language keying, or empty}
userFacingMode: {true|false — whether user-facing-language detection fired during wiki keying}

verificationResult: {pass|fail|skipped}
verificationOutput:
  {commandName}: exit {N}

impactAssessment:
  risk: {low|medium|high|skipped}
  scope: {isolated|module|cross-module|system-wide|skipped}
  regressionAreas[N]: {features/flows to watch}
  relatedWikiPages[N]: {wiki page IDs of affected components}

priorRelatedTasks[N]: {task/fix IDs of related prior work, or empty}

commitHash: {short SHA or null}
planContext: {path to PLAN.md or null}
injectedPhase: {phase identifier or null}
injectedWave: {wave number or null}
```

##### 4d. Offer Commit

If `--no-commit` was NOT set:

Print:

```
Commit changes with /loom-git commit? (y/n)
```

If the user confirms, invoke `/loom-git commit`. Record the resulting commit hash in the log file (update the `commitHash` field). If the user declines, set `commitHash: null`.

If `--no-commit` was set, skip this step and set `commitHash: null`.

##### 4e. Wiki Update Prompt

If wiki context was gathered and changed files overlap with wiki page `sourceRefs`, suggest updating the wiki:

```
Wiki pages may need updating after this change:
  - {page title} ({page ID})

Update wiki with /loom-wiki ingest --diff? (y/n)
```

If confirmed, invoke `/loom-wiki ingest --diff`. If wiki is not available or no overlap, skip silently.

##### 4e.1. Contract-Page Quick-Archive (added by PLAN-spec-upgrades.md Phase 6)

**When this step runs.** Only when the project has `contract-*` wiki pages. Detect by checking for any file matching `.loom/wiki/pages/contract-*.md`. If none exist, skip this step entirely — `/loom-quick` behavior is unchanged for projects without contract pages.

**When this step runs and verification passed.** If `verificationResult` is `fail`, skip — the work hasn't converged yet and stamping a retroactive contract-page archive against failing code would lock in bad state.

**What it does.** If contract pages exist AND verification passed (or was skipped via `--no-verify`), `/loom-quick` invokes `scripts/loom-change/quick-archive.ts` to capture the work as a retroactive change proposal and archive it into the relevant contract page(s). The full atomicity, conflict-detection, and supersession-scan machinery from `/loom-change archive` runs — no shortcuts.

**Step-by-step:**

1. **Identify affected domains.** Scan `filesChanged[]` from the task. For each changed file, check whether any `contract-*` page's `sourceRefs[]` lists it. Collect the unique set of affected domains (the `{domain}` portion of each matching `contract-{domain}` page).

2. **If no domains matched, skip** — the work touched no files referenced by any contract page, so no archive is needed.

3. **Compose the deltas payload.** For each affected domain, derive a minimal `QuickArchiveDelta` object:
   - `domain` = the contract page's domain
   - `addedRequirements[]`, `modifiedRequirements[]`, `removedRequirements[]`, `addedScenarios[]`, `modifiedScenarios[]`, `removedScenarios[]` — populated based on what the task actually changed. For purely structural code changes that introduced no new requirements, all six arrays may be empty (the archive will still record the rationale in History).
   - `breakingChange: false` (unless the change is known-breaking — then set `true` and include `migrationNote`).
   - `migrationNote: null`.
   - `rationale` — derived from the task description plus the impact assessment summary (must be at least 30 chars).

4. **Invoke quick-archive.** Call `scripts/loom-change/quick-archive.ts` via `bunx tsx` (or `npx tsx` fallback) with the deltas payload. The script:
   - Generates a `chg-{YYYYMMDD}-{slug}` directory from the task description.
   - Synthesizes a retroactive `proposal.md` with `reviewedBy: loom-quick` and `approvedBy: loom-quick`.
   - Runs the full archive path (pre-flight validation, conflict scan, atomic per-domain commit, supersession scan, wiki index refresh).

5. **Record the changeId in the log.** Add `quickArchive.changeId` to the QuickTaskLog frontmatter so the audit trail links the quick task to its change proposal.

6. **Surface failure modes:**
   - If pre-flight validation fails (e.g., the user manually edited the contract page before running quick), surface the error and tell the user to run `/loom-change recover` or `/loom-change init` manually.
   - If a conflict is detected with another in-flight change, surface both change IDs and the conflicting requirement/scenario IDs.
   - If mid-archive rollback occurs, surface the path to the rollback log.

**Behavior when contract pages are absent.** When no `contract-*` pages exist (the project hasn't materialized them yet), `/loom-quick` behaves exactly as before — no quick-archive invocation, no log addition. This keeps the ceremony free for projects that haven't opted into the change lifecycle.

##### 4f. Print Summary

Print a summary in this format:

```
--- Quick Task Complete ---
Mode:         {mode}
Task:         {description}
Files:        {comma-separated list of changed files, or "none"}
Impact:       {risk} risk, {scope} scope {or "skipped"}
Regression:   {comma-separated regression areas, or "none"}
Verification: {pass|fail|skipped}
Log:          {path to log file}
Commit:       {short SHA or "none"}
```
