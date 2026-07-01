---
name: loom-design-consultation
description: "Ground-up brand kickoff — aesthetic direction, typography, color system, motion principles, font preview render. Uses .loom/learnings.toon to pull prior design decisions across projects."
---

# /loom-design:consultation — Ground-Up Brand Kickoff (M-13 F-22)

`/loom-design:consultation` runs a five-phase interview that produces a
durable **design premise artifact** for the project. It is the ground-up
kickoff that later `/loom-design:html` and `/loom-design:shotgun` runs
consume as their taste baseline.

## When to run

- Starting a new project with no locked visual identity
- Rebooting an existing product whose visual language has drifted
- After a rebrand, before any UI code is written

If a premise already exists (`.loom/design/*.md`), `/loom-design:consultation`
must be re-invoked explicitly — never overwrite.

## Prior-decision context

Before the interview, read `.loom/learnings.toon` and filter for
`domain: design`. Surface every relevant prior decision to the user so
cross-project taste is carried forward rather than re-derived. If the
learnings file is absent or empty, note that and proceed.

## Five-phase interview

Each phase MUST run in order. Do not merge phases. Record the user's
answers verbatim; do not paraphrase to fit a template.

### Phase 1 — Audience & tone
- Who is the primary audience? (role, sophistication, time budget)
- What emotional register does the product live in? (serious, playful,
  editorial, utilitarian, rebellious)
- What products does the user admire tonally? (name three, with reasons)

### Phase 2 — Aesthetic direction
- Mood board via prose: five adjectives + one paragraph that describes
  the visual world the product inhabits.
- Reject vague answers ("clean", "modern") and probe for the specific
  shape those words take.

### Phase 3 — Typography pairing
- Primary display face + primary text face (name and rationale).
- Fallback stack (system-safe).
- Line-height and measure rules of thumb the project will adopt.
- Optional: render a font preview via `/loom-design:html` (F-23) using
  the pairing on a sample article page.

### Phase 4 — Color system
- Primary, secondary, and accent hues (name + hex/OKLCH).
- Semantic tokens: success, warning, danger, info.
- Neutral ramp (at least 9 stops).
- Contrast targets (WCAG AA minimum, AAA where feasible).

### Phase 5 — Motion principles
- Easing curves the project standardizes on (cubic-bezier values).
- Duration bands: micro (≤150 ms), standard (150-300 ms),
  deliberate (300-600 ms).
- When motion is used and when it is refused.

## Output

Write the premise to `.loom/design/{slug}-{ISO-timestamp}.md`.

- `slug` derives from the project name (kebab-case).
- Timestamp is ISO 8601 with second precision, no colons
  (`2026-06-30T203045Z`).
- File contains one H2 per phase with the recorded decisions, plus a
  provenance footer recording the prior learnings that influenced the
  session.

## Optional preview render

If the user asks for a visual preview of the typography or color system,
delegate to `/loom-design:html` (F-23) with a prose mockup like:

```
Render a two-column article page using {display-face} for headings and
{text-face} for body copy, with the color system swatches inline in the
right rail.
```

## Anti-slop guardrails

- Do not invent brand words the user did not use.
- Do not select stock palettes ("midnight blue + coral") without the
  user affirming each hue.
- Do not compress the interview if the user is fast to answer — every
  phase must produce at least one durable decision.

## See also

- `commands/loom-design/consultation.md`
- `skills/loom-design-html/SKILL.md`
- `skills/loom-design-shotgun/SKILL.md`
- `.loom/learnings.toon` (domain: design)
