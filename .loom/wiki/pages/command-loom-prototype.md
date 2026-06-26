---
pageId: command-loom-prototype
category: command
tags[5]: loom-prototype,throwaway,prototype,ADR-linkage,completion-ceremony
lastUpdated: 2026-06-26T00:00:00Z
updatedAt: 2026-06-26T00:00:00Z
updatedBy: wiki-maintainer-agent
staleness: fresh
summary: /loom-prototype scaffolds named throwaway experiments (logic branch = terminal app, ui branch = parallel UI variants) that expose a Seam before production code is written; the completion ceremony writes answer.toon and optionally updates the originating ADR.
estimatedTokens: 750
bodySections[5]: Summary,Arguments,Branches,Completion Ceremony,ADR Linkage
relatedFiles[1]:
  commands/loom-prototype.md
crossRefs[3]{pageId,relationship}:
  protocol-codebase-design,consumes
  feature-f18-mattpocock-skills-adoption,implemented-by
  state-machine-adr,relates-to
---

## Summary

`/loom-prototype` (F-18 Phase D, sub-12) scaffolds throwaway prototype experiments — code written expressly to answer a question and then discarded. Prototypes have **no polish, no tests, no persistence**. They expose a **Seam** in the design so the production Module can be deep (high **Depth**) before the first line of production code is written. Source of truth: `commands/loom-prototype.md`.

Attributed to Matt Pocock's throwaway-prototype branches pattern (MIT License, per `NOTICE`).

## Arguments

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `<name>` | string | yes | kebab-case, must match `^[a-z][a-z0-9-]*$` |
| `--branch <logic\|ui>` | enum | yes | `logic` = terminal app; `ui` = parallel UI variants on one route |
| `--adr <ADR-NNNN>` | string | no | Originating ADR slug; links the prototype to a decision record |

## Branches

**`logic`** — scaffolds `prototypes/{name}/index.ts`, a minimal terminal app with `async function main()`.

**`ui`** — scaffolds three files: `variant-a.tsx`, `variant-b.tsx`, and `route.tsx` (a route harness with a commented import toggle between variants).

Both branches produce `prototypes/{name}/README.md` (with THROWAWAY banner and "the question" placeholder) and `prototypes/{name}/.prototype-meta.toon` (machine-readable metadata with `throwaway: true`, `status: active`).

## Completion Ceremony

The completion ceremony runs when the operator passes `--complete`:

1. Checks `prototypes/{name}/answer.toon` does not already exist.
2. Prompts for or accepts `--answer "<text>"` (one line: what did you learn?).
3. Invokes `scripts/loom-prototype/completion-ceremony.ts` which writes `answer.toon` atomically.
4. Prints: `Prototype '{name}' complete. answer.toon written.` + `The prototype directory is safe to delete: rm -rf prototypes/{name}/`.

After completion the suggested next steps are: review `answer.toon`, carry the finding into `/loom-plan create` or `/loom-roadmap refine`, delete the prototype.

## ADR Linkage

If `--adr <ADR-NNNN>` is passed:
- Scaffold step: the ADR slug is recorded in `.prototype-meta.toon` under `adrRef:`.
- Completion ceremony: the ceremony script appends a `prototypeAnswer:` line to the referenced ADR file at `docs/adr/`.
- Error: if the ADR file does not exist, exits 2 with `ADR_NOT_FOUND`.

## Error Codes

| Exit | Code | When |
|------|------|------|
| 1 | `PROTOTYPE_EXISTS` | `prototypes/{name}/` already exists |
| 2 | `ADR_NOT_FOUND` | `--adr` references missing ADR file |

## Related Pages

- [Codebase design vocabulary](protocol-codebase-design.md)
- [ADR state machine](state-machine-adr.md)
