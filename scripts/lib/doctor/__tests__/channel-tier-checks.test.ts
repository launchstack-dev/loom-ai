/**
 * Channel + Tier doctor-check tests.
 *
 * Covers all 6 Phase 9A2a check modules: version-drift, channel-files,
 * install-interrupted, channel-upgrade-available, tier-ambiguous,
 * managed-tier-detected. Each check gets at least one happy-path case and one
 * fail/warn case via injectable fs / fetch / install-state fixtures.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import VersionDriftCheck from "../checks/version-drift";
import ChannelFilesCheck from "../checks/channel-files";
import InstallInterruptedCheck from "../checks/install-interrupted";
import ChannelUpgradeAvailableCheck from "../checks/channel-upgrade-available";
import TierAmbiguousCheck from "../checks/tier-ambiguous";
import ManagedTierDetectedCheck from "../checks/managed-tier-detected";
import type { InstallState } from "../../install-state";

function baseState(over: Partial<InstallState> = {}): InstallState {
  return {
    installedVersion: "0.1.0",
    installTimestamp: "2026-06-18T10:00:00.000Z",
    installSourceUrl: "https://github.com/launchstack-dev/loom-ai",
    runtimeVersion: "node-20.11.0",
    channel: "curl",
    source: "curl-script",
    migratedFrom: null,
    lastPing: null,
    doNotTrack: false,
    updateInProgress: null,
    installError: null,
    pinnedVersion: null,
    ...over,
  };
}

function mockFetch(
  status: number,
  body: unknown,
): typeof globalThis.fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof globalThis.fetch;
}

describe("VersionDriftCheck", () => {
  it("passes when installed matches latest", async () => {
    const check = new VersionDriftCheck({
      fetch: mockFetch(200, { tag_name: "v0.1.0" }),
    });
    const result = await check.run(baseState({ installedVersion: "0.1.0" }));
    expect(result.status).toBe("pass");
    expect(result.category).toBe("channel");
  });

  it("warns (does not fail) on network error — graceful degradation", async () => {
    const check = new VersionDriftCheck({
      fetch: (async () => {
        throw new Error("ENOTFOUND api.github.com");
      }) as unknown as typeof globalThis.fetch,
    });
    const result = await check.run(baseState());
    expect(result.status).toBe("warn");
    expect(result.status).not.toBe("fail");
  });

  it("warns when installed differs from latest", async () => {
    const check = new VersionDriftCheck({
      fetch: mockFetch(200, { tag_name: "v0.9.0" }),
    });
    const result = await check.run(baseState({ installedVersion: "0.1.0" }));
    expect(result.status).toBe("warn");
    expect(result.fixCommand).toBe("/loom-upgrade");
  });
});

describe("ChannelFilesCheck", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loom-channel-files-"));
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("passes when only one channel present", async () => {
    fs.mkdirSync(path.join(tmp, ".loom"));
    const check = new ChannelFilesCheck({
      home: tmp,
      curlPath: path.join(tmp, ".loom"),
      pluginPath: path.join(tmp, ".claude", "plugins", "loom"),
    });
    const result = await check.run(baseState());
    expect(result.status).toBe("pass");
  });

  it("fails when both channels detected", async () => {
    fs.mkdirSync(path.join(tmp, ".loom"));
    fs.mkdirSync(path.join(tmp, ".claude", "plugins", "loom"), {
      recursive: true,
    });
    const check = new ChannelFilesCheck({
      home: tmp,
      curlPath: path.join(tmp, ".loom"),
      pluginPath: path.join(tmp, ".claude", "plugins", "loom"),
    });
    const result = await check.run(baseState());
    expect(result.status).toBe("fail");
    expect(result.fixCommand).toBe("/loom-doctor --fix --reconcile");
    expect(result.category).toBe("channel");
  });
});

describe("InstallInterruptedCheck", () => {
  it("passes on clean install-state", async () => {
    const check = new InstallInterruptedCheck();
    const result = await check.run(baseState());
    expect(result.status).toBe("pass");
  });

  it("warns when updateInProgress is set", async () => {
    const check = new InstallInterruptedCheck();
    const result = await check.run(
      baseState({
        updateInProgress: {
          fromVersion: "0.1.0",
          toVersion: "0.2.0",
          startedAt: "2026-06-18T09:00:00.000Z",
        },
      }),
    );
    expect(result.status).toBe("warn");
    expect(result.fixCommand).toBe("/loom-upgrade --resume");
  });

  it("warns when installError is set", async () => {
    const check = new InstallInterruptedCheck();
    const result = await check.run(
      baseState({
        installError: {
          step: "fetch-tarball",
          message: "HTTP 503",
          timestamp: "2026-06-18T09:00:00.000Z",
        },
      }),
    );
    expect(result.status).toBe("warn");
  });
});

describe("ChannelUpgradeAvailableCheck", () => {
  it("fires (info) on curl host when marketplace is reachable", async () => {
    const check = new ChannelUpgradeAvailableCheck({
      fetch: mockFetch(200, { status: "ok" }),
    });
    const result = await check.run(baseState({ channel: "curl" }));
    expect(result.status).toBe("pass"); // info severity → pass / exit 0
    expect(result.message).toMatch(/reachable/);
    expect(result.remediation).toMatch(/loom-uninstall/);
  });

  it("skips probe on plugin channel", async () => {
    const check = new ChannelUpgradeAvailableCheck({
      fetch: mockFetch(200, { status: "ok" }),
    });
    const result = await check.run(baseState({ channel: "plugin" }));
    expect(result.status).toBe("pass");
    expect(result.message).toMatch(/skipped/);
  });

  it("stays quiet when marketplace probe fails on curl host", async () => {
    const check = new ChannelUpgradeAvailableCheck({
      fetch: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof globalThis.fetch,
    });
    const result = await check.run(baseState({ channel: "curl" }));
    expect(result.status).toBe("pass");
    expect(result.message).toMatch(/not reachable/);
  });
});

describe("TierAmbiguousCheck", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loom-tier-ambig-"));
    fs.mkdirSync(path.join(tmp, ".claude"));
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("passes when only project-tier has loom entries", async () => {
    fs.writeFileSync(
      path.join(tmp, ".claude", "settings.json"),
      JSON.stringify({ hooks: { PreToolUse: ["run-hook.sh"] } }),
    );
    const check = new TierAmbiguousCheck({ projectDir: tmp });
    const result = await check.run(baseState());
    expect(result.status).toBe("pass");
  });

  it("fails when BOTH project + local tiers contain loom entries", async () => {
    fs.writeFileSync(
      path.join(tmp, ".claude", "settings.json"),
      JSON.stringify({ hooks: { PreToolUse: ["run-hook.sh"] } }),
    );
    fs.writeFileSync(
      path.join(tmp, ".claude", "settings.local.json"),
      JSON.stringify({ hooks: { PostToolUse: ["run-hook.sh"] } }),
    );
    const check = new TierAmbiguousCheck({ projectDir: tmp });
    const result = await check.run(baseState());
    expect(result.status).toBe("fail");
    expect(result.fixCommand).toBeNull();
    expect(result.remediation).toMatch(/--tier/);
    expect(result.category).toBe("tier");
  });
});

describe("ManagedTierDetectedCheck", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loom-managed-tier-"));
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("passes (silent) when no managed-settings file exists", async () => {
    const check = new ManagedTierDetectedCheck({
      candidatePaths: [path.join(tmp, "missing.json")],
    });
    const result = await check.run(baseState());
    expect(result.status).toBe("pass");
    expect(result.message).toMatch(/No managed-tier/);
  });

  it("fires (info) when managed-settings.json contains loom entries", async () => {
    const managedPath = path.join(tmp, "managed-settings.json");
    fs.writeFileSync(
      managedPath,
      JSON.stringify({ hooks: { PreToolUse: ["run-hook.sh"] } }),
    );
    const check = new ManagedTierDetectedCheck({
      candidatePaths: [managedPath],
    });
    const result = await check.run(baseState());
    expect(result.status).toBe("pass"); // info severity → pass status
    expect(result.message).toMatch(/Managed Loom hook entries detected/);
    expect(result.category).toBe("tier");
  });

  it("does not trigger tier-ambiguous (separate check ID)", async () => {
    const managedPath = path.join(tmp, "managed-settings.json");
    fs.writeFileSync(
      managedPath,
      JSON.stringify({ hooks: { PreToolUse: ["run-hook.sh"] } }),
    );
    const check = new ManagedTierDetectedCheck({
      candidatePaths: [managedPath],
    });
    const result = await check.run(baseState());
    expect(result.id).toBe("managed-tier-detected");
    expect(result.id).not.toBe("tier-ambiguous");
  });
});
