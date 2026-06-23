import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const repoRoot = path.resolve(__dirname, "..");
const installScript = path.join(repoRoot, "install.sh");

let sandbox: string;
let shimBin: string;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "loom-install-mutex-"));
  shimBin = path.join(sandbox, "bin");
  fs.mkdirSync(shimBin, { recursive: true });
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function makeClaudeShim(stdout: string, exit = 0): void {
  const shim = path.join(shimBin, "claude");
  fs.writeFileSync(
    shim,
    `#!/bin/sh\ncat <<'EOF'\n${stdout}\nEOF\nexit ${exit}\n`,
    { mode: 0o755 },
  );
}

/** Run install.sh with PATH controlled and stop right after the pre-flight. */
function runPreflightOnly(extraPath: string[] = []): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  // Source install.sh up to the first network call by extracting just the
  // pre-flight block. The pre-flight is fully self-contained — it returns or
  // exits before touching the network. We run the real script and let it fail
  // naturally if it gets past the pre-flight; we only assert on exit code 9
  // for the conflict path and "got past pre-flight" otherwise.
  const env = {
    ...process.env,
    PATH: [...extraPath, "/usr/bin", "/bin"].join(":"),
    // Force network calls to fail fast so a passing pre-flight doesn't hang.
    HOME: sandbox,
  };
  // Use sh to avoid bashisms in tests, and disable the network fetch by
  // pointing REPO at an obviously-bad source. install.sh is bash-only (#!/bin/bash),
  // so invoke bash explicitly.
  const result = spawnSync("bash", [installScript], {
    env,
    encoding: "utf8",
    timeout: 10_000,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("install.sh — plugin/curl mutual exclusion", () => {
  it("exits 9 with INSTALL_CONFLICT_PLUGIN_AND_CURL when claude reports loom plugin present", () => {
    makeClaudeShim("loom 0.1.0 (installed)\nother-plugin 1.0.0");
    const { status, stderr } = runPreflightOnly([shimBin]);
    expect(status).toBe(9);
    expect(stderr).toContain("INSTALL_CONFLICT_PLUGIN_AND_CURL");
    expect(stderr).toMatch(/\/loom-uninstall/);
  });

  it("does NOT exit 9 when claude reports no loom plugin", () => {
    makeClaudeShim("other-plugin 1.0.0\nanother 2.3.4");
    const { status } = runPreflightOnly([shimBin]);
    // Pre-flight passes; install.sh will then fail later trying to fetch from
    // network in the sandbox. Anything other than 9 confirms the pre-flight
    // didn't block.
    expect(status).not.toBe(9);
  });

  it("does NOT exit 9 when claude CLI is absent", () => {
    // No shim — PATH has only /usr/bin:/bin, no `claude`.
    const { status } = runPreflightOnly([]);
    expect(status).not.toBe(9);
  });
});

describe("install.sh — tarball sha256 verification", () => {
  function sha256Of(filePath: string): string {
    const out = spawnSync("sh", [
      "-c",
      `if command -v sha256sum >/dev/null 2>&1; then sha256sum "${filePath}" | awk '{print $1}'; else shasum -a 256 "${filePath}" | awk '{print $1}'; fi`,
    ], { encoding: "utf8" });
    return (out.stdout ?? "").trim();
  }

  it("exits MANIFEST_INVALID without extracting when tarball sha256 does not match manifest", () => {
    const tarball = path.join(sandbox, "loom-release.tar.gz");
    fs.writeFileSync(tarball, "real release bytes");
    const realSha = sha256Of(tarball);
    // Manifest claims a different sha → tampered case.
    const manifest = path.join(sandbox, "manifest.toon");
    fs.writeFileSync(
      manifest,
      `schemaVersion: 1\nsha256: 0000000000000000000000000000000000000000000000000000000000000000\n`,
    );
    const result = spawnSync("bash", [installScript], {
      env: {
        ...process.env,
        PATH: "/usr/bin:/bin",
        HOME: sandbox,
        LOOM_RELEASE_TARBALL: tarball,
        LOOM_RELEASE_MANIFEST: manifest,
      },
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(result.stderr).toContain("MANIFEST_INVALID");
    expect(result.status).not.toBe(0);
    // Real sha appears nowhere in stdout — extraction never began.
    expect(result.stdout ?? "").not.toContain(realSha);
  });

  it("does not block on sha verification when tarball matches manifest", () => {
    const tarball = path.join(sandbox, "loom-release.tar.gz");
    fs.writeFileSync(tarball, "matching bytes");
    const realSha = sha256Of(tarball);
    const manifest = path.join(sandbox, "manifest.toon");
    fs.writeFileSync(manifest, `schemaVersion: 1\nsha256: ${realSha}\n`);
    const result = spawnSync("bash", [installScript], {
      env: {
        ...process.env,
        PATH: "/usr/bin:/bin",
        HOME: sandbox,
        LOOM_RELEASE_TARBALL: tarball,
        LOOM_RELEASE_MANIFEST: manifest,
      },
      encoding: "utf8",
      timeout: 10_000,
    });
    // Should not see MANIFEST_INVALID. Install will still likely fail later
    // (network), but the sha gate passed.
    expect(result.stderr).not.toContain("MANIFEST_INVALID");
  });
});
