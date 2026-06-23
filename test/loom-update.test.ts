/**
 * Integration tests for the `/loom-update` CLI surface (Phase 13).
 *
 * Scope: argv parsing, channel detection, --check/--json output contracts,
 * resume from marker, rollback after a failed update, exit codes.
 *
 * No network, no spawn — install-state path and manifest fetch are injected.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { PassThrough } from "node:stream";

import { main, parseArgs } from "../scripts/loom-update.js";
import {
  writeInstallStateAtomic,
  readInstallState,
  type InstallState,
} from "../scripts/lib/install-state.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FROZEN_NOW = new Date("2026-06-18T12:00:00.000Z");

function makeStreams(): {
  stdout: PassThrough;
  stderr: PassThrough;
  out: () => string;
  err: () => string;
} {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const outChunks: Buffer[] = [];
  const errChunks: Buffer[] = [];
  stdout.on("data", (c) => outChunks.push(c as Buffer));
  stderr.on("data", (c) => errChunks.push(c as Buffer));
  return {
    stdout,
    stderr,
    out: () => Buffer.concat(outChunks).toString("utf8"),
    err: () => Buffer.concat(errChunks).toString("utf8"),
  };
}

function baseState(overrides: Partial<InstallState> = {}): InstallState {
  return {
    installedVersion: "0.1.0",
    installTimestamp: "2026-06-17T10:00:00.000Z",
    installSourceUrl: "https://example.com",
    runtimeVersion: "node-20",
    channel: "plugin",
    source: "marketplace-browse",
    migratedFrom: null,
    lastPing: null,
    doNotTrack: false,
    updateInProgress: null,
    installError: null,
    pinnedVersion: null,
    ...overrides,
  };
}

let tmpDir: string;
let statePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-update-"));
  statePath = path.join(tmpDir, "install.toon");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
  it("parses --check --json", () => {
    const p = parseArgs(["--check", "--json"]);
    expect(p.check).toBe(true);
    expect(p.json).toBe(true);
    expect(p.error).toBeUndefined();
  });

  it("parses --channel curl", () => {
    const p = parseArgs(["--channel", "curl"]);
    expect(p.channel).toBe("curl");
  });

  it("rejects bad --channel", () => {
    const p = parseArgs(["--channel", "marketplace"]);
    expect(p.error).toMatch(/--channel/);
  });

  it("parses --pin", () => {
    expect(parseArgs(["--pin", "0.3.0"]).pin).toBe("0.3.0");
  });

  it("rejects --pin without value", () => {
    expect(parseArgs(["--pin"]).error).toMatch(/--pin/);
  });

  it("flags unknown args", () => {
    expect(parseArgs(["--whatever"]).error).toMatch(/Unknown flag/);
  });
});

// ---------------------------------------------------------------------------
// --help / errors
// ---------------------------------------------------------------------------

describe("--help and arg errors", () => {
  it("--help prints usage and exits 0", async () => {
    const { stdout, stderr, out } = makeStreams();
    const code = await main({
      argv: ["--help"],
      stdout,
      stderr,
      env: { LOOM_HOME: tmpDir },
    });
    expect(code).toBe(0);
    expect(out()).toContain("/loom-update");
    expect(out()).toContain("--check");
  });

  it("unknown flag exits 2", async () => {
    const { stdout, stderr, err } = makeStreams();
    const code = await main({
      argv: ["--nope"],
      stdout,
      stderr,
      env: { LOOM_HOME: tmpDir },
    });
    expect(code).toBe(2);
    expect(err()).toContain("Unknown flag");
  });
});

// ---------------------------------------------------------------------------
// --check
// ---------------------------------------------------------------------------

describe("--check", () => {
  it("S-01: prints exact ASCII -> text line", async () => {
    writeInstallStateAtomic(statePath, baseState({ installedVersion: "0.1.0" }));
    const { stdout, stderr, out } = makeStreams();
    const code = await main({
      argv: ["--check"],
      stdout,
      stderr,
      env: { LOOM_HOME: tmpDir },
      installStatePath: statePath,
      fetchManifest: async () => ({ versions: ["0.1.0", "0.2.0"] }),
      now: () => FROZEN_NOW,
    });
    expect(code).toBe(0);
    expect(out()).toBe(
      "Loom v0.1.0 installed -> v0.2.0 available — run /loom-update to apply\n",
    );
  });

  it("S-02: --json emits JSON conforming to schema", async () => {
    writeInstallStateAtomic(statePath, baseState({ installedVersion: "0.1.0" }));
    const { stdout, stderr, out } = makeStreams();
    const code = await main({
      argv: ["--check", "--json"],
      stdout,
      stderr,
      env: { LOOM_HOME: tmpDir },
      installStatePath: statePath,
      fetchManifest: async () => ({ versions: ["0.1.0", "0.2.0"] }),
      now: () => FROZEN_NOW,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(out());
    expect(parsed).toMatchObject({
      schemaVersion: 1,
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      behind: 1,
      pinnedVersion: null,
      channel: "plugin",
    });
    expect(typeof parsed.generatedAt).toBe("string");
  });

  it("exits 2 when install-state is missing", async () => {
    const { stdout, stderr, err } = makeStreams();
    const code = await main({
      argv: ["--check"],
      stdout,
      stderr,
      env: { LOOM_HOME: tmpDir },
      installStatePath: statePath,
      fetchManifest: async () => ({ versions: ["0.1.0"] }),
    });
    expect(code).toBe(2);
    expect(err()).toContain("install-state-missing");
  });
});

// ---------------------------------------------------------------------------
// Default apply path (channel detection)
// ---------------------------------------------------------------------------

describe("apply — channel detection", () => {
  it("plugin channel: emits restart-required final line", async () => {
    writeInstallStateAtomic(statePath, baseState({ channel: "plugin" }));
    const { stdout, stderr, out } = makeStreams();
    const code = await main({
      argv: [],
      stdout,
      stderr,
      env: { LOOM_HOME: tmpDir },
      installStatePath: statePath,
      fetchManifest: async () => ({ versions: ["0.1.0", "0.2.0"] }),
      exec: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      now: () => FROZEN_NOW,
    });
    expect(code).toBe(0);
    const lines = out().trim().split("\n");
    expect(lines[lines.length - 1]).toBe(
      "Claude Code restart required to load new plugin version",
    );
    expect(readInstallState(statePath)!.installedVersion).toBe("0.2.0");
  });

  it("curl channel: no restart line", async () => {
    writeInstallStateAtomic(statePath, baseState({ channel: "curl" }));
    const { stdout, stderr, out } = makeStreams();
    const code = await main({
      argv: [],
      stdout,
      stderr,
      env: { LOOM_HOME: tmpDir },
      installStatePath: statePath,
      fetchManifest: async () => ({ versions: ["0.1.0", "0.2.0"] }),
      exec: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      now: () => FROZEN_NOW,
    });
    expect(code).toBe(0);
    expect(out()).not.toContain("restart required");
  });

  it("--channel override forces plugin path for curl install", async () => {
    writeInstallStateAtomic(statePath, baseState({ channel: "curl" }));
    let cmdSeen = "";
    const { stdout, stderr } = makeStreams();
    const code = await main({
      argv: ["--channel", "plugin"],
      stdout,
      stderr,
      env: { LOOM_HOME: tmpDir },
      installStatePath: statePath,
      fetchManifest: async () => ({ versions: ["0.1.0", "0.2.0"] }),
      exec: async (cmd) => {
        cmdSeen = cmd;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
      now: () => FROZEN_NOW,
    });
    expect(code).toBe(0);
    expect(cmdSeen).toBe("claude");
  });

  it("--pin writes pinnedVersion", async () => {
    writeInstallStateAtomic(statePath, baseState({ channel: "plugin" }));
    const { stdout, stderr } = makeStreams();
    const code = await main({
      argv: ["--pin", "0.5.0"],
      stdout,
      stderr,
      env: { LOOM_HOME: tmpDir },
      installStatePath: statePath,
      fetchManifest: async () => ({ versions: ["0.1.0", "0.5.0"] }),
      exec: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      now: () => FROZEN_NOW,
    });
    expect(code).toBe(0);
    const after = readInstallState(statePath)!;
    expect(after.pinnedVersion).toBe("0.5.0");
    expect(after.installedVersion).toBe("0.5.0");
  });
});

// ---------------------------------------------------------------------------
// --resume
// ---------------------------------------------------------------------------

describe("--resume", () => {
  it("S-03: completes from a mid-update marker and emits restart line", async () => {
    writeInstallStateAtomic(
      statePath,
      baseState({
        channel: "plugin",
        updateInProgress: {
          fromVersion: "0.1.0",
          toVersion: "0.2.0",
          startedAt: "2026-06-17T11:00:00.000Z",
        },
      }),
    );
    const { stdout, stderr, out } = makeStreams();
    const code = await main({
      argv: ["--resume"],
      stdout,
      stderr,
      env: { LOOM_HOME: tmpDir },
      installStatePath: statePath,
      fetchManifest: async () => ({ versions: ["0.1.0", "0.2.0"] }),
      exec: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      now: () => FROZEN_NOW,
    });
    expect(code).toBe(0);
    expect(out()).toContain("Claude Code restart required");
    const after = readInstallState(statePath)!;
    expect(after.updateInProgress).toBeNull();
    expect(after.installedVersion).toBe("0.2.0");
  });

  it("S-04: unrecoverable marker → failed terminal, non-zero exit, stderr guidance", async () => {
    writeInstallStateAtomic(
      statePath,
      baseState({
        updateInProgress: {
          fromVersion: "0.1.0",
          toVersion: "9.9.9",
          startedAt: "x",
        },
      }),
    );
    const { stdout, stderr, err } = makeStreams();
    const code = await main({
      argv: ["--resume"],
      stdout,
      stderr,
      env: { LOOM_HOME: tmpDir },
      installStatePath: statePath,
      fetchManifest: async () => ({ versions: ["0.1.0", "0.2.0"] }),
      exec: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    });
    expect(code).not.toBe(0);
    expect(err()).toContain("/loom-update --check");
    expect(err()).toContain("/loom-doctor --bundle");
    expect(readInstallState(statePath)!.updateInProgress).toBe("failed");
  });

  it("noop when no marker present", async () => {
    writeInstallStateAtomic(statePath, baseState());
    const { stdout, stderr } = makeStreams();
    const code = await main({
      argv: ["--resume"],
      stdout,
      stderr,
      env: { LOOM_HOME: tmpDir },
      installStatePath: statePath,
      fetchManifest: async () => ({ versions: ["0.1.0"] }),
      exec: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    });
    expect(code).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// --rollback (integration: real v3 inventory + snapshot on disk)
// ---------------------------------------------------------------------------

describe("--rollback", () => {
  function buildV3(items: { source: string; content: string }[]): {
    invPath: string;
    snapshotPath: string;
  } {
    const snapshotPath = path.join(tmpDir, "snap");
    fs.mkdirSync(snapshotPath, { recursive: true });
    const targetDir = path.join(tmpDir, "targets");
    fs.mkdirSync(targetDir, { recursive: true });
    const rows: string[] = [];
    const itemLines: string[] = [];
    for (const it of items) {
      const copyPath = path.join(snapshotPath, it.source);
      fs.mkdirSync(path.dirname(copyPath), { recursive: true });
      fs.writeFileSync(copyPath, it.content);
      const hash = crypto.createHash("sha256").update(it.content).digest("hex");
      rows.push(`${hash} ${it.source}`);
      const targetPath = path.join(targetDir, it.source);
      itemLines.push(
        `  ${it.source.replace(/\//g, "-")},prompt,${it.source},${targetPath},${hash},loom-core,2026-06-17T00:00:00.000Z`,
      );
    }
    const chain = crypto
      .createHash("sha256")
      .update(rows.slice().sort().join("\n"))
      .digest("hex");
    const toon = [
      "schemaVersion: 3",
      "protocolVersion: 3",
      "lastSynced: 2026-06-17T00:00:00.000Z",
      "loomCoreVersion: 0.1.0",
      "loomHooksVersion: 0.1.0",
      "catalogVersion: 3",
      "",
      `items[${items.length}]{name,type,source,targetPath,sha256,component,installedAt}:`,
      ...itemLines,
      "",
      "snapshot:",
      "  versionBeforeUpgrade: 0.0.9",
      `  snapshotPath: ${snapshotPath}`,
      `  snapshotSha256: ${chain}`,
      "  capturedAt: 2026-06-17T00:00:00.000Z",
      "  expiresAt: 2026-06-24T00:00:00.000Z",
      "",
    ].join("\n");
    const invPath = path.join(tmpDir, "v3-install-state.toon");
    fs.writeFileSync(invPath, toon);
    return { invPath, snapshotPath };
  }

  it("restores files when v3 chain is intact", async () => {
    const { invPath } = buildV3([
      { source: "commands/x.md", content: "x-content" },
    ]);
    const { stdout, stderr, out } = makeStreams();
    const code = await main({
      argv: ["--rollback"],
      stdout,
      stderr,
      env: { LOOM_HOME: tmpDir },
      v3InventoryPath: invPath,
    });
    expect(code).toBe(0);
    expect(out()).toContain("Rolled back to v0.0.9");
    // The target file exists with restored content.
    const restored = path.join(tmpDir, "targets", "commands", "x.md");
    expect(fs.existsSync(restored)).toBe(true);
    expect(fs.readFileSync(restored, "utf8")).toBe("x-content");
  });

  it("exits non-zero with ROLLBACK_HASH_MISMATCH when chain is tampered", async () => {
    const { invPath, snapshotPath } = buildV3([
      { source: "a.md", content: "alpha" },
    ]);
    // Tamper with snapshot file → chain mismatch.
    fs.writeFileSync(path.join(snapshotPath, "a.md"), "TAMPERED");
    const { stdout, stderr, err } = makeStreams();
    const code = await main({
      argv: ["--rollback"],
      stdout,
      stderr,
      env: { LOOM_HOME: tmpDir },
      v3InventoryPath: invPath,
    });
    expect(code).toBe(2);
    expect(err()).toContain("ROLLBACK_HASH_MISMATCH");
  });

  it("rollback after a failed update restores prior version", async () => {
    // Simulate a failed update: install-state still pointing at the prior
    // version with a marker present, plus a v3 snapshot capturing it.
    writeInstallStateAtomic(
      statePath,
      baseState({
        installedVersion: "0.1.0",
        updateInProgress: "failed",
      }),
    );
    const { invPath } = buildV3([
      { source: "agents/x.md", content: "prior" },
    ]);
    const { stdout, stderr } = makeStreams();
    const code = await main({
      argv: ["--rollback"],
      stdout,
      stderr,
      env: { LOOM_HOME: tmpDir },
      installStatePath: statePath,
      v3InventoryPath: invPath,
    });
    expect(code).toBe(0);
    expect(
      fs.readFileSync(path.join(tmpDir, "targets", "agents", "x.md"), "utf8"),
    ).toBe("prior");
  });
});
