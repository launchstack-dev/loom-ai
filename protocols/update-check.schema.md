---
schemaVersion: 1
name: update-check
description: UpdateCheck — structured output of `/loom-update --check --json`, consumed by the statusline update indicator and CI freshness gates.
---

# Update Check Schema

Canonical schema for the JSON output of `/loom-update --check --json`. The same fields are emitted in TOON when `--json` is omitted. Produced by `scripts/loom-update.ts` (Phase 9A2) and consumed by the statusline renderer and CI workflows that gate on plugin freshness.

## TOON Exemplar

```toon
UpdateCheck:
  schemaVersion: 1
  currentVersion: 0.3.1
  latestVersion: 0.4.0
  behind: 3
  pinnedVersion: null
  generatedAt: 2026-06-17T12:34:56Z
  channel: plugin
```

## Top-Level Fields

| Field | Required | Type | Description |
|---|---|---|---|
| schemaVersion | yes | int | Currently `1`. Bumped on breaking shape changes. |
| currentVersion | yes | string | Semver of the locally installed Loom plugin (e.g. `0.3.1`). Must satisfy `^\d+\.\d+\.\d+(-[\w.]+)?$`. |
| latestVersion | yes | string | Semver of the newest release advertised by the marketplace manifest. Same regex as `currentVersion`. |
| behind | yes | int | Number of released versions between `currentVersion` and `latestVersion`. Always `>= 0`. Zero means current is at or ahead of latest. |
| pinnedVersion | yes | string \| null | If the user pinned a version via `~/.loom/install.toon`'s `pin:` field, the pinned semver; otherwise `null`. When non-null, `/loom-update --apply` is a no-op unless `--force` is passed. |
| generatedAt | yes | iso8601 | UTC timestamp when the check was performed. |
| channel | yes | enum | `plugin` \| `curl` — which install channel the local environment is using. |

## Output Forms

- **TOON (default):** Top-level key `UpdateCheck:` with nested fields as shown above.
- **JSON (`--json`):** Flat object `{"schemaVersion":1, "currentVersion":"...", "latestVersion":"...", "behind":3, "pinnedVersion":null, "generatedAt":"...", "channel":"plugin"}`.

## Exit Codes

| Code | Meaning |
|---|---|
| 0 | Check succeeded — fields are valid. `behind == 0` and `behind > 0` both exit 0. |
| 1 | Network or manifest error — output is omitted or empty. |
| 2 | Local install state is corrupt or unreadable. |

## Consumers

- **Statusline** (`scripts/loom-statusline.ts`): reads cached UpdateCheck and renders `⏶ N` indicator when `behind > 0` and `pinnedVersion == null`.
- **CI freshness gates** (`.github/workflows/refresh-upstream-schemas.yml` and similar): fail the workflow when `behind > threshold`.
- **`/loom-doctor`**: includes the most recent UpdateCheck under `checks[].evidence` for the `channel-upgrade-available` check.

## Notes

- `behind` is purely numeric distance; it does not encode major/minor/patch semantics. A consumer wanting "major version drift" must parse the semver strings.
- `pinnedVersion` is read from the channel envelope at `~/.loom/install.toon`, not from the v3 component inventory at `~/.claude/skills/library/install-state.toon`.
