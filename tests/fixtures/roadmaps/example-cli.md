# CLI Tool Roadmap

## vision

Build a fast, composable CLI toolkit for developers who value minimal footprint and deterministic behavior. The tool is a standalone binary that reads declarative config files and applies transforms to structured data pipelines. Target audience: solo developers and small teams who prefer configuration over convention.

Primary value: reproducible, version-pinned transforms executed locally without cloud dependencies.

## milestones

**M1 — Core Engine (Month 1-2)**
- Parse declarative transform configs (YAML)
- Execute sequential and parallel transform chains
- Structured output: JSON, TOON, plain text

**M2 — Plugin System (Month 3)**
- Plugin discovery via a well-defined entry-point convention
- Version pinning for plugin dependencies
- Plugin isolation: each plugin runs in its own subprocess

**M3 — Developer Experience (Month 4)**
- Watch mode with incremental re-runs
- Machine-readable progress output for CI integration
- Comprehensive --help with per-command examples

## tool-selection

- **Runtime:** Bun (fast startup, native TypeScript, built-in test runner)
- **Argument parsing:** `yargs` (well-tested, mature ecosystem)
- **Config parsing:** `yaml` npm package (streaming-safe for large configs)
- **Plugin isolation:** Node.js `child_process.fork` (ABI-stable, no native deps)
- **Test harness:** Vitest (compatible with Bun, supports worker-mode)

Selection rationale: all chosen tools are widely adopted in the Node/Bun ecosystem, have stable API surfaces, and avoid heavy native bindings that would complicate cross-platform distribution.

## data-model

**Transform** — the atomic unit of work
- `id`: string (kebab-case, unique within a config file)
- `type`: string (maps to a plugin entry-point)
- `inputs[]`: array of file-glob patterns or named transform output refs
- `outputs[]`: array of named output refs or file patterns
- `config`: arbitrary key-value bag passed to the plugin

**Pipeline** — a directed acyclic graph of Transforms
- `id`: string
- `transforms[]`: ordered list (topological sort applied at parse time)
- `version`: semver string

**PluginManifest** — metadata a plugin exposes
- `name`: string
- `version`: semver
- `entryPoint`: path to the plugin's main module

## success-metrics

- Cold-start time < 50ms for `--help` on M1 milestone hardware (MacBook Air M2)
- Transform chain of 10 sequential steps completes in < 500ms on a 10MB fixture
- All unit tests pass on every commit (CI enforced)
- Plugin API declared stable at M2 with a written deprecation policy
- Adoption target: 50 GitHub stars by end of M3

## constraints

- Must run on macOS (arm64, x86-64), Linux (x86-64, arm64), and Windows (x86-64)
- No cloud dependencies in the critical path (local-first)
- Binary distribution via `npm` global install; optional Homebrew tap at M3
- Plugin system must not require users to restart the CLI process to pick up new plugins
- All public APIs must be documented before M2 ships

## risks

**R1 — Plugin isolation overhead**
Risk: subprocess spawn per plugin invocation adds >20ms latency per transform.
Mitigation: pool long-lived plugin workers; benchmark in M2 sprint 1.
Severity: medium.

**R2 — Cross-platform path handling**
Risk: Windows path separators cause silent failures in glob resolution.
Mitigation: normalize all paths through `node:path.posix`; add Windows CI job in M1.
Severity: medium.

**R3 — Bun API instability**
Risk: Bun APIs change between minor versions, breaking builds.
Mitigation: pin Bun version in `package.json`; review release notes on each update.
Severity: low.

## out-of-scope

- GUI or web dashboard (may be addressed in a future phase)
- Cloud execution or remote plugin registries
- Automatic plugin update / self-update of the CLI binary
- Multi-user access control or team collaboration features
- Paid / commercial licensing model (open source only for v1)
