---
description: "Smart routing — natural language to the right Loom command"
---

# /loom-which

You route the user to the correct Loom command by walking a decision tree one question at a time. You ask **exactly one question per turn** (GR-01), recommend the most common branch as the default for each node (GR-02), enumerate all branches before recommending (GR-03), infer answers from existing codebase artifacts before asking (GR-04), and cap the session at 12 questions maximum (GR-05; hard cap lands in Phase 5a — the cap exists from day one).

## Requirements

$ARGUMENTS

### Arguments

Parse the optional argument after `which`:
- No args: start the decision tree from N-01 (first question)
- `"<description>"`: attempt to infer the branch from the description, then confirm or ask the follow-up question

## Decision Tree

The canonical decision tree. Internal nodes carry a question and branches; leaf nodes carry a command recommendation. Each session starts at **N-01**.

```toon
nodes[14]{id,question,branches,leafRecommendation}:
  N-01,"What kind of task are you on?","[bug, feature, design, planning, audit, runtime, unclear]",null
  N-02,"Bug — do you have a tight, reliably-red reproduction command?","[yes, partial, no]",null
  N-03,"Feature — is there an approved ROADMAP.md entry for it yet?","[yes-approved, drafted-not-approved, no-roadmap]",null
  N-04,"Design — are you exploring shape (codebase health, deepening) or capturing a decision (ADR)?","[shape, decision, throwaway-prototype]",null
  N-05,"Planning — do you need to convert a roadmap to a plan, review an existing plan, or execute one?","[convert, review, execute]",null
  N-06,"Audit — what surface are you auditing?","[coverage, attribution, skill-autoload, sediment]",null
  N-07,"Runtime — what state is the Loom installation in?","[upgrade, library-refresh, project-migrate]",null
  L-runtime-upgrade,null,null,"/loom-update (channel-aware Loom-runtime upgrade — atomic staging, rollback snapshots)"
  L-runtime-library,null,null,"/loom-library sync (refresh user-installed kits and agents — refuses to touch system files)"
  L-runtime-upgrade-project,null,null,"/loom-upgrade (migrate THIS project's PLAN.md / ROADMAP.md / state files to current schemas)"
  L-bugfix-tight,null,null,"/loom-bugfix --autoconverge"
  L-bugfix-construct,null,null,"/loom-bugfix (default path; Phase-1 gate will help you construct loop.toon — start at rung 1 of the 10-rung ladder)"
  L-feature-roadmap,null,null,"/loom-plan create (roadmap exists; ready for plan)"
  L-feature-draft-roadmap,null,null,"/loom-roadmap converge (drive the roadmap to ready first)"
  L-feature-new,null,null,"/loom-roadmap init (no roadmap yet)"
  L-design-shape,null,null,"/loom-deepen --target <subtree>"
  L-design-decision,null,null,"Write an ADR at docs/adr/{NNNN}-{title}.md per docs/adr/README.md"
  L-design-throwaway,null,null,"/loom-prototype <name> --branch <logic|ui>"
  L-plan-convert,null,null,"/loom-plan create"
  L-plan-review,null,null,"/loom-plan review"
  L-plan-execute,null,null,"/loom-plan execute"
  L-audit-coverage,null,null,"scripts/coverage-audit/f18-audit.ts --validate <PATH>"
  L-audit-attribution,null,null,"bunx vitest run tests/regressions/no-per-file-attribution.test.ts"
  L-audit-autoload,null,null,"scripts/skill-autoload-audit/classify.ts"
  L-audit-sediment,null,null,"scripts/sediment-sweep/no-op-test.ts"
  L-unclear-fallback,null,null,"/loom-reference (no clear match; consult the flat reference table)"

edges[26]{fromNode,branch,toNode}:
  N-01,bug,N-02
  N-01,feature,N-03
  N-01,design,N-04
  N-01,planning,N-05
  N-01,audit,N-06
  N-01,runtime,N-07
  N-01,unclear,L-unclear-fallback
  N-07,upgrade,L-runtime-upgrade
  N-07,library-refresh,L-runtime-library
  N-07,project-migrate,L-runtime-upgrade-project
  N-02,yes,L-bugfix-tight
  N-02,partial,L-bugfix-construct
  N-02,no,L-bugfix-construct
  N-03,yes-approved,L-feature-roadmap
  N-03,drafted-not-approved,L-feature-draft-roadmap
  N-03,no-roadmap,L-feature-new
  N-04,shape,L-design-shape
  N-04,decision,L-design-decision
  N-04,throwaway-prototype,L-design-throwaway
  N-05,convert,L-plan-convert
  N-05,review,L-plan-review
  N-05,execute,L-plan-execute
  N-06,coverage,L-audit-coverage
  N-06,attribution,L-audit-attribution
  N-06,skill-autoload,L-audit-autoload
  N-06,sediment,L-audit-sediment
```

## Instructions

### Step 0: Codebase Inference (GR-04)

Before asking the user anything, inspect the codebase to try to infer answers:

1. Check if a `planning/ROADMAP.md` or `ROADMAP.md` exists → informs N-03 branches.
2. Check if a `.plan-execution/loops/` directory has entries → informs N-02 (tight reproduction loop present).
3. Check if an optional description was provided via `$ARGUMENTS` → attempt to match it to the decision tree branches using the keyword table below.

Keyword inference table (first match wins; all comparisons are case-insensitive):

| Keywords | Inferred node path |
|----------|--------------------|
| bug, fix, broken, regression, error | N-01 → bug |
| feature, add, ship, build | N-01 → feature |
| design, shape, ADR, architecture | N-01 → design |
| plan, roadmap, convert, review | N-01 → planning |
| audit, coverage, attribution, sediment | N-01 → audit |

If the description is ambiguous or unrecognized: proceed to the interactive tree starting at N-01.

### Step 1: Walk the Tree — One Question Per Turn (GR-01, GR-02, GR-03)

**Critical rule:** Ask exactly one question per response. Do NOT ask N-01 and N-02 in the same message.

For the **current node** in the traversal:

1. **Print the question** from the node verbatim.
2. **Enumerate all branches** as a numbered list. Include a brief one-line description for each.
3. **Bold the recommended default** — the first branch in the `branches` array for that node (GR-02).
4. Wait for the user's reply before asking the next question.

**Question format template:**

```
## /loom-which — Q{N}

{node question verbatim}

  **1. {branch[0]} ← recommended default**
  2. {branch[1]}
  3. {branch[2]}
  ...

Reply with the number or branch name.
```

Where `{N}` is the question number in this session (1-indexed). Track question count — if it reaches 12, emit `STUCK_AT_GRILL_CAP` to stderr and stop (Phase 5a full cap behavior; tracking from day one per GR-05).

### Step 2: Handle User Reply

Map the user's reply to a branch label:
- If they reply with a number: map to the Nth branch (1-indexed) for the current node.
- If they reply with a partial or full branch label: match case-insensitively.
- If the reply does not match any branch: print `NO_MATCH for: "{reply}"` to stderr and re-present the current node question.

Follow the matching edge from the current node to the next node or leaf.

### Step 3: At a Leaf — Emit Recommendation

When the traversal reaches a leaf node (`L-*`), print:

```
## /loom-which — Recommendation

**{leafRecommendation verbatim}**

Path taken: {N-01 branch} → {N-0x branch (if applicable)}
```

If the leaf is `L-unclear-fallback`, also print to stderr:

```
NO_MATCH diagnostic: no branch matched the user's task description; falling back to /loom-reference
```

### Step 4: No-Match Fallback (Scenario S-02)

If at any point:
- The user provides a description that doesn't match any branch after codebase inference, **and**
- The interactive walk cannot be completed (e.g., the user replies with something unrecognized twice in a row)

Then:
1. Print `NO_MATCH diagnostic: could not route to a command` to stderr.
2. Print to stdout: `Suggestion: /loom-reference (consult the flat reference table for all commands)`

## Grilling Discipline Compliance (GR-01..GR-05)

This command implements Phase 1 compliance with `protocols/grilling.md`:

| Rule | Implementation |
|------|----------------|
| GR-01 | Ask exactly one question per response — the question format template enforces this |
| GR-02 | Bold the first branch as recommended default in every question |
| GR-03 | Print all branches as a numbered list before recommending — never collapse |
| GR-04 | Step 0 reads codebase artifacts before asking the user anything |
| GR-05 | Question counter tracked; STUCK_AT_GRILL_CAP emitted at Q13 (Phase 5a: 12-question hard cap, progress indicator `Q{N}/{cap}`, `/skip` operator — not Phase 1 obligations) |

Full Phase 5a grilling content (12-question cap with progress display, `/skip` escape, model-invocation guidance) is NOT a Phase 1 obligation. The cap exists and is tracked from day one.
