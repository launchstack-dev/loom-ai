---
description: "Cross-vendor LLM comparison (Claude/GPT/Gemini) with LLM judge — dashboard reports latency, tokens, cost, and quality per vendor."
---

# /loom-benchmark:models

Runs the same prompt(s) across configured LLM vendors, uses an LLM judge to
score output quality, and emits a TOON dashboard.

Delegates to `skills/loom-benchmark-models/SKILL.md`.

## Usage

```
/loom-benchmark models [--suite <path>] [--model-claude <id>] [--model-gpt <id>] [--model-gemini <id>] [--judge <claude|gpt|gemini>]
```

## Required env

At least one of:
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`

Vendors without a key are recorded as `skipped` rather than failing the run.

## Output

- Stdout: TOON dashboard with per-vendor `avgLatencyMs`, `totalTokensIn`,
  `totalTokensOut`, `estCostUsd`, `avgQuality`.
- Append: `.loom/benchmark-history.toon`.

See `skills/loom-benchmark-models/SKILL.md` for the full schema.
