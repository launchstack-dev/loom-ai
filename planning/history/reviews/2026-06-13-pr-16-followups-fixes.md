# PR #16 Follow-up Fixes — 2026-06-13

**Branch:** `pr-16-followups`
**Base:** `main` (post-merge of PR #16 `a87561c`)
**Sources:**
- 9 info-level findings from prior `/loom-code review` (archived at `planning/history/reviews/2026-06-13-review.md`)
- 7 Gemini review comments posted on PR #16

**Note:** Two pairs of findings overlap; applied Gemini's stricter wording where deduped.
- Info-4 (brace-balance over-rejects) ∪ Gemini G5 → comment+quoted-string stripping
- Info-9 (validator inc.type allowlist) ∪ Gemini G4 → ERROR (not silent warning)

## Findings applied (14 total)

| # | Source | Severity | File | What |
|---|--------|---------:|------|------|
| 1 | Info-1 | info | hooks/lib/library-catalog-migrator.ts | identity `.map()` → spread for prompts + infrastructure |
| 2 | Info-2 | info | test/library-catalog-v3-to-v4.test.ts | bare `Function` → `MigrationStep` at 4 cast sites + import added |
| 3 | Info-3 | info | hooks/lib/wizard-interview.ts | SLUG_RE two-branch alternation annotated |
| 4 | Info-4 ∪ G5 | medium | hooks/lib/wizard-interview.ts | `detectExistingSkill` brace-balance: strip comments + quoted strings before counting |
| 5 | Info-5 | info | hooks/lib/skill-router.ts | JSDoc epoch sentinel default on `buildSkillInstallRecord` |
| 6 | Info-6 | info | test/library-add-heuristic.test.ts | fix `filesCreated[]:` → `filesCreated[1]:` real TOON + isolated regex-branch test added |
| 7 | Info-7 | info | planning/history/executions/wave-1-summary.toon | F-002 "54 rewrites" count clarified (in-memory tokens vs on-disk diff lines) |
| 8 | Info-8 | info | checksums.sha256 | add `commands/loom-skill.md` to manifest (15 → 16 tracked files) |
| 9 | Info-9 ∪ G4 | medium | scripts/validate-library-catalog.js | inc.type allowlist as ERROR (not silent warning); valid types listed in message |
| 10 | **Gemini G1** | high | hooks/lib/library-add-heuristic.ts | `triggers:` block search bounded to next unindented key (prevents false positives when empty `triggers:` is followed by `requires:` with list items) |
| 11 | **Gemini G2** | **security-high** | hooks/lib/skill-router.ts | `validateInstallPath` rejects `..` path-traversal segments (CWE-22 hardening) — splits on `/` and `\` for cross-platform safety |
| 12 | Gemini G3 | medium | hooks/lib/library-catalog-migrator.ts | also validate `description` field in v3→v4 migration loop (was only checking `source`) |
| 13 | Gemini G6 | medium | hooks/lib/wizard-interview.ts | `generateSkillMdContent` routes globs through `yamlQuoteString` |
| 14 | Gemini G7 | medium | hooks/lib/wizard-interview.ts | `generateLibraryYamlEntry` routes globs through `yamlQuoteString` |

## Verification

```
bunx tsc --noEmit -p hooks/tsconfig.json   → exit 0
bun test (full suite)                       → 0 failures
node scripts/validate-library-catalog.js   → exit 0, 0 warnings, 105 entries
bash scripts/verify-checksums.sh            → up to date (16 tracked files)
```

## Batch structure

- **Batch A** (single fixer-agent, sonnet, in parallel): 11 fixes across `hooks/lib/*.ts` + their test files
- **Batch B** (orchestrator-direct, simple scoped edits): validator allowlist + wave-1-summary annotation + checksums manifest add

## Highlights

- **G2 (security-high)** is real CWE-22 hardening. Prior code did `targetPath.startsWith(prefix)` only — a path like `~/.claude/skills/../etc/passwd/SKILL.md` would have passed. Now rejected before prefix check.
- **G1 (high)** is a subtle classification correctness fix. Previously, a YAML file with `triggers:` (empty body) followed by `requires:` containing `- foo` items would false-positive as a `skill`. Now the block is bounded to the next unindented key.
- **G4 (validator allowlist)** elevates from silent warning to error. A kit with `includes: [{type: "agnt", name: "foo"}]` (typo'd type) now fails CI instead of slipping through.

## Co-location notes

- This branch sits beside an in-flight `convergence-generalization` run on `main`. That run uses `.plan-execution/` actively, so this branch tracks state in `planning/history/reviews/` instead.
- Two files modified in the working tree (`agents/convergence-driver.md`, `planning/history/changelog.md`) belong to the convergence-gen run and were explicitly NOT included in any commit on this branch.

## Outstanding (not addressed this run)

- Info-level finding from M-02 smoke-test walk-through: `commands/loom-library.md` Step 5 documents the API surface but leaves the Bash execution layer (mkdir + cp + shasum + install-state row append) implicit. Should be codified in a future doc pass.
- `test/loom-change/lifecycle.test.ts:641` `vi.resetModules` skip — owner is `loom-change-owner`; reimplement using `bun:test mock.module()`.
