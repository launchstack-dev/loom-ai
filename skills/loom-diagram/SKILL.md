---
name: loom-diagram
description: "English or mermaid → excalidraw triplet (source .md + editable .excalidraw + rendered .svg/.png)."
---

# /loom-diagram — English/Mermaid → Excalidraw Triplet (M-08 F-29)

Generates a **triplet of diagram artifacts** from either a prose English
description or a mermaid source block. Every diagram ships as three files
with the same base name at the target path:

| File | Purpose |
|---|---|
| `<slug>.md` | Source: prose description or mermaid fence. Editable, human-readable, git-friendly. |
| `<slug>.excalidraw` | Editable excalidraw JSON. Opened round-trip in the excalidraw web app. |
| `<slug>.svg` | Rendered vector output (also `.png` when a rasterizer is available). |

## Inputs

Two invocation modes:

1. **Prose mode** — describe the diagram in English:
   ```
   /loom-diagram --prose "A user clicks the Login button, which posts to /auth, which returns a JWT stored in localStorage." --out docs/diagrams/login-flow
   ```
   The skill asks Claude to translate the prose into mermaid, then emits the
   triplet.

2. **Mermaid mode** — supply mermaid source directly:
   ```
   /loom-diagram --mermaid ./login-flow.mmd --out docs/diagrams/login-flow
   ```
   Or inline via `--mermaid-inline "sequenceDiagram\n..."`.

## Output

Default `--out` is `docs/diagrams/<slug>` where `<slug>` is derived from
either the input file basename or the first noun-phrase of `--prose`.

The three output files:

- `<out>.md` — front-matter + prose/mermaid source:
  ```markdown
  ---
  diagram: login-flow
  source: mermaid
  generatedAt: 2026-06-30T17:50:00Z
  ---

  ```mermaid
  sequenceDiagram
    User->>+Server: POST /auth
    Server-->>-User: 200 JWT
  ```
  ```

- `<out>.excalidraw` — editable JSON produced by piping the mermaid through
  `@excalidraw/mermaid-to-excalidraw` (via `bunx` / `npx`). If the package
  is not installed, the skill emits an instructive stderr message pointing
  the user at `bun add -D @excalidraw/mermaid-to-excalidraw` and skips the
  `.excalidraw` step (but still writes `.md` and `.svg`).

- `<out>.svg` — rendered via `mmdc` (mermaid-cli) if installed. Falls back
  to instructive stderr. `.png` also emitted when `mmdc` supports it.

## Index registration

Every generated triplet is appended to `.loom/diagrams/index.toon`:

```toon
diagrams[N]{slug,path,source,generatedAt,shaShort}:
  login-flow,docs/diagrams/login-flow,mermaid,2026-06-30T17:50:00Z,a1b2c3d
```

The `shaShort` is a truncated SHA-256 of the `.md` source, used by
`/loom-docs:release` to detect drift between the source `.md` and the
rendered `.excalidraw` / `.svg`. If the SHA of the `.md` differs from the
recorded value but the render files predate the last edit, the release gate
reports the drift.

## CLI

```
/loom-diagram (--prose "<text>" | --mermaid <path> | --mermaid-inline "<src>") --out <path> [--no-svg] [--no-excalidraw]
```

## Output envelope

```toon
slug: login-flow
outPath: docs/diagrams/login-flow
files[3]{ext,path,written}:
  md,docs/diagrams/login-flow.md,true
  excalidraw,docs/diagrams/login-flow.excalidraw,true
  svg,docs/diagrams/login-flow.svg,true

registered: true
indexPath: .loom/diagrams/index.toon
```

## Exit codes

- `0` — triplet written and registered.
- `1` — neither `--prose` nor `--mermaid` provided.
- `2` — output directory not writable.

## Atomic writes

All writes (including `.loom/diagrams/index.toon`) go through `.tmp` +
`fs.renameSync`.
