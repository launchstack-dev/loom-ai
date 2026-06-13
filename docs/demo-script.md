# 90-Second Demo — Recording Script + Capture Instructions

This is the storyboard for Loom's pinned demo. **It is not the recording itself** — the `.cast` file has to be captured by Jensen on a clean session. Follow the script below verbatim so the recording is reproducible.

The goal is **one wow moment in 90 seconds**: a user types a small task description and watches Loom catch an impact they didn't know about, before any code ships.

---

## Why asciinema (not video)

- Text-based: embeds inline in README, replays at any speed, searchable.
- No editing burden — single take.
- Re-recordable in 5 minutes when commands change.
- Hosts on asciinema.org for free, with an SVG embed.

If we eventually want a polished video (3-5 min, voiceover, scope-drift-getting-caught arc) for HN/Twitter, do that AFTER the asciinema is live and the warm users have validated the flow.

---

## Setup (before recording)

1. **Clean terminal**: iTerm or Terminal.app, font size **16+**, color scheme high-contrast (Dracula or default-dark). Window sized to **100×30**. Anything narrower truncates Loom's status line.
2. **Clean project**: use `examples/billing-api/` (created in this kit). Pre-run `/loom-init --audit-only` so wiki is seeded. Don't actually commit init artifacts — we want the recording to start from a known state.
3. **Install asciinema**: `brew install asciinema` (or apt / pip equivalent).
4. **Pre-test the script**: run the commands once before recording. The hero moment depends on Loom's actual behavior at this version; if anything has drifted, fix the script before capturing.

---

## The recording (90 seconds)

```bash
asciinema rec docs/demo.cast \
  --title "Loom catches an impact you didn't know about" \
  --idle-time-limit 2 \
  --rows 30 --cols 100
```

`--idle-time-limit 2` collapses any pause longer than 2 seconds — so your thinking pauses don't bloat the recording.

### Script (type exactly this, in this order)

**[0:00 — Frame the scene]** Run this **outside the recording** as voice-over equivalent (drop into README copy):

> "I made a small change to a refund calculation. Watch Loom catch what I missed."

**[0:00–0:05]** Show the working directory once:

```bash
ls
# (shows ROADMAP.md, PLAN.md, src/, .loom/, planning/)
```

**[0:05–0:15]** Trigger the task:

```
/loom-quick "fix the rounding bug in refund calc"
```

**[0:15–0:35]** Loom prints `Mode: standalone`, then gathers context. You'll see lines like:

```
Reading CLAUDE.md...
Querying wiki: refund calc → 3 candidate pages
Component match: src/billing/refund.ts (high confidence)
Flow match: flow-refund-flow (exercises: refund.ts, invoice.ts)
```

**[0:35–0:55]** Loom executes — edits the file. Quick.

**[0:55–1:20] — THE HERO MOMENT.** The post-execution impact assessment fires:

```
Impact Assessment:
  risk:           medium
  scope:          cross-module
  regressionAreas: invoice issuance, monthly statements
  related wiki:   component-billing, flow-refund-flow, flow-monthly-billing
```

The point: **the user only asked about refund rounding. Loom flagged that monthly statements probably also need re-verifying.** That's the wow.

**[1:20–1:30]** The summary block lands:

```
--- Quick Task Complete ---
Mode:         standalone
Task:         fix the rounding bug in refund calc
Files:        src/billing/refund.ts
Impact:       medium risk, cross-module scope
Regression:   invoice issuance, monthly statements
Verification: pass
Log:          planning/history/quick-tasks/2026-06-13-fix-the-rounding-bug.toon
Commit:       (pending)
```

Press Ctrl-D to stop recording.

---

## Post-recording

1. **Trim the front and tail** if there's dead space:
   ```bash
   asciinema cat docs/demo.cast | head -1   # check header
   # Use https://github.com/cirocosta/asciinema-edit if you need to cut
   ```
2. **Upload** (optional but recommended for the embedded SVG player):
   ```bash
   asciinema upload docs/demo.cast
   # Returns a URL like https://asciinema.org/a/XXXXXXX
   ```
3. **Embed in README** — add right after the status callout:
   ```markdown
   [![asciicast](https://asciinema.org/a/XXXXXXX.svg)](https://asciinema.org/a/XXXXXXX)
   ```
   The SVG renders inline on GitHub and clicks through to the playable recording.
4. **Also link from `docs/first-30-minutes.md`** under "Before you start" so users can preview before installing.
5. **Commit** `docs/demo.cast` to the repo (it's text, diffs cleanly).

---

## When to re-record

- `/loom-quick` output format changes (the `--- Quick Task Complete ---` block).
- Impact assessment fields change shape.
- The wiki query output changes.
- You realize the hero moment doesn't land for someone watching cold (test with a warm user).

Recording takes ~5 minutes once setup is in place. Don't preserve a stale recording for sentimental reasons.

---

## What to skip

- **Voiceover** — adds an editing dependency that kills the "re-record in 5 min" property. The README caption is the voiceover.
- **Multiple scenarios in one recording** — kill the demo's pacing. One scene, one wow.
- **The full `/loom-auto` pipeline** — too long for a 90s demo. Do that as a separate longer video later if needed.

---

## Acceptance check

Show the recording to ONE warm user **before installing Loom**. Ask: "After watching that, what does Loom do?"

- If they say something like "it catches impacts of small changes" or "it gives you a paper trail" — demo works.
- If they say "I don't know" or describe something the recording didn't show — re-shoot or rewrite the framing.
