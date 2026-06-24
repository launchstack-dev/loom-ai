---
description: "Rubric: Constraints & Decisions"
---

# Rubric: Constraints & Decisions

The Constraints & Decisions section captures locked architectural decisions and non-negotiable requirements as numbered records (C-01, C-02, ...). Each entry has four required fields: **Decision** (the chosen approach), **Rationale** (why this was chosen), **Alternatives considered** (what was evaluated and rejected, with reasons), and **Impact** (high/medium/low). A strong constraints section makes downstream plan phases predictable — a reader can anticipate which approaches will be rejected at code-review time because the rationale already foreclosed them.

## Green

> "### C-04: E2E Runner Uses Playwright
> **Decision:** Playwright CLI for headless e2e, Chrome MCP via `--chrome` flag for authenticated flows. No Bowser dependency.
> **Rationale:** Bowser wraps Playwright inside Claude Code's agent framework — we already have our own orchestration. Direct Playwright is simpler and CI-compatible. Playwright is needed because Loom plans can produce web applications, and milestone-level acceptance criteria for web apps require browser verification.
> **Alternatives considered:** Bowser as dependency (rejected — adds framework coupling for features we already have), Puppeteer (rejected — Playwright has better DX).
> **Impact:** medium"

This is green because every required field is present and substantive. The Rationale explicitly references the project's context ("we already have our own orchestration"), so the decision is anchored to this project, not generic advice. The Alternatives column names two specific competitors and gives a one-line reason for each rejection — a reviewer can independently agree or push back. Impact is sized realistically. A future agent encountering "we should use Bowser" knows to refuse and cite C-04.

## Yellow

> "### C-01: Use TypeScript
> **Decision:** TypeScript.
> **Rationale:** Type safety is good.
> **Impact:** high"

This is yellow because the four required fields are partially present (Alternatives is missing) and the present fields are degenerate. "Type safety is good" is a generic platitude, not a project-anchored rationale — it would apply to any project. The missing Alternatives column hides whether plain JavaScript, Flow, or ReScript were considered, so a future contributor proposing one of those has no record to push against. Reviewer should echo: "add the Alternatives field naming at least one rejected option and the reason; replace the rationale with a project-specific justification (e.g., 'API surface shared between server and tests benefits from compile-time contract enforcement')."

## Red

> "We'll make good architectural decisions as we go."

This is red because no decision IDs exist, no decisions are recorded, no rationales are documented, and no alternatives are evaluated. The downstream pipeline has no invariants to honor — every code review must re-derive every architectural choice from first principles. The Tech Stack section cannot be cross-referenced against the constraints because none exist. Reviewer must mark as blocking — the schema requires at least one constraint with all four fields.
