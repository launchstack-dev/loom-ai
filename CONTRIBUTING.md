# Contributing to Loom

Thanks for taking the time to contribute. Loom is in alpha (`v0.0.x`) — schemas can still shift, but the core pipeline is stable enough to extend.

## Quick start for contributors

1. **Use the local-dev install pattern** (see [README → Install → Two install patterns](README.md#install)). Symlinks let you edit Loom and see changes live in Claude Code without re-running the installer.

   ```bash
   git clone https://github.com/launchstack-dev/loom-ai.git
   cd loom-ai
   # Symlink ~/.claude/{commands,agents,skills/library/library.yaml,…} per the README table.
   ```

2. **Install dependencies** (only the test workspaces need anything heavier than `typescript`):

   ```bash
   bun install                          # root devDependencies
   (cd test/protocol && bun install)    # protocol-test workspace deps
   ```

3. **Run the test suites:**

   ```bash
   bunx vitest run                                  # root suite (~900 tests)
   (cd test/protocol && bunx vitest run)            # protocol suite (~470 tests)
   ```

   Both suites should be green before opening a PR.

## How to propose a change

1. **Open an issue first** for anything beyond a small fix — it saves you from building something that turns out to overlap with planned work in [`planning/ROADMAP.md`](planning/ROADMAP.md) or an active wave under [`planning/plans/`](planning/plans/).
2. **Branch from `main`** with a descriptive name: `feat/<short-name>`, `fix/<short-name>`, `docs/<short-name>`.
3. **Make focused commits.** Loom itself follows Conventional Commits — please match the style:
   - `feat(scope): …` — user-visible new behaviour
   - `fix(scope): …` — bug fix
   - `docs: …` — docs-only
   - `chore: …` — tooling, deps, no behaviour change
   - `refactor(scope): …` — internal restructure, no behaviour change
4. **Open a PR against `main`.** The template will prompt you for the change summary, test evidence, and any related issue/plan ref.
5. **CI must pass.** The `checksums.yml` workflow validates `checksums.sha256` against tracked content. If you modified files under the manifest, run `scripts/generate-checksums.sh` and commit the updated `checksums.sha256`.

## Where things live

| If you're changing… | Look at… |
|---|---|
| A user-facing command | `commands/loom-*.md` (and the `commands/loom-*/` subcommand folders) |
| Agent behaviour or prompts | `agents/<agent-name>.md` |
| A protocol schema | `protocols/*.schema.md` — these are the source of truth, ports/wrappers consume them |
| A hook | `hooks/*.ts` (TypeScript) — see `hooks/README.md` for the registration convention |
| Wiki/catalog plumbing | `skills/library.yaml` and `scripts/materialize-contracts.ts` |
| Docs | `docs/*.md` and `README.md` |

When you touch protocol schemas, the **convergence test** (`test/protocol/schema-validation.test.ts`) and the **contract page validator** will catch most drift. Run them locally before pushing.

## Plans, scenarios, and convergence — at a glance

Loom drives its own development with its own pipeline. Plans live under `planning/plans/PLAN-*.md`. Each plan ships Given/When/Then scenarios that the convergence pipeline gates on. If your change connects to an existing plan, reference its phase/wave in the PR description (`Phase 12 / Wave 3`) — it makes review faster.

The `feat`/`fix` lineage in `git log` is the easiest way to learn the conventions used today.

## Code style

- **TypeScript:** strict mode. No `any` without a comment explaining why.
- **Markdown:** wrap at ~100 columns where reasonable; tables and code blocks may exceed.
- **TOON** (used in schemas and fixtures): see `protocols/toon-format.md` for canonical examples.
- **Identifiers in examples:** use `alice`, `bob`, `team-a` rather than real names or hostnames.
- **No absolute paths** in tracked content — use repo-relative paths or environment variables. There is a hook that flags violations.

## Reporting bugs and asking questions

- **Bug?** Open an issue with the bug-report template.
- **Idea?** Open an issue with the feature-request template — even rough ones are useful.
- **Stuck mid-pipeline?** [`docs/troubleshooting.md`](docs/troubleshooting.md) maps common errors. If your case isn't there, file a bug — it likely belongs there.

## License

By contributing, you agree that your contributions will be licensed under the [Apache 2.0 License](LICENSE) that covers the project.
