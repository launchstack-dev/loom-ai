/**
 * Rule 14 — plan artifact relocation
 *
 * Tests the detection logic and a reference implementation of the
 * relocation routine. The real /loom-upgrade runtime calls into
 * `hooks/lib/planning-paths.ts` resolvers; this test exercises the
 * same logic against a virtual filesystem to lock in behavior before
 * the runtime ships.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";

import { isRootStub, type FsResolver } from "../../hooks/lib/planning-paths.js";

interface VirtualFs {
  files: Set<string>;
  dirs: Set<string>;
  content: Map<string, string>;
}

function vfs(): VirtualFs {
  return { files: new Set(), dirs: new Set(), content: new Map() };
}

function addFile(v: VirtualFs, p: string, c: string = ""): void {
  v.files.add(p);
  v.content.set(p, c);
  let d = path.dirname(p);
  while (d && d !== "/" && d !== ".") {
    v.dirs.add(d);
    d = path.dirname(d);
  }
}

function addDir(v: VirtualFs, p: string): void {
  v.dirs.add(p);
}

function fsResolver(v: VirtualFs): FsResolver {
  return {
    existsSync: (p) => v.files.has(p) || v.dirs.has(p),
    statSync: (p) => ({ size: Buffer.byteLength(v.content.get(p) ?? "", "utf-8") }),
    readFileSync: (p, _enc: "utf-8") => {
      const c = v.content.get(p);
      if (c === undefined) throw new Error(`ENOENT: ${p}`);
      return c;
    },
  };
}

/**
 * Rule 14 detection — returns true if the project needs relocation.
 *
 * Outdated iff:
 *   - planning/ does NOT exist (or is empty) AND
 *   - at least one of: non-stub root ROADMAP.md, any root PLAN*.md,
 *     or root .plan-history/
 */
function detectRule14Outdated(root: string, v: VirtualFs): boolean {
  const planningDir = path.join(root, "planning");
  const planningExists = v.dirs.has(planningDir);

  const rootRoadmap = path.join(root, "ROADMAP.md");
  const rootRoadmapExists = v.files.has(rootRoadmap);
  const rootRoadmapIsStub = rootRoadmapExists && isRootStub(rootRoadmap, "planning/ROADMAP.md", fsResolver(v));
  const hasLegacyRoadmap = rootRoadmapExists && !rootRoadmapIsStub;

  const rootPlanFiles = [...v.files].filter((p) => {
    const rel = path.relative(root, p);
    return /^PLAN(-[^/]+)?\.md$/.test(rel);
  });
  const hasLegacyPlans = rootPlanFiles.length > 0;

  const planHistory = path.join(root, ".plan-history");
  const hasLegacyHistory = v.dirs.has(planHistory);

  const hasLegacyArtifacts = hasLegacyRoadmap || hasLegacyPlans || hasLegacyHistory;
  return hasLegacyArtifacts && !planningExists;
}

const ROOT = "/proj";

describe("Rule 14 detection — plan artifact relocation", () => {
  it("flags legacy layout with ROADMAP.md and PLAN.md at root", () => {
    const v = vfs();
    addFile(v, path.join(ROOT, "ROADMAP.md"), "# Real roadmap\n" + "x".repeat(2000));
    addFile(v, path.join(ROOT, "PLAN.md"), "# Plan\n");
    expect(detectRule14Outdated(ROOT, v)).toBe(true);
  });

  it("flags .plan-history/ at root without planning/", () => {
    const v = vfs();
    addDir(v, path.join(ROOT, ".plan-history"));
    addFile(v, path.join(ROOT, ".plan-history", "changelog.md"), "");
    expect(detectRule14Outdated(ROOT, v)).toBe(true);
  });

  it("does NOT flag when planning/ already exists", () => {
    const v = vfs();
    addDir(v, path.join(ROOT, "planning"));
    addFile(v, path.join(ROOT, "ROADMAP.md"), "stub: planning/ROADMAP.md");
    addFile(v, path.join(ROOT, "PLAN.md"), "# Stale legacy plan\n");
    expect(detectRule14Outdated(ROOT, v)).toBe(false);
  });

  it("does NOT flag when only a root stub exists (already migrated)", () => {
    const v = vfs();
    addDir(v, path.join(ROOT, "planning"));
    addFile(v, path.join(ROOT, "planning", "ROADMAP.md"), "# Modern\n");
    addFile(
      v,
      path.join(ROOT, "ROADMAP.md"),
      "# ROADMAP\n\nMoved to [planning/ROADMAP.md](planning/ROADMAP.md).\n",
    );
    expect(detectRule14Outdated(ROOT, v)).toBe(false);
  });

  it("does NOT flag a stub root when planning/ is absent and there are no other legacy files", () => {
    // Edge case: orphan stub (planning/ was deleted but stub remained).
    // No relocatable content, so Rule 14 is a no-op. The stub can be
    // hand-deleted by the user if they don't want it.
    const v = vfs();
    addFile(
      v,
      path.join(ROOT, "ROADMAP.md"),
      "# ROADMAP\n\nMoved to [planning/ROADMAP.md](planning/ROADMAP.md).\n",
    );
    expect(detectRule14Outdated(ROOT, v)).toBe(false);
  });

  it("does NOT flag a greenfield repo with no plan artifacts", () => {
    const v = vfs();
    addFile(v, path.join(ROOT, "README.md"), "# Hello world\n");
    expect(detectRule14Outdated(ROOT, v)).toBe(false);
  });

  it("flags named PLAN-*.md variants too", () => {
    const v = vfs();
    addFile(v, path.join(ROOT, "PLAN-oss-launch.md"), "# Plan\n");
    expect(detectRule14Outdated(ROOT, v)).toBe(true);
  });

  it("does NOT flag PLAN.md inside subdirectories (only root counts)", () => {
    const v = vfs();
    addFile(v, path.join(ROOT, "docs", "PLAN.md"), "# Nested\n");
    expect(detectRule14Outdated(ROOT, v)).toBe(false);
  });

  it("flags when ROADMAP.md is long-form (not a stub)", () => {
    const v = vfs();
    addFile(v, path.join(ROOT, "ROADMAP.md"), "# Real roadmap\n" + "content ".repeat(200));
    expect(detectRule14Outdated(ROOT, v)).toBe(true);
  });

  it("idempotency — after migration, detection returns false", () => {
    // Simulate post-migration state: planning/ populated, root stub
    const v = vfs();
    addDir(v, path.join(ROOT, "planning"));
    addDir(v, path.join(ROOT, "planning", "plans"));
    addDir(v, path.join(ROOT, "planning", "archive"));
    addDir(v, path.join(ROOT, "planning", "history"));
    addFile(v, path.join(ROOT, "planning", "ROADMAP.md"), "# Modern\n");
    addFile(v, path.join(ROOT, "planning", "plans", "PLAN.md"), "# Active plan\n");
    addFile(
      v,
      path.join(ROOT, "ROADMAP.md"),
      "# ROADMAP\n\nMoved to [planning/ROADMAP.md](planning/ROADMAP.md).\n",
    );

    expect(detectRule14Outdated(ROOT, v)).toBe(false);
  });
});
