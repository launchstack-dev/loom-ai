/**
 * tests/ci/changed-files-mapping.test.ts — behavioral tests for
 * scripts/ci/changed-files-vitest.ts (check name: changed-file-tests, frozen
 * in protocols/ci-gates.contract.md).
 *
 * Exercises the script as a subprocess in --dry-run mode with an explicit
 * --files list (bypasses git), asserting the changed-path → test-file mapping:
 * sibling/{__tests__}/mirror conventions, the content scan that lets a
 * behavioral test claim the script it spawns, full-suite escalation, and the
 * exit-3 git-unavailable path.
 *
 * Run: bunx vitest run tests/ci/changed-files-mapping.test.ts
 */

import { describe, it, expect, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const SCRIPT = join(REPO_ROOT, "scripts/ci/changed-files-vitest.ts");

const RUNTIME: string = (() => {
  try {
    execFileSync("bun", ["--version"], { stdio: "ignore" });
    return "bun";
  } catch {
    return process.execPath;
  }
})();

interface DryRun {
  status: number | null;
  stdout: string;
  stderr: string;
  mode: string;
  resolvedTests: string[];
  unmapped: string[];
}

function dryRun(files: string[], root: string = REPO_ROOT): DryRun {
  const res = spawnSync(
    RUNTIME,
    [SCRIPT, "--dry-run", "--files", files.join(","), "--root", root],
    { cwd: root, encoding: "utf8" },
  );
  const stdout = res.stdout ?? "";
  const grab = (key: string): string[] => {
    const match = stdout.match(new RegExp(`^${key}\\[\\d+\\]:[ \\t]*(.*)$`, "m"));
    if (!match || !match[1].trim()) return [];
    return match[1].split(",").map((s) => s.trim()).filter(Boolean);
  };
  return {
    status: res.status,
    stdout,
    stderr: res.stderr ?? "",
    mode: stdout.match(/^ {2}mode: (.+)$/m)?.[1] ?? "",
    resolvedTests: grab("resolvedTests"),
    unmapped: grab("unmapped"),
  };
}

describe("changed-files-vitest mapping (real repo)", () => {
  it("maps a CI script to the behavioral test that spawns it (content scan)", () => {
    const res = dryRun(["scripts/ci/check-hook-drift.ts"]);
    expect(res.status).toBe(0);
    expect(res.mode).toBe("mapped");
    // tests/ci/drift-checks.test.ts spawns check-hook-drift.ts by path, so a
    // change to the script must pull that test into the PR gate.
    expect(res.resolvedTests).toContain("tests/ci/drift-checks.test.ts");
  });

  it("maps changed-files-vitest.ts to this mapping test", () => {
    const res = dryRun(["scripts/ci/changed-files-vitest.ts"]);
    expect(res.status).toBe(0);
    expect(res.resolvedTests).toContain("tests/ci/changed-files-mapping.test.ts");
  });

  it("maps a hook to its hooks/__tests__ neighbor", () => {
    const res = dryRun(["hooks/file-ownership.ts"]);
    expect(res.status).toBe(0);
    expect(res.resolvedTests).toContain("hooks/__tests__/file-ownership.test.ts");
  });

  it("runs a changed test file directly", () => {
    const res = dryRun(["tests/ci/changed-files-mapping.test.ts"]);
    expect(res.status).toBe(0);
    expect(res.resolvedTests).toContain("tests/ci/changed-files-mapping.test.ts");
  });

  it("escalates to the full suite when vitest.config.ts changes", () => {
    const res = dryRun(["vitest.config.ts", "scripts/ci/check-docs-drift.ts"]);
    expect(res.status).toBe(0);
    expect(res.mode).toBe("full-suite");
    expect(res.resolvedTests).toEqual([]);
  });

  it("exits 0 in no-tests mode for non-code changes", () => {
    const res = dryRun(["README.md", "planning/plans/PLAN-exceed-gstack.md"]);
    expect(res.status).toBe(0);
    expect(res.mode).toBe("no-tests");
    expect(res.resolvedTests).toEqual([]);
  });

  it("reports source files it cannot map as unmapped (nightly backstop)", () => {
    // Name assembled at runtime so the content scan cannot match THIS file.
    const phantom = ["scripts/ci/zz-unmappable", "fixture.ts"].join("-");
    const res = dryRun([phantom]);
    expect(res.status).toBe(0);
    expect(res.unmapped).toContain(phantom);
  });
});

describe("changed-files-vitest mapping (hermetic fixture root)", () => {
  const tempDirs: string[] = [];
  afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  });

  function makeFixtureRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), "loom-changed-files-"));
    tempDirs.push(dir);
    mkdirSync(join(dir, "scripts/util"), { recursive: true });
    mkdirSync(join(dir, "hooks/__tests__"), { recursive: true });
    mkdirSync(join(dir, "tests/util"), { recursive: true });
    // sibling convention
    writeFileSync(join(dir, "scripts/util/alpha.ts"), "export const a = 1;\n");
    writeFileSync(join(dir, "scripts/util/alpha.test.ts"), "// sibling test\n");
    // __tests__ convention
    writeFileSync(join(dir, "hooks/beta.ts"), "export const b = 2;\n");
    writeFileSync(join(dir, "hooks/__tests__/beta.test.ts"), "// __tests__ test\n");
    // tests/ mirror with scripts/ prefix stripped
    writeFileSync(join(dir, "scripts/util/gamma.ts"), "export const c = 3;\n");
    writeFileSync(join(dir, "tests/util/gamma.test.ts"), "// mirror test\n");
    return dir;
  }

  it("resolves sibling, __tests__, and tests/ mirror conventions", () => {
    const root = makeFixtureRoot();

    const sibling = dryRun(["scripts/util/alpha.ts"], root);
    expect(sibling.resolvedTests).toContain("scripts/util/alpha.test.ts");

    const dunder = dryRun(["hooks/beta.ts"], root);
    expect(dunder.resolvedTests).toContain("hooks/__tests__/beta.test.ts");

    const mirror = dryRun(["scripts/util/gamma.ts"], root);
    expect(mirror.resolvedTests).toContain("tests/util/gamma.test.ts");
  });

  it("exits 3 when git is unavailable and no --files list is given", () => {
    const root = makeFixtureRoot();
    const res = spawnSync(RUNTIME, [SCRIPT, "--dry-run", "--root", root], {
      cwd: root,
      encoding: "utf8",
    });
    expect(res.status).toBe(3);
    expect(res.stderr).toContain("GIT_DIFF_UNAVAILABLE");
  });
});
