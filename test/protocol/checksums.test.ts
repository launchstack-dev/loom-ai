/**
 * Tests for scripts/generate-checksums.sh and scripts/verify-checksums.sh.
 *
 * These scripts guard the install.sh integrity-verification path: if the
 * manifest drifts from the files it tracks, cold installs break. The
 * tests exercise each behavior in a sandbox manifest so we can prove
 * generation + drift detection + missing-file handling without touching
 * the repo's real checksums.sha256.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";

const SCRIPT = path.resolve(__dirname, "..", "..", "scripts", "generate-checksums.sh");

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function runScript(cwd: string, args: string[] = []): { code: number; stdout: string; stderr: string } {
  // Each test invokes the script in a freshly-built fake "repo" so we
  // need to set up a scripts/ subdirectory with the real script copied in
  // (the script computes REPO_ROOT relative to its own location).
  const result = spawnSync("bash", [SCRIPT, ...args], {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, PATH: process.env.PATH || "" },
  });
  return {
    code: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function setupFakeRepo(): string {
  // Build a tmp dir with the same scripts/ layout as the real repo, then
  // run the script against it. The script computes REPO_ROOT as
  // dirname(scripts/) so we copy the real script into a scripts/
  // subdirectory of the tmp dir, and the manifest at the tmp root.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loom-checksums-"));
  fs.mkdirSync(path.join(tmp, "scripts"));
  fs.copyFileSync(SCRIPT, path.join(tmp, "scripts", "generate-checksums.sh"));
  fs.chmodSync(path.join(tmp, "scripts", "generate-checksums.sh"), 0o755);
  return tmp;
}

function tmpScript(repo: string): string {
  return path.join(repo, "scripts", "generate-checksums.sh");
}

function runIn(repo: string, args: string[] = []): { code: number; stdout: string; stderr: string } {
  const result = spawnSync("bash", [tmpScript(repo), ...args], {
    cwd: repo,
    encoding: "utf-8",
    env: { ...process.env },
  });
  return {
    code: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe("scripts/generate-checksums.sh", () => {
  let repo: string;

  beforeEach(() => {
    repo = setupFakeRepo();
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("regenerates a manifest where every tracked file's hash matches its content", () => {
    // Create two tracked files
    fs.writeFileSync(path.join(repo, "foo.txt"), "hello\n");
    fs.mkdirSync(path.join(repo, "sub"));
    fs.writeFileSync(path.join(repo, "sub", "bar.md"), "# heading\n");
    // Seed manifest with WRONG hashes — exercise the regeneration path
    fs.writeFileSync(
      path.join(repo, "checksums.sha256"),
      `0000000000000000000000000000000000000000000000000000000000000000  foo.txt\n` +
        `1111111111111111111111111111111111111111111111111111111111111111  sub/bar.md\n`,
    );

    const result = runIn(repo);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("regenerated");

    const manifest = fs.readFileSync(path.join(repo, "checksums.sha256"), "utf-8");
    expect(manifest).toContain(`${sha256("hello\n")}  foo.txt`);
    expect(manifest).toContain(`${sha256("# heading\n")}  sub/bar.md`);
  });

  it("--check exits 0 when manifest is up to date", () => {
    fs.writeFileSync(path.join(repo, "foo.txt"), "hello\n");
    fs.writeFileSync(
      path.join(repo, "checksums.sha256"),
      `${sha256("hello\n")}  foo.txt\n`,
    );

    const result = runIn(repo, ["--check"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("up to date");
  });

  it("--check exits 1 when manifest has drifted", () => {
    fs.writeFileSync(path.join(repo, "foo.txt"), "modified content\n");
    fs.writeFileSync(
      path.join(repo, "checksums.sha256"),
      `${sha256("original content\n")}  foo.txt\n`,
    );

    const result = runIn(repo, ["--check"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("DRIFT");
    expect(result.stderr).toContain("scripts/generate-checksums.sh");
  });

  it("exits 1 when a tracked file is missing", () => {
    fs.writeFileSync(
      path.join(repo, "checksums.sha256"),
      `${sha256("anything\n")}  nonexistent.txt\n`,
    );

    const result = runIn(repo);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("MISSING");
    expect(result.stderr).toContain("nonexistent.txt");
  });

  it("exits 2 when checksums.sha256 is absent", () => {
    const result = runIn(repo);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("not found");
  });

  it("ignores blank lines and comments in the manifest", () => {
    fs.writeFileSync(path.join(repo, "foo.txt"), "hello\n");
    fs.writeFileSync(
      path.join(repo, "checksums.sha256"),
      `# This manifest is generated by scripts/generate-checksums.sh\n` +
        `\n` +
        `${sha256("hello\n")}  foo.txt\n`,
    );

    const result = runIn(repo, ["--check"]);
    expect(result.code).toBe(0);
  });

  it("rejects unknown arguments with exit code 2", () => {
    fs.writeFileSync(path.join(repo, "foo.txt"), "hello\n");
    fs.writeFileSync(
      path.join(repo, "checksums.sha256"),
      `${sha256("hello\n")}  foo.txt\n`,
    );

    const result = runIn(repo, ["--bogus"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("unknown argument");
  });
});

describe("real repo manifest", () => {
  it("scripts/verify-checksums.sh exits 0 — the manifest committed to main matches reality", () => {
    // This is the regression guard the CI workflow runs. If this test
    // fails locally, run `scripts/generate-checksums.sh` and re-stage.
    const repoRoot = path.resolve(__dirname, "..", "..");
    const verify = path.join(repoRoot, "scripts", "verify-checksums.sh");
    const result = spawnSync("bash", [verify], {
      cwd: repoRoot,
      encoding: "utf-8",
    });
    if (result.status !== 0) {
      console.error("verify-checksums.sh stderr:", result.stderr);
      console.error("verify-checksums.sh stdout:", result.stdout);
    }
    expect(result.status).toBe(0);
  });
});
