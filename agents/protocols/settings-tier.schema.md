---
schemaVersion: 1
name: settings-tier
description: SettingsTier enum and TierResolution algorithm used by `register-loom-hooks.ts --tier` and `/loom-doctor` tier checks.
---

# Settings Tier Schema

Defines the four Claude Code settings tiers, their precedence, and the `TierResolution` algorithm that maps `--tier auto` plus existing-entry state to a concrete write target.

## TOON Exemplar

```toon
SettingsTier:
  values[4]: user, project, local, managed
  precedence[4]: managed, project, local, user
  defaultForRegister: local

TierResolution:
  inputs:
    explicitFlag: auto                  # auto | local | project | null
    existingLocalEntries: false
    existingProjectEntries: false
  output:
    chosenTier: local
    reason: default
    conflictDetected: false
```

## SettingsTier Enum

| Value | File | Description |
|---|---|---|
| `user` | `~/.claude/settings.json` | Global per-user. Loom NEVER writes here. |
| `project` | `.claude/settings.json` | Committed to repo. Team-wide opt-in. |
| `local` | `.claude/settings.local.json` | Gitignored, machine-local. **Default for `register-loom-hooks.ts`.** |
| `managed` | `/Library/Application Support/ClaudeCode/managed-settings.json` | MDM policy. Out of scope for M-07. |

### Precedence

```toon
precedence[4]: managed, project, local, user
```

Higher in the list wins. Loom-side note: `local` overrides `user` (Claude Code's documented behavior), which is why machine-local registration is safe even when a user-level settings file is present.

## TierResolution Algorithm

```toon
TierResolution:
  inputs:
    explicitFlag: string?         # auto | local | project | null
    existingLocalEntries: bool
    existingProjectEntries: bool
  output:
    chosenTier: string            # local | project
    reason: string                # explicit | preserve-prior | default | conflict-refused
    conflictDetected: bool
```

### Resolution Rules (in order)

1. If `explicitFlag in (local, project)` → `chosenTier = explicitFlag`, `reason = explicit`.
2. Else if `existingLocalEntries && existingProjectEntries` → `conflictDetected = true`, `reason = conflict-refused`. Surface `MIGRATION_TIER_AMBIGUOUS`; do not write.
3. Else if `existingLocalEntries XOR existingProjectEntries` → `chosenTier = (whichever has entries)`, `reason = preserve-prior`.
4. Else (fresh project, no prior Loom entries) → `chosenTier = local`, `reason = default`.

> **Note:** `--tier auto` resolves to `local` for **fresh projects** (rule 4) and preserves prior choice for **existing projects** (rule 3). This is the F-17 tier flip behavior: previously Loom defaulted to `project`; now it defaults to `local` for fresh installs while never silently moving prior project-tier entries.

## Consumer Cross-Reference

```toon
consumers[1]{wave,agent,role}:
  wave-3,wave-3-tier-agent,implements-resolution-in-scripts/register-loom-hooks.ts-and-tests-in-test/tier-resolution.test.ts
```

## Cross-References

- `doctor-report.schema.md` — `DoctorReport.tier` uses this enum; `MIGRATION_TIER_AMBIGUOUS` surfaces `conflict-refused`.
- `migration-evidence.schema.md` — `source.path` resolves through this tier mapping.
