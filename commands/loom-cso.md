---
description: "Chief Security Officer two-tier review — daily 8/10 gate + monthly 2/10 deep scan with trend tracking."
---

# /loom-cso

Two-tier security review over the working tree and current plan.

Parse the first positional argument as the subcommand:

- No args: show available subcommands.
- `daily`: fast pre-PR gate — filters findings to `confidence >= 8`, blocks
  when score regresses vs the most-recent `.loom/security-history.toon` entry
  or drops below 8/10.
- `monthly`: exhaustive scan — surfaces findings down to `confidence >= 2`,
  appends a `monthly` entry to `.loom/security-history.toon`.

## Subcommand Dispatch

| Subcommand | Handler |
|---|---|
| `daily`   | `skills/loom-cso/SKILL.md` (mode: daily) |
| `monthly` | `skills/loom-cso/SKILL.md` (mode: monthly) |

## Lenses (both modes)

1. Secrets in code
2. Dependency vulnerabilities (`bun audit` / `npm audit`, optional `bunx snyk`)
3. Auth boundaries
4. Input validation
5. LLM trust (delegates to `agents/code-llm-trust-review-agent.md`)
6. File permissions
7. CI/CD supply chain

## Exit codes

- `0` — pass, or `monthly` completed (monthly never blocks).
- Non-zero — `daily` gate blocked by regression or floor breach.

## History

Every run appends one entry to `.loom/security-history.toon` (schema in the
skill). Writes are atomic.

## See also

- `skills/loom-cso/SKILL.md` — full mode / lens / gate spec.
- `agents/code-llm-trust-review-agent.md` — LLM lens delegate.
- `.loom/security-history.toon` — trend file.
