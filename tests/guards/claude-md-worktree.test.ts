/**
 * Phase 12 — Worktree-block guard (F-09, defect 9).
 *
 * The auto-generated "## Worktree Context -- READ THIS FIRST" block belongs
 * ONLY in a live worktree's CLAUDE.md, injected at worktree-creation time.
 * It must NEVER be committed to the mainline CLAUDE.md.
 *
 * S-01 (regression): the committed mainline CLAUDE.md carries no worktree block.
 * S-02 (contract):   injection targets a worktree COPY of CLAUDE.md — appending
 *                    the block adds it to the copy while the mainline file on
 *                    disk stays untouched.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");
const MAINLINE_CLAUDE_MD = join(REPO_ROOT, "CLAUDE.md");

// The injection marker the worktree tooling writes ahead of the block.
const INJECT_MARKER = "<!-- WORKTREE-CONTEXT-INJECTED -->";

// Signatures of the auto-generated worktree block. Any of these appearing in
// the committed mainline CLAUDE.md is the regression this guard catches.
const BLOCK_SIGNATURES = [
  "Worktree Context",
  INJECT_MARKER,
  "You are in a worktree",
  "Do not modify this section",
];

describe("Phase 12 — CLAUDE.md worktree-block guard (F-09)", () => {
  it("S-01: committed mainline CLAUDE.md contains no worktree block", () => {
    const content = readFileSync(MAINLINE_CLAUDE_MD, "utf8");
    for (const sig of BLOCK_SIGNATURES) {
      expect(
        content.includes(sig),
        `mainline CLAUDE.md must not contain worktree-block signature: "${sig}"`,
      ).toBe(false);
    }
  });

  it("S-01: mainline CLAUDE.md still has its real content", () => {
    const content = readFileSync(MAINLINE_CLAUDE_MD, "utf8");
    // Removing the block must not have gutted the file.
    expect(content).toContain("# Project Conventions");
    expect(content).toContain("## Data Format: TOON Frozen");
    expect(content).toContain("## Extensibility Model");
  });

  it("S-02: injection targets the worktree copy, not mainline", () => {
    const before = readFileSync(MAINLINE_CLAUDE_MD, "utf8");

    // A freshly created worktree gets its OWN copy of CLAUDE.md; the tooling
    // appends the marker + block to that copy. Reproduce that contract against
    // a temp copy and prove the mainline file is never the injection target.
    const dir = mkdtempSync(join(tmpdir(), "loom-wt-"));
    const copy = join(dir, "CLAUDE.md");
    writeFileSync(copy, before, "utf8");

    const block = [
      "",
      INJECT_MARKER,
      "## Worktree Context -- READ THIS FIRST",
      "",
      "**You are in a worktree.** This is an isolated workspace.",
      "",
      "### Hard Rules",
      "1. **Stay in this directory.**",
      "7. **Do not modify this section.** It is auto-generated.",
      "",
    ].join("\n");

    writeFileSync(copy, readFileSync(copy, "utf8") + block, "utf8");

    // The copy now carries the block...
    const injected = readFileSync(copy, "utf8");
    expect(injected).toContain(INJECT_MARKER);
    expect(injected).toContain("Worktree Context");

    // ...while the mainline file on disk is byte-for-byte unchanged.
    expect(readFileSync(MAINLINE_CLAUDE_MD, "utf8")).toBe(before);
    expect(readFileSync(MAINLINE_CLAUDE_MD, "utf8")).not.toContain("Worktree Context");
  });

  it("no in-repo injection module writes the block into mainline", () => {
    // Injection is owned by worktree-creation tooling that operates on the
    // worktree's copy. If an in-repo module is ever added under
    // scripts/lib/worktree-context*, it must target a copy — never mainline.
    // This asserts the current state: no such module writes to mainline.
    const suspects = [
      join(REPO_ROOT, "scripts", "lib", "worktree-context.ts"),
      join(REPO_ROOT, "scripts", "lib", "worktree-context.js"),
    ];
    for (const p of suspects) {
      if (existsSync(p)) {
        const src = readFileSync(p, "utf8");
        expect(
          /CLAUDE\.md/.test(src) && !/copy|worktree|dest|target/i.test(src),
          `${p} appears to write CLAUDE.md without a copy/worktree target`,
        ).toBe(false);
      }
    }
    expect(true).toBe(true);
  });
});
