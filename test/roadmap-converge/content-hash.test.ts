/**
 * Vitest coverage for scripts/roadmap-converge/content-hash.ts.
 *
 * Covers AC: content-hash invalidation flag, line-count diff for the stderr notice.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  compareRoadmapHash,
  hashRoadmap,
  roadmapIsReadable,
} from "../../scripts/roadmap-converge/content-hash.js";

let workdir: string;
let roadmap: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "roadmap-converge-hash-"));
  roadmap = join(workdir, "ROADMAP.md");
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("hashRoadmap", () => {
  it("returns sha256 hex digest matching node:crypto baseline", () => {
    const body = "# vision\n\nA roadmap.\n";
    writeFileSync(roadmap, body);
    const expected = createHash("sha256").update(body).digest("hex");
    expect(hashRoadmap(roadmap)).toBe(expected);
  });
});

describe("compareRoadmapHash — invalidation flag", () => {
  it("priorMatches=true when priorHash equals current", () => {
    const body = "# vision\nstable\n";
    writeFileSync(roadmap, body);
    const current = createHash("sha256").update(body).digest("hex");

    const result = compareRoadmapHash(roadmap, current, 2);
    expect(result.priorMatches).toBe(true);
    expect(result.current).toBe(current);
    expect(result.currentLineCount).toBe(2);
    expect(result.lineDiff).toBe("+0 -0");
  });

  it("priorMatches=false when content changed; lineDiff shows the delta", () => {
    writeFileSync(roadmap, "line1\nline2\nline3\n");
    const result = compareRoadmapHash(
      roadmap,
      "deadbeef".repeat(8), // unrelated prior hash
      2
    );
    expect(result.priorMatches).toBe(false);
    expect(result.currentLineCount).toBe(3);
    expect(result.lineDiff).toBe("+1 -0");
  });

  it("priorMatches=false when priorHash is the empty string (cold start)", () => {
    writeFileSync(roadmap, "first pass\n");
    const result = compareRoadmapHash(roadmap, "", null);
    expect(result.priorMatches).toBe(false);
    expect(result.lineDiff).toBe("+1 -0");
  });

  it("lineDiff reports removals when content shrinks", () => {
    writeFileSync(roadmap, "one\n");
    const result = compareRoadmapHash(roadmap, "x", 5);
    expect(result.lineDiff).toBe("+0 -4");
  });

  it("empty file is 0 lines", () => {
    writeFileSync(roadmap, "");
    const result = compareRoadmapHash(roadmap, "", null);
    expect(result.currentLineCount).toBe(0);
    expect(result.lineDiff).toBe("+0 -0");
  });
});

describe("roadmapIsReadable", () => {
  it("returns true for a regular file", () => {
    writeFileSync(roadmap, "hi\n");
    expect(roadmapIsReadable(roadmap)).toBe(true);
  });

  it("returns false for a missing path", () => {
    expect(roadmapIsReadable(join(workdir, "missing.md"))).toBe(false);
  });
});
