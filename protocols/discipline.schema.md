# Discipline Profile Schema

Defines the capability-gated discipline profile that decides which Loom enforcement
layers are active in a session. This is the single conditional seam mandated by the
Fable Readiness roadmap (`planning/ROADMAP-fable-readiness.md`, C-01/C-02): one
writer (`/loom-doctor --resolve-profile`), one reader (`hooks/lib/discipline.ts`),
many consumers (hooks self-bail via `hookActive()`).

No hook, agent, or command may branch on a model name or perform its own profile
detection. The only files allowed to contain profile-resolution logic are
`hooks/lib/discipline.ts` and the doctor resolver.

## Config Schema

Lives in `.claude/orchestration.toml`:

```toml
[settings.discipline]
profile = "auto"        # auto | strict | standard | minimal
# resolved = "standard" # written by `/loom-doctor --resolve-profile`; only read when profile = "auto"

[settings.discipline.tierOverrides]
# Per-agent-tier floors, applied to tier-sensitive hooks regardless of session profile.
haiku = "standard"      # cheap-tier subagents keep file-ownership enforcement
```

| Key | Type | Default | Meaning |
|---|---|---|---|
| `profile` | string | `auto` | User pin. Any value other than `auto` is authoritative. |
| `resolved` | string | (absent) | Doctor-probed result, consulted only when `profile = "auto"`. |
| `tierOverrides.<tier>` | string | `haiku = "standard"` (built-in) | Minimum profile applied to tier-sensitive hooks when an agent of `<tier>` is active. |

## Profiles

Profiles are ordered by strictness: `minimal` < `standard` < `strict`.

| Profile | Layers active | Intended environment |
|---|---|---|
| `strict` | core + engine (markdown fallback) + scaffold | Today's Loom; harnesses without Workflow/auto-compaction |
| `standard` | core + engine (Workflow) | Current Claude Code + Opus/Sonnet-class sessions |
| `minimal` | core only (session-level) | Fable-class sessions; engine trusts the native Workflow tool |
| `auto` | resolves to one of the above | Fresh-install default |

## Resolution Algorithm

Implemented once, in `hooks/lib/discipline.ts` → `resolveProfile()`:

1. `LOOM_DISCIPLINE_PROFILE` env var, if set to a valid profile (test/debug escape hatch,
   mirrors the `LOOM_SKIP_*` convention).
2. `profile` key, if set to `strict` | `standard` | `minimal` (explicit user pin).
3. `profile = "auto"` (or absent): use `resolved` if present and valid.
4. Otherwise → **`strict`**.

Rule 4 is the C-06 no-surprise guarantee: an existing install with no
`[settings.discipline]` section — or any unparseable/invalid value — behaves exactly
as Loom does today. This is deliberately fail-strict, not fail-open: in an
enforcement product, a config error must never silently turn enforcement off.
No migration rewrites the user's config; the default lives in the reader.

## Layer Membership

The authoritative resource-level membership list is the three kits in
`skills/library.yaml` (`loom-core`, `loom-engine`, `loom-scaffold`). Hook-level
gates are the `HOOK_GATES` table in `hooks/lib/discipline.ts`:

| Hook | Layer | Active when profile ≥ | Notes |
|---|---|---|---|
| deploy-guard | core | minimal | always on |
| typecheck-on-write | core | minimal | always on |
| shellcheck-on-write | core | minimal | always on |
| bash-portability-on-write | core | minimal | always on |
| pylint-on-write | core | minimal | always on |
| contract-lock | core | minimal | always on |
| wiki-session-status | core | minimal | always on |
| wiki-write-guard | core | minimal | always on |
| wiki-commit-ledger | core | minimal | always on |
| loom-migration | core | minimal | always on |
| file-ownership | core | standard | **tier-sensitive** — see below |
| quality-gate | core | minimal | always on (C-08/C-11): stage-gate today, becomes the acceptance re-validation gate in M-2 |
| context-budget | scaffold | strict | |
| budget-tracker | scaffold | strict | |
| context-monitor | scaffold | strict | |
| checkpoint-trigger | scaffold | strict | |
| status-updater | scaffold | strict | |
| wiki-impact-warner | scaffold | strict | throttle/injection machinery |

A hook name missing from `HOOK_GATES` is treated as core/always-on. Unknown never
means disabled.

## Tier Overrides (per-agent floors)

Loom deliberately runs cheap-tier models (haiku) on fixers and sweeps even when the
session model is frontier-class. Session-level profile relaxation must not strip
guards from those agents (roadmap C-01).

Mechanics:

- A hook gate marked `tierSensitive` computes its effective profile as
  `max(sessionProfile, tierOverrides[tier])` before comparing against its minimum.
- The active tier is supplied by the orchestrator via the **`LOOM_AGENT_TIER`**
  environment variable on spawn (values: `haiku` | `sonnet` | `opus` | custom tier
  names registered in `tierOverrides`).
- Built-in default floor: `haiku = "standard"`. Config `tierOverrides` entries
  override the built-in on a per-tier basis.

Example: session profile `minimal`, `LOOM_AGENT_TIER=haiku` → file-ownership's
effective profile is `standard` → out-of-boundary writes are still blocked.

Only `file-ownership` is tier-sensitive today. Session-scoped hooks (Stop-event
gates, monitors) ignore tier floors — a tier floor lifts per-agent enforcement,
not session choreography.

## Consumer Contract

Every gated hook adds exactly one line, immediately after its cheap input filters:

```typescript
import { hookActive } from "./lib/discipline.js";
// ...
if (!hookActive("context-budget")) return allow();
```

- `hookActive(name)` reads config relative to `process.cwd()` (same resolution as
  every other orchestration.toml consumer).
- Under `strict` every gate returns `true`, so strict behavior is byte-identical to
  pre-profile Loom.
- A bailed hook exits 0 with no stdout — zero prompt injections, zero blocks
  (roadmap metric "scaffold silence under minimal").

## Doctor Integration

- `/loom-doctor` includes a `discipline-profile` check reporting the configured,
  resolved, and effective profile.
- `/loom-doctor --resolve-profile` probes harness capabilities and writes
  `resolved = "<profile>"` into `[settings.discipline]` (atomic write: `.tmp` +
  rename). It never changes the `profile` key — pinning stays a human act.
- Probes are conservative: when a capability signal is absent or ambiguous, the
  resolver picks the stricter profile.

## Related

- `planning/ROADMAP-fable-readiness.md` — vision, locked decisions C-01..C-06
- `protocols/orchestration-config.schema.md` — full orchestration.toml schema
- `skills/library.yaml` — kit-level layer membership (`loom-core` / `loom-engine` / `loom-scaffold`)
