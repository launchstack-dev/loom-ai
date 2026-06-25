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

// ---------------------------------------------------------------------------
// IterationSnapshot writer — covers checksum embedding + atomic write +
// retry-on-transient-failure per protocols/iteration-snapshot.schema.md.
//
// Validates locked decisions W-01 (ms-precision ISO 8601), W-02 (slug rule
// for multi-dot + extension-less filenames), and C-07 (keep all snapshots
// forever; no overwrite).
// ---------------------------------------------------------------------------

import {
  writeIterationSnapshot,
  deriveSlug,
  SnapshotWriteFailed,
  type WriteFileImpl,
} from "../../hooks/lib/iteration-snapshot.js";

describe("writeIterationSnapshot (iteration-snapshot.ts)", () => {
  let repoRoot: string;
  let snapshotDir: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "loom-snapshot-"));
    snapshotDir = path.join(repoRoot, "planning", "history", "snapshots");
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  function writeSubject(relPath: string, body: string): string {
    const abs = path.join(repoRoot, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
    return relPath;
  }

  function parseToon(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      if (!key) continue;
      out[key] = line.slice(idx + 1).trim();
    }
    return out;
  }

  it("happy path: writes copy + metadata; checksum matches sha256 of copy; iteration + slug + timestamp shape correct", async () => {
    const body = "# Plan\nIteration 2 content\n";
    const subject = writeSubject(
      "planning/PLAN-convergence-generalization.md",
      body,
    );

    const record = await writeIterationSnapshot({
      subject,
      iteration: 2,
      snapshotDir,
      repoRoot,
    });

    // Both files exist side-by-side under snapshotDir.
    const copyPath = path.join(
      snapshotDir,
      "PLAN-convergence-generalization-pass-2.md",
    );
    const metaPath = path.join(
      snapshotDir,
      "PLAN-convergence-generalization-pass-2.toon",
    );
    expect(fs.existsSync(copyPath)).toBe(true);
    expect(fs.existsSync(metaPath)).toBe(true);

    // Copy is byte-identical to source.
    expect(fs.readFileSync(copyPath, "utf-8")).toBe(body);

    // Checksum in metadata matches sha256 of the copy.
    const expected = `sha256:${sha256(body)}`;
    expect(record.snapshotChecksum).toBe(expected);

    const meta = parseToon(fs.readFileSync(metaPath, "utf-8"));
    expect(meta.snapshotChecksum).toBe(expected);
    expect(meta.iteration).toBe("2");
    expect(meta.slug).toBe("PLAN-convergence-generalization");
    expect(meta.sourcePath).toBe("planning/PLAN-convergence-generalization.md");
    expect(meta.snapshotPath).toBe(
      "planning/history/snapshots/PLAN-convergence-generalization-pass-2.md",
    );

    // Timestamp is ISO 8601 with millisecond precision (locked W-01).
    expect(meta.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    // Record returned mirrors what's on disk.
    expect(record.iteration).toBe(2);
    expect(record.slug).toBe("PLAN-convergence-generalization");
  });

  it("multi-dot filename: slug is basename minus FINAL extension only (W-02)", async () => {
    const subject = writeSubject("planning/PLAN-x.v2.md", "body\n");

    const record = await writeIterationSnapshot({
      subject,
      iteration: 1,
      snapshotDir,
      repoRoot,
    });

    expect(record.slug).toBe("PLAN-x.v2");
    expect(fs.existsSync(path.join(snapshotDir, "PLAN-x.v2-pass-1.md"))).toBe(true);
    expect(fs.existsSync(path.join(snapshotDir, "PLAN-x.v2-pass-1.toon"))).toBe(true);

    // Sanity-check the pure helper directly too.
    const derived = deriveSlug("planning/PLAN-x.v2.md");
    expect(derived.slug).toBe("PLAN-x.v2");
    expect(derived.ext).toBe(".md");
    expect(derived.basename).toBe("PLAN-x.v2.md");
  });

  it("no-extension subject: slug equals basename, copy has no extension, metadata still gets .toon", async () => {
    const subject = writeSubject("notes", "just a note\n");

    const record = await writeIterationSnapshot({
      subject,
      iteration: 1,
      snapshotDir,
      repoRoot,
    });

    expect(record.slug).toBe("notes");
    expect(fs.existsSync(path.join(snapshotDir, "notes-pass-1"))).toBe(true);
    expect(fs.existsSync(path.join(snapshotDir, "notes-pass-1.toon"))).toBe(true);

    const derived = deriveSlug("notes");
    expect(derived.slug).toBe("notes");
    expect(derived.ext).toBe("");
  });

  it("source missing: throws SNAPSHOT_WRITE_FAILED after attempting once (no retry needed — pre-write check)", async () => {
    // The source file is checked before the write loop begins, so a missing
    // source short-circuits without consuming the retry. This confirms the
    // helper distinguishes pre-write validation failures from transient
    // write failures.
    let sleepCalls = 0;
    const sleep = async (_ms: number) => {
      sleepCalls++;
    };

    await expect(
      writeIterationSnapshot({
        subject: "does/not/exist.md",
        iteration: 1,
        snapshotDir,
        repoRoot,
        sleep,
      }),
    ).rejects.toThrow(/^SNAPSHOT_WRITE_FAILED:/);
    expect(sleepCalls).toBe(0);

    // And the error is the expected class.
    let thrown: unknown;
    try {
      await writeIterationSnapshot({
        subject: "does/not/exist.md",
        iteration: 1,
        snapshotDir,
        repoRoot,
        sleep,
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(SnapshotWriteFailed);
    expect((thrown as Error).name).toBe("SnapshotWriteFailed");
  });

  it("transient EIO: first write attempt fails, second succeeds; both files end up on disk", async () => {
    const subject = writeSubject("planning/PLAN.md", "v1\n");

    let attempts = 0;
    let sleepCalls = 0;
    const sleep = async (ms: number) => {
      sleepCalls++;
      // Don't actually wait 1s in tests — but assert the requested duration
      // matches the locked 1-second backoff.
      expect(ms).toBe(1000);
    };
    // Custom writer: throw on first attempt, succeed on second by delegating
    // to the real fs primitives.
    const flaky: WriteFileImpl = ({ copyAbsPath, copyBytes, metaAbsPath, metaBytes }) => {
      attempts++;
      if (attempts === 1) {
        const err: NodeJS.ErrnoException = new Error("EIO simulated") as NodeJS.ErrnoException;
        err.code = "EIO";
        throw err;
      }
      const copyTmp = `${copyAbsPath}.tmp`;
      fs.writeFileSync(copyTmp, copyBytes);
      fs.renameSync(copyTmp, copyAbsPath);
      const metaTmp = `${metaAbsPath}.tmp`;
      fs.writeFileSync(metaTmp, metaBytes);
      fs.renameSync(metaTmp, metaAbsPath);
    };

    const record = await writeIterationSnapshot({
      subject,
      iteration: 1,
      snapshotDir,
      repoRoot,
      sleep,
      _writeFileImpl: flaky,
    });

    expect(attempts).toBe(2);
    expect(sleepCalls).toBe(1);
    expect(record.iteration).toBe(1);
    expect(fs.existsSync(path.join(snapshotDir, "PLAN-pass-1.md"))).toBe(true);
    expect(fs.existsSync(path.join(snapshotDir, "PLAN-pass-1.toon"))).toBe(true);
  });

  it("keep-all-forever retention (C-07): pass-1, pass-2, pass-3 all coexist; refusing to overwrite an existing pass throws", async () => {
    const subject = writeSubject("planning/PLAN.md", "evolving plan\n");

    await writeIterationSnapshot({ subject, iteration: 1, snapshotDir, repoRoot });
    await writeIterationSnapshot({ subject, iteration: 2, snapshotDir, repoRoot });
    await writeIterationSnapshot({ subject, iteration: 3, snapshotDir, repoRoot });

    // All 6 files (3 copies + 3 metadata) coexist after the third write.
    for (const n of [1, 2, 3]) {
      expect(fs.existsSync(path.join(snapshotDir, `PLAN-pass-${n}.md`))).toBe(true);
      expect(fs.existsSync(path.join(snapshotDir, `PLAN-pass-${n}.toon`))).toBe(true);
    }

    // A caller-error second invocation for the same iteration MUST be
    // refused — never silently overwrite a snapshot per locked C-07.
    await expect(
      writeIterationSnapshot({ subject, iteration: 2, snapshotDir, repoRoot }),
    ).rejects.toThrow(/snapshot already exists/);
  });
});
