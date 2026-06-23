/**
 * Unit tests for the /loom-update helpers: check, apply, resume, rollback.
 *
 * Pure-helper tests — no spawn(), no network, no real ~/.loom mutation. All
 * I/O is injected.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";

import {
  check,
  compareSemver,
  parseSemver,
  normalizeSemver,
  renderCheckJSON,
  renderCheckText,
  type ManifestRegistry,
} from "../check.js";
import {
  apply,
  writeMarker,
  clearMarker,
  recordPin,
  type ApplyDeps,
} from "../apply.js";
import { resume, UNRECOVERABLE_MESSAGE } from "../resume.js";
import { parseV3Inventory, rollback, type RollbackDeps } from "../rollback.js";
import type { InstallState } from "../../install-state.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

function makeStateStore(initial: InstallState | null = null): {
  readState: () => InstallState | null;
  writeState: (s: InstallState) => void;
  current: () => InstallState | null;
} {
  let value: InstallState | null = initial;
  return {
    readState: () => (value ? { ...value } : null),
    writeState: (s) => {
      value = { ...s };
    },
    current: () => value,
  };
}

const FROZEN_NOW = new Date("2026-06-18T00:00:00.000Z");

// ---------------------------------------------------------------------------
// check.ts
// ---------------------------------------------------------------------------

describe("update/check — semver", () => {
  it("parses with and without leading v", () => {
    expect(parseSemver("v1.2.3")).toEqual([1, 2, 3, ""]);
    expect(parseSemver("0.1.0")).toEqual([0, 1, 0, ""]);
    expect(parseSemver("1.0.0-rc.1")).toEqual([1, 0, 0, "rc.1"]);
  });

  it("rejects garbage", () => {
    expect(() => parseSemver("not-a-version")).toThrow();
  });

  it("compares numerically across major/minor/patch", () => {
    expect(compareSemver("0.1.0", "0.2.0")).toBeLessThan(0);
    expect(compareSemver("1.0.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareSemver("0.1.0", "0.1.0")).toBe(0);
  });

  it("pre-release sorts before its release", () => {
    expect(compareSemver("1.0.0-rc.1", "1.0.0")).toBeLessThan(0);
  });

  it("normalizes v prefix", () => {
    expect(normalizeSemver("v0.2.0")).toBe("0.2.0");
    expect(normalizeSemver("0.2.0")).toBe("0.2.0");
  });
});

describe("update/check — drift detection", () => {
  it("reports behind=0 when current equals latest", async () => {
    const store = makeStateStore(baseState({ installedVersion: "0.2.0" }));
    const manifest: ManifestRegistry = { versions: ["0.1.0", "0.2.0"] };
    const result = await check({
      readState: store.readState,
      fetchManifest: async () => manifest,
      now: () => FROZEN_NOW,
    });
    expect(result.behind).toBe(0);
    expect(result.currentVersion).toBe("0.2.0");
    expect(result.latestVersion).toBe("0.2.0");
    expect(result.schemaVersion).toBe(1);
    expect(result.channel).toBe("plugin");
  });

  it("counts strictly-greater entries for behind", async () => {
    const store = makeStateStore(baseState({ installedVersion: "0.1.0" }));
    const manifest: ManifestRegistry = {
      versions: ["0.0.9", "0.1.0", "0.2.0", "0.3.0"],
    };
    const result = await check({
      readState: store.readState,
      fetchManifest: async () => manifest,
      now: () => FROZEN_NOW,
    });
    expect(result.behind).toBe(2);
    expect(result.latestVersion).toBe("0.3.0");
  });

  it("throws when install-state is missing", async () => {
    await expect(
      check({
        readState: () => null,
        fetchManifest: async () => ({ versions: ["0.1.0"] }),
        now: () => FROZEN_NOW,
      }),
    ).rejects.toThrow(/install-state-missing/);
  });

  it("throws when manifest is empty", async () => {
    await expect(
      check({
        readState: () => baseState(),
        fetchManifest: async () => ({ versions: [] }),
        now: () => FROZEN_NOW,
      }),
    ).rejects.toThrow(/manifest-empty/);
  });

  it("propagates pinnedVersion", async () => {
    const result = await check({
      readState: () => baseState({ pinnedVersion: "0.1.0" }),
      fetchManifest: async () => ({ versions: ["0.1.0", "0.2.0"] }),
      now: () => FROZEN_NOW,
    });
    expect(result.pinnedVersion).toBe("0.1.0");
  });
});

describe("update/check — renderers", () => {
  const base = {
    schemaVersion: 1 as const,
    currentVersion: "0.1.0",
    latestVersion: "0.2.0",
    behind: 1,
    pinnedVersion: null,
    generatedAt: FROZEN_NOW.toISOString(),
    channel: "plugin" as const,
  };

  it("renders S-01 acceptance line with ASCII arrow", () => {
    expect(renderCheckText(base)).toBe(
      "Loom v0.1.0 installed -> v0.2.0 available — run /loom-update to apply",
    );
  });

  it("renders up-to-date line when behind=0", () => {
    expect(renderCheckText({ ...base, behind: 0, latestVersion: "0.1.0" })).toBe(
      "Loom v0.1.0 installed — up to date",
    );
  });

  it("renders JSON with all schema-required fields", () => {
    const json = JSON.parse(renderCheckJSON(base));
    expect(json).toMatchObject({
      schemaVersion: 1,
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      behind: 1,
      pinnedVersion: null,
      channel: "plugin",
    });
    expect(typeof json.generatedAt).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// apply.ts
// ---------------------------------------------------------------------------

function makeApplyDeps(
  store: ReturnType<typeof makeStateStore>,
  execHandler: ApplyDeps["exec"],
  latest = "0.2.0",
): ApplyDeps {
  return {
    readState: store.readState,
    writeState: store.writeState,
    resolveLatestVersion: async () => latest,
    exec: execHandler,
    now: () => FROZEN_NOW,
  };
}

describe("update/apply — marker helpers", () => {
  it("writeMarker records fromVersion/toVersion/startedAt", () => {
    const store = makeStateStore(baseState({ installedVersion: "0.1.0" }));
    writeMarker(
      { readState: store.readState, writeState: store.writeState, now: () => FROZEN_NOW },
      "0.2.0",
    );
    const cur = store.current()!;
    expect(cur.updateInProgress).toEqual({
      fromVersion: "0.1.0",
      toVersion: "0.2.0",
      startedAt: FROZEN_NOW.toISOString(),
    });
  });

  it("clearMarker updates installedVersion and clears marker", () => {
    const store = makeStateStore(
      baseState({
        installedVersion: "0.1.0",
        updateInProgress: {
          fromVersion: "0.1.0",
          toVersion: "0.2.0",
          startedAt: "x",
        },
      }),
    );
    clearMarker({ readState: store.readState, writeState: store.writeState }, "0.2.0");
    const cur = store.current()!;
    expect(cur.installedVersion).toBe("0.2.0");
    expect(cur.updateInProgress).toBeNull();
  });

  it("recordPin writes pinnedVersion", () => {
    const store = makeStateStore(baseState());
    recordPin(
      { readState: store.readState, writeState: store.writeState },
      "0.5.0",
    );
    expect(store.current()!.pinnedVersion).toBe("0.5.0");
  });
});

describe("update/apply — plugin channel", () => {
  it("delegates to `claude plugin update loom` on success", async () => {
    const store = makeStateStore(baseState({ channel: "plugin" }));
    const calls: { cmd: string; args: string[] }[] = [];
    const exec: ApplyDeps["exec"] = async (cmd, args) => {
      calls.push({ cmd, args });
      return { exitCode: 0, stdout: "ok", stderr: "" };
    };
    const result = await apply(makeApplyDeps(store, exec));
    expect(result.exitCode).toBe(0);
    expect(result.restartRequired).toBe(true);
    expect(calls[0]).toEqual({ cmd: "claude", args: ["plugin", "update", "loom"] });
    // Marker cleared, installedVersion bumped.
    expect(store.current()!.installedVersion).toBe("0.2.0");
    expect(store.current()!.updateInProgress).toBeNull();
  });

  it("falls back to `plugin add loom@<v>` when update fails", async () => {
    const store = makeStateStore(baseState({ channel: "plugin" }));
    const calls: { cmd: string; args: string[] }[] = [];
    const exec: ApplyDeps["exec"] = async (cmd, args) => {
      calls.push({ cmd, args });
      // First call (update) fails; second call (add) succeeds.
      if (calls.length === 1) {
        return { exitCode: 1, stdout: "", stderr: "boom" };
      }
      return { exitCode: 0, stdout: "added", stderr: "" };
    };
    const result = await apply(makeApplyDeps(store, exec));
    expect(result.exitCode).toBe(0);
    expect(calls.length).toBe(2);
    expect(calls[1]).toEqual({
      cmd: "claude",
      args: ["plugin", "add", "loom@0.2.0"],
    });
  });

  it("returns non-zero when both update and add fail; marker remains", async () => {
    const store = makeStateStore(baseState({ channel: "plugin" }));
    const exec: ApplyDeps["exec"] = async () => ({
      exitCode: 7,
      stdout: "",
      stderr: "x",
    });
    const result = await apply(makeApplyDeps(store, exec));
    expect(result.exitCode).toBe(7);
    expect(result.restartRequired).toBe(false);
    // Marker retained for --resume.
    expect(store.current()!.updateInProgress).not.toBeNull();
  });
});

describe("update/apply — curl channel", () => {
  it("invokes bash -c with the pinned install URL", async () => {
    const store = makeStateStore(baseState({ channel: "curl" }));
    let captured: { cmd: string; args: string[] } | null = null;
    const exec: ApplyDeps["exec"] = async (cmd, args) => {
      captured = { cmd, args };
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    const result = await apply(makeApplyDeps(store, exec, "0.3.0"));
    expect(result.exitCode).toBe(0);
    expect(result.restartRequired).toBe(false);
    expect(captured!.cmd).toBe("bash");
    expect(captured!.args[0]).toBe("-c");
    expect(captured!.args[1]).toContain("v0.3.0");
    expect(captured!.args[1]).toContain("install.sh");
    expect(store.current()!.installedVersion).toBe("0.3.0");
  });
});

describe("update/apply — pin", () => {
  it("writes pinnedVersion and targets the pinned version", async () => {
    const store = makeStateStore(baseState({ channel: "plugin" }));
    const calls: { cmd: string; args: string[] }[] = [];
    const exec: ApplyDeps["exec"] = async (cmd, args) => {
      calls.push({ cmd, args });
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    await apply(makeApplyDeps(store, exec), { pin: "0.5.0" });
    expect(store.current()!.pinnedVersion).toBe("0.5.0");
    expect(store.current()!.installedVersion).toBe("0.5.0");
  });
});

// ---------------------------------------------------------------------------
// resume.ts
// ---------------------------------------------------------------------------

describe("update/resume", () => {
  it("noop when no marker is present", async () => {
    const store = makeStateStore(baseState());
    const outcome = await resume({
      ...makeApplyDeps(store, async () => ({ exitCode: 0, stdout: "", stderr: "" })),
      fetchManifest: async () => ({ versions: ["0.1.0", "0.2.0"] }),
    });
    expect(outcome.kind).toBe("noop");
  });

  it("noop when state is missing", async () => {
    const store = makeStateStore(null);
    const outcome = await resume({
      readState: store.readState,
      writeState: store.writeState,
      resolveLatestVersion: async () => "0.2.0",
      exec: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      now: () => FROZEN_NOW,
      fetchManifest: async () => ({ versions: ["0.2.0"] }),
    });
    expect(outcome.kind).toBe("noop");
  });

  it("completes when toVersion is in the registry", async () => {
    const store = makeStateStore(
      baseState({
        channel: "plugin",
        updateInProgress: {
          fromVersion: "0.1.0",
          toVersion: "0.2.0",
          startedAt: "x",
        },
      }),
    );
    const outcome = await resume({
      ...makeApplyDeps(
        store,
        async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      ),
      fetchManifest: async () => ({ versions: ["0.1.0", "0.2.0"] }),
    });
    expect(outcome.kind).toBe("completed");
    if (outcome.kind === "completed") {
      expect(outcome.result.restartRequired).toBe(true);
    }
    expect(store.current()!.updateInProgress).toBeNull();
  });

  it("sets terminal failed when toVersion is unknown", async () => {
    const store = makeStateStore(
      baseState({
        updateInProgress: {
          fromVersion: "0.1.0",
          toVersion: "9.9.9",
          startedAt: "x",
        },
      }),
    );
    const outcome = await resume({
      ...makeApplyDeps(
        store,
        async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      ),
      fetchManifest: async () => ({ versions: ["0.1.0", "0.2.0"] }),
    });
    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") {
      expect(outcome.message).toBe(UNRECOVERABLE_MESSAGE);
    }
    expect(store.current()!.updateInProgress).toBe("failed");
  });

  it("treats prior failed sentinel as terminal", async () => {
    const store = makeStateStore(
      baseState({ updateInProgress: "failed" }),
    );
    const outcome = await resume({
      ...makeApplyDeps(
        store,
        async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      ),
      fetchManifest: async () => ({ versions: ["0.1.0", "0.2.0"] }),
    });
    expect(outcome.kind).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// rollback.ts
// ---------------------------------------------------------------------------

function makeV3Fixture(
  tmpDir: string,
  items: { source: string; content: string }[],
): { invPath: string; snapshotPath: string; chain: string } {
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

  const invPath = path.join(tmpDir, "install-state.toon");
  fs.writeFileSync(invPath, toon);
  return { invPath, snapshotPath, chain };
}

describe("update/rollback", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-rollback-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses a well-formed v3 inventory", () => {
    const { invPath } = makeV3Fixture(tmpDir, [
      { source: "commands/x.md", content: "hello" },
    ]);
    const inv = parseV3Inventory(fs.readFileSync(invPath, "utf8"));
    expect(inv.schemaVersion).toBe(3);
    expect(inv.items.length).toBe(1);
    expect(inv.items[0].source).toBe("commands/x.md");
    expect(inv.snapshot).not.toBeNull();
  });

  it("rejects unsupported schemaVersion", () => {
    expect(() => parseV3Inventory("schemaVersion: 2\n")).toThrow(/schemaVersion/);
  });

  it("restores files when chain matches", () => {
    const fixture = makeV3Fixture(tmpDir, [
      { source: "a.md", content: "alpha" },
      { source: "b.md", content: "beta" },
    ]);
    const deps: RollbackDeps = {
      readInventory: () => fs.readFileSync(fixture.invPath, "utf8"),
    };
    const outcome = rollback(deps);
    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.restoredVersion).toBe("0.0.9");
      expect(outcome.restoredCount).toBe(2);
    }
    // Snapshot files must remain (rollback uses .staged peer + rename).
    expect(fs.existsSync(path.join(fixture.snapshotPath, "a.md"))).toBe(true);
  });

  it("returns ROLLBACK_HASH_MISMATCH on chain tamper", () => {
    const fixture = makeV3Fixture(tmpDir, [
      { source: "a.md", content: "alpha" },
    ]);
    // Tamper: rewrite the snapshot copy content but leave the recorded chain alone.
    fs.writeFileSync(path.join(fixture.snapshotPath, "a.md"), "TAMPERED");
    const outcome = rollback({
      readInventory: () => fs.readFileSync(fixture.invPath, "utf8"),
    });
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.code).toBe("ROLLBACK_HASH_MISMATCH");
    }
  });

  it("returns ROLLBACK_NO_SNAPSHOT when snapshot block is absent", () => {
    const toon = [
      "schemaVersion: 3",
      "protocolVersion: 3",
      "loomCoreVersion: 0.1.0",
      "loomHooksVersion: 0.1.0",
      "items[0]{name,type,source,targetPath,sha256,component,installedAt}:",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(tmpDir, "inv.toon"), toon);
    const outcome = rollback({
      readInventory: () => fs.readFileSync(path.join(tmpDir, "inv.toon"), "utf8"),
    });
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.code).toBe("ROLLBACK_NO_SNAPSHOT");
    }
  });

  it("returns noop when inventory file is missing", () => {
    const outcome = rollback({ readInventory: () => null });
    expect(outcome.kind).toBe("noop");
  });
});
