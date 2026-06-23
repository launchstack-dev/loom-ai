import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  deriveChannel,
  deriveSource,
  deriveInstallSourceUrl,
  readPluginVersion,
  runFirstRun,
  DEFAULT_INSTALL_SOURCE_URL,
  type FirstRunDeps,
} from "./first-run";
import { readInstallState, writeInstallStateAtomic } from "./install-state";

function freezeClock(iso = "2026-06-17T10:00:00.000Z"): () => Date {
  const d = new Date(iso);
  return () => d;
}

function makePluginJson(dir: string, version: string): string {
  const p = path.join(dir, "plugin.json");
  fs.writeFileSync(p, JSON.stringify({ name: "loom", version }, null, 2));
  return p;
}

describe("derivation helpers", () => {
  it("deriveChannel returns plugin when CLAUDE_PLUGIN_ROOT set", () => {
    expect(deriveChannel({ CLAUDE_PLUGIN_ROOT: "/x" } as NodeJS.ProcessEnv)).toBe("plugin");
  });
  it("deriveChannel returns curl when CLAUDE_PLUGIN_ROOT empty/unset", () => {
    expect(deriveChannel({} as NodeJS.ProcessEnv)).toBe("curl");
    expect(deriveChannel({ CLAUDE_PLUGIN_ROOT: "" } as NodeJS.ProcessEnv)).toBe("curl");
  });

  it("deriveSource: plugin default → marketplace-browse", () => {
    expect(deriveSource("plugin", {} as NodeJS.ProcessEnv)).toBe("marketplace-browse");
  });
  it("deriveSource: plugin + LOOM_INSTALL_SOURCE=direct-link", () => {
    expect(
      deriveSource("plugin", { LOOM_INSTALL_SOURCE: "direct-link" } as NodeJS.ProcessEnv),
    ).toBe("direct-link");
  });
  it("deriveSource: curl default → curl-script", () => {
    expect(deriveSource("curl", {} as NodeJS.ProcessEnv)).toBe("curl-script");
  });
  it("deriveSource: curl + LOOM_INSTALL_URL → self-hosted-url", () => {
    expect(
      deriveSource("curl", { LOOM_INSTALL_URL: "https://x.example/install.sh" } as NodeJS.ProcessEnv),
    ).toBe("self-hosted-url");
  });

  it("deriveInstallSourceUrl: returns LOOM_INSTALL_URL when set", () => {
    expect(
      deriveInstallSourceUrl({ LOOM_INSTALL_URL: "https://x.example" } as NodeJS.ProcessEnv),
    ).toBe("https://x.example");
  });
  it("deriveInstallSourceUrl: falls back to canonical default", () => {
    expect(deriveInstallSourceUrl({} as NodeJS.ProcessEnv)).toBe(DEFAULT_INSTALL_SOURCE_URL);
  });
});

describe("readPluginVersion", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-pluginjson-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads .version from plugin.json", () => {
    const p = makePluginJson(tmpDir, "0.1.0");
    expect(readPluginVersion(p)).toBe("0.1.0");
  });

  it("throws when version is missing", () => {
    const p = path.join(tmpDir, "plugin.json");
    fs.writeFileSync(p, JSON.stringify({ name: "x" }));
    expect(() => readPluginVersion(p)).toThrow(/version/);
  });
});

describe("runFirstRun", () => {
  let tmpDir: string;
  let pluginJsonPath: string;
  let statePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-firstrun-"));
    pluginJsonPath = makePluginJson(tmpDir, "0.1.0");
    statePath = path.join(tmpDir, ".loom", "install.toon");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function deps(envOverrides: NodeJS.ProcessEnv = {} as NodeJS.ProcessEnv): FirstRunDeps {
    return {
      env: envOverrides,
      now: freezeClock(),
      installStatePath: statePath,
      pluginJsonPath,
      runtimeVersion: "node-20.11.0",
    };
  }

  it("creates a fresh envelope for plugin install (default → marketplace-browse)", () => {
    const result = runFirstRun(deps({ CLAUDE_PLUGIN_ROOT: "/x" } as NodeJS.ProcessEnv));
    expect(result.kind).toBe("created");
    const onDisk = readInstallState(statePath);
    expect(onDisk).not.toBeNull();
    expect(onDisk!.channel).toBe("plugin");
    expect(onDisk!.source).toBe("marketplace-browse");
    expect(onDisk!.installedVersion).toBe("0.1.0");
    expect(onDisk!.installSourceUrl).toBe(DEFAULT_INSTALL_SOURCE_URL);
    expect(onDisk!.runtimeVersion).toBe("node-20.11.0");
    expect(onDisk!.installTimestamp).toBe("2026-06-17T10:00:00.000Z");
  });

  it("creates envelope for plugin + direct-link", () => {
    runFirstRun(
      deps({
        CLAUDE_PLUGIN_ROOT: "/x",
        LOOM_INSTALL_SOURCE: "direct-link",
      } as NodeJS.ProcessEnv),
    );
    const onDisk = readInstallState(statePath);
    expect(onDisk!.source).toBe("direct-link");
  });

  it("creates envelope for curl install (default → curl-script)", () => {
    runFirstRun(deps({} as NodeJS.ProcessEnv));
    const onDisk = readInstallState(statePath);
    expect(onDisk!.channel).toBe("curl");
    expect(onDisk!.source).toBe("curl-script");
  });

  it("creates envelope for curl + LOOM_INSTALL_URL → self-hosted-url", () => {
    runFirstRun(deps({ LOOM_INSTALL_URL: "https://corp.example/loom.sh" } as NodeJS.ProcessEnv));
    const onDisk = readInstallState(statePath);
    expect(onDisk!.channel).toBe("curl");
    expect(onDisk!.source).toBe("self-hosted-url");
    expect(onDisk!.installSourceUrl).toBe("https://corp.example/loom.sh");
  });

  it("is idempotent: re-invocation with matching version is byte-stable no-op", () => {
    runFirstRun(deps({ CLAUDE_PLUGIN_ROOT: "/x" } as NodeJS.ProcessEnv));
    const firstBytes = fs.readFileSync(statePath, "utf8");
    // Snapshot mtime in MILLIseconds for portability; ns precision varies by FS.
    const firstMtimeMs = fs.statSync(statePath).mtimeMs;

    // Re-invoke with a different clock to prove frozen fields don't drift.
    const result = runFirstRun({
      env: { CLAUDE_PLUGIN_ROOT: "/x" } as NodeJS.ProcessEnv,
      now: freezeClock("2027-01-01T00:00:00.000Z"),
      installStatePath: statePath,
      pluginJsonPath,
      runtimeVersion: "node-20.11.0",
    });
    expect(result.kind).toBe("noop");
    const secondBytes = fs.readFileSync(statePath, "utf8");
    expect(secondBytes).toBe(firstBytes);
    // No-op must not touch the file at all — mtime unchanged.
    expect(fs.statSync(statePath).mtimeMs).toBe(firstMtimeMs);
  });

  it("preserves updateInProgress across version bump", () => {
    // Seed an existing envelope with updateInProgress set.
    runFirstRun(deps({ CLAUDE_PLUGIN_ROOT: "/x" } as NodeJS.ProcessEnv));
    const seeded = readInstallState(statePath)!;
    seeded.updateInProgress = {
      fromVersion: "0.1.0",
      toVersion: "0.2.0",
      startedAt: "2026-06-17T09:00:00.000Z",
    };
    writeInstallStateAtomic(statePath, seeded);

    // Bump version in plugin.json.
    makePluginJson(tmpDir, "0.2.0");

    const result = runFirstRun(deps({ CLAUDE_PLUGIN_ROOT: "/x" } as NodeJS.ProcessEnv));
    expect(result.kind).toBe("version-bumped");
    const after = readInstallState(statePath)!;
    expect(after.installedVersion).toBe("0.2.0");
    expect(after.updateInProgress).toEqual(seeded.updateInProgress);
    // Frozen fields preserved across bump.
    expect(after.installTimestamp).toBe(seeded.installTimestamp);
    expect(after.installSourceUrl).toBe(seeded.installSourceUrl);
    expect(after.source).toBe(seeded.source);
    expect(after.channel).toBe(seeded.channel);
  });

  it("matches plugin.json version exactly", () => {
    makePluginJson(tmpDir, "9.9.9");
    runFirstRun(deps({} as NodeJS.ProcessEnv));
    expect(readInstallState(statePath)!.installedVersion).toBe("9.9.9");
  });

  it("preserves doNotTrack across re-invocation", () => {
    runFirstRun(deps({} as NodeJS.ProcessEnv));
    const s = readInstallState(statePath)!;
    s.doNotTrack = true;
    writeInstallStateAtomic(statePath, s);

    // Bump version → version-bumped path should preserve doNotTrack.
    makePluginJson(tmpDir, "0.2.0");
    runFirstRun(deps({} as NodeJS.ProcessEnv));
    expect(readInstallState(statePath)!.doNotTrack).toBe(true);
  });
});
