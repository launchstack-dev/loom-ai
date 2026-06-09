/**
 * Planning artifact path resolution.
 *
 * Single source of truth for the resolution order documented in
 * `agents/protocols/planning-paths.md`. Every exported function
 * defaults to a `defaultFs` resolver that calls `node:fs` directly,
 * so the production caller gets real filesystem reads. Tests pass an
 * injected `FsResolver` to stub the filesystem without monkey-patching
 * node:fs — pure with the injection, impure without it.
 *
 * Resolution model:
 *   - Reads: prefer `planning/` layout, fall back to legacy root
 *   - Writes: default to modern `planning/` layout
 *   - Stub detection: a short root file pointing at `planning/{name}` is
 *     a pointer, not the source
 *
 * Callable from `/loom-upgrade` Rule 14 (relocate legacy roots),
 * status hooks (find the active roadmap/plan), and any future TS
 * runtime for the planning commands.
 */

import * as fs from "node:fs";
import path from "node:path";

export interface PlanningResolution {
  /** Absolute path of the resolved file, or null if not found. */
  path: string | null;
  /** Where the file was found. */
  source: "planning-modern" | "planning-archive" | "root-legacy" | "explicit" | "not-found";
  /** True when a root stub points at the modern path. */
  rootIsStub: boolean;
}

export interface FsResolver {
  existsSync(p: string): boolean;
  statSync(p: string): { size: number };
  readFileSync(p: string, enc: "utf-8"): string;
}

const defaultFs: FsResolver = {
  existsSync: fs.existsSync,
  statSync: (p) => ({ size: fs.statSync(p).size }),
  readFileSync: (p, enc) => fs.readFileSync(p, enc),
};

/**
 * A root file is a "stub" if it's short AND references the canonical
 * `planning/{name}.md` location. Both conditions must hold to defeat
 * accidental triggers on legitimately small roadmaps.
 *
 * Threshold: ≤512 bytes and ≤10 lines (matches the stub written by the
 * reorg PR — one heading plus a paragraph).
 */
export function isRootStub(rootPath: string, expectedTarget: string, fsLike: FsResolver = defaultFs): boolean {
  if (!fsLike.existsSync(rootPath)) return false;
  try {
    const size = fsLike.statSync(rootPath).size;
    if (size > 512) return false;
    const content = fsLike.readFileSync(rootPath, "utf-8");
    if (content.split("\n").length > 10) return false;
    return content.includes(expectedTarget);
  } catch {
    return false;
  }
}

/**
 * Resolve a ROADMAP read path.
 *
 * Search order:
 *   1. explicit (if provided)
 *   2. planning/ROADMAP.md
 *   3. ROADMAP.md at root (legacy, ignored if it's a stub pointing at planning/)
 */
export function resolveRoadmapRead(
  projectRoot: string,
  explicit: string | null = null,
  fsLike: FsResolver = defaultFs
): PlanningResolution {
  if (explicit) {
    const abs = path.isAbsolute(explicit) ? explicit : path.join(projectRoot, explicit);
    return {
      path: fsLike.existsSync(abs) ? abs : null,
      source: fsLike.existsSync(abs) ? "explicit" : "not-found",
      rootIsStub: false,
    };
  }

  const modern = path.join(projectRoot, "planning", "ROADMAP.md");
  if (fsLike.existsSync(modern)) {
    const root = path.join(projectRoot, "ROADMAP.md");
    const stub = isRootStub(root, "planning/ROADMAP.md", fsLike);
    return { path: modern, source: "planning-modern", rootIsStub: stub };
  }

  const root = path.join(projectRoot, "ROADMAP.md");
  if (fsLike.existsSync(root)) {
    const stub = isRootStub(root, "planning/ROADMAP.md", fsLike);
    if (stub) {
      // Pointer to a target that doesn't exist — not found, but stub flagged
      return { path: null, source: "not-found", rootIsStub: true };
    }
    return { path: root, source: "root-legacy", rootIsStub: false };
  }

  return { path: null, source: "not-found", rootIsStub: false };
}

/**
 * Resolve a PLAN read path.
 *
 * Search order:
 *   1. explicit (if provided)
 *   2. planning/plans/PLAN.md   (or planning/plans/PLAN-{name}.md)
 *   3. planning/archive/PLAN.md (or planning/archive/PLAN-{name}.md)
 *   4. PLAN.md at root          (or PLAN-{name}.md at root)
 */
export function resolvePlanRead(
  projectRoot: string,
  name: string | null = null,
  explicit: string | null = null,
  fsLike: FsResolver = defaultFs
): PlanningResolution {
  if (explicit) {
    const abs = path.isAbsolute(explicit) ? explicit : path.join(projectRoot, explicit);
    return {
      path: fsLike.existsSync(abs) ? abs : null,
      source: fsLike.existsSync(abs) ? "explicit" : "not-found",
      rootIsStub: false,
    };
  }

  const filename = name ? `PLAN-${name}.md` : "PLAN.md";

  const modern = path.join(projectRoot, "planning", "plans", filename);
  if (fsLike.existsSync(modern)) {
    return { path: modern, source: "planning-modern", rootIsStub: false };
  }

  const archive = path.join(projectRoot, "planning", "archive", filename);
  if (fsLike.existsSync(archive)) {
    return { path: archive, source: "planning-archive", rootIsStub: false };
  }

  const root = path.join(projectRoot, filename);
  if (fsLike.existsSync(root)) {
    return { path: root, source: "root-legacy", rootIsStub: false };
  }

  return { path: null, source: "not-found", rootIsStub: false };
}

/**
 * Resolve the default WRITE path for a new ROADMAP.
 *
 * Returns the modern path if `planning/` exists OR if the legacy root
 * doesn't exist (greenfield). Returns the root legacy path only when an
 * existing legacy non-stub root file is present — to avoid silently
 * relocating user content (that's Rule 14's job).
 */
export function resolveRoadmapWrite(projectRoot: string, fsLike: FsResolver = defaultFs): string {
  const planning = path.join(projectRoot, "planning");
  const root = path.join(projectRoot, "ROADMAP.md");
  const rootExists = fsLike.existsSync(root);
  const planningExists = fsLike.existsSync(planning);

  if (planningExists) return path.join(planning, "ROADMAP.md");
  if (rootExists && !isRootStub(root, "planning/ROADMAP.md", fsLike)) return root;
  return path.join(planning, "ROADMAP.md"); // greenfield default
}

/**
 * Resolve the default WRITE path for a new PLAN.
 *
 * Modern projects (with `planning/` or `planning/plans/` present) write
 * under `planning/plans/`. Legacy projects with an existing root PLAN.md
 * keep using the root. Greenfield defaults to modern.
 */
export function resolvePlanWrite(
  projectRoot: string,
  name: string | null = null,
  fsLike: FsResolver = defaultFs
): string {
  const filename = name ? `PLAN-${name}.md` : "PLAN.md";
  const planning = path.join(projectRoot, "planning");
  const planningPlans = path.join(projectRoot, "planning", "plans");
  const root = path.join(projectRoot, filename);
  const rootExists = fsLike.existsSync(root);
  const planningExists = fsLike.existsSync(planning) || fsLike.existsSync(planningPlans);

  if (planningExists) return path.join(planningPlans, filename);
  if (rootExists) return root;
  return path.join(planningPlans, filename); // greenfield default
}
