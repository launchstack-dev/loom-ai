---
description: Import real Chrome cookies into the loom-browser daemon for authenticated live-site QA
---

# /loom-setup:browser-cookies

Import cookies from the operator's local Chrome / Chromium / Brave / Edge
profile into `.loom/browser/cookies/{domain}.toon` so `/loom-browser start`
can load them into the headless daemon on next boot.

## When to run

- Once per project after configuring the domain list
- Whenever cookies expire and `/loom-browser start` emits a stale-cookie diagnostic
- After signing in as a new test user in your local browser

## Domain list

Write the domains you want to import to `.loom/browser/cookie-domains.toon`:

```
domains[2]: example.com, api.example.com
```

## Usage

```bash
bunx tsx scripts/loom-import-cookies.ts
```

## Output

- `.loom/browser/cookies/{domain}.toon` per domain (gitignored)
- One row per cookie with `name`, `value`, `path`, `expiresAt`, `httpOnly`, `secure`, `sameSite`

## Requirements

- `chrome-cookies-secure` npm package (install with `bun add -d chrome-cookies-secure`)
- Read access to the local browser cookie store (macOS may prompt for keychain)

If the library is missing, the script exits non-zero with an install hint.

## Security

`.loom/browser/cookies/` is in `.gitignore` — never commit cookies. Treat
them as session-authentication material.

## See also

- `skills/loom-setup-browser-cookies/SKILL.md`
- `commands/loom-browser.md`
