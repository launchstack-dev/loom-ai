---
description: Persistent Chromium daemon — start, stop, status, exec with tiered READ/WRITE/META semantics
---

# /loom-browser

Persistent Chromium daemon (M-11 F-33) shared by `/loom-qa`, `/loom-devex:review`,
`/loom-cso`, `/loom-design:*`, and `/loom-benchmark`.

## Subcommands

| Subcommand | Tier | Description |
|------------|------|-------------|
| `start`  | META  | Boot Chromium, write `.loom/browser/state.toon`, attach injection-defense hooks, load cookies from `.loom/browser/cookies/*.toon`. |
| `stop`   | META  | Terminate the daemon and mark state stopped. |
| `status` | META  | Print current phase — stopped, running, or crashed. |
| `exec`   | READ or WRITE | Run one command against the running daemon. See tier semantics below. |

## Tier semantics

- **READ** (idempotent, cacheable, parallelizable): screenshots, DOM queries, a11y snapshot, network log dump.
- **WRITE** (side-effecting, must be sequenced): click, type, navigate, form submit, file upload.
- **META** (daemon lifecycle, exclusive): start/stop, config change, cookie import.

## Prompt-injection defense

The daemon exposes an `onPageText(pageText, url)` hook that fires on every
page load. In M-11 the hook is a no-op; M-05 F-15 wires it to
`agents/code-llm-trust-review-agent.md` to detect prompt-injection signatures
and emit `BROWSER_INJECTION_BLOCKED`.

## Accessibility-tree refs

Downstream agents reference elements by `{role, name, index}` tuples from the
a11y tree — not raw CSS selectors. This keeps refs stable across style
refactors.

## Usage

```bash
bunx tsx scripts/loom-browser-daemon.ts start
bunx tsx scripts/loom-browser-daemon.ts status
bunx tsx scripts/loom-browser-daemon.ts exec "goto https://example.com"
bunx tsx scripts/loom-browser-daemon.ts stop
```

## Chromium binary

Wraps the operator's existing Chrome/Chromium/Brave/Edge install
(no binary bundled). Detection order — `$CHROME_PATH`, then platform-standard
paths. If no binary is found, degrades to **stub mode**: commands are logged
to `.loom/browser/queue.toon` for manual replay.

## State file

`.loom/browser/state.toon` — schema per `protocols/browser-state.schema.toon`.
Fields: `daemonPid`, `daemonPort`, `startedAt`, `chromiumBinaryPath`,
`cdpEndpoint`, `activeTabs[]`, `cookiesLoaded`, `injectionDefenseEnabled`.

## See also

- `skills/loom-browser/SKILL.md` — full spec
- `skills/loom-setup-browser-cookies/SKILL.md` — cookie import
- `commands/loom-setup/browser-cookies.md` — cookie import subcommand
