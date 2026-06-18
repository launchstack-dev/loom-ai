/**
 * Vitest coverage for scripts/roadmap-converge/diff-view.ts.
 *
 * Covers:
 *   - First-ever sign-off (oldHash = null) renders current file as additions
 *   - Unchanged file (hash matches) renders a "no changes" notice
 *   - Hash mismatch with no git history falls back to synthesised diff
 *
 * We avoid asserting on git binary availability by exercising the
 * "blob not found" code path (we never commit the prior content).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { renderDiff } from "../../scripts/roadmap-converge/diff-view.js";

let workdir: string;
let originalCwd: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "roadmap-diff-view-"));
  originalCwd = process.cwd();
  process.chdir(workdir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(workdir, { recursive: true, force: true });
});

describe("renderDiff", () => {
  it("renders first-ever sign-off when oldHash is null", () => {
    const path = "ROADMAP.md";
    writeFileSync(path, "# vision\n\nLine one.\nLine two.\n");

    const out = renderDiff(null, path);

    expect(out).toContain("first-ever sign-off");
    expect(out).toContain("+# vision");
    expect(out).toContain("+Line one.");
    expect(out).toContain("+Line two.");
  });

  it("renders 'no changes' when current hash matches oldHash", () => {
    const path = "ROADMAP.md";
    const body = "# vision\n\nUnchanged.\n";
    writeFileSync(path, body);
    const hash = createHash("sha256").update(body).digest("hex");

    const out = renderDiff(hash, path);

    expect(out).toContain("No changes since last sign-off");
    expect(out).toContain(hash.slice(0, 12));
  });

  it("falls back to synthesised diff when prior blob is unrecoverable", () => {
    const path = "ROADMAP.md";
    writeFileSync(path, "# vision\n\nNew content.\n");
    // hash that does not match the file and is not in any git history
    const bogusHash = "0".repeat(64);

    const out = renderDiff(bogusHash, path);

    // Either we got "could not recover prior content" (no git) or git ran
    // and produced a real diff. Both are acceptable; we assert the header
    // mentions sign-off diff view and the current content is present.
    expect(out).toContain("Sign-off diff view");
    expect(out).toContain("New content.");
  });

  it("ends output with a trailing newline so pagers display cleanly", () => {
    writeFileSync("ROADMAP.md", "x\n");
    const out = renderDiff(null, "ROADMAP.md");
    expect(out.endsWith("\n")).toBe(true);
  });
});
