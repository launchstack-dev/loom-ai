## Command: `add`

Appends a new feature and phase to ROADMAP.md without regenerating the entire document.

```
/loom-roadmap add "user management with RBAC"
/loom-roadmap add "real-time notifications" --priority high --milestone v2
```

### Step A1: Read and Validate Roadmap

1. Resolve `ROADMAP.md` per `agents/protocols/planning-paths.md` (planning/ROADMAP.md → ROADMAP.md at root). If not found, display: "No ROADMAP.md found. Run `/loom-roadmap init` to create one." and stop.
2. Parse the existing feature list, milestone list, and phase list from the roadmap.

### Step A2: Parse Arguments

Extract from args:
- **description** (required): the feature description string
- **--milestone \<name\>** (optional): target milestone. Default: the current (last incomplete) milestone.
- **--priority high** (optional): if set, place the feature at the top of the target milestone's feature list instead of appending.
- **--after \<feature-name\>** (optional): place the feature immediately after the named existing feature. Error if the named feature does not exist.

If neither `--priority` nor `--after` is specified, append to the end of the target milestone's feature list.

### Step A3: Create Feature Entry

1. Generate a feature ID: next sequential `F-XX` after the last feature in the roadmap.
2. Generate a slug from the description (lowercase, hyphens, strip non-alphanumeric). E.g., "user management with RBAC" becomes `user-management-rbac`.
3. Place the feature in the feature list at the determined position (top if `--priority high`, after the named feature if `--after`, otherwise append).

### Step A4: Create Phase Entry (if roadmap has phases)

If the roadmap contains phase definitions (sections like `### Phase N`):

1. **Auto-number**: find the last phase number and use the next sequential integer.
2. **Slug**: use the slug generated in Step A3.
3. **Dependencies**: set to `[]` (empty — user can refine later with `/loom-roadmap deps` or manual edit).
4. **Status**: set to `planned`.
5. **Milestone**: assign to the target milestone.
6. Append the new phase block at the end of the phase list:

```markdown
### Phase {N}: {Description}
**Slug:** {slug}
**Dependencies:** []
**Status:** planned
**Milestone:** {milestone name}
```

### Step A5: Write and Log

1. Write updated `ROADMAP.md` (atomic: write to `.tmp`, rename).
2. Ensure `planning/history/` directory exists (create if not).
3. Append to `planning/history/changelog.md`:
   ```markdown
   ## {YYYY-MM-DD} — Feature added: {description}
   - Feature ID: {F-XX}
   - Slug: {slug}
   - Milestone: {milestone name}
   - Placement: {top | after {feature} | appended}
   {- Phase: {N} (if phase was created)}
   ```

### Step A6: Display Result

Show the new feature entry and phase (if created):

```
Feature added: {description}
  ID: F-XX
  Slug: {slug}
  Milestone: {milestone name}
  Phase: {N} (planned, no dependencies)

Suggested next steps:
  /loom-roadmap review   — review the updated roadmap
  /loom-plan create      — generate an execution plan
  /loom-roadmap deps     — verify the dependency graph
```

---

## Command: `insert`

Inserts a new feature/phase at a specific position using decimal numbering (e.g., Phase 3.1 between Phase 3 and Phase 4). Designed for urgent additions that must slot into a specific execution order.

```
/loom-roadmap insert 3 "urgent auth fix"
/loom-roadmap insert 3 "auth fix" --reason "security vulnerability discovered"
```

### Step I1: Read and Validate Roadmap

1. Resolve `ROADMAP.md` per `agents/protocols/planning-paths.md` (planning/ROADMAP.md → ROADMAP.md at root). If not found, display: "No ROADMAP.md found. Run `/loom-roadmap init` to create one." and stop.
2. Parse all phases with their numbers, dependencies, and statuses.

### Step I2: Parse Arguments

Extract from args:
- **position** (required, integer): the phase number to insert after. E.g., `3` means "insert after Phase 3."
- **description** (required): the feature description string.
- **--reason "text"** (optional): rationale for the insertion (recorded in changelog).

Validate:
- The position phase must exist. If not, display: "Phase {N} does not exist. Available phases: {list}." and stop.
- Identify the next phase (the phase that currently follows the position phase in execution order).

### Step I3: Determine Decimal Phase Number

1. Check if Phase `{position}.1` already exists.
2. If it does, try `{position}.2`, `{position}.3`, etc., until an unused decimal is found.
3. Use this decimal as the new phase number.

### Step I4: Create Phase Entry

1. **Copy dependencies**: start with the same dependency list as the phase at `{position}` (the phase being inserted after). This ensures the new phase has the same prerequisites.
2. **Generate slug** from description (same logic as `add`).
3. **Status**: set to `planned`.
4. Create the phase block and insert it into ROADMAP.md immediately after Phase `{position}`:

```markdown
### Phase {position.X}: {Description}
**Slug:** {slug}
**Dependencies:** {copied from Phase {position}}
**Status:** planned
```

### Step I5: Add Feature to Feature List

1. Generate a feature ID (next sequential `F-XX`).
2. Add the feature to the feature list, positioned in the same milestone as Phase `{position}`.

### Step I6: Write and Log

1. Write updated `ROADMAP.md` (atomic: write to `.tmp`, rename).
2. Ensure `planning/history/` directory exists.
3. Append to `planning/history/changelog.md`:
   ```markdown
   ## {YYYY-MM-DD} — Feature inserted: {description}
   - Phase: {position.X} (inserted after Phase {position})
   - Slug: {slug}
   - Dependencies: {copied from Phase {position}}
   {- Reason: {reason text} (if --reason provided)}
   ```

### Step I7: Display Result

```
Phase {position.X} inserted: {description}
  Slug: {slug}
  Dependencies: {list}
  Position: after Phase {position} ({name}), before Phase {next} ({name})

{If --reason: Reason: {reason text}}

This phase will execute after Phase {position} and before Phase {next}.
Run `/loom-roadmap deps` to verify the dependency graph.
```

---

## Command: `remove`

Removes a phase from the roadmap by phase number or slug. Checks for dependent phases before removing and offers to clean up dependency references.

```
/loom-roadmap remove 5
/loom-roadmap remove "user-management"    (by slug)
```

### Step R1: Read and Validate Roadmap

1. Resolve `ROADMAP.md` per `agents/protocols/planning-paths.md`. If not found, display: "No ROADMAP.md found." and stop.
2. Parse all phases with their numbers, slugs, names, dependencies, and statuses.

### Step R2: Find the Target Phase

1. If the argument is a number, find the phase with that number.
2. If the argument is a string, find the phase whose slug matches.
3. If no match found, display: "Phase '{arg}' not found. Available phases: {list with numbers and slugs}." and stop.

### Step R3: Check Dependencies

Scan ALL other phases for dependency references to the target phase:

1. For each phase in the roadmap (excluding the target), check if its `Dependencies` list contains the target phase number.
2. Collect all phases that depend on the target (the "dependents").

### Step R4: Warn if Dependents Exist

If dependents were found, display a warning and ask for confirmation:

```
Phase {N} ({slug}) is depended on by:
  - Phase {X} ({slug-x})
  - Phase {Y} ({slug-y})

Remove anyway? Dependents will have this dependency dropped. (yes / no)
```

Wait for user response. If "no" or anything other than "yes", display "Removal cancelled." and stop.

If no dependents exist, proceed without prompting.

### Step R5: Execute Removal

1. **Remove the phase** from ROADMAP.md (delete the entire phase block).
2. **Remove the corresponding feature** from the feature list (match by slug or phase reference).
3. **Update dependent phases**: for each dependent found in Step R3, remove the target phase number from their dependency lists. Do NOT add replacement dependencies — the user should run `/loom-roadmap deps` to verify the graph.
4. **Do NOT renumber remaining phases.** Phase numbers are stable identifiers referenced in notes, wiki entries, changelogs, and external documentation. Gaps in numbering are expected and acceptable.

### Step R6: Write and Log

1. Write updated `ROADMAP.md` (atomic: write to `.tmp`, rename).
2. Append to `planning/history/changelog.md`:
   ```markdown
   ## {YYYY-MM-DD} — Phase removed: Phase {N} ({slug})
   - Description: {phase name/description}
   - Dependents updated: {list of phases that had this dependency removed, or "none"}
   - Feature removed: {F-XX} ({feature name})
   ```

### Step R7: Display Result

```
Removed: Phase {N} ({slug}) — {description}
  Feature F-XX removed from feature list

{If dependents were updated:
Updated dependencies:
  - Phase {X} ({slug-x}): removed Phase {N} from dependencies
  - Phase {Y} ({slug-y}): removed Phase {N} from dependencies
}

Phase numbers have NOT been renumbered (preserves external references).
Run `/loom-roadmap deps` to verify the updated dependency graph.
```

---

## Command: `reorder`

Moves phases to new positions in the roadmap. Validates that the move does not create circular dependencies using Kahn's algorithm (same logic as the `deps` subcommand). Supports both targeted moves and interactive mode.

```
/loom-roadmap reorder              (interactive)
/loom-roadmap reorder 5 --after 2  (move phase 5 to after phase 2)
```

### Step O1: Read and Parse

1. Resolve `ROADMAP.md` per `agents/protocols/planning-paths.md`. If not found, display: "No ROADMAP.md found." and stop.
2. Extract all phases with their numbers, names, slugs, and dependency lists.
3. Build the dependency adjacency list (same format as `deps` subcommand Step 1).

### Step O2: Determine Mode

- If a phase number and `--after` are provided: **targeted mode** (Steps O3-O4).
- If no args: **interactive mode** (Steps O5-O7).

### Step O3: Targeted Move

1. Validate both phase numbers exist. If not, display available phases and stop.
2. Move the specified phase to the position after the `--after` phase in the document order.
3. Proceed to Step O8 (cycle detection and write).

### Step O4: Validate Targeted Move (Cycle Detection)

Run Kahn's algorithm on the dependency graph with the proposed new ordering:

1. **Build the adjacency list** from the current dependency declarations (dependencies are NOT changed by reorder — only document position changes).
2. **Compute in-degree** for each phase (count incoming dependency edges).
3. **Initialize queue** with all phases that have in-degree 0.
4. **Process**: while the queue is non-empty, dequeue a phase, increment processed count, and for each phase that depends on it, decrement its in-degree. If in-degree reaches 0, enqueue it.
5. **If processedCount < total phases**: a cycle exists. The unprocessed phases form the cycle.

If a cycle is detected:
```
Move rejected: moving Phase {N} after Phase {M} creates a circular dependency.
Cycle: Phase {A} → Phase {B} → ... → Phase {A}

The dependency graph requires Phase {N} to complete before Phase {M}.
To force this reorder, first update dependencies with manual edits to ROADMAP.md.
```
Stop without writing.

If no cycle, proceed to Step O8.

### Step O5: Interactive Mode — Display Current Order

Present the current phase order with dependencies:

```
## Current Phase Order

  Phase 0: Contracts           (deps: none)
  Phase 1: Data Layer          (deps: 0)
  Phase 2: API Routes          (deps: 0)
  Phase 3: Auth                (deps: 1, 2)
  Phase 4: Integration         (deps: 3)
  Phase 5: Dashboard           (deps: 3)

Which phase do you want to move, and where?
(e.g., "5 --after 1" to move Phase 5 after Phase 1)
Type "done" to finalize, or "cancel" to abort.
```

### Step O6: Interactive Move Loop

1. Parse user input as `{phase} --after {phase}`.
2. Tentatively apply the move to the in-memory phase list.
3. Run cycle detection (Kahn's algorithm, same as Step O4) on the resulting graph.
4. If cycle detected: reject the move, display the cycle, and return to the prompt. The phase list reverts to its state before this move.
5. If no cycle: accept the move. Display the updated order and return to the prompt.
6. Allow multiple moves before the user types "done".

### Step O7: Confirm Interactive Changes

When the user types "done", display the final proposed order alongside the original:

```
## Proposed Reorder

Original:                          Proposed:
  Phase 0: Contracts                 Phase 0: Contracts
  Phase 1: Data Layer                Phase 1: Data Layer
  Phase 2: API Routes                Phase 5: Dashboard    ← moved
  Phase 3: Auth                      Phase 2: API Routes
  Phase 4: Integration               Phase 3: Auth
  Phase 5: Dashboard                 Phase 4: Integration

Apply this reorder? (yes / no)
```

If "no", display "Reorder cancelled." and stop.

### Step O8: Write and Log

1. Rewrite the phase sections in `ROADMAP.md` in the new order (atomic: write to `.tmp`, rename).
   - **Important**: only the document order of phase sections changes. Phase numbers, slugs, dependency lists, and all other content remain unchanged.
2. Append to `planning/history/changelog.md`:
   ```markdown
   ## {YYYY-MM-DD} — Phases reordered
   - Moves: {list of "Phase N moved after Phase M"}
   - Cycle check: passed
   ```

### Step O9: Display Result

```
Phases reordered successfully.

New order: Phase 0, Phase 1, Phase 5, Phase 2, Phase 3, Phase 4

Run `/loom-roadmap deps` to see the updated dependency graph.
```

---

