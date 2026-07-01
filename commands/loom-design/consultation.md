---
description: Ground-up brand kickoff — run the 5-phase design consultation interview and write a durable premise artifact to .loom/design/
---

# /loom-design:consultation

Runs the M-13 F-22 five-phase design consultation and writes a design
premise artifact to `.loom/design/{slug}-{ISO-timestamp}.md`.

## What it does

1. Read `.loom/learnings.toon` and filter for `domain: design`; surface
   prior cross-project design decisions to the user.
2. Walk the user through five phases in order:
   1. Audience & tone
   2. Aesthetic direction (prose mood board)
   3. Typography pairing
   4. Color system (primary/secondary/accents/semantic + neutral ramp)
   5. Motion principles (easing, duration bands, when to use motion)
3. Optionally delegate to `/loom-design:html` to render a font preview
   or color-swatch page.
4. Write the premise atomically (`.tmp` + rename) with one H2 per phase
   plus a provenance footer.

## Output

- `.loom/design/{slug}-{ISO-timestamp}.md`

## Acceptance

- The premise artifact MUST land under `.loom/design/`. (Plan S-01)

## See also

- `skills/loom-design-consultation/SKILL.md`
- `commands/loom-design.md`
