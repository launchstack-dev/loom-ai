# DismissedInitPrompt Schema

Canonical TOON schema for the per-project file at `.loom/dismissed-init-prompt`. Written when the user dismisses the F-02 pre-init no-op prompt; suppresses subsequent prompts for 24 hours, after which the file's `dismissedAt` is considered expired and the prompt is shown again.

Paired TypeScript type: `hooks/lib/types/dismissed-init-prompt.ts`.

## Fields

| Field | Type | Constraints | Validation Rules |
|-------|------|-------------|-----------------|
| dismissedAt | string | ISO 8601, required | suppression expires 24h after |

## Indexes / Cascade

Singleton per project; not applicable.

## TOON Reference Example

```toon
dismissedAt: 2026-06-15T10:00:00Z
```
