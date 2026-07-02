/**
 * tests/lib/entry-guard.test.ts — PLAN-exceed-gstack Phase 2b (F-02).
 *
 * Behavioral tests for `isMain(import.meta)` — the guard Phase 14a uses to
 * gate the top-level `main()` calls in scripts/loom-version-slot.ts and
 * scripts/loom-browser-daemon.ts.
 *
 * Coverage matrix (real subprocesses, not mocks):
 *   - bun          — direct execution → MAIN; imported module → NOT_MAIN
 *   - plain node   — .ts via type stripping (node ≥ 22.6): same pair
 *   - node + tsx   — loader-imported entry (native import.meta.main is
 *                    false/undefined there — the argv[1] check must win)
 * plus synthesized-ImportMeta unit tests pinning each decision branch.
 *
 * Run: bunx vitest run tests/lib/entry-guard.test.ts
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { isMain } from "../../lib/index.js";
import * as entryGuardModule from "../../lib/entry-guard.js";
import * as barrel from "../../lib/index.js";

const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const ENTRY_GUARD_URL = pathToFileURL(
  path.join(REPO_ROOT, "lib", "entry-guard.ts"),
).href;
const BARREL_URL = pathToFileURL(path.join(REPO_ROOT, "lib", "index.ts")).href;

// ---------------------------------------------------------------------------
// Runtime detection
// ---------------------------------------------------------------------------

function binWorks(cmd: string, args: string[]): boolean {
  try {
    return spawnSync(cmd, args, { encoding: "utf8", timeout: 20_000 }).status === 0;
  } catch {
    return false;
  }
}

const hasBun = binWorks("bun", ["--version"]);
const hasNpx = binWorks("npx", ["--version"]);

/** node argv prefix that can execute a .ts file, or null if unsupported. */
function nodeTsRunner(): string[] | null {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major >= 23) return [process.execPath, "--no-warnings"];
  if (major === 22 && minor >= 6) {
    return [process.execPath, "--no-warnings", "--experimental-strip-types"];
  }
  return null;
}

const nodeRunner = nodeTsRunner();

// ---------------------------------------------------------------------------
// Fixtures — written to a temp dir; the probe imports the REAL lib module.
// ---------------------------------------------------------------------------

let fixtureDir: string;
let probePath: string;
let importerPath: string;
let barrelProbePath: string;

beforeAll(() => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "entry-guard-test-"));

  // Probe: reports whether ITS OWN import.meta is the process entry.
  probePath = path.join(fixtureDir, "probe.ts");
  fs.writeFileSync(
    probePath,
    [
      `import { isMain } from ${JSON.stringify(ENTRY_GUARD_URL)};`,
      `console.log(isMain(import.meta) ? "MAIN" : "NOT_MAIN");`,
      "",
    ].join("\n"),
  );

  // Importer: pulls the probe in as a dependency — the probe must then
  // report NOT_MAIN even though the process is running.
  importerPath = path.join(fixtureDir, "importer.ts");
  fs.writeFileSync(
    importerPath,
    [`import "./probe.ts";`, `console.log("IMPORTER_DONE");`, ""].join("\n"),
  );

  // Barrel probe (bun/tsx only — plain node cannot remap the barrel's
  // `.js` specifiers onto .ts sources without a loader).
  barrelProbePath = path.join(fixtureDir, "barrel-probe.ts");
  fs.writeFileSync(
    barrelProbePath,
    [
      `import { isMain } from ${JSON.stringify(BARREL_URL)};`,
      `console.log(isMain(import.meta) ? "MAIN" : "NOT_MAIN");`,
      "",
    ].join("\n"),
  );
});

afterAll(() => {
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});

function run(argv: string[]): { stdout: string; status: number | null } {
  const [cmd, ...args] = argv;
  const res = spawnSync(cmd, args, {
    encoding: "utf8",
    cwd: fixtureDir,
    timeout: 25_000,
  });
  return { stdout: (res.stdout ?? "").trim(), status: res.status };
}

// ---------------------------------------------------------------------------
// Subprocess tests per runtime
// ---------------------------------------------------------------------------

describe.skipIf(!hasBun)("isMain under bun", () => {
  it("returns true when the module is the process entry", () => {
    const res = run(["bun", probePath]);
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("MAIN");
  });

  it("returns false when the module is merely imported", () => {
    const res = run(["bun", importerPath]);
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("NOT_MAIN\nIMPORTER_DONE");
  });

  it("behaves identically when imported through the lib/index.ts barrel", () => {
    const res = run(["bun", barrelProbePath]);
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("MAIN");
  });
});

describe.skipIf(nodeRunner === null)("isMain under plain node (type stripping)", () => {
  it("returns true when the module is the process entry", () => {
    const res = run([...(nodeRunner as string[]), probePath]);
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("MAIN");
  });

  it("returns false when the module is merely imported", () => {
    const res = run([...(nodeRunner as string[]), importerPath]);
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("NOT_MAIN\nIMPORTER_DONE");
  });
});

describe.skipIf(!hasNpx)("isMain under node + tsx (loader-imported entry)", () => {
  // Under tsx the user script is dynamically imported by the loader, so the
  // NATIVE import.meta.main is false/undefined for the true entry — the
  // argv[1] comparison must carry this case (the repo pattern: hooks and
  // scripts are spawned as `npx tsx <file>`).
  it("returns true for the tsx-launched entry script", () => {
    const res = run(["npx", "-y", "tsx", probePath]);
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("MAIN");
  });

  it("returns false for a module imported by the tsx-launched entry", () => {
    const res = run(["npx", "-y", "tsx", importerPath]);
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("NOT_MAIN\nIMPORTER_DONE");
  });

  it("behaves identically when imported through the lib/index.ts barrel", () => {
    const res = run(["npx", "-y", "tsx", barrelProbePath]);
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("MAIN");
  });
});

// ---------------------------------------------------------------------------
// In-process behavior (this test file is NOT the entry) + decision branches
// ---------------------------------------------------------------------------

describe("isMain in-process and per-branch", () => {
  it("returns false for a vitest-imported module (this file is not the entry)", () => {
    expect(isMain(import.meta)).toBe(false);
  });

  it("barrel and module export the exact same function (no duplication)", () => {
    expect(barrel.isMain).toBe(entryGuardModule.isMain);
  });

  it("argv[1] match wins even when the native flag is false (tsx shape)", () => {
    // tsx: argv[1] is the user script, but the loader-imported module has
    // native main === false. isMain must still say true.
    const entryUrl = pathToFileURL(path.resolve(process.argv[1] as string)).href;
    const fakeMeta = { url: entryUrl, main: false } as unknown as ImportMeta;
    expect(isMain(fakeMeta)).toBe(true);
  });

  it("trusts a native main === true when argv gives no match (bun eval shape)", () => {
    const fakeMeta = {
      url: pathToFileURL(path.join(os.tmpdir(), "nowhere.ts")).href,
      main: true,
    } as unknown as ImportMeta;
    expect(isMain(fakeMeta)).toBe(true);
  });

  it("fails closed on a non-file URL", () => {
    const fakeMeta = { url: "data:text/javascript,export{}" } as unknown as ImportMeta;
    expect(isMain(fakeMeta)).toBe(false);
  });

  it("fails closed when there is no argv match and no native flag", () => {
    const fakeMeta = {
      url: pathToFileURL(path.join(os.tmpdir(), "unrelated.ts")).href,
    } as unknown as ImportMeta;
    expect(isMain(fakeMeta)).toBe(false);
  });

  it("resolves symlinked argv paths to the same module (macOS /tmp → /private/tmp)", () => {
    const realDir = fs.mkdtempSync(path.join(os.tmpdir(), "entry-guard-link-"));
    try {
      const realFile = path.join(realDir, "real.ts");
      fs.writeFileSync(realFile, "// stub\n");
      const linkFile = path.join(realDir, "link.ts");
      fs.symlinkSync(realFile, linkFile);

      const savedArgv1 = process.argv[1];
      process.argv[1] = linkFile;
      try {
        const fakeMeta = {
          url: pathToFileURL(realFile).href,
          main: false,
        } as unknown as ImportMeta;
        expect(isMain(fakeMeta)).toBe(true);
      } finally {
        process.argv[1] = savedArgv1;
      }
    } finally {
      fs.rmSync(realDir, { recursive: true, force: true });
    }
  });
});
