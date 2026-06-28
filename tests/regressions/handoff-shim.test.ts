/**
 * tests/regressions/handoff-shim.test.ts
 *
 * S-02: Pre-F-18 handoff path resolves via shim.
 *
 * Given: A pre-F-18 handoff file path at the legacy location
 *        (e.g., .plan-execution/handoff.md).
 * When:  A consumer of the new tmp-dir convention reads the legacy path
 *        through the shim.
 * Then:
 *   1. The shim MUST return a usable path.
 *   2. A direct read of the new tmp-dir path MUST succeed (when a file
 *      exists there).
 *
 * Run: bunx vitest run tests/regressions/handoff-shim.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveLegacyPath,
  isLegacyHandoffPath,
} from "../../scripts/loom-pause/handoff-shim.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpWorkDir: string;

beforeEach(() => {
  tmpWorkDir = mkdtempSync(join(tmpdir(), "loom-shim-test-"));
});

afterEach(() => {
  rmSync(tmpWorkDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// S-02: Legacy path resolves to new tmp-dir convention
// ---------------------------------------------------------------------------

describe("S-02: Pre-F-18 handoff path resolves via shim", () => {
  describe("resolveLegacyPath()", () => {
    it("resolves .plan-execution/handoff.md to $TMPDIR/loom-handoff-*.md", () => {
      const legacyPath = join(tmpWorkDir, ".plan-execution", "handoff.md");
      const newPath = resolveLegacyPath(legacyPath);

      // Must be under tmpdir()
      expect(newPath.startsWith(tmpdir())).toBe(true);

      // Filename must match loom-handoff-{id}.md
      const filename = basename(newPath);
      expect(filename).toMatch(/^loom-handoff-.+\.md$/);
    });

    it("resolves .plan-execution/session-handoff.md to $TMPDIR/loom-handoff-*.md", () => {
      const legacyPath = join(tmpWorkDir, ".plan-execution", "session-handoff.md");
      const newPath = resolveLegacyPath(legacyPath);

      expect(newPath.startsWith(tmpdir())).toBe(true);
      expect(basename(newPath)).toMatch(/^loom-handoff-.+\.md$/);
    });

    it("resolves handoff-abc123.md (with embedded id) preserving the id", () => {
      const legacyPath = join(tmpWorkDir, ".plan-execution", "handoff-abc123.md");
      const newPath = resolveLegacyPath(legacyPath);

      expect(newPath.startsWith(tmpdir())).toBe(true);
      expect(newPath).toContain("abc123");
    });

    it("resolves loom-handoff-HANDOFF-20260626T120000Z-a3f7.md preserving the id", () => {
      // A file that already has the canonical name but lives outside tmpdir
      const legacyPath = join(
        tmpWorkDir,
        ".plan-execution",
        "loom-handoff-HANDOFF-20260626T120000Z-a3f7.md"
      );
      const newPath = resolveLegacyPath(legacyPath);

      expect(newPath.startsWith(tmpdir())).toBe(true);
      expect(newPath).toContain("HANDOFF-20260626T120000Z-a3f7");
    });

    it("returns a path that does NOT include the original .plan-execution directory", () => {
      const legacyPath = join(tmpWorkDir, ".plan-execution", "handoff.md");
      const newPath = resolveLegacyPath(legacyPath);

      expect(newPath).not.toContain(".plan-execution");
    });

    it("two calls with the same legacy path return the same new path (stable)", () => {
      const legacyPath = join(tmpWorkDir, ".plan-execution", "handoff.md");
      const newPath1 = resolveLegacyPath(legacyPath);
      const newPath2 = resolveLegacyPath(legacyPath);

      expect(newPath1).toBe(newPath2);
    });
  });

  describe("isLegacyHandoffPath()", () => {
    it("returns true for .plan-execution/handoff.md", () => {
      const legacyPath = join(tmpWorkDir, ".plan-execution", "handoff.md");
      expect(isLegacyHandoffPath(legacyPath)).toBe(true);
    });

    it("returns true for .plan-execution/session-handoff.md", () => {
      const legacyPath = join(tmpWorkDir, ".plan-execution", "session-handoff.md");
      expect(isLegacyHandoffPath(legacyPath)).toBe(true);
    });

    it("returns true for .plan-execution/handoff-abc123.md", () => {
      const legacyPath = join(tmpWorkDir, ".plan-execution", "handoff-abc123.md");
      expect(isLegacyHandoffPath(legacyPath)).toBe(true);
    });

    it("returns false for a canonical $TMPDIR/loom-handoff-{id}.md path", () => {
      const canonicalPath = join(tmpdir(), "loom-handoff-HANDOFF-abc123.md");
      expect(isLegacyHandoffPath(canonicalPath)).toBe(false);
    });

    it("returns false for an unrelated file path", () => {
      const otherPath = join(tmpWorkDir, ".plan-execution", "state.toon");
      expect(isLegacyHandoffPath(otherPath)).toBe(false);
    });
  });

  describe("Round-trip: legacy path → new path → file readable", () => {
    it("a file written to the new path is readable after shim resolution", () => {
      const legacyPath = join(tmpWorkDir, ".plan-execution", "handoff.md");
      const newPath = resolveLegacyPath(legacyPath);

      // Write content to the resolved new path
      const expectedContent = [
        "id: HANDOFF-20260626T120000Z-test",
        "createdAt: 2026-06-26T12:00:00.000Z",
        "suggestedSkills[1]: loom-resume",
        "referencedArtifacts[0]:",
        "redactedSecretsCount: 0",
      ].join("\n");

      writeFileSync(newPath, expectedContent, "utf8");

      try {
        // Consumer resolves the legacy path and reads from the new path
        const resolvedPath = resolveLegacyPath(legacyPath);
        expect(existsSync(resolvedPath)).toBe(true);

        const content = readFileSync(resolvedPath, "utf8");
        expect(content).toBe(expectedContent);
        expect(content).toContain("suggestedSkills[1]: loom-resume");
        expect(content).toContain("redactedSecretsCount: 0");
      } finally {
        // Clean up the tmp file we created in tmpdir()
        rmSync(newPath, { force: true });
      }
    });

    it("resolving the same legacy path twice gives the same file", () => {
      const legacyPath = join(tmpWorkDir, ".plan-execution", "handoff.md");
      const newPath1 = resolveLegacyPath(legacyPath);
      const newPath2 = resolveLegacyPath(legacyPath);

      // Both resolutions point to the same file
      expect(newPath1).toBe(newPath2);
    });

    it("different legacy paths with different ids produce different new paths", () => {
      const path1 = join(tmpWorkDir, ".plan-execution", "handoff-session1.md");
      const path2 = join(tmpWorkDir, ".plan-execution", "handoff-session2.md");

      const newPath1 = resolveLegacyPath(path1);
      const newPath2 = resolveLegacyPath(path2);

      expect(newPath1).not.toBe(newPath2);
    });
  });
});
