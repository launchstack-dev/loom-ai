---
description: "Cold-start Diataxis docs — generates docs/tutorial, docs/how-to, docs/reference, docs/explanation with proper frontmatter."
---

# /loom-docs:generate

Scaffolds a complete Diataxis-shaped `docs/` tree for a project that has no
docs yet (or wants to normalize existing docs to the framework).

Delegates to `skills/loom-docs-generate/SKILL.md`.

## Diataxis quadrants

| Quadrant | Generated file |
|---|---|
| Tutorial | `docs/tutorial/getting-started.md` |
| How-to | `docs/how-to/README.md` (index) |
| Reference | `docs/reference/README.md` (index) |
| Explanation | `docs/explanation/architecture.md` |

Every file has `diataxis: tutorial|how-to|reference|explanation` in
frontmatter.

## Usage

```
/loom-docs:generate [--force] [--only tutorial|how-to|reference|explanation]
```

## Idempotency

Refuses to overwrite existing files unless `--force` is passed. Use `--only`
to regenerate a single quadrant.

## Exit codes

- `0` — all requested quadrants written.
- `1` — target file exists and `--force` was not passed.
- `2` — codebase context unreadable.

See `skills/loom-docs-generate/SKILL.md` for the full behavior.
