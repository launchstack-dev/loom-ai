import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  defaultInstallStatePath,
  encodeInstallState,
  decodeInstallState,
  readInstallState,
  writeInstallStateAtomic,
  type InstallState,
} from "./install-state";

function sample(): InstallState {
  return {
    installedVersion: "0.1.0",
    installTimestamp: "2026-06-17T10:00:00.000Z",
    installSourceUrl: "https://github.com/launchstack-dev/loom-ai",
    runtimeVersion: "node-20.11.0",
    channel: "plugin",
    source: "marketplace-browse",
    migratedFrom: null,
    lastPing: null,
    doNotTrack: false,
    updateInProgress: null,
    installError: null,
    pinnedVersion: null,
  };
}

describe("install-state", () => {
  let tmpDir: string;
  let target: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-install-state-"));
    target = path.join(tmpDir, ".loom", "install.toon");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("defaultInstallStatePath", () => {
    it("honors LOOM_HOME when set", () => {
      const p = defaultInstallStatePath({ LOOM_HOME: "/tmp/sandbox" } as NodeJS.ProcessEnv);
      expect(p).toBe(path.join("/tmp/sandbox", "install.toon"));
    });

    it("falls back to HOME when LOOM_HOME unset", () => {
      const p = defaultInstallStatePath({ HOME: "/Users/foo" } as NodeJS.ProcessEnv);
      expect(p).toBe(path.join("/Users/foo", ".loom", "install.toon"));
    });

    it("throws when neither HOME nor LOOM_HOME is set", () => {
      expect(() => defaultInstallStatePath({} as NodeJS.ProcessEnv)).toThrow(/HOME/);
    });
  });

  describe("encode/decode round-trip", () => {
    it("round-trips a minimal envelope", () => {
      const s = sample();
      const encoded = encodeInstallState(s);
      const back = decodeInstallState(encoded);
      expect(back).toEqual(s);
    });

    it("round-trips updateInProgress as a block", () => {
      const s = sample();
      s.updateInProgress = {
        fromVersion: "0.1.0",
        toVersion: "0.2.0",
        startedAt: "2026-06-17T11:00:00.000Z",
      };
      const back = decodeInstallState(encodeInstallState(s));
      expect(back.updateInProgress).toEqual(s.updateInProgress);
    });

    it("round-trips updateInProgress=\"failed\" sentinel", () => {
      const s = sample();
      s.updateInProgress = "failed";
      const back = decodeInstallState(encodeInstallState(s));
      expect(back.updateInProgress).toBe("failed");
    });

    it("round-trips installError block", () => {
      const s = sample();
      s.installError = {
        step: "fetch",
        message: "404",
        timestamp: "2026-06-17T11:00:00.000Z",
      };
      const back = decodeInstallState(encodeInstallState(s));
      expect(back.installError).toEqual(s.installError);
    });

    it("round-trips migratedFrom block", () => {
      const s = sample();
      s.migratedFrom = { channel: "curl", version: "0.0.9" };
      const back = decodeInstallState(encodeInstallState(s));
      expect(back.migratedFrom).toEqual(s.migratedFrom);
    });

    it("round-trips lastPing and pinnedVersion when set", () => {
      const s = sample();
      s.lastPing = "2026-06-17T12:00:00.000Z";
      s.pinnedVersion = "0.1.0";
      const back = decodeInstallState(encodeInstallState(s));
      expect(back.lastPing).toBe(s.lastPing);
      expect(back.pinnedVersion).toBe(s.pinnedVersion);
    });

    it("escapes newlines in installError.message", () => {
      const s = sample();
      s.installError = {
        step: "x",
        message: "line1\nline2",
        timestamp: "2026-06-17T11:00:00.000Z",
      };
      const enc = encodeInstallState(s);
      expect(enc.split("\n").filter((l) => l.length > 0).every((l) => !l.includes("line2\n")))
        .toBe(true);
      const back = decodeInstallState(enc);
      expect(back.installError?.message).toBe("line1 line2");
    });
  });

  describe("decode validation", () => {
    it("rejects missing required field", () => {
      const text = `installedVersion: 0.1.0\nchannel: plugin\nsource: marketplace-browse\n`;
      expect(() => decodeInstallState(text)).toThrow(/required field/);
    });

    it("rejects invalid channel", () => {
      const s = sample();
      const bad = encodeInstallState(s).replace("channel: plugin", "channel: ftp");
      expect(() => decodeInstallState(bad)).toThrow(/channel/);
    });

    it("rejects invalid source", () => {
      const s = sample();
      const bad = encodeInstallState(s).replace(
        "source: marketplace-browse",
        "source: wormhole",
      );
      expect(() => decodeInstallState(bad)).toThrow(/source/);
    });
  });

  describe("atomic write", () => {
    it("creates parent dir and writes envelope", () => {
      const s = sample();
      writeInstallStateAtomic(target, s);
      expect(fs.existsSync(target)).toBe(true);
      const back = readInstallState(target);
      expect(back).toEqual(s);
    });

    it("uses .tmp then rename (no .tmp lingers on success)", () => {
      const s = sample();
      writeInstallStateAtomic(target, s);
      expect(fs.existsSync(`${target}.tmp`)).toBe(false);
    });

    it("readInstallState returns null when file missing", () => {
      expect(readInstallState(target)).toBeNull();
    });

    it("overwrite produces byte-stable output for the same state", () => {
      const s = sample();
      writeInstallStateAtomic(target, s);
      const first = fs.readFileSync(target, "utf8");
      writeInstallStateAtomic(target, s);
      const second = fs.readFileSync(target, "utf8");
      expect(second).toBe(first);
    });
  });
});
