---
name: loom-design-html
description: "Ships production HTML/CSS from mockup with 'Pretext-native' approach (text reflows, heights computed, layouts not pixel-frozen)."
---

# /loom-design:html — Pretext-Native HTML/CSS from Mockup (M-13 F-23)

`/loom-design:html` converts an approved mockup — either a prose
description or a supplied image path — into production-quality HTML +
CSS that reflows correctly across viewports, does not encode heights in
pixels, and follows the project's design premise (see
`/loom-design:consultation`).

## Input

One of:

1. **Prose description.** A paragraph or bulleted block describing the
   layout, sections, and hierarchy.
2. **Image path.** An absolute path to a mockup image on disk. Image
   analysis is performed by the user (agents describe what they see back
   to the invoker; the invoker confirms before the agent writes code).

If a design premise exists under `.loom/design/*.md`, read the most
recent one and honor its typography and color decisions. If no premise
exists, warn and proceed with system defaults, tagging the run as
`no-premise` in the output header.

## Output

- `docs/design/{slug}/index.html`
- `docs/design/{slug}/styles.css`

`slug` derives from the mockup name or a user-provided identifier
(kebab-case). Both files are written atomically (`.tmp` + rename).

## Pretext-native rules

Every emitted stylesheet MUST follow these rules. They exist because
LLM-generated HTML routinely encodes pixel-perfect Figma layouts that
break the moment text reflows.

- Use `rem` / `em` for typography, spacing, and radii. `px` is
  permitted only for hairline borders and shadow offsets.
- Layout uses flexbox or CSS grid. No absolute-positioned column
  scaffolds.
- Heights are computed by content, not asserted. Prefer `min-height`
  over `height` for section wrappers.
- Long-form text uses `text-wrap: balance` on headings and
  `text-wrap: pretty` on body copy.
- Semantic HTML5: `<header>`, `<nav>`, `<main>`, `<article>`,
  `<section>`, `<aside>`, `<footer>` used according to meaning, not
  visual position.
- All interactive controls have visible focus states.
- Color values are declared once as CSS custom properties at `:root`
  and referenced by token name in every rule.

## Anti-AI-slop guards

Inherited from Phase 5 F-14. Reject and revise before writing if any of
these trigger:

- Any gradient that spans more than two stops OR any element with more
  than one gradient background. Solid fills are the default.
- CSS comments that read as marketing prose ("A beautifully crafted
  experience..."). Comments explain intent for future maintainers only.
- Default framework palettes (Tailwind `indigo-500`, Bootstrap
  primary blue) shipped without customization. If a premise exists,
  every hue must trace to it.
- Placeholder text like "Lorem ipsum" or "Your headline here" in
  final output. Use the mockup's copy verbatim; if absent, ask.

## Validation

Before returning, run:

- HTML structural parse (any HTML5 parser). Emitted HTML MUST parse
  without structural errors — this is the F-23 acceptance criterion.
- Basic CSS lint (unknown properties, unclosed blocks).
- Contrast check against the premise's WCAG targets.

## See also

- `commands/loom-design/html.md`
- `skills/loom-design-consultation/SKILL.md`
- Phase 5 F-14 anti-AI-slop rules
