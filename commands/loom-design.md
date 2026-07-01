---
description: Design dispatcher — subcommands run ground-up brand kickoff (consultation), production HTML/CSS from mockup (html), and parallel UI variants with taste memory (shotgun). Shipped by M-13 (gstack adoption Phase 13).
---

# /loom-design

Dispatcher for build-time design commands. Each subcommand produces a
durable artifact that later subcommands can consume.

## Subcommands

| Subcommand | Purpose | Ships in |
|------------|---------|----------|
| `consultation` | Ground-up brand kickoff — 5-phase interview producing a design premise under `.loom/design/`. Consults `.loom/learnings.toon` (domain: design) for prior cross-project decisions. | M-13 (F-22) |
| `html` | Ship production HTML/CSS from a prose or image mockup using Pretext-native rules and Phase 5 F-14 anti-AI-slop guards. Emits to `docs/design/{slug}/`. | M-13 (F-23) |
| `shotgun` | Fire N parallel UI variants (default 4) on distinct axes, render side-by-side via `/loom-browser` (fallback: files under `.loom/design/shotgun/{slug}/`), capture preference with `capturedAt`, decay at 90 d / 180 d. | M-13 (F-24) |

## Usage

```bash
/loom-design consultation
/loom-design html
/loom-design shotgun
```

## See also

- `commands/loom-design/consultation.md`
- `commands/loom-design/html.md`
- `commands/loom-design/shotgun.md`
- `skills/loom-design-consultation/SKILL.md`
- `skills/loom-design-html/SKILL.md`
- `skills/loom-design-shotgun/SKILL.md`
