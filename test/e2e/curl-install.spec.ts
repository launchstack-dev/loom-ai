/**
 * Phase 11B — Wave 6a: curl-install E2E spec (Scenario S-01).
 *
 * Verifies the curl-path correctness contract: on a fresh container,
 * `curl install.sh | sh` followed by `/loom-doctor --json` produces
 * `overallStatus === "clean"` and exits 0.
 *
 * Execution model:
 *   - Production CI: docker present + the Phase 8 packaging pipeline has
 *     produced `dist/loom-local-test.tar.gz`. The spec runs the full matrix
 *     via the Phase 8 clean-machine harness (`test/docker/run-harness.sh`).
 *   - Local dev: docker absent OR tarball missing → graceful skip via
 *     `it.skipIf`. The bare-fact assertions (spec wiring, harness presence)
 *     still execute so regressions in the surrounding scaffolding surface.
 *
 * This mirrors the degradation pattern established by
 * `test/plugin-install-e2e.test.ts` (Phase 8) so CI behavior stays
 * consistent across the install-path matrix.
 *
 * Harness integration:
 *   The spec invokes `bash test/docker/run-harness.sh --local-tarball <path> --mode curl`.
 *   The `--mode` argument is the curl-vs-plugin selector used to switch the
 *   inner script's install command. See `integrationNotes` in the Wave 6a
 *   AgentResult — if run-harness.sh does not yet recognize `--mode`, a wiring
 *   pass must extend it. The spec passes the flag regardless so the contract
 *   is locked in source.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");
const HARNESS = join(REPO_ROOT, "test/docker/run-harness.sh");
const TARBALL = join(REPO_ROOT, "dist/loom-local-test.tar.gz");
const INSTALL_SH = join(REPO_ROOT, "install.sh");

function hasDocker(): boolean {
  const r = spawnSync("docker", ["info"], { stdio: "ignore" });
  return r.status === 0;
}

function hasCurl(): boolean {
  const r = spawnSync("curl", ["--version"], { stdio: "ignore" });
  return r.status === 0;
}

const DOCKER_AVAILABLE = hasDocker();
const CURL_AVAILABLE = hasCurl();
const TARBALL_AVAILABLE = existsSync(TARBALL);
const HARNESS_AVAILABLE = existsSync(HARNESS);
const DEPS_AVAILABLE =
  DOCKER_AVAILABLE && CURL_AVAILABLE && TARBALL_AVAILABLE && HARNESS_AVAILABLE;

describe("Phase 11B — curl-install E2E (S-01)", () => {
  it("install.sh is present at repo root (curl install target)", () => {
    expect(existsSync(INSTALL_SH)).toBe(true);
  });

  it("Phase 8 harness driver is present (delegation target)", () => {
    expect(existsSync(HARNESS)).toBe(true);
  });

  it.skipIf(!DEPS_AVAILABLE)(
    "S-01: curl install on fresh container → /loom-doctor --json reports overallStatus=clean and exits 0",
    () => {
      // Delegates to the Phase 8 harness with --mode curl. The harness builds
      // a clean container, fetches install.sh from the bind-mounted repo (or
      // pipes it through curl in CI), runs /loom-doctor --json, and asserts
      // overallStatus === "clean" + exit 0 inside the inner script. The outer
      // spec asserts on the harness exit code and HARNESS_OK sentinel.
      const result = spawnSync(
        "bash",
        [
          HARNESS,
          "--local-tarball",
          TARBALL,
          "--mode",
          "curl",
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
    "spec cleanly skips when docker/curl/tarball/harness are absent locally",
    () => {
      // Bare-fact: when dependencies are not present, the spec MUST still
      // pass so local dev iteration is not blocked. CI re-runs with the full
      // dependency set.
      expect(DEPS_AVAILABLE).toBe(false);
    }
  );
});
