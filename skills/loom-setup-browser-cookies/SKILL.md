---
name: loom-setup-browser-cookies
description: Import real Chrome cookies into headless daemon for authenticated live-site QA. Interactive domain picker; per-project storage at .loom/browser/cookies/{domain}.toon with expiry tracking.
---

# /loom-setup:browser-cookies — Import Chrome Cookies (M-11 F-34)

Authenticated live-site QA (`/loom-qa`, `/loom-devex:review`) needs to sign in
as a real user. Rather than script an OAuth dance for every site, this
subcommand extracts cookies from the operator's **real** Chrome / Chromium /
Brave / Edge install and hands them to the `/loom-browser` daemon at boot.

This is a **boot-time** op — you run it **once** per project (or whenever
cookies expire); on the next `/loom-browser start`, the cookies are loaded
into the daemon automatically.

## Supported browsers

| Browser | macOS path | Linux path | Windows path |
|---------|------------|------------|--------------|
| Google Chrome | `~/Library/Application Support/Google/Chrome/Default/Cookies` | `~/.config/google-chrome/Default/Cookies` | `%LOCALAPPDATA%\Google\Chrome\User Data\Default\Cookies` |
| Chromium | `~/Library/Application Support/Chromium/Default/Cookies` | `~/.config/chromium/Default/Cookies` | `%LOCALAPPDATA%\Chromium\User Data\Default\Cookies` |
| Brave | `~/Library/Application Support/BraveSoftware/Brave-Browser/Default/Cookies` | `~/.config/BraveSoftware/Brave-Browser/Default/Cookies` | `%LOCALAPPDATA%\BraveSoftware\Brave-Browser\User Data\Default\Cookies` |
| Microsoft Edge | `~/Library/Application Support/Microsoft Edge/Default/Cookies` | `~/.config/microsoft-edge/Default/Cookies` | `%LOCALAPPDATA%\Microsoft\Edge\User Data\Default\Cookies` |

The cookie store is a SQLite file with the cookie values encrypted using an
OS-keychain-derived key. The script uses `chrome-cookies-secure` when
installed; otherwise it prints an instructive stderr message with the install
command.

## Domain picker

Two modes:

1. **Interactive** (default) — the script lists the top ~30 domains from the
   cookie store by cookie count and prompts the operator to select which to
   export.
2. **Config-driven** — if `.loom/browser/cookie-domains.toon` exists, the
   script reads the domain list from there and skips the prompt. Format:

   ```
   domains[3]: example.com, api.example.com, dashboard.example.com
   ```

## Output — `.loom/browser/cookies/{domain}.toon`

One file per domain. Each cookie row records `name`, `value`, `path`,
`expiresAt` (ISO 8601), `httpOnly`, `secure`, and `sameSite`.

```
schemaVersion: 1
domain: example.com
extractedAt: 2026-06-30T14:22:05Z
sourceBrowser: chrome
cookies[2]{name,value,path,expiresAt,httpOnly,secure,sameSite}:
  session,abc123def456,/,2026-07-30T14:22:05Z,true,true,lax
  csrf,xyz789,/,2026-07-30T14:22:05Z,false,true,strict
```

## Expiry tracking

Every cookie carries an `expiresAt`. The `/loom-browser start` boot path skips
cookies whose `expiresAt` is in the past and emits a diagnostic naming the
domain so the operator can re-run this command.

## Security — never commit cookies

`.loom/browser/cookies/` is added to `.gitignore` by Phase 7 wiring. Cookies
are session-authentication material and must never enter git history. If a
cookie file is accidentally committed, treat it like a leaked credential —
revoke the session on the source site and rotate.

## Downstream

Loaded by `/loom-browser start` on next boot; consumed transparently by
`/loom-qa`, `/loom-devex:review`, `/loom-cso`, and `/loom-design:*` when they
navigate to the matching domain.
