# Code Review Report — PR #24 `fix/safe-upgrade-path`

**Scope:** install.sh, commands/loom-library.md, test/install-state-preservation.test.ts (348 lines)
**Reviewers:** Gemini (PR bot) · pr-review-toolkit:code-reviewer · pr-review-toolkit:silent-failure-hunter
**Mode:** focused
**Generated:** 2026-06-25

---

## Critical

### #1 [GEM-01] install.sh — Schema corruption on v3→v2 row preservation
**Reviewer:** Gemini
The awk filter preserves rows verbatim into a v2 5-column header. v3 rows have 7 columns. After `/loom-library sync` migrates the file to v3, re-running install.sh writes a v2 header with v3 rows → corrupted TOON.

**Fix:** `if (NF == 7) print $1","$2","$3","$4","$7; else print $0`

### #2 [GEM-02] test/install-state-preservation.test.ts:29 — Test PRESERVATION_AWK out of sync
**Reviewer:** Gemini
Test mirrors install.sh's awk literal. Must update with the column-mapping fix from GEM-01 or the test runs the wrong filter.

### #3 [SILENT-01] install.sh:336-337 — mktemp exit code ignored
**Reviewer:** silent-failure-hunter
`mktemp` failure → empty var → trap no-op → awk redirect silently writes nothing → user rows lost.

**Fix:** `STATE_TMP=$(mktemp ...) || { echo "ERROR: mktemp failed" >&2; exit 1; }`

### #4 [SILENT-02] install.sh awk line — awk exit code ignored
**Reviewer:** silent-failure-hunter
awk failure → empty PRESERVED_TMP → wc -l returns 0 → installer silently drops every kit/BYO/custom-agent row.

**Fix:** Capture `$?` after the awk pipeline. Abort with "preservation failed, aborting to protect user-added rows".

---

## High

### #5 [STYLE-01] install.sh:339, 419 — EXIT trap clobber
**Reviewers:** code-reviewer + silent-failure-hunter
`trap 'rm -f ...' EXIT` overwrites any pre-existing EXIT trap; `trap - EXIT` clears all EXIT handlers.

### #6 [STYLE-02] install.sh:351 — wc -l counts newlines
**Reviewers:** code-reviewer + silent-failure-hunter
Replace with `PRESERVED_COUNT=$(awk 'END{print NR}' "${PRESERVED_TMP}")`.

### #7 [SILENT-03] test/install-state-preservation.test.ts — Test ignores stderr
**Reviewer:** silent-failure-hunter
Add `expect(result.stderr).toBe("")` to `runAwkFilter`.

### #8 [SILENT-04] install.sh — cat >> STATE_TMP failure swallowed
**Reviewer:** silent-failure-hunter
Disk-full mid-write produces truncated file with lying header.

**Fix:** `cat "${PRESERVED_TMP}" >> "${STATE_TMP}" || { echo "ERROR: append failed" >&2; exit 1; }`

---

## Medium

### #9 [GEM-03] test/install-state-preservation.test.ts — Missing v3-to-v2 conversion test
**Reviewer:** Gemini

### #10 [SILENT-05] install.sh — Empty vs missing STATE_FILE indistinguishable in log
**Reviewer:** silent-failure-hunter

---

## Low

### #11 [STYLE-04] install.sh awk regex — `/^  [^ ]/` fragile to indentation
**Reviewer:** code-reviewer

---

## Cross-cutting theme

**Data-loss silent failures dominate.** This block exists to prevent data loss, but every error path (mktemp, awk, cat, schema mismatch) lets the exact failure it's defending against happen silently.

**Fix priority:**
- **Data-correctness:** GEM-01, GEM-02, SILENT-01, SILENT-02, SILENT-04
- **Integrity follow-ons:** STYLE-01, STYLE-02, SILENT-03, GEM-03
- **Nice-to-haves:** SILENT-05, STYLE-04

---

## Summary

| Reviewer | Critical | High | Medium | Low |
|---|---|---|---|---|
| Gemini | 2 | 0 | 1 | 0 |
| Code Reviewer | 0 | 2 | 0 | 1 |
| Silent Failure Hunter | 2 | 2 | 1 | 0 |
| **Total** | **4** | **4** | **2** | **1** |

To auto-apply these findings, run `/loom-code fix` in a new conversation.
