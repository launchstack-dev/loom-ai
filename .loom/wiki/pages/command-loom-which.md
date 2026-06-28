---
pageId: command-loom-which
category: command
tags[5]: loom-which,decision-tree,routing,grilling,model-facing
lastUpdated: 2026-06-26T00:00:00Z
updatedAt: 2026-06-26T00:00:00Z
updatedBy: wiki-maintainer-agent
staleness: fresh
summary: /loom-which is the decision-tree router (14 nodes, 26 edges) that walks an operator from a natural-language task description to the precise Loom command — one GR-compliant question per turn with codebase inference first.
estimatedTokens: 900
bodySections[5]: Summary,Decision Tree Shape,Distinguishing from Siblings,GR Compliance,Usage
relatedFiles[1]:
  commands/loom-which.md
crossRefs[4]{pageId,relationship}:
  protocol-grilling,consumes
  feature-f18-mattpocock-skills-adoption,implemented-by
  command-loom-deepen,relates-to
  command-loom-prototype,relates-to
---

## Summary

`/loom-which` (F-18 Phase A, sub-4c) is the interactive decision-tree router introduced in F-18. It walks the operator from a natural-language task description to the exact Loom command to run, using a 14-node / 26-edge tree and the grilling discipline from `protocols/grilling.md`. Source of truth: `commands/loom-which.md`.

## Decision Tree Shape

The tree has **14 nodes** (7 internal `N-*` nodes + 7 special `N-*` runtime nodes + leaf nodes) and **26 edges** (including the runtime branch added in F-18).

Internal nodes (ask one question each):

| Node | Question |
|------|----------|
| N-01 | What kind of task? (bug / feature / design / planning / audit / runtime / unclear) |
| N-02 | Bug — do you have a tight, reliably-red reproduction command? |
| N-03 | Feature — is there an approved ROADMAP.md entry? |
| N-04 | Design — exploring shape or capturing a decision or throwaway prototype? |
| N-05 | Planning — convert roadmap / review plan / execute plan? |
| N-06 | Audit — coverage / attribution / skill-autoload / sediment? |
| N-07 | Runtime — upgrade / library-refresh / project-migrate? |

The runtime branch (`N-07` + `L-runtime-*` leaves) is new in F-18 — previous versions had no runtime node.

Leaf nodes resolve to a specific command (e.g., `/loom-bugfix --autoconverge`, `/loom-deepen --target <subtree>`, `Write an ADR at docs/adr/`). The `L-unclear-fallback` leaf resolves to `/loom-reference`.

## Step 0: Codebase Inference (GR-04)

Before asking anything, `/loom-which` reads codebase artifacts:
1. Check `planning/ROADMAP.md` existence → informs N-03 branches.
2. Check `.plan-execution/loops/` entries → informs N-02 (tight loop present).
3. Attempt keyword match on any description passed as `$ARGUMENTS`.

## Distinguishing from Sibling Commands

| Command | Audience | Purpose |
|---------|----------|---------|
| `/loom-which` | Model-facing router | Interactive grilling tree to the right command |
| `/loom-do` | Natural-language dispatcher | Smart routing with no Q&A — guesses from a description |
| `/loom-reference` | Human browsing | Flat table of all Loom commands |

`/loom-which` is appropriate when the operator is unsure which Loom command fits their task and wants guided disambiguation.

## GR Compliance

| Rule | Implementation |
|------|----------------|
| GR-01 | Exactly one question per response (format template enforces this) |
| GR-02 | First branch bolded as recommended default in every question |
| GR-03 | All branches printed as numbered list before recommending |
| GR-04 | Step 0 reads codebase artifacts before asking |
| GR-05 | Question counter tracked; `STUCK_AT_GRILL_CAP` emitted at Q13 |

## Usage

```
/loom-which
/loom-which "I have a bug with a reproduction step"
```

## Related Pages

- [Grilling protocol](protocol-grilling.md)
- [/loom-deepen](command-loom-deepen.md)
- [/loom-prototype](command-loom-prototype.md)
