---
name: loom-docs-generate
description: "Cold-start docs via Diataxis quadrant (tutorial/how-to/reference/explanation). Enforces the 4 doc types with structure."
---

# /loom-docs:generate — Diataxis Cold-Start Doc Scaffolding (M-08 F-28)

Generates a **complete Diataxis-shaped `docs/` tree** for a project that has
no docs yet (or wants to normalize existing ad-hoc docs to the framework).
The four Diataxis quadrants are:

| Quadrant | Purpose | Generated file |
|---|---|---|
| **Tutorial** | Learning-oriented — a beginner's guided lesson. | `docs/tutorial/getting-started.md` |
| **How-to** | Task-oriented — recipes for solving specific problems. | `docs/how-to/README.md` (index) |
| **Reference** | Information-oriented — API/config lookup. | `docs/reference/README.md` (index) |
| **Explanation** | Understanding-oriented — architecture and design. | `docs/explanation/architecture.md` |

## Inputs

Reads the following codebase context to seed the stubs:

- `README.md` — pulls project name, one-line description, install command.
- `package.json` — pulls dependencies, scripts, and entry points.
- Top-level directories — enumerated to seed the reference index.
- `CLAUDE.md` / `CONTEXT.md` — pulls architectural context for the
  explanation quadrant.

## Output structure

Every generated file has Diataxis frontmatter:

```markdown
---
diataxis: tutorial
title: Getting Started with <project>
---
```

Valid `diataxis:` values are exactly one of: `tutorial`, `how-to`,
`reference`, `explanation`. Downstream tools (`/loom-docs:release`) enforce
this tag when validating.

### `docs/tutorial/getting-started.md`

A guided lesson with:

1. **What you'll build** — one paragraph.
2. **Prerequisites** — env, tools, versions.
3. **Step-by-step** — 5-10 numbered steps that end with a working demo.
4. **Next steps** — pointers into how-to and explanation.

### `docs/how-to/README.md`

Index page listing task-oriented recipes. Seeded with 3 stub recipe titles
pulled from `README.md` "Usage" section (if present):

```markdown
## Recipes
- [How to install](./install.md) *(stub)*
- [How to configure](./configure.md) *(stub)*
- [How to deploy](./deploy.md) *(stub)*
```

### `docs/reference/README.md`

Index page listing every top-level source directory as a reference stub
target. For each `<dir>/`, adds `- [<dir>](./<dir>.md) *(stub)*`.

### `docs/explanation/architecture.md`

Prose explanation seeded from `CLAUDE.md` architecture sections. Structure:

1. **Design goals** — why this project exists.
2. **Key concepts** — nouns from the codebase.
3. **How it fits together** — module-level diagram (references
   `/loom-diagram` for excalidraw triplets).
4. **Trade-offs** — what was chosen and what was rejected.

## Idempotency

If any target file exists, `/loom-docs:generate` refuses to overwrite by
default. Pass `--force` to overwrite. Pass `--only <quadrant>` to regenerate
just one quadrant.

## CLI

```
/loom-docs:generate [--force] [--only tutorial|how-to|reference|explanation]
```

## Output envelope

Reports which files were written:

```toon
generated[4]{quadrant,path,action}:
  tutorial,docs/tutorial/getting-started.md,created
  how-to,docs/how-to/README.md,created
  reference,docs/reference/README.md,created
  explanation,docs/explanation/architecture.md,created

skipped[0]:
```

## Exit codes

- `0` — all 4 quadrants written (or explicitly skipped via `--only`).
- `1` — target file exists and `--force` was not passed.
- `2` — codebase context unreadable.
