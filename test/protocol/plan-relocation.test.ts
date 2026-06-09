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
import { isSymlink, type LstatResolver } from "../../hooks/lib/symlink-safety.js";

interface VirtualFs {
  files: Set<string>;
  dirs: Set<string>;
  content: Map<string, string>;
  symlinks: Set<string>;
}

function vfs(): VirtualFs {
  return { files: new Set(), dirs: new Set(), content: new Map(), symlinks: new Set() };
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

function addSymlink(v: VirtualFs, p: string): void {
  v.files.add(p);
  v.symlinks.add(p);
  let d = path.dirname(p);
  while (d && d !== "/" && d !== ".") {
    v.dirs.add(d);
    d = path.dirname(d);
  }
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

function lstatResolver(v: VirtualFs): LstatResolver {
  return {
    existsSync: (p) => v.files.has(p) || v.dirs.has(p),
    isSymlink: (p) => v.symlinks.has(p),
  };
}

/**
 * Rule 14 detection — returns true if the project needs relocation.
 *
 * Outdated iff:
 *   - planning/ does NOT exist (or is empty) AND
 *   - at least one of: non-stub root ROADMAP.md, any root PLAN*.md,
 *     or root .plan-history/
 *
 * Symlinked sources are excluded from the "legacy artifacts" tally —
 * they're user-managed at a separate location, the migration would
 * skip them anyway (see Symlink Safety in schema-upgrade.md), so
 * counting them as relocatable would falsely trigger Rule 14 on
 * projects that have nothing to relocate.
 */
function detectRule14Outdated(root: string, v: VirtualFs): boolean {
  const planningDir = path.join(root, "planning");
  const planningExists = v.dirs.has(planningDir);
  const fs = fsResolver(v);
  const lstat = lstatResolver(v);

  const rootRoadmap = path.join(root, "ROADMAP.md");
  const rootRoadmapExists = v.files.has(rootRoadmap);
  const rootRoadmapIsStub = rootRoadmapExists && isRootStub(rootRoadmap, "planning/ROADMAP.md", fs);
  const rootRoadmapIsLink = rootRoadmapExists && isSymlink(rootRoadmap, lstat);
  const hasLegacyRoadmap = rootRoadmapExists && !rootRoadmapIsStub && !rootRoadmapIsLink;

  const rootPlanFiles = [...v.files].filter((p) => {
    const rel = path.relative(root, p);
    if (!/^PLAN(-[^/]+)?\.md$/.test(rel)) return false;
    if (isSymlink(p, lstat)) return false;
    return true;
  });
  const hasLegacyPlans = rootPlanFiles.length > 0;

  const planHistory = path.join(root, ".plan-history");
  // .plan-history symlinked to elsewhere → user-managed, defer
  const planHistoryIsLink = isSymlink(planHistory, lstat);
  const hasLegacyHistory = v.dirs.has(planHistory) && !planHistoryIsLink;

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

describe("Rule 14 detection — symlink safety", () => {
  it("does NOT flag when root ROADMAP.md is a symlink (user-managed)", () => {
    // User has ROADMAP.md → ~/dotfiles/projects/foo/ROADMAP.md
    const v = vfs();
    addSymlink(v, path.join(ROOT, "ROADMAP.md"));
    expect(detectRule14Outdated(ROOT, v)).toBe(false);
  });

  it("does NOT flag when root PLAN.md is a symlink (user-managed)", () => {
    const v = vfs();
    addSymlink(v, path.join(ROOT, "PLAN.md"));
    expect(detectRule14Outdated(ROOT, v)).toBe(false);
  });

  it("does NOT flag when .plan-history/ is a symlink (e.g., to shared volume)", () => {
    const v = vfs();
    addSymlink(v, path.join(ROOT, ".plan-history"));
    // Note: simulating a symlinked directory entry; the lstat resolver
    // returns true regardless of whether the link target is a file or dir
    expect(detectRule14Outdated(ROOT, v)).toBe(false);
  });

  it("flags only the non-symlinked artifacts in a mixed project", () => {
    // ROADMAP.md is symlinked (user-managed), PLAN.md is a real legacy file
    const v = vfs();
    addSymlink(v, path.join(ROOT, "ROADMAP.md"));
    addFile(v, path.join(ROOT, "PLAN.md"), "# Real plan\n");
    expect(detectRule14Outdated(ROOT, v)).toBe(true);
  });

  it("does NOT flag a project where ALL legacy artifacts are symlinks", () => {
    const v = vfs();
    addSymlink(v, path.join(ROOT, "ROADMAP.md"));
    addSymlink(v, path.join(ROOT, "PLAN.md"));
    addSymlink(v, path.join(ROOT, "PLAN-feature.md"));
    expect(detectRule14Outdated(ROOT, v)).toBe(false);
  });
});
