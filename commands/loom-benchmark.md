---
description: "Benchmark dispatcher — subcommands: models (cross-vendor LLM comparison), perf (Core Web Vitals regression)."
---

# /loom-benchmark

Dispatcher for benchmark subcommands.

Parse the first positional argument as the subcommand:

- No args: show available subcommands.
- `models`: cross-vendor LLM comparison (Claude/GPT/Gemini) with LLM judge.
- `perf`: Core Web Vitals regression gate via `/loom-browser` daemon.

## Subcommand Dispatch

| Subcommand | Handler |
|---|---|
| `models` | `skills/loom-benchmark-models/SKILL.md` |
| `perf`   | `skills/loom-benchmark/SKILL.md` |

## Usage

```
/loom-benchmark models [--suite <path>] [--judge <claude|gpt|gemini>]
/loom-benchmark perf   [--url <url>] [--baseline-ref <git-ref>]
```

See the linked skill file for full flag list and output schema.

## History files

- `models` appends to `.loom/benchmark-history.toon`.
- `perf` appends to `.loom/perf-history.toon`.

Both are read by `/loom-status` for trend rendering.
