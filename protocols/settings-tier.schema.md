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
| `managed` | `/Library/Application Support/ClaudeCode/managed-settings.json` | MDM policy. **Immutable for Loom** — see "Managed Tier (Immutable)" below. |

## Managed Tier (Immutable)

The `managed` tier represents settings deployed by an MDM (Mobile Device Management) policy or other administrator-controlled mechanism. **Loom NEVER writes to the managed tier and NEVER modifies entries present there**, including under `/loom-doctor --fix`, `register-loom-hooks.ts`, and the SessionStart migration runner.

### Rules

1. **No writes.** No Loom code path may open `managed-settings.json` for write. The path is not in any Loom file-ownership manifest.
2. **No fix.** `/loom-doctor --fix` MUST skip any check whose `evidence.paths[]` resolves into the managed-settings path.
3. **Detection-only.** The `managed-tier-detected` check (see `doctor-report.schema.md` registry) emits an `info`-severity `MANAGED_TIER_DETECTED` finding when Loom entries are found in the managed tier. The finding informs the user that tier changes require their MDM admin; doctor does not propose remediation Loom can execute.
4. **Precedence semantics preserved.** The managed tier still wins on read precedence (`managed > project > local > user`) — Loom respects whatever the admin set; it just refuses to participate in modifying it.

### Cross-reference

- `doctor-report.schema.md` — `managed-tier-detected` check (category `tier`, severity `info`); `MANAGED_TIER_DETECTED` error code row.

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
