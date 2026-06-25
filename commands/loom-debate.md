---
description: "Adversarial multi-round debate between agents"
---

# Loom Debate

Run an adversarial multi-round debate between agents to reach a well-reasoned decision.

## Requirements

$ARGUMENTS

### Arguments

Parse arguments after `debate`:
- `"question or topic"` (required): the decision to debate
- `--agents <a,b>`: specify advocate and critic agents (default: use general-purpose agents with role prompts)
- `--rounds <N>`: max debate rounds (default: 3, max: 5)
- `--moderator <agent>`: agent that synthesizes the final recommendation (default: general-purpose)

### Protocols

Before doing anything, read:
- `~/.claude/protocols/orchestration-patterns.md` — Pattern 1: Debate
- `~/.claude/protocols/pattern-executor.md` — execution mechanics

### Instructions

#### Step 0: Resolve Agents

1. If `--agents` specified, use those agent names. Look them up in `orchestration.toml` or library for their `.md` file paths.
2. If no `--agents`, use `general-purpose` agents with role prompts:
   - Advocate: "You are an advocate. Argue FOR the strongest position on this question."
   - Critic: "You are a devil's advocate. Find weaknesses, counter-arguments, and risks in the advocate's position."
   - Moderator: "You are a neutral moderator. Synthesize the debate into a clear recommendation with tradeoffs."
3. Check `.claude/orchestration.toml` for `[patterns.*]` entries with `type = "debate"`. If the user's topic matches a configured pattern's trigger, use that pattern's agent config instead.

#### Step 1: Debate Rounds

Execute per `orchestration-patterns.md` Pattern 1:

1. **Round 1 — Advocate:** Spawn advocate agent with the question. Collect position and arguments.
2. **Round 1 — Critic:** Spawn critic agent with the question + advocate's position. Collect critique.
3. **Round 2..N — Rebuttal:** Feed critique back to advocate → collect rebuttal. Feed rebuttal to critic → collect counter. Repeat for `--rounds` rounds.

Display each round as it completes:
```
## Debate: {topic}

### Round 1
**Advocate:** {position summary — 2-3 sentences}
**Critic:** {critique summary — 2-3 sentences}

### Round 2
**Advocate rebuttal:** {key points}
**Critic counter:** {key points}

...
```

#### Step 2: Synthesis

Spawn moderator agent with the full debate transcript:
"Synthesize this debate into a structured recommendation. Include: decision, confidence level (high/medium/low), key tradeoffs acknowledged, and dissenting considerations worth monitoring."

#### Step 3: Present Result

```
## Recommendation

**Decision:** {moderator's recommendation}
**Confidence:** {high/medium/low}

### Key Tradeoffs
{bulleted list}

### Dissenting Considerations
{points from the losing side worth monitoring}

### Full Transcript
{collapse or summarize — available in .plan-execution/debate-{timestamp}.toon}
```

Save the debate to `.plan-execution/debate-{timestamp}.toon` for reference.

#### Wiki Update (non-blocking)

If `.loom/wiki/` exists, spawn wiki-maintainer-agent in the background:
- Event type: `debate-complete`
- Event data: topic, decision, tradeoffs, confidence
- Wiki path: `.loom/wiki`

### Error Handling

- **Agent failure mid-debate:** If advocate or critic fails, attempt one retry with the same context. If retry fails, synthesize from whatever rounds completed.
- **No question provided:** Print: "Usage: `/loom-debate \"Redis vs Postgres for sessions\"`"
