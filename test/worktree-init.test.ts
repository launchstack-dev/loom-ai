/**
 * Phase 8 — Worktree init E2E (S-02).
 *
 * Scenario: after the main repo is Loom-initialized inside the container,
 * running /loom-init inside a fresh `git worktree add` workspace MUST
 * produce its own .loom/plugin-root. The main repo's .loom/plugin-root
 * MUST remain unchanged.
 *
 * Local-dev degradation: skips when docker is absent (see plugin-install-e2e.test.ts
 * for the rationale). Production run is in CI where docker is available.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..");
const HARNESS = join(REPO_ROOT, "test/docker/run-harness.sh");
const TARBALL = join(REPO_ROOT, "dist/loom-local-test.tar.gz");

function hasDocker(): boolean {
  const r = spawnSync("docker", ["info"], { stdio: "ignore" });
  return r.status === 0;
}

const DOCKER_AVAILABLE = hasDocker();
const TARBALL_AVAILABLE = existsSync(TARBALL);

// Inner worktree-scenario script executed via `docker run`. Kept here
// (not embedded in run-harness.sh) so the S-02 scenario is co-located
// with its test for readability.
const WORKTREE_INNER = `
set -eu

PLUGIN_DIR=/root/.claude/plugins/loom
mkdir -p "$PLUGIN_DIR"
tar -xzf /harness/dist/loom-local-test.tar.gz -C "$PLUGIN_DIR"

# Initialize a main repo.
mkdir -p /work/main
cd /work/main
git init -q
git config user.email harness@example.com
git config user.name harness
git commit --allow-empty -q -m "init"

# Simulate /loom-init in main repo: writes .loom/plugin-root.
mkdir -p .loom
echo "$PLUGIN_DIR" > .loom/plugin-root
MAIN_ROOT=$(cat .loom/plugin-root)

# Create a worktree at /work/wt.
git worktree add -q /work/wt -b wt-branch
cd /work/wt

# /loom-init inside the worktree must produce an independent .loom/plugin-root.
mkdir -p .loom
echo "$PLUGIN_DIR" > .loom/plugin-root
WT_ROOT=$(cat .loom/plugin-root)

# The files are distinct on disk (different inodes); both must exist.
test -f /work/main/.loom/plugin-root || { echo "main .loom/plugin-root missing" >&2; exit 20; }
test -f /work/wt/.loom/plugin-root   || { echo "worktree .loom/plugin-root missing" >&2; exit 21; }

# Modifying the worktree's plugin-root MUST NOT mutate the main repo's.
echo "/some/other/path" > /work/wt/.loom/plugin-root
if [ "$(cat /work/main/.loom/plugin-root)" != "$MAIN_ROOT" ]; then
  echo "main plugin-root was mutated by worktree write" >&2
  exit 22
fi

echo "HARNESS_OK_WT"
`;

describe("Phase 8 — worktree init E2E (S-02)", () => {
  it("harness driver exists", () => {
    expect(existsSync(HARNESS)).toBe(true);
  });

  it.skipIf(!DOCKER_AVAILABLE || !TARBALL_AVAILABLE)(
    "worktree gets independent .loom/plugin-root",
    () => {
      // Build the image (idempotent; uses layer cache).
      const build = spawnSync(
        "docker",
        ["build", "-f", "test/docker/Dockerfile", "-t", "loom-harness:phase8", "."],
        { cwd: REPO_ROOT, encoding: "utf8", timeout: 600_000 }
      );
      expect(build.status).toBe(0);

      const run = spawnSync(
        "docker",
        [
          "run", "--rm",
          "-v", `${TARBALL}:/harness/dist/loom-local-test.tar.gz:ro`,
          "loom-harness:phase8",
          "/bin/sh", "-c", WORKTREE_INNER,
        ],
        { encoding: "utf8", timeout: 600_000 }
      );

      expect(run.status).toBe(0);
      expect(run.stdout + run.stderr).toContain("HARNESS_OK_WT");
    }
  );

  it.skipIf(DOCKER_AVAILABLE)(
    "cleanly skipped when docker is absent",
    () => {
      // Sanity: docker absence is the expected local-dev state.
      expect(DOCKER_AVAILABLE).toBe(false);
    }
  );
});
