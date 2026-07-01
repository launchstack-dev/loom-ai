---
name: loom-browser
description: Persistent Chromium daemon at .loom/browser/ with tiered READ/WRITE/META command semantics, accessibility-tree refs, anti-bot stealth stubs, and prompt-injection defense hooks.
---

# /loom-browser — Persistent Chromium Daemon (M-11)

`/loom-browser` gives Loom a long-lived headless (or headed) Chromium session
that downstream commands share instead of each cold-starting their own browser.
It is the substrate that `/loom-qa` (M-07), `/loom-design:*` (M-13), and
`/loom-benchmark` (M-08 F-27) build on.

## Subcommands

| Subcommand | Tier | Effect |
|------------|------|--------|
| `/loom-browser start` | META | Boot Chromium, write `.loom/browser/state.toon`, attach injection defense hooks, load per-domain cookies from `.loom/browser/cookies/*.toon` if present. |
| `/loom-browser stop`  | META | Terminate the daemon, mark `state.toon` `stopped`. |
| `/loom-browser status`| META | Print current daemon state — `stopped`, `starting`, `running`, `stopping`, `crashed`. |
| `/loom-browser exec <cmd>` | READ or WRITE | Run one command against the running daemon. See tier table below. |

## State — `.loom/browser/state.toon`

Written on `start`, updated on tab changes, deleted (or marked `stopped`) on
`stop`. Schema — `protocols/browser-state.schema.toon` (Phase 0):

```
schemaVersion: 1
daemonPid: 47213
daemonPort: 9222
startedAt: 2026-06-30T14:22:05Z
chromiumBinaryPath: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
cdpEndpoint: ws://127.0.0.1:9222/devtools/browser/abc123
activeTabs[1]{tabId,url,title}:
  T-01,https://example.com,Example Domain
cookiesLoaded: true
injectionDefenseEnabled: true
```

If `daemonPid` is present but the OS process is gone, the daemon is `crashed`
and a subsequent `start` will clean up before booting.

## Tier semantics

Loom commands classify every browser operation into one of three tiers. This
tiering is what lets us cache aggressively, replay safely, and reason about
side effects.

### READ (idempotent)

Safe to retry, safe to parallelize, cacheable.

- Screenshot (`page.screenshot`)
- DOM query (`page.$eval`, `page.evaluate`)
- Accessibility-tree fetch (`page.accessibility.snapshot()`)
- Network request log dump
- Console log dump
- URL / title read

### WRITE (side-effecting)

Mutates page state or navigates. Must be sequenced, not parallelized.

- Click, type, hover, drag
- Navigate (`page.goto`)
- Form submit
- File upload / download

### META (daemon-lifecycle)

Affects the daemon itself, not any page. Must not run while READ/WRITE
operations are in flight.

- start / stop / restart
- Config change (viewport, user-agent)
- Cookie import (see `/loom-setup:browser-cookies`)
- Extension load

## Accessibility-tree refs

Downstream agents reference DOM elements by a **role+name+index tuple** from
the accessibility tree, **not** raw CSS selectors:

```
{role: "button", name: "Sign in", index: 0}
```

This keeps refs stable across style refactors and legible to reviewers. When
an element has no accessible name, the daemon synthesizes one from the nearest
label or heading; the synthesis rule is recorded in the WRITE trace so a
future retro can catch cases where the synthesized name drifted.

## Anti-bot stealth stubs

M-11 ships **stub** stealth hooks — enough to unbreak most `navigator.webdriver`
sniff tests and consistent user-agent handling, but not a full evasion suite.
The stubs are:

- `navigator.webdriver` set to `undefined`
- Realistic `navigator.plugins` / `navigator.languages`
- WebGL vendor / renderer overrides seeded from the wrapped user install

Full evasion (canvas fingerprinting randomization, TLS fingerprint tuning) is
explicit **Out of Scope** for M-11 and left to future milestones.

## Prompt-injection defense hooks

PLACEHOLDER — full integration lands with **M-05 F-15 llm-trust review**
(see `agents/code-llm-trust-review-agent.md`, shipped in Phase 5).

The daemon exposes a hook point that fires on every page load with the
extracted page text. In M-11 the hook is wired to a no-op. In M-05 F-15 the
hook will pipe page text through the llm-trust agent's untrusted-text
tainting rules and surface `BROWSER_INJECTION_BLOCKED` when a prompt-injection
signature is detected.

Hook shape (stable contract — do not rename):

```
onPageText(pageText: string, url: string) => { ok: boolean, findings: Finding[] }
```

## Chromium binary policy

M-11 **wraps the existing user Chromium/Chrome install** — it does not bundle
a binary. Detection order — macOS: `/Applications/Google Chrome.app`,
`/Applications/Chromium.app`, `$CHROME_PATH`. Linux: `google-chrome`,
`chromium`, `chromium-browser`. Windows: `%PROGRAMFILES%\Google\Chrome`.

If no binary is found, `/loom-browser start` emits `BROWSER_ALREADY_RUNNING`
or a related `BROWSER_NO_BINARY` diagnostic and falls back to **stub mode**
(queue-only — commands are written to `.loom/browser/queue.toon` for the
operator to run manually). This keeps M-11 best-effort so downstream milestones
can still emit useful plans in CI environments without a browser.

## Downstream consumers

- **M-07 `/loom-qa`** — live-site iterative test/fix loop
- **M-07 `/loom-devex:review`** — live DX audit with real TTHW measurement
- **M-07 `/loom-cso`** — two-tier live security review
- **M-13 `/loom-design:*`** — HTML → design consultation → shotgun screenshot compare
- **M-08 F-27 `/loom-benchmark`** — comparative live-site benchmark harness

Each of these commands may only issue tier-appropriate operations and MUST
respect the READ/WRITE serialization contract above.
