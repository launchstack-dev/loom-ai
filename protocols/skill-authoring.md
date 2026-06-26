# Skill Authoring Principles (F-18 Phase A)

This protocol defines the 6 principles every Loom-authored skill MUST honour, adopted from Matt Pocock's skills-authoring discipline per locked decision C-06.

Each principle carries a sentence-level **no-op test rule** — a check the sediment-sweep auditor runs against the skill body to detect violations cheaply. A skill that fails any no-op test is flagged for revision before it ships.

## Model-invoked vs user-invoked trade-off

Skills come in two flavours, and the trade-off shapes every authoring decision:

- **User-invoked skills** (`/loom-which`, `/loom-bugfix`, `/loom-plan create`) ship as slash commands. They run when a human types them. Their predictability budget is high — surprising the user is the failure mode. Authors should bias toward enumeration, explicit prompts, and recap.
- **Model-invoked skills** (skills the model loads on demand based on `triggers:` frontmatter) run silently inside a Claude turn. Their predictability budget is low — every extra token costs budget across many invocations. Authors should bias toward brevity, leading-word triggers, and zero ceremony.

When a skill could be either, prefer model-invoked unless the user explicitly benefits from the slash-command surface (e.g., interactive grilling, multi-step orchestration).

## Principle 1 — predictability

**Definition:** A skill must produce outputs whose shape a caller can predict from the skill's name and one-line description alone.

**Failure mode:** A `/loom-which` invocation that sometimes prints a recommendation and sometimes runs the recommendation directly.

**noOpTestRule:** Grep the skill body for branches that change the output channel (stdout vs. file write vs. tool call) based on inferred user intent without an explicit flag — if found, fail.

## Principle 2 — leading-word

**Definition:** The first word of a skill's description and the first sentence of its body must telegraph the trigger condition with zero ambiguity.

**Failure mode:** Description starts with "This skill helps you..." — the model cannot detect the trigger without reading three sentences.

**noOpTestRule:** Assert the first word of the description is an imperative verb OR a domain noun ("Stripe", "WorkOS", "Postgres") — if it starts with "This", "A", "An", "The", or "Use", fail.

## Principle 3 — completion-criterion

**Definition:** Every skill must declare an explicit completion criterion the model can check against before claiming done.

**Failure mode:** A skill that "creates a plan" with no test of plan validity — the model declares success on any output.

**noOpTestRule:** Search the skill body for the substring "completion criterion", "done when", or "success when" — if absent AND the skill performs any write or shell command, fail.

## Principle 4 — premature-completion

**Definition:** A skill must not claim completion before the completion criterion has been observed; in particular, intermediate "looks good" signals are not completion.

**Failure mode:** A skill that returns "Done — created the file" without re-reading the file and asserting its shape.

**noOpTestRule:** Walk the skill body for a final-claim sentence; if the preceding paragraph contains a write or shell-call without a subsequent read-back or status-check, fail.

## Principle 5 — sediment

**Definition:** Skills accumulate sediment — outdated examples, abandoned flags, dead branches. The author must run the sediment-sweep no-op test before each release and remove anything that no longer earns its keep.

**Failure mode:** A `/loom-converge` skill body that still documents the `--legacy-iter` flag removed two milestones ago.

**noOpTestRule:** For every flag, command, or path mentioned in the skill body, assert it appears at least once in the corresponding source code or schema doc; orphans fail.

## Principle 6 — duplication

**Definition:** Two skills MUST NOT solve the same problem; if they would, merge them or introduce a clear axis of distinction (e.g., user-invoked vs. model-invoked, foreground vs. background).

**Failure mode:** `/loom-bugfix` and `/loom-debug` both run the same harness with the same arguments.

**noOpTestRule:** Build a name → first-paragraph map of every skill in `~/.claude/skills/`; flag any two whose first paragraphs share >70% of their content words; manual review required before either ships.
