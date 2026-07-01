---
name: loom-benchmark-models
description: "Side-by-side comparison of Claude+GPT+Gemini on same prompt with LLM judge scoring quality, dashboard reports latency+tokens+cost."
---

# /loom-benchmark models — Cross-Vendor Model Comparison (M-08 F-25)

Runs the same prompt(s) across configured LLM vendors (Anthropic Claude,
OpenAI GPT, Google Gemini), uses an LLM judge to score output quality on a
0-10 scale, and emits a TOON dashboard comparing **latency**, **tokens**,
**cost**, and **quality** per vendor. Every run is appended to
`.loom/benchmark-history.toon` for drift-tracking.

## Inputs

1. **Benchmark suite** — `.loom/benchmark-suite.toon` if present. Schema:
   ```toon
   prompts[N]{id,prompt,rubric}:
     P1,Explain quicksort in 3 sentences,clarity+correctness
     P2,Write a python function to reverse a linked list,correctness+idiom
   ```
   If the file is absent, synthesize a small default set (3 prompts covering
   explanation, code, and reasoning) and record which set was used in the
   dashboard.

2. **Vendor selection** — auto-detected from env:
   - `ANTHROPIC_API_KEY` → Claude
   - `OPENAI_API_KEY` → GPT
   - `GEMINI_API_KEY` → Gemini

   Vendors without keys are skipped (best-effort; recorded as `skipped: true`
   in the dashboard rather than failing the whole run).

3. **Judge** — Claude by default (uses `ANTHROPIC_API_KEY`). If unavailable,
   fall back to GPT, then Gemini. If no vendor is available, judge scores are
   `null` and the dashboard notes `judgeAvailable: false`.

## Dispatch flow

For every `(prompt, vendor)` pair:

1. Record wall-clock start.
2. Call the vendor's chat/completion endpoint with a fixed default model
   (`claude-opus-4-1`, `gpt-4o-mini`, `gemini-1.5-pro`). Override via
   `--model-<vendor>=<id>` flags.
3. Record end time, token usage (input+output), and estimated cost based on
   published per-1K-token pricing baked into the skill (updated per release).
4. Store output for judge scoring.

Then, per prompt, ask the judge to score each vendor's output 0-10 against
the prompt's `rubric` (or a default rubric of "clarity, correctness,
concision"). Judge output must itself be TOON:

```toon
promptId: P1
scores[N]{vendor,score,reason}:
  claude,9,accurate and concise
  gpt,8,accurate but slightly verbose
  gemini,7,missing edge case
```

## Dashboard output

Emit to stdout and write to `.loom/benchmark-history.toon` (append):

```toon
runId: bench-2026-06-30-1730
timestamp: 2026-06-30T17:30:00Z
suite: .loom/benchmark-suite.toon
promptCount: 2
vendorsRun[3]: claude, gpt, gemini
vendorsSkipped[0]:
judgeAvailable: true
judge: claude

dashboard[N]{vendor,model,promptsRun,avgLatencyMs,totalTokensIn,totalTokensOut,estCostUsd,avgQuality}:
  claude,claude-opus-4-1,2,1240,340,820,0.023,8.5
  gpt,gpt-4o-mini,2,980,340,760,0.004,7.5
  gemini,gemini-1.5-pro,2,1420,340,880,0.011,7.0

verdict: claude_best_quality gpt_best_cost
```

## History file schema

`.loom/benchmark-history.toon` is an append-only log:

```toon
runs[N]{runId,timestamp,vendorsRun,avgQualityByVendor,estCostUsdByVendor}:
  bench-2026-06-30-1730,2026-06-30T17:30:00Z,"claude|gpt|gemini","claude:8.5|gpt:7.5|gemini:7.0","claude:0.023|gpt:0.004|gemini:0.011"
```

Downstream tools (`/loom-status`, retro reports) read this to trend quality
and cost over time.

## CLI

```
/loom-benchmark models [--suite <path>] [--model-claude <id>] [--model-gpt <id>] [--model-gemini <id>] [--judge <claude|gpt|gemini>]
```

## Exit codes

- `0` — run completed (even if some vendors were skipped).
- `1` — no vendors available (all API keys missing).
- `2` — suite file specified via `--suite` was unreadable.

## Atomic writes

Every write to `.loom/benchmark-history.toon` writes to
`.loom/benchmark-history.toon.tmp` first, then `fs.renameSync`.
