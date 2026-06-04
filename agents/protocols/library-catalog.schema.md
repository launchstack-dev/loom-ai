# Library Catalog Schema (v3)

Canonical schema for `skills/library.yaml` — the Loom catalog. Defines what kinds of artifacts can be registered, version-compat fields, and how `/loom-library` resolves them.

## Versions

- **v1** (deprecated): early catalog, no kit support.
- **v2** (current): adds `kits:` section with kit name, description, version, `minLoomVersion`, `includes[]`, `command`, `suggestedConfig`. See `kit.schema.md`. No kit-level version-compat machinery for hooks/core.
- **v3** (this doc): adds `minHooksVersion` / `minCoreVersion` to kit entries; introduces a `releases:` block listing the canonical release artifacts (tarball URL + cosign signature); formalizes catalog item types.

## v3 Top-Level Format

```yaml
catalog_version: 3
repo: https://github.com/launchstack-dev/loom-ai
loomCoreVersion: 0.1.0
loomHooksVersion: 0.1.0

releases:
  - version: 0.1.0
    coreTarball: https://github.com/launchstack-dev/loom-ai/releases/download/v0.1.0/loom-core-v0.1.0.tar.gz
    hooksTarball: https://github.com/launchstack-dev/loom-ai/releases/download/v0.1.0/loom-hooks-v0.1.0.tar.gz
    cosignSignature: https://github.com/launchstack-dev/loom-ai/releases/download/v0.1.0/loom-core-v0.1.0.tar.gz.sig
    sha256Manifest: https://github.com/launchstack-dev/loom-ai/releases/download/v0.1.0/SHA256SUMS
    releasedAt: 2026-05-07T00:00:00Z

default_dirs:
  skills:
    - default: .claude/skills/
    - global: ~/.claude/skills/
  agents:
    - default: .claude/agents/
    - global: ~/.claude/agents/
  prompts:
    - default: .claude/commands/
    - global: ~/.claude/commands/

library:
  skills:
    - name: ...
      description: ...
      source: ...
  agents:
    - ...
  prompts:
    - ...

kits:
  - name: data-engineering
    description: Data pipeline quality gates, schema review, lineage tracking, and test generation
    version: 1.1.0
    minLoomVersion: 3
    minCoreVersion: 0.1.0       # NEW in v3
    minHooksVersion: 0.1.0      # NEW in v3
    includes:
      - data-schema-reviewer
      - data-test-generator
      - data-pipeline-agent
    command: loom-data.md
    suggestedConfig: kits/data-engineering/orchestration-fragment.toml
```

## v3 Top-Level Fields

| Field | Required | Type | Description |
|---|---|---|---|
| catalog_version | yes | int | Schema version. v3 = `3`. |
| repo | yes | URL | Canonical Git repository for the catalog. |
| loomCoreVersion | yes | semver | The version of `loom-core` this catalog targets. Installer uses this to choose the right release. |
| loomHooksVersion | yes | semver | The version of `loom-hooks` this catalog targets. |
| releases | yes | list | Available release artifacts. See below. |
| default_dirs | yes | object | Per-type install path defaults (unchanged from v2). |
| library | yes | object | Per-type item index (unchanged from v2). |
| kits | yes | list | Kit registry. See `kit.schema.md` for the kit entry schema; v3 adds `minCoreVersion` and `minHooksVersion`. |

## `releases[]` Entry

Each entry describes one published version of Loom. The installer downloads the tarball pointed to here, verifies the cosign signature, and unpacks per `install-state.schema.md`.

| Field | Required | Type | Description |
|---|---|---|---|
| version | yes | semver | Release version. Matches a Git tag in `repo`. |
| coreTarball | yes | URL | Signed tarball containing `loom-core` files. |
| hooksTarball | yes | URL | Signed tarball containing `loom-hooks` files. |
| cosignSignature | yes | URL | Cosign keyless signature for `coreTarball`. Verified using GitHub OIDC issuer + repo identity. |
| sha256Manifest | yes | URL | SHA256SUMS manifest for additional integrity check. |
| releasedAt | yes | ISO 8601 | Release timestamp. |

Why both cosign and SHA256: cosign is the trust anchor; SHA256SUMS is a belt-and-suspenders check that survives if cosign verification tooling is broken in a user's environment.

## Kit Entry Additions (v3)

Kits gain two new optional fields. See `kit.schema.md` for the full kit schema.

| Field | Required | Type | Description |
|---|---|---|---|
| minCoreVersion | no | semver | Minimum installed `loom-core` version required for this kit. If unmet, kit installation is blocked with a prompt to upgrade core. |
| minHooksVersion | no | semver | Minimum installed `loom-hooks` version required for this kit. If unmet, kit installation is blocked with a prompt to upgrade hooks. Because hook upgrades require explicit user confirmation (`/loom-upgrade --hooks`), this prompt surfaces a diff and waits for consent. |

## Resolution Algorithm (v3)

When a user runs `/loom-library use <kit-name>`:

```
1. Read library.yaml v3 catalog.
2. Find kit entry by name.
3. Read install-state.toon v3.
4. Check kit.minCoreVersion against install-state.loomCoreVersion:
   - If unmet: prompt user to /loom-upgrade core. Block kit install.
5. Check kit.minHooksVersion against install-state.loomHooksVersion:
   - If unmet: prompt user to /loom-upgrade --hooks (which shows diff, requires confirmation). Block kit install.
6. Check kit.minLoomVersion against catalog.catalog_version:
   - If unmet: prompt user to upgrade Loom (covers core, hooks, catalog together).
7. If all checks pass, install kit items per existing v2 flow.
```

The same algorithm runs at `loom-core` startup against the currently-installed kits — if any kit's `minCoreVersion` or `minHooksVersion` becomes unmet (e.g., due to a partial rollback or external state corruption), surface a warning at startup with remediation steps.

## Migration: v2 → v3

```
v2 → v3 catalog migration:
1. Read v2 library.yaml (catalog_version: 2).
2. Add catalog_version: 3.
3. Add loomCoreVersion and loomHooksVersion (default to current installed values).
4. Add releases[] with at least the current release (URLs derived from repo + version tag).
5. For each kit in kits[], leave minCoreVersion and minHooksVersion absent — implies "no constraint."
   Maintainers will fill these in over subsequent kit version bumps.
6. Write atomically.
```

v3 is backward-compatible at the catalog level: kits without `minCoreVersion` / `minHooksVersion` simply skip those checks, behaving as in v2.

## Atomic Write Discipline

Same as `install-state.schema.md`: write to `.tmp`, then `rename(2)`. The catalog is fetched and written by the installer; partial fetches are caught by SHA256 manifest verification before write.

## Discovery

Registered in v3 `library.yaml` as the `library-catalog-schema` skill, source `agents/protocols/library-catalog.schema.md`.
