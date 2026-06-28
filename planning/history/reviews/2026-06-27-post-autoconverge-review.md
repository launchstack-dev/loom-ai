# Code Review Report

**Scope:** `90a6f4a..HEAD` — 6 commits since the prior autoconverge pass · 11 files · 604 lines (+368 / −16)
**Reviewers:** code-reviewer (sonnet), silent-failure-hunter (sonnet), pr-test-analyzer (sonnet), security-reviewer (sonnet), architecture-reviewer (sonnet)
**Mode:** default (5 reviewers in parallel; full reviewer omits comment-analyzer + type-design-analyzer per `/loom-code review` defaults)

Commits in scope:
- `83ab9f6` docs(F-18): README + cheatsheet + concepts + troubleshooting
- `e9cf861` docs(F-18): first-30-minutes + cheatsheet authoring + design-philosophy
- `21d4575` fix(install): register /loom-which + /loom-deepen + /loom-prototype in install.sh
- `6db83e5` test(install): regression for commands/ ↔ install.sh COMMAND_FILES drift
- `d085b06` chore(install): wire command-coverage drift check into pre-commit + CI

After-dedup result: **3 critical · 8 warning · 9 advisory** spread across the new install/test infrastructure + 2 vocabulary collisions in the new docs prose.

---

## Critical (3)

### [SILENT] `scripts/git-hooks/pre-commit:78` — Gate silently skipped when `bunx` is absent
> `[ -n "${STAGED_COMMANDS_OR_INSTALL}" ] && [ "${LOOM_SKIP_PRECOMMIT_QUALITY:-0}" != "1" ] && command -v bunx >/dev/null 2>&1`

The hook's stated goal is "fail-closed." When `bunx` is missing the third predicate is false, the entire block is skipped, no warning surfaces, and the commit succeeds with no install-coverage check. A contributor on a machine without bun gets zero feedback — the exact scenario this feature exists to prevent.

**Fix:** Restructure as nested `if` — skip with an explicit `>&2` warning when bunx is absent. Echo something like `"[install-coverage] WARNING: bunx not found — install-coverage check SKIPPED. CI remains the backstop (install-command-coverage.yml)."`
*Found by: silent-failure-hunter (F1, confidence high) + architecture-reviewer (arch-002, warning) — overlapping*

### [TEST] `scripts/git-hooks/pre-commit:45-47` — install-coverage block is unreachable when ONLY `install.sh` is staged
> The hook's early-exit block at line 47 fires when `TOUCHED` (the intersection of staged paths and paths listed in `checksums.sha256`) is empty. `install.sh` is NOT in `checksums.sha256`, so a commit staging only `install.sh` (e.g., removing an entry or adding a bogus path) triggers the early exit BEFORE reaching the install-coverage block at line 77.

End-user impact: the local gate has a hole for the exact class of edit (`install.sh`-only) it's supposed to catch. CI still catches it on push.

**Fix:** Restructure the hook so the install-coverage block runs independently of `TOUCHED`. Easiest: compute `STAGED_COMMANDS_OR_INSTALL` BEFORE the early-exit at line 47, and bypass the early-exit when it's non-empty.
*Found by: pr-test-analyzer (#2, high)*

### [SILENT] `scripts/git-hooks/pre-commit:80,82` — Vitest output truncated to `tail -30`; shared `/tmp/loom-install-coverage.log` races on parallel commits
> `>/tmp/loom-install-coverage.log 2>&1` + `tail -30 /tmp/loom-install-coverage.log`

The test's actionable error includes the full list of missing files and the `COMMAND_FILES` lines to paste — if more than ~15 files drift simultaneously, the most actionable part scrolls off. Plus the shared `/tmp` path races on multi-user machines and parallel CI jobs.

**Fix:** `LOG=$(mktemp /tmp/loom-install-coverage.XXXXXX.log)` + `cat "${LOG}" >&2` + `rm -f "${LOG}"`. Both issues closed in one change.
*Found by: silent-failure-hunter (F2, high) + security-reviewer (sec-001, low — adds CWE-377 framing — same root cause)*

---

## Warnings (8)

### [SILENT] `scripts/git-hooks/pre-commit:77` — `|| true` swallows grep error codes (exit 2), not just no-match (exit 1)
A grep regex or I/O error gets converted to an empty string and the gate silently bypasses. Distinguish no-match from error with an explicit exit-code check.
*Fix:* `STAGED_COMMANDS_OR_INSTALL=$(echo "${STAGED_PATHS}" | grep -E '^(commands/|install\.sh$)') || { _rc=$?; [ "${_rc}" -ne 1 ] && { echo "[install-coverage] grep failed rc=${_rc}" >&2; exit 1; } }`
*Found by: silent-failure-hunter (F3, high)*

### [SILENT] `test/install-command-coverage.test.ts:43-47` — `execFileSync("git", ["ls-files"])` has no `timeout` / `maxBuffer`
If git hangs (index lock, NFS, malformed index), the pre-commit hook silently freezes — terminal goes quiet because hook output is redirected to the log.
*Fix:* `{ encoding: "utf8", timeout: 10_000, maxBuffer: 10 * 1024 * 1024 }`
*Found by: silent-failure-hunter (F4, medium)*

### [SILENT] `test/install-command-coverage.test.ts:88,131` — `readFileSync` at describe-scope crashes with opaque ENOENT
If install.sh or checksums.sha256 is absent (rename refactor, shallow clone), Vitest surfaces a raw ENOENT module-load error, not the clean "missing entries" output the hook's `tail -30` is designed to display.
*Fix:* Move `readFileSync` inside `it()` callbacks or wrap in try/catch with an explicit `throw new Error("install.sh not found at <path> — is this running from the repo root?")`.
*Found by: silent-failure-hunter (F5, medium)*

### [SEC] `.github/workflows/install-command-coverage.yml:52,55` — Unpinned action versions (`actions/checkout@v4`, `oven-sh/setup-bun@v2`)
Mutable tag references are the standard supply-chain attack vector for GitHub Actions (e.g. tj-actions/changed-files CVE-2025-30066). Severity is medium because the workflow runs with `permissions: contents: read` and no secrets, limiting blast radius — but the attacker-controlled build env could still exfiltrate source or pivot.
*Fix:* Pin to commit SHAs with the tag in a trailing comment: `uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2`. Add Dependabot/Renovate to keep SHAs current.
*Found by: security-reviewer (sec-002, medium, CWE-829)*

### [ARCH] `test/install-command-coverage.test.ts` (both describe blocks) — `listTrackedCommandFiles()` called twice, duplicate `git ls-files` spawns
The checksums describe block re-binds `tracked` rather than re-using the first block's. Locality violation per `protocols/codebase-design.md` §7 — same question answered in two places.
*Fix:* Hoist `const tracked = listTrackedCommandFiles()` to module scope, reference from both blocks. Pattern matches `test/install-state-preservation.test.ts`'s `PRESERVATION_AWK` constant.
*Found by: architecture-reviewer (arch-001, warning)*

### [TEST] `test/install-command-coverage.test.ts:130-146` — Checksums coverage is one-directional only
Catches "tracked file missing from checksums.sha256" but NOT the reverse (stale entries that no longer correspond to a tracked file). Mirror the install.sh describe block's bidirectional pattern.
*Fix:* Add a second `it()` in the checksums block asserting `checksummed.filter(p => !trackedSet.has(p))` is empty.
*Found by: pr-test-analyzer (#1, medium)*

### [ARCH-VOCAB] docs/concepts.md + design-philosophy.md + troubleshooting.md + cheatsheet.md — "Phase 0 / Phase 1" collides with plan-document `Phase`
Per CT-07 + `protocols/codebase-design.md` §0 mapping table: the new prose uses "Phase 0" (loom-converge interaction state) and "Phase 1" (loom-bugfix gate state) without qualifying the namespace. PLAN.md also uses `Phase` as a load-bearing concept ("a phase in PLAN.md" appears in concepts.md itself). A reader of troubleshooting §5b reasonably wonders if "Phase 0" refers to plan-phase or interaction-state.
*Fix:* Option C (lowest friction): coin a dedicated term in `protocols/codebase-design.md` §0 for the interaction-state concept (e.g., `Gate` or `Stage`), add a "When to use which" row, then sweep the 5 doc files to use the new term. Option B (cheaper): qualify on first use per doc — "Phase 0 (in the `loom-converge` interaction state machine, not to be confused with plan phases)".
*Found by: architecture-reviewer (vocab-001, warning)*

### [STYLE] `docs/cheatsheet.md:56-58 + 132-134` — `/loom-prototype` rows duplicated verbatim
Three prototype rows appear in both "Codebase health (F-18)" and "Authoring" sections. Contradicts the cheatsheet's own preamble ("One page. Organized by what you want to do") and creates a maintenance hazard.
*Fix:* Keep rows in "Authoring" only; add a one-line cross-reference in the codebase-health table pointing to it.
*Found by: code-reviewer (#6, confidence 84)*

---

## Advisory (9)

### [STYLE] `test/install-command-coverage.test.ts:23` — Unused import `relative` from `node:path`
Dead code; will trigger `no-unused-vars` lint warning if added.
*Fix:* Drop `relative` from the import.
*Found by: code-reviewer (#1, confidence 95) + silent-failure-hunter (F6, medium) + pr-test-analyzer (#7) — triple-overlap*

### [STYLE] `test/install-command-coverage.test.ts:87-123` — Third `it` ("exact match") is logically subsumed by the first two
If tests 1 + 2 pass, test 3 cannot fail. Triple-failure on real drift is more confusing than the actionable single-failure each direction-test produces.
*Fix:* Drop the third case; add a comment on the first noting the orphan-check covers the inverse.
*Found by: code-reviewer (#2, confidence 90) + pr-test-analyzer (#0) + architecture-reviewer (arch-004) — triple-overlap*

### [STYLE] `.github/workflows/install-command-coverage.yml:50` — `bun-version: latest` instead of pinned semver range
`latest` creates an unpinned dependency that can break on a bun minor bump.
*Fix:* Pin to `"1.x"` matching the project's standard.
*Found by: code-reviewer (#3, confidence 88)*

### [STYLE] `scripts/git-hooks/pre-commit:77` — Install-coverage block isn't NUL-safe
Pre-existing quality-gates block uses NUL-delimited collection for path safety. New block uses newline-pipe `grep` — would split on newline-in-filename. Rare but pre-existing pattern is documented in the file itself at lines 103-106.
*Fix:* Either adopt the NUL-safe pattern or add an explicit "# NUL-safety not required because…" comment.
*Found by: code-reviewer (#4, confidence 85)*

### [STYLE] `install.sh:94-98, 110-114` — New entries lack section comments
`loom-uninstall`, `loom-test`, `loom-doctor`, `_loom-init-guard`, `loom-change` appended without explaining why they belong where they do. Pre-existing sections use comment headers ("# Subcommand files", "# Noun commands", etc.).
*Fix:* Add a "# Lifecycle / maintenance (added in cleanup pass — caused /loom-update to skip them)" comment block.
*Found by: code-reviewer (#5, confidence 82)*

### [STYLE] `docs/first-30-minutes.md:21` vs `README.md:219` — `/loom-do` described inconsistently
"infers intent silently from a natural-language prompt" vs "model-facing intent inference". Standardise on one.
*Fix:* Use the README formulation across both — it's more precise about the caller.
*Found by: code-reviewer (#7, confidence 80)*

### [SEC] `install.sh:172-183` — Missing `mkdir -p ${CLAUDE_DIR}/commands/loom-auto/links` for the 3 new sub-dir command paths
`fetch_file`'s mktemp will fail with a generic "file failed to download" message if the parent dir doesn't exist (e.g., Alpine Docker fresh installs). Existing block has matching mkdirs for `loom-plan` and `loom-roadmap` subdirs.
*Fix:* Add `mkdir -p "${CLAUDE_DIR}/commands/loom-auto/links"` alongside the existing mkdir calls. CWE-732 adjacent (integrity verification silently skipped).
*Found by: security-reviewer (sec-003, low)*

### [SILENT/TEST] `test/install-command-coverage.test.ts:66-85` — `extractInstallSources` silently returns empty Set on regex format change
If `install.sh` array format changes (e.g., quoting style swap, variable in path), regex matches nothing, Set is empty, and the test fails with confusing "everything is missing" instead of "parser broke."
*Fix:* Post-parse smoke check: `if (sources.size === 0) throw new Error("COMMAND_FILES found but no entries matched — has the format changed?")`.
*Found by: silent-failure-hunter (F8, medium) + architecture-reviewer (arch-005, info) — overlap*

### [TEST/ARCH] `.github/workflows/install-command-coverage.yml:29-41` + `scripts/git-hooks/pre-commit` — CI path filter omits `scripts/git-hooks/pre-commit` itself
A change to the hook (e.g., removing or disabling the install-coverage invocation) wouldn't trigger this workflow on the PR introducing it. Local gate breaks in CI's blind spot. Same applies to `scripts/generate-checksums.sh` (upstream producer of `checksums.sha256`).
*Fix:* Add both paths to the workflow's `paths:` filter. Add a one-line comment in the workflow explaining the intentional divergence from the pre-commit hook's own filter set.
*Found by: pr-test-analyzer (#6, medium) + architecture-reviewer (arch-003, info) — overlap*

### [SILENT] `.github/workflows/install-command-coverage.yml:59-60` — No `bun install --frozen-lockfile` step before `bunx vitest`
`bunx` auto-fetches latest vitest from the registry, which differs from local dev's locked version. Silent dependency at test-run time.
*Fix:* Add `bun install --frozen-lockfile` step; change `bunx vitest` to `bun run vitest`.
*Found by: silent-failure-hunter (F7, medium)*

---

## Vocab-collision (advisory, separated from above for clarity)

### [ARCH-VOCAB] `protocols/codebase-design.md:1` + `docs/first-30-minutes.md:303` — "F-18 Phase A" uses "Phase" for a third meaning (roadmap delivery sub-phase)
Pre-existing for the protocol header; new for first-30-minutes. Same root cause as vocab-001 — `Phase` is overloaded across plan-document, interaction-state, and roadmap-delivery namespaces.
*Fix:* Replace "Phase A" with the roadmap-native label (wave or milestone ref) or drop the qualifier where it adds no navigation value.
*Found by: architecture-reviewer (vocab-002, info)*

---

## Test Coverage Summary

The new install-coverage regression test catches the F-18 distribution gap and the 11 pre-existing gaps it surfaced. Bidirectional install.sh assertion is correct. Action-able failure output is unusually good (prints the exact lines to paste). Notable gaps:

- Pre-commit hook behaviour itself has no test (it's bash, BATS would be the fix).
- Empty-set parser failure is unguarded.
- Checksums coverage is one-directional.
- `INSTALL_EXEMPT` allow-list (currently empty) has no test proving it actually exempts anything.
- CI workflow path filter doesn't include the hook file itself.

---

## Summary

| Reviewer | Critical | Warning | Advisory |
|----------|----------|---------|----------|
| code-reviewer | 0 | 2 (style + duplication) | 6 |
| silent-failure-hunter | 2 (F1, F2) | 3 (F3, F4, F5) | 3 (F6, F7, F8) |
| pr-test-analyzer | 1 (#2 unreachable block) | 1 (#1 one-directional) | 4 |
| security-reviewer | 0 | 1 (sec-002 unpinned actions) | 2 |
| architecture-reviewer | 0 | 3 (arch-001, arch-002, vocab-001) | 4 |
| **Total (after dedup)** | **3** | **8** | **9** |

**Dedup notes:**
- "Unused `relative` import" caught by 3 reviewers — kept once.
- "Third `it` redundant" caught by 3 reviewers — kept once.
- "Vitest log race / tmpfile" merged: silent-failure-hunter's F2 + security-reviewer's sec-001 cite the same root cause from different angles.
- "Silent skip when bunx missing" merged: silent-failure-hunter's F1 + architecture-reviewer's arch-002.
- "Empty-set parser" merged: silent-failure-hunter's F8 + architecture-reviewer's arch-005.
- "CI path filter omits hook" merged: pr-test-analyzer's #6 + architecture-reviewer's arch-003.

---

To auto-apply these findings, run `/loom-code fix` in a new conversation.
