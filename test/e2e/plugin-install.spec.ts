/**
 * Phase 12 — Wave 6b: plugin-install E2E spec (Scenario S-01).
 *
 * Verifies the plugin-path correctness contract: on a fresh container,
 * `/plugin install loom@<signed-release-tag>` followed by `/loom-doctor --json`
 * produces `overallStatus === "clean"` and exits 0.
 *
 * Execution model (mirrors the Phase 11B curl-install spec):
 *   - Production CI: docker present + the Phase 7 signed release tag exists +
 *     the Phase 8 packaging pipeline has produced `dist/loom-local-test.tar.gz`.
 *     The spec runs the full matrix via the Phase 8 clean-machine harness
 *     (`test/docker/run-harness.sh --mode plugin`).
 *   - Local dev: docker absent OR tarball missing OR harness missing → graceful
 *     skip via `it.skipIf`. The bare-fact assertions (spec wiring, harness
 *     presence) still execute so regressions in the surrounding scaffolding
 *     surface.
 *
 * Harness integration:
 *   The spec invokes `bash test/docker/run-harness.sh --local-tarball <path> --mode plugin`.
 *   `--mode plugin` is the default selector for the Phase 8 harness (the
 *   plugin-install path is the primary install vector); the curl spec passes
 *   `--mode curl` for the alternate path. Both modes share the same outer
 *   assertion contract: harness exit 0 + `HARNESS_OK` sentinel in combined
 *   stdout/stderr.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");
const HARNESS = join(REPO_ROOT, "test/docker/run-harness.sh");
const TARBALL = join(REPO_ROOT, "dist/loom-local-test.tar.gz");
const PLUGIN_MANIFEST = join(REPO_ROOT, ".claude-plugin/plugin.json");

function hasDocker(): boolean {
  const r = spawnSync("docker", ["info"], { stdio: "ignore" });
  return r.status === 0;
}

const DOCKER_AVAILABLE = hasDocker();
const TARBALL_AVAILABLE = existsSync(TARBALL);
const HARNESS_AVAILABLE = existsSync(HARNESS);
const DEPS_AVAILABLE =
  DOCKER_AVAILABLE && TARBALL_AVAILABLE && HARNESS_AVAILABLE;

describe("Phase 12 — plugin-install E2E (S-01)", () => {
  it("Phase 8 harness driver is present (delegation target)", () => {
    expect(existsSync(HARNESS)).toBe(true);
  });

  it("plugin manifest is present at .claude-plugin/plugin.json (install target)", () => {
    // The plugin manifest is the artifact `/plugin install loom@<tag>` resolves
    // against. Its presence is a bare-fact regression guard that fires even
    // when docker is absent.
    expect(existsSync(PLUGIN_MANIFEST)).toBe(true);
  });

  it.skipIf(!DEPS_AVAILABLE)(
    "S-01: /plugin install loom@<tag> on fresh container → /loom-doctor --json reports overallStatus=clean and exits 0",
    () => {
      // Delegates to the Phase 8 harness with --mode plugin. The harness builds
      // a clean container, runs `/plugin install loom@<tag>` against the signed
      // release tarball (Phase 7), runs `/loom-doctor --json`, and asserts
      // overallStatus === "clean" + exit 0 inside the inner script. The outer
      // spec asserts on the harness exit code and the HARNESS_OK sentinel.
      const result = spawnSync(
        "bash",
        [
          HARNESS,
          "--local-tarball",
          TARBALL,
          "--mode",
          "plugin",
        ],
        {
          encoding: "utf8",
          cwd: REPO_ROOT,
          timeout: 600_000,
        }
      );
      expect(result.status).toBe(0);
      const combined = (result.stdout ?? "") + (result.stderr ?? "");
      expect(combined).toContain("HARNESS_OK");
    }
  );

  it.skipIf(DEPS_AVAILABLE)(
    "spec cleanly skips when docker/tarball/harness are absent locally",
    () => {
      // Bare-fact: when dependencies are not present, the spec MUST still
      // pass so local dev iteration is not blocked. CI re-runs with the full
      // dependency set.
      expect(DEPS_AVAILABLE).toBe(false);
    }
  );
});
