---
description: Ship production HTML/CSS from a prose or image mockup with Pretext-native rules and anti-AI-slop guards. Emits to docs/design/{slug}/
---

# /loom-design:html

Runs the M-13 F-23 mockup-to-HTML pipeline.

## What it does

1. Accept input: prose description of the mockup OR an absolute path to
   a mockup image. Image analysis is performed by the user in dialogue
   with the agent; the agent does not silently guess.
2. If a design premise exists under `.loom/design/*.md`, read the most
   recent one and honor its typography and color decisions.
3. Emit `docs/design/{slug}/index.html` + `docs/design/{slug}/styles.css`
   (atomic `.tmp` + rename).
4. Enforce Pretext-native rules (rem/em, flexbox/grid, computed heights,
   `text-wrap: balance`/`pretty`, semantic HTML5, tokenized colors).
5. Enforce Phase 5 F-14 anti-AI-slop guards (no gradient overuse, no
   marketing-prose comments, no default palettes, no placeholder text).
6. Validate: HTML structural parse, CSS lint, contrast check.

## Output

- `docs/design/{slug}/index.html`
- `docs/design/{slug}/styles.css`

## Acceptance

- Emitted HTML MUST parse without structural errors. (Plan S-01)

## See also

- `skills/loom-design-html/SKILL.md`
- `commands/loom-design.md`
