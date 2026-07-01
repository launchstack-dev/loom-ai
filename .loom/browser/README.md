# .loom/browser/

Runtime state for the persistent Chromium daemon shipped by M-11 F-33.

## Files

| File | Written by | Purpose |
|------|-----------|---------|
| `state.toon` | `/loom-browser start\|stop` | Daemon state per `protocols/browser-state.schema.toon` |
| `daemon.pid` | `/loom-browser start` | Convenience PID file mirror of `state.toon.daemonPid` |
| `queue.toon` | `/loom-browser` in stub mode | Append-only log of commands to replay manually when no browser binary is available |
| `cookies/` | `/loom-setup:browser-cookies` | Per-domain cookie files (**gitignored**) |
| `cookie-domains.toon` | operator (hand-edit) | Domain list consumed by cookie import — `domains[N]: a.com, b.com` |
| `profile/` | Chromium | Ephemeral user-data-dir used by the daemon |

## Tier semantics

Every browser operation is one of three tiers — this is the invariant every
downstream command must respect:

- **READ** — idempotent, cacheable, parallelizable (screenshot, DOM query, a11y snapshot)
- **WRITE** — side-effecting, must be sequenced (click, type, navigate)
- **META** — daemon lifecycle, exclusive (start/stop, config, cookie import)

Full spec: `skills/loom-browser/SKILL.md`.

## Do not commit

`.loom/browser/cookies/` and `.loom/browser/profile/` contain session
credentials and OS-specific state. Neither should enter git history —
enforced via `.gitignore`.
