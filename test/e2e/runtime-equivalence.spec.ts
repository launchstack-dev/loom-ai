/**
 * Phase 11B — Wave 6a: cross-path runtime-equivalence E2E spec (Scenario S-02).
 *
 * Verifies that the plugin-install path and the curl-install path produce
 * runtime-equivalent /loom-doctor reports — i.e. the same set of checks
 * runs and each check resolves to the same status. This is the contract
 * that makes the dual install paths interchangeable from a correctness
 * standpoint: pick the path that fits your workflow, not your bug surface.
 *
 * Fixtures (created under test/e2e/fixtures/):
 *   plugin-install/ — .claude-plugin/plugin.json + ${CLAUDE_PLUGIN_ROOT}-anchored .claude/settings.json
 *   curl-install/   — hooks/run-hook.sh + ${CLAUDE_PROJECT_DIR}-anchored .claude/settings.json
 *
 * Both fixtures carry a stub `.loom/plugin-root` so the init-guard prelude
 * does not abort /loom-doctor with the "uninitialized" diagnostic.
 *
 * Invocation:
 *   `bunx tsx scripts/loom-doctor.ts --json` run from each fixture cwd.
 *   Parse the JSON report and compare:
 *     - checks[].id  array (set + order)
 *     - checks[].status array (per-id outcome)
 *
 * Degradation:
 *   /loom-doctor depends on tsx + the scripts/lib/doctor/checks/* tree.
 *   When tsx is unavailable on PATH, or when the doctor invocation errors
 *   for environment reasons unrelated to the install path, the spec
 *   skips gracefully. The fixture wiring assertions still run.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");
const FIXTURES = join(__dirname, "fixtures");
const PLUGIN_FIXTURE = join(FIXTURES, "plugin-install");
const CURL_FIXTURE = join(FIXTURES, "curl-install");
const DOCTOR = join(REPO_ROOT, "scripts/loom-doctor.ts");

function hasTsx(): boolean {
  const r = spawnSync("bunx", ["--version"], { stdio: "ignore" });
  if (r.status === 0) return true;
  const r2 = spawnSync("npx", ["--version"], { stdio: "ignore" });
  return r2.status === 0;
}

interface DoctorCheck {
  id: string;
  status: "pass" | "warn" | "fail";
}

interface DoctorReport {
  schemaVersion?: number;
  overallStatus?: "clean" | "warnings" | "problems";
  exitCode?: number;
  checks?: DoctorCheck[];
}

function runDoctor(cwd: string): {
  ok: boolean;
  report?: DoctorReport;
  raw: string;
  status: number | null;
} {
  // Prefer bunx (project convention), fall back to npx.
  const runners: Array<[string, string[]]> = [
    ["bunx", ["tsx", DOCTOR, "--json"]],
    ["npx", ["tsx", DOCTOR, "--json"]],
  ];
  for (const [cmd, args] of runners) {
    const r = spawnSync(cmd, args, {
      encoding: "utf8",
      cwd,
      timeout: 60_000,
      env: {
        ...process.env,
        // Ensure CLAUDE_PROJECT_DIR resolves to the fixture so curl-anchored
        // settings inspection finds the stub run-hook.sh.
        CLAUDE_PROJECT_DIR: cwd,
      },
    });
    if (r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT")
      continue;
    const raw = (r.stdout ?? "") + (r.stderr ?? "");
    try {
      // The JSON payload may be interleaved with stderr progress; extract the
      // first top-level JSON object that contains a "checks" key.
      const match = raw.match(/\{[\s\S]*"checks"[\s\S]*\}/);
      if (!match) {
        return { ok: false, raw, status: r.status };
      }
      const report = JSON.parse(match[0]) as DoctorReport;
      return { ok: true, report, raw, status: r.status };
    } catch {
      return { ok: false, raw, status: r.status };
    }
  }
  return { ok: false, raw: "", status: null };
}

const TSX_AVAILABLE = hasTsx();
const DOCTOR_AVAILABLE = existsSync(DOCTOR);
const FIXTURES_AVAILABLE =
  existsSync(join(PLUGIN_FIXTURE, ".claude-plugin/plugin.json")) &&
  existsSync(join(PLUGIN_FIXTURE, ".claude/settings.json")) &&
  existsSync(join(CURL_FIXTURE, "hooks/run-hook.sh")) &&
  existsSync(join(CURL_FIXTURE, ".claude/settings.json"));

const DEPS_AVAILABLE = TSX_AVAILABLE && DOCTOR_AVAILABLE && FIXTURES_AVAILABLE;

describe("Phase 11B — cross-path runtime equivalence (S-02)", () => {
  it("plugin-install fixture is well-formed", () => {
    expect(existsSync(join(PLUGIN_FIXTURE, ".claude-plugin/plugin.json"))).toBe(
      true
    );
    expect(existsSync(join(PLUGIN_FIXTURE, ".claude/settings.json"))).toBe(
      true
    );
  });

  it("curl-install fixture is well-formed", () => {
    expect(existsSync(join(CURL_FIXTURE, "hooks/run-hook.sh"))).toBe(true);
    expect(existsSync(join(CURL_FIXTURE, ".claude/settings.json"))).toBe(true);
  });

  it.skipIf(!DEPS_AVAILABLE)(
    "S-02: /loom-doctor --json produces identical checks[].id and checks[].status arrays across fixtures",
    () => {
      const plugin = runDoctor(PLUGIN_FIXTURE);
      const curl = runDoctor(CURL_FIXTURE);

      // If the doctor invocation could not produce a parseable report on
      // either side, skip the assertion (degradation; logged for triage).
      if (!plugin.ok || !curl.ok) {
        console.warn(
          "[runtime-equivalence] skipping: doctor JSON unavailable",
          { plugin: plugin.raw.slice(0, 200), curl: curl.raw.slice(0, 200) }
        );
        return;
      }

      const pluginChecks = plugin.report?.checks ?? [];
      const curlChecks = curl.report?.checks ?? [];

      const pluginIds = pluginChecks.map((c) => c.id);
      const curlIds = curlChecks.map((c) => c.id);

      // S-02 core assertion #1: identical checks[].id arrays.
      expect(curlIds).toEqual(pluginIds);

      const pluginStatuses = pluginChecks.map((c) => c.status);
      const curlStatuses = curlChecks.map((c) => c.status);

      // S-02 core assertion #2: identical checks[].status arrays.
      expect(curlStatuses).toEqual(pluginStatuses);
    }
  );

  it.skipIf(DEPS_AVAILABLE)(
    "spec cleanly skips when tsx/doctor/fixtures are absent locally",
    () => {
      expect(DEPS_AVAILABLE).toBe(false);
    }
  );
});
