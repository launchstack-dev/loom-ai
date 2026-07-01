---
description: Parallel UI variant board — generate N candidates on distinct axes, render side-by-side via /loom-browser (fallback to files), capture preference with capturedAt, decay old preferences at 90d/180d
---

# /loom-design:shotgun

Runs the M-13 F-24 parallel UI variant board with time-decaying taste
memory.

## What it does

1. Accept a prose description of the target UI and an optional
   `--n <count>` (default 4).
2. Read `.loom/design/preferences.toon`, apply decay
   (90-day weight-down, 180-day drop-out), and use the surviving
   weighted preferences as a soft bias for axis selection.
3. Generate N variants on **distinct** axes (minimalist, dense,
   brutalist, editorial by default; other axes if the target calls for
   them). Each variant runs through the F-23 pipeline so it inherits
   Pretext-native rules and anti-slop guards.
4. Render side-by-side:
   - Preferred: hand off to the `/loom-browser` daemon (M-11).
   - Fallback (daemon stopped/crashed/absent): write each variant to
     `.loom/design/shotgun/{slug}/variant-{n}.html` and print the paths.
5. Prompt the user to pick a winner. Append a record to
   `.loom/design/preferences.toon` (atomic `.tmp` + rename) with a
   `capturedAt` ISO-8601 timestamp, slug, winning variant number,
   winner axis, and rejected axes.

## Output

- `.loom/design/shotgun/{slug}/variant-*.html` (fallback path)
- `.loom/design/preferences.toon` (appended)

## Acceptance

- Preference records MUST carry a `capturedAt` timestamp. (Plan S-01)

## See also

- `skills/loom-design-shotgun/SKILL.md`
- `skills/loom-browser/SKILL.md`
- `commands/loom-design.md`
