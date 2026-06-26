import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Two behaviors under test, both protecting against duplicate path entries
 * in checksums.sha256:
 *
 *  1. scripts/generate-checksums.sh dedupes its input on regeneration —
 *     a manifest with duplicate path entries normalises to one entry per
 *     path after running the generator.
 *
 *  2. install.sh's verify_checksum is defensive — even if a manifest with
 *     duplicate path entries somehow survives generation, the equality
 *     check picks the first hash and succeeds when content matches.
 *     (Tested by exercising the embedded `grep | awk | head -n 1` pipeline
 *     literal against fixtures.)
 *
 * Background: PR #24 surfaced this exact bug. The fixer (this PR) belt-
 * and-suspenders both ends of the contract.
 */

const REPO_ROOT = path.resolve(__dirname, "..");
const GENERATE_SCRIPT = path.join(REPO_ROOT, "scripts/generate-checksums.sh");

// Mirror of install.sh's verify_checksum pipeline — keep in sync.
// Single awk: literal `$2 == src` (no grep-regex traps); `exit` after first
// match handles duplicates for free; awk exits 0 on no-match so the line
// survives `set -euo pipefail` without `|| true`. If install.sh's pipeline
// changes shape, this constant must move in lockstep. (Gemini #28 round-2.)
const VERIFY_PIPELINE = `awk -v src="__SRC__" '$2 == src {print $1; exit}' __FILE__ 2>/dev/null`;

let sandbox: string;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "loom-checksum-dedup-"));
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function runShell(cmd: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("bash", ["-c", cmd], { encoding: "utf-8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("install.sh verify_checksum pipeline tolerates duplicate manifest entries", () => {
  it("picks the first hash when a path appears once", () => {
    const manifest = path.join(sandbox, "checksums.sha256");
    fs.writeFileSync(
      manifest,
      "abc123def456abc123def456abc123def456abc123def456abc123def456abcd  commands/foo.md\n",
    );
    const cmd = VERIFY_PIPELINE.replace("__SRC__", "commands/foo.md").replace(
      "__FILE__",
      manifest,
    );
    const result = runShell(cmd);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(
      "abc123def456abc123def456abc123def456abc123def456abc123def456abcd",
    );
  });

  it("picks the first hash when the path appears multiple times (defensive)", () => {
    const manifest = path.join(sandbox, "checksums.sha256");
    fs.writeFileSync(
      manifest,
      [
        "abc123def456abc123def456abc123def456abc123def456abc123def456abcd  commands/foo.md",
        "abc123def456abc123def456abc123def456abc123def456abc123def456abcd  commands/foo.md",
      ].join("\n") + "\n",
    );
    const cmd = VERIFY_PIPELINE.replace("__SRC__", "commands/foo.md").replace(
      "__FILE__",
      manifest,
    );
    const result = runShell(cmd);
    expect(result.status).toBe(0);
    // Should be ONE hash, not a newline-joined pair. The bug being defended
    // against produced `"abc...\nabc..."` which then mismatched against the
    // single-hash actual value.
    expect(result.stdout.trim().split("\n").length).toBe(1);
    expect(result.stdout.trim()).toBe(
      "abc123def456abc123def456abc123def456abc123def456abc123def456abcd",
    );
  });
});

describe("scripts/generate-checksums.sh dedupes duplicate path entries", () => {
  it("preserves a single-entry manifest unchanged (regression)", () => {
    // Build a tiny fake repo with one file and a manifest pointing at it.
    const fakeRepo = path.join(sandbox, "repo");
    fs.mkdirSync(path.join(fakeRepo, "scripts"), { recursive: true });
    fs.copyFileSync(GENERATE_SCRIPT, path.join(fakeRepo, "scripts/generate-checksums.sh"));
    fs.chmodSync(path.join(fakeRepo, "scripts/generate-checksums.sh"), 0o755);
    fs.mkdirSync(path.join(fakeRepo, "commands"));
    fs.writeFileSync(path.join(fakeRepo, "commands/foo.md"), "hello\n");

    const expectedSha = spawnSync("shasum", ["-a", "256", path.join(fakeRepo, "commands/foo.md")], {
      encoding: "utf-8",
    }).stdout.split(/\s+/)[0];

    const manifest = path.join(fakeRepo, "checksums.sha256");
    fs.writeFileSync(manifest, `${expectedSha}  commands/foo.md\n`);

    const result = runShell(`cd '${fakeRepo}' && bash scripts/generate-checksums.sh`);
    expect(result.status).toBe(0);

    const out = fs.readFileSync(manifest, "utf-8");
    const lines = out.trim().split("\n");
    expect(lines.length).toBe(1);
    expect(lines[0]).toMatch(/commands\/foo\.md$/);
  });

  it("collapses duplicate path entries to one, reporting the count", () => {
    const fakeRepo = path.join(sandbox, "repo");
    fs.mkdirSync(path.join(fakeRepo, "scripts"), { recursive: true });
    fs.copyFileSync(GENERATE_SCRIPT, path.join(fakeRepo, "scripts/generate-checksums.sh"));
    fs.chmodSync(path.join(fakeRepo, "scripts/generate-checksums.sh"), 0o755);
    fs.mkdirSync(path.join(fakeRepo, "commands"));
    fs.writeFileSync(path.join(fakeRepo, "commands/foo.md"), "hello\n");

    // Manifest with 3 duplicate path entries (with bogus placeholder hashes).
    const manifest = path.join(fakeRepo, "checksums.sha256");
    fs.writeFileSync(
      manifest,
      [
        "0000000000000000000000000000000000000000000000000000000000000000  commands/foo.md",
        "0000000000000000000000000000000000000000000000000000000000000000  commands/foo.md",
        "0000000000000000000000000000000000000000000000000000000000000000  commands/foo.md",
      ].join("\n") + "\n",
    );

    const result = runShell(`cd '${fakeRepo}' && bash scripts/generate-checksums.sh`);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("deduped");
    expect(result.stderr).toContain("2 duplicate path entry");

    const out = fs.readFileSync(manifest, "utf-8");
    const lines = out.trim().split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBe(1);
    // Hash should be the freshly-computed one, not the bogus zero placeholder.
    expect(lines[0]).not.toMatch(/^0000/);
    expect(lines[0]).toMatch(/commands\/foo\.md$/);
  });

  it("preserves comments and blank lines verbatim across dedup", () => {
    const fakeRepo = path.join(sandbox, "repo");
    fs.mkdirSync(path.join(fakeRepo, "scripts"), { recursive: true });
    fs.copyFileSync(GENERATE_SCRIPT, path.join(fakeRepo, "scripts/generate-checksums.sh"));
    fs.chmodSync(path.join(fakeRepo, "scripts/generate-checksums.sh"), 0o755);
    fs.mkdirSync(path.join(fakeRepo, "commands"));
    fs.writeFileSync(path.join(fakeRepo, "commands/foo.md"), "hello\n");

    const manifest = path.join(fakeRepo, "checksums.sha256");
    fs.writeFileSync(
      manifest,
      [
        "# Loom checksums",
        "",
        "0000000000000000000000000000000000000000000000000000000000000000  commands/foo.md",
        "0000000000000000000000000000000000000000000000000000000000000000  commands/foo.md",
        "",
        "# end",
      ].join("\n") + "\n",
    );

    const result = runShell(`cd '${fakeRepo}' && bash scripts/generate-checksums.sh`);
    expect(result.status).toBe(0);

    const out = fs.readFileSync(manifest, "utf-8");
    expect(out).toContain("# Loom checksums");
    expect(out).toContain("# end");
    const dataLines = out.split("\n").filter((l) => l && !l.startsWith("#"));
    expect(dataLines.length).toBe(1);
  });
});
