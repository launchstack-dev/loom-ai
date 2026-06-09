import { describe, it, expect } from "vitest";
import path from "node:path";

import {
  resolveRoadmapRead,
  resolvePlanRead,
  resolveRoadmapWrite,
  resolvePlanWrite,
  isRootStub,
  type FsResolver,
} from "../../hooks/lib/planning-paths.js";

/**
 * Fixture-builder for a synthetic filesystem. Tests pass in a map of
 * { path -> content } and get back a FsResolver that pretends those
 * are the only files that exist. Lets us exercise the resolver without
 * touching the real filesystem.
 */
function mockFs(files: Record<string, string>): FsResolver {
  return {
    existsSync: (p: string) => Object.prototype.hasOwnProperty.call(files, p),
    statSync: (p: string) => ({ size: Buffer.byteLength(files[p] ?? "", "utf-8") }),
    readFileSync: (p: string, _enc: "utf-8") => {
      if (!Object.prototype.hasOwnProperty.call(files, p)) {
        throw new Error(`ENOENT: ${p}`);
      }
      return files[p];
    },
  };
}

const ROOT = "/proj";
const PLANNING_ROADMAP = path.join(ROOT, "planning", "ROADMAP.md");
const ROOT_ROADMAP = path.join(ROOT, "ROADMAP.md");
const PLANNING_PLAN = path.join(ROOT, "planning", "plans", "PLAN.md");
const PLANNING_ARCHIVE_PLAN = path.join(ROOT, "planning", "archive", "PLAN.md");
const ROOT_PLAN = path.join(ROOT, "PLAN.md");

describe("resolveRoadmapRead", () => {
  it("returns planning/ROADMAP.md when modern layout is present", () => {
    const fs = mockFs({ [PLANNING_ROADMAP]: "# Modern roadmap\n" });
    const r = resolveRoadmapRead(ROOT, null, fs);
    expect(r.path).toBe(PLANNING_ROADMAP);
    expect(r.source).toBe("planning-modern");
    expect(r.rootIsStub).toBe(false);
  });

  it("returns root ROADMAP.md when only legacy layout exists", () => {
    const fs = mockFs({ [ROOT_ROADMAP]: "# Legacy roadmap\n" + "x".repeat(2000) });
    const r = resolveRoadmapRead(ROOT, null, fs);
    expect(r.path).toBe(ROOT_ROADMAP);
    expect(r.source).toBe("root-legacy");
  });

  it("prefers modern even when root stub exists alongside", () => {
    const stub = "# ROADMAP\n\nMoved to [planning/ROADMAP.md](planning/ROADMAP.md).\n";
    const fs = mockFs({
      [PLANNING_ROADMAP]: "# Modern\n",
      [ROOT_ROADMAP]: stub,
    });
    const r = resolveRoadmapRead(ROOT, null, fs);
    expect(r.path).toBe(PLANNING_ROADMAP);
    expect(r.rootIsStub).toBe(true);
  });

  it("returns not-found when only a stub exists at root with no modern target", () => {
    const stub = "# ROADMAP\n\nMoved to [planning/ROADMAP.md](planning/ROADMAP.md).\n";
    const fs = mockFs({ [ROOT_ROADMAP]: stub });
    const r = resolveRoadmapRead(ROOT, null, fs);
    expect(r.path).toBeNull();
    expect(r.rootIsStub).toBe(true);
  });

  it("honors explicit path verbatim", () => {
    const explicit = "/elsewhere/CUSTOM-ROADMAP.md";
    const fs = mockFs({ [explicit]: "# Custom\n" });
    const r = resolveRoadmapRead(ROOT, explicit, fs);
    expect(r.path).toBe(explicit);
    expect(r.source).toBe("explicit");
  });

  it("returns not-found when nothing exists", () => {
    const fs = mockFs({});
    const r = resolveRoadmapRead(ROOT, null, fs);
    expect(r.path).toBeNull();
    expect(r.source).toBe("not-found");
  });
});

describe("resolvePlanRead", () => {
  it("returns planning/plans/PLAN.md when modern active layout has it", () => {
    const fs = mockFs({ [PLANNING_PLAN]: "# Active plan\n" });
    const r = resolvePlanRead(ROOT, null, null, fs);
    expect(r.path).toBe(PLANNING_PLAN);
    expect(r.source).toBe("planning-modern");
  });

  it("falls back to planning/archive/ when not in plans/", () => {
    const fs = mockFs({ [PLANNING_ARCHIVE_PLAN]: "# Archived\n" });
    const r = resolvePlanRead(ROOT, null, null, fs);
    expect(r.path).toBe(PLANNING_ARCHIVE_PLAN);
    expect(r.source).toBe("planning-archive");
  });

  it("falls back to root PLAN.md (legacy)", () => {
    const fs = mockFs({ [ROOT_PLAN]: "# Legacy\n" });
    const r = resolvePlanRead(ROOT, null, null, fs);
    expect(r.path).toBe(ROOT_PLAN);
    expect(r.source).toBe("root-legacy");
  });

  it("resolves named PLAN-{slug}.md", () => {
    const named = path.join(ROOT, "planning", "plans", "PLAN-feature-x.md");
    const fs = mockFs({ [named]: "# Named plan\n" });
    const r = resolvePlanRead(ROOT, "feature-x", null, fs);
    expect(r.path).toBe(named);
    expect(r.source).toBe("planning-modern");
  });

  it("prefers active plans/ over archive/ when both exist", () => {
    const fs = mockFs({
      [PLANNING_PLAN]: "# Active\n",
      [PLANNING_ARCHIVE_PLAN]: "# Archived\n",
    });
    const r = resolvePlanRead(ROOT, null, null, fs);
    expect(r.path).toBe(PLANNING_PLAN);
  });

  it("returns not-found when nothing exists", () => {
    const fs = mockFs({});
    const r = resolvePlanRead(ROOT, null, null, fs);
    expect(r.path).toBeNull();
  });
});

describe("resolveRoadmapWrite", () => {
  it("writes to planning/ROADMAP.md when planning/ exists", () => {
    const fs = mockFs({ [path.join(ROOT, "planning")]: "" });
    expect(resolveRoadmapWrite(ROOT, fs)).toBe(PLANNING_ROADMAP);
  });

  it("writes to root ROADMAP.md when legacy non-stub exists and no planning/", () => {
    const fs = mockFs({ [ROOT_ROADMAP]: "# Real content\n" + "x".repeat(2000) });
    expect(resolveRoadmapWrite(ROOT, fs)).toBe(ROOT_ROADMAP);
  });

  it("writes to planning/ROADMAP.md when only a stub exists at root", () => {
    const stub = "# ROADMAP\n\nMoved to [planning/ROADMAP.md](planning/ROADMAP.md).\n";
    const fs = mockFs({ [ROOT_ROADMAP]: stub });
    expect(resolveRoadmapWrite(ROOT, fs)).toBe(PLANNING_ROADMAP);
  });

  it("greenfield writes to planning/ROADMAP.md", () => {
    const fs = mockFs({});
    expect(resolveRoadmapWrite(ROOT, fs)).toBe(PLANNING_ROADMAP);
  });
});

describe("resolvePlanWrite", () => {
  it("writes to planning/plans/PLAN.md when planning/ exists", () => {
    const fs = mockFs({ [path.join(ROOT, "planning")]: "" });
    expect(resolvePlanWrite(ROOT, null, fs)).toBe(PLANNING_PLAN);
  });

  it("writes to root PLAN.md when legacy and no planning/", () => {
    const fs = mockFs({ [ROOT_PLAN]: "# Existing\n" });
    expect(resolvePlanWrite(ROOT, null, fs)).toBe(ROOT_PLAN);
  });

  it("writes named plan to planning/plans/PLAN-{slug}.md", () => {
    const fs = mockFs({ [path.join(ROOT, "planning")]: "" });
    const target = path.join(ROOT, "planning", "plans", "PLAN-foo.md");
    expect(resolvePlanWrite(ROOT, "foo", fs)).toBe(target);
  });

  it("greenfield writes to planning/plans/PLAN.md", () => {
    const fs = mockFs({});
    expect(resolvePlanWrite(ROOT, null, fs)).toBe(PLANNING_PLAN);
  });
});

describe("isRootStub", () => {
  it("identifies a short root file referencing planning/ROADMAP.md as a stub", () => {
    const stub = "# ROADMAP\n\nMoved to [planning/ROADMAP.md](planning/ROADMAP.md).\n";
    const fs = mockFs({ [ROOT_ROADMAP]: stub });
    expect(isRootStub(ROOT_ROADMAP, "planning/ROADMAP.md", fs)).toBe(true);
  });

  it("rejects a long file even if it mentions planning/ROADMAP.md", () => {
    const long = "# ROADMAP\n" + "real content ".repeat(100) + " planning/ROADMAP.md\n";
    const fs = mockFs({ [ROOT_ROADMAP]: long });
    expect(isRootStub(ROOT_ROADMAP, "planning/ROADMAP.md", fs)).toBe(false);
  });

  it("rejects a short file with no reference to the target", () => {
    const short = "# ROADMAP\n\nTODO\n";
    const fs = mockFs({ [ROOT_ROADMAP]: short });
    expect(isRootStub(ROOT_ROADMAP, "planning/ROADMAP.md", fs)).toBe(false);
  });

  it("returns false when the file does not exist", () => {
    const fs = mockFs({});
    expect(isRootStub(ROOT_ROADMAP, "planning/ROADMAP.md", fs)).toBe(false);
  });
});
