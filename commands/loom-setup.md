---
description: Setup dispatcher — subcommands prepare project-local resources (cookies, credentials, fixtures) that downstream Loom commands consume
---

# /loom-setup

Dispatcher for one-time project-local setup tasks. Each subcommand primes
resources that other Loom commands read at run time.

## Subcommands

| Subcommand | Purpose | Ships in |
|------------|---------|----------|
| `browser-cookies` | Import real Chrome/Chromium/Brave/Edge cookies into `.loom/browser/cookies/{domain}.toon` for authenticated live-site QA. | M-11 (F-34) |

Additional subcommands may be added by future milestones — treat this file as
a stable dispatcher with an open extension slot.

## Usage

```bash
# See subcommand entries under commands/loom-setup/
/loom-setup browser-cookies
```

## See also

- `commands/loom-setup/browser-cookies.md`
- `skills/loom-setup-browser-cookies/SKILL.md`
