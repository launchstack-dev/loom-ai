---
description: "English or mermaid → excalidraw triplet (source .md + editable .excalidraw + rendered .svg)."
---

# /loom-diagram

Generates a diagram triplet from either prose English or mermaid source.

Delegates to `skills/loom-diagram/SKILL.md`.

## Output triplet

At the target path `<out>`:

- `<out>.md` — source (prose or mermaid fence, with frontmatter).
- `<out>.excalidraw` — editable excalidraw JSON.
- `<out>.svg` — rendered vector output.

## Usage

```
/loom-diagram --prose "<text>" --out <path>
/loom-diagram --mermaid <file.mmd> --out <path>
/loom-diagram --mermaid-inline "<src>" --out <path>
```

Flags:
- `--no-svg` — skip the `.svg` render.
- `--no-excalidraw` — skip the `.excalidraw` step.

## Index registration

Every generated triplet is registered in `.loom/diagrams/index.toon` with a
SHA-256 of the `.md` source for later drift-detection by
`/loom-docs:release`.

## Toolchain

- Excalidraw JSON: `@excalidraw/mermaid-to-excalidraw` (via `bunx` / `npx`).
- SVG/PNG render: `mmdc` (mermaid-cli).

Missing tools produce instructive stderr but do not abort — the `.md` source
is always written.

## Exit codes

- `0` — triplet written and registered.
- `1` — neither `--prose` nor `--mermaid` provided.
- `2` — output directory not writable.

See `skills/loom-diagram/SKILL.md` for the full behavior.
