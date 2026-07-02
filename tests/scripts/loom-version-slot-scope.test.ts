/**
 * tests/scripts/loom-version-slot-scope.test.ts
 *
 * F-05 (defect 3) — cross-repo state contamination in the sibling-worktree
 * scan of scripts/loom-version-slot.ts.
 *
 * The old code recorded EVERY git directory sitting next to the current repo
 * (parent dir and ~/.worktrees) under the CURRENT repo's name, so an
 * unrelated project that merely shared a parent directory contaminated the
 * slot registry with foreign versions. The fix scopes the scan by resolved
 * git common-dir (same filter idea as scripts/loom-worktree-scan.ts:421):
 * only worktrees whose common dir resolves to this repo's are recorded.
 *
 * Adversarial fixtures, subprocess-spawned:
 *   - a genuine linked worktree of the current repo  -> MUST be recorded
 *   - an unrelated repo in the same parent dir       -> MUST NOT be recorded
 *   - an unrelated repo in ~/.worktrees whose directory BASENAME equals the
 *     current repo's (basename-collision trap)       -> MUST NOT be recorded
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "loom-version-slot.ts");

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 15_000 });
  if (r.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (${r.status}): ${r.stderr ?? ""}`,
    );
  }
  return (r.stdout ?? "").trim();
}

function writePkg(dir: string, version: string): void {
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: path.basename(dir), version }, null, 2),
  );
}

function initRepo(dir: string, version: string): void {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "fixture@test.invalid");
  git(dir, "config", "user.name", "fixture");
  git(dir, "config", "commit.gpgsign", "false");
  writePkg(dir, version);
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
}

function runScan(cwd: string, home: string): ReturnType<typeof spawnSync<string>> {
  return spawnSync("bun", [SCRIPT, "scan"], {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, HOME: home, GH_TOKEN: "", GITHUB_TOKEN: "" },
  });
}

function readRegistry(home: string): string {
  return fs.readFileSync(
    path.join(home, ".loom", "version-slots.toon"),
    "utf8",
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("loom-version-slot — sibling scan is scoped to the current repo", () => {
  let tmp: string;
  let home: string;
  let parent: string;
  let repoA: string; // current repo (cwd for the scan)

  // Distinct versions so registry assertions are unambiguous.
  const REPO_A_VERSION = "0.1.0";
  const WORKTREE_VERSION = "0.2.0"; // repoA linked worktree — MUST be recorded
  const FOREIGN_SIBLING_VERSION = "9.9.9"; // unrelated repo, same parent dir
  const FOREIGN_HOMEDIR_VERSION = "8.8.8"; // unrelated repo, ~/.worktrees, colliding basename

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loom-vslot-scope-"));
    home = path.join(tmp, "home");
    fs.mkdirSync(home, { recursive: true });
    parent = path.join(tmp, "parent");

    // Current repo.
    repoA = path.join(parent, "repo-a");
    initRepo(repoA, REPO_A_VERSION);

    // A genuine linked worktree of repoA, sitting in the same parent dir,
    // claiming a different version in its (uncommitted) package.json.
    const wt = path.join(parent, "repo-a-wt");
    git(repoA, "worktree", "add", "-q", wt, "-b", "feature-x");
    writePkg(wt, WORKTREE_VERSION);

    // Adversarial fixture 1: a COMPLETELY UNRELATED repo in the same parent
    // dir. Old code recorded its version under repo-a.
    initRepo(path.join(parent, "unrelated-repo"), FOREIGN_SIBLING_VERSION);

    // Adversarial fixture 2: an unrelated repo under ~/.worktrees whose
    // directory basename COLLIDES with the current repo's. Only a
    // common-dir comparison (not a name comparison) can exclude it.
    initRepo(
      path.join(home, ".worktrees", "repo-a"),
      FOREIGN_HOMEDIR_VERSION,
    );
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("records a worktree belonging to THIS repo", () => {
    const r = runScan(repoA, home);

    expect(r.status).toBe(0);
    const registry = readRegistry(home);
    // The linked worktree's claim is present, keyed to this repo and its
    // real branch.
    expect(registry).toContain(
      `repo-a,${WORKTREE_VERSION},feature-x,`,
    );
  });

  it("does NOT record a sibling worktree from a DIFFERENT repo", () => {
    const r = runScan(repoA, home);

    expect(r.status).toBe(0);
    const registry = readRegistry(home);
    expect(registry).not.toContain(FOREIGN_SIBLING_VERSION);
    expect(registry).not.toContain("unrelated-repo");
  });

  it("excludes a foreign repo even when its directory basename matches this repo", () => {
    const r = runScan(repoA, home);

    expect(r.status).toBe(0);
    const registry = readRegistry(home);
    // The ~/.worktrees/repo-a impostor shares our basename but resolves to a
    // different git common-dir — it must not leak into our registry.
    expect(registry).not.toContain(FOREIGN_HOMEDIR_VERSION);
  });

  it("registry ends up with exactly the one same-repo slot (no contamination rows)", () => {
    const r = runScan(repoA, home);

    expect(r.status).toBe(0);
    const registry = readRegistry(home);
    expect(registry).toContain("slots[1]");
  });

  it("stdout scan report matches the scoped registry (TOON output preserved)", () => {
    const r = runScan(repoA, home);

    expect(r.status).toBe(0);
    expect(r.stdout).toContain(
      "slots[1]{repo,version,branch,worktreePath,prNumber,prState,claimedAt,lastSeenAt}:",
    );
    expect(r.stdout).toContain(WORKTREE_VERSION);
    expect(r.stdout).not.toContain(FOREIGN_SIBLING_VERSION);
    expect(r.stdout).not.toContain(FOREIGN_HOMEDIR_VERSION);
  });
});
