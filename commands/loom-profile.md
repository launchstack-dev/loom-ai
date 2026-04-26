---
description: "View or switch model cost profiles for the agent pipeline"
---

# Loom Profile

View or switch model cost profiles. Controls which models are used for different agent tiers across the Loom pipeline.

## Requirements

$ARGUMENTS

### Arguments

Parse arguments after `profile`:
- No args: show current profile and available profiles
- `<name>`: switch to the named profile (`quality`, `balanced`, `budget`)
- `--show`: show detailed model assignments for the current profile
- `--set <tier> <model>`: override a single tier's model (e.g., `--set review haiku`)

### Instructions

#### Step 1: Read Current Configuration

1. Check if `.claude/orchestration.toml` exists in the project root.
   - If yes: read the `[settings]` section for `modelProfile` and any `[settings.profiles.*]` sections.
   - If no: use defaults (no profile set, all agents inherit parent model).

2. Determine the active profile:
   - If `modelProfile` is set in orchestration.toml: that's the active profile.
   - If not set: active profile is "inherit" (all agents use parent model).

#### Step 2: Handle No-Args (Show Current)

If no arguments provided after `profile`:

```
## Model Cost Profile

Active: {profile name or "inherit (no profile set)"}

Available profiles:
  quality    All tiers use high-capability models (opus/sonnet). Best results, highest cost.
  balanced   Planning uses opus, execution and review use sonnet, utility uses haiku. Good tradeoff.
  budget     Planning uses sonnet, everything else uses haiku. Lowest cost.
  inherit    No profile — all agents inherit the parent model. (default)

Current assignments:
  Planning:      {model}    (roadmap-builder, plan-builder, questioner)
  Execution:     {model}    (contracts, implementer, wiring)
  Review:        {model}    (all reviewers)
  Verification:  {model}    (verification-agent)
  Utility:       {model}    (meta-agent, wiki agents, fixer)

Switch profile: /loom-profile <name>
Override a tier: /loom-profile --set <tier> <model>
```

Stop.

#### Step 3: Handle Profile Switch

If a profile name is provided (`quality`, `balanced`, or `budget`):

1. Validate the profile name. If not recognized:
   ```
   Unknown profile: "{name}". Available profiles: quality, balanced, budget, inherit
   ```
   Stop.

2. Read or create `.claude/orchestration.toml`:
   - If the file exists: update the `modelProfile` field under `[settings]`.
   - If the file does not exist: create it with the `[settings]` section and the profile definitions.

3. Write the profile definitions if they don't already exist:

   ```toml
   [settings]
   modelProfile = "{name}"

   [settings.profiles.quality]
   planning = "opus"
   execution = "opus"
   review = "opus"
   verification = "sonnet"
   utility = "sonnet"

   [settings.profiles.balanced]
   planning = "opus"
   execution = "sonnet"
   review = "sonnet"
   verification = "sonnet"
   utility = "haiku"

   [settings.profiles.budget]
   planning = "sonnet"
   execution = "sonnet"
   review = "haiku"
   verification = "haiku"
   utility = "haiku"
   ```

4. If the file already has profile definitions, only update the `modelProfile` field -- do not overwrite custom profile definitions.

5. Display confirmation:
   ```
   Profile switched to: {name}

   Model assignments:
     Planning:      {model}
     Execution:     {model}
     Review:        {model}
     Verification:  {model}
     Utility:       {model}

   Takes effect on the next command invocation.
   ```

#### Step 4: Handle Tier Override

If `--set <tier> <model>` is provided:

1. Validate the tier name. Must be one of: `planning`, `execution`, `review`, `verification`, `utility`.
   If not recognized: print "Unknown tier: {tier}. Available tiers: planning, execution, review, verification, utility" and stop.

2. Validate the model name. Must be one of: `opus`, `sonnet`, `haiku`.
   If not recognized: print "Unknown model: {model}. Available models: opus, sonnet, haiku" and stop.

3. Read the current profile name from orchestration.toml.
   - If no profile is set: warn "No active profile. Set a base profile first with `/loom-profile <name>`, or this override will only apply if a profile is activated later."

4. If a profile is active, modify that profile's tier in orchestration.toml:
   ```toml
   [settings.profiles.{active-profile}]
   {tier} = "{model}"
   ```

5. Display confirmation:
   ```
   Override applied: {tier} = {model} (in profile "{active-profile}")

   Current assignments:
     Planning:      {model}
     Execution:     {model}
     Review:        {model}
     Verification:  {model}
     Utility:       {model}
   ```

#### Step 5: Handle --show (Detailed View)

If `--show` is provided:

Display the full profile with per-agent model assignments:

```
## Model Profile: {name}

### Agent Model Assignments

| Agent | Tier | Model | Source |
|-------|------|-------|--------|
| roadmap-builder-agent | planning | {model} | profile |
| plan-builder-agent | planning | {model} | profile |
| questioner-agent | planning | {model} | profile |
| contracts-agent | execution | {model} | profile |
| implementer-agent | execution | {model} | profile |
| wiring-agent | execution | {model} | profile |
| security-reviewer | review | {model} | profile |
| architecture-reviewer | review | {model} | profile |
| plan-compliance-reviewer | review | {model} | profile |
| verification-agent | verification | {model} | profile |
| meta-agent | utility | {model} | profile |
| wiki-maintainer-agent | utility | {model} | profile |
| fixer-agent | utility | {model} | profile |

### Per-Agent Overrides (from orchestration.toml)

{If any agents in orchestration.toml have explicit `model` fields, list them here.
These override the profile assignment.}

| Agent | Configured Model | Overrides Profile |
|-------|-----------------|-------------------|
| {agent-name} | {model} | yes |

Per-agent overrides always take precedence over profile assignments.
```

Stop.

### Error Handling

- **orchestration.toml parse error:** Warn about the parse error, display the raw file content, and suggest manual fix. Do not overwrite a corrupted file.
- **No write permission:** Warn that the profile change cannot be saved. Display the intended change for the user to apply manually.
- **Unknown profile in file:** If orchestration.toml references a profile name that isn't defined in `[settings.profiles.*]`, warn: "Active profile '{name}' is not defined. Using inherit behavior."
