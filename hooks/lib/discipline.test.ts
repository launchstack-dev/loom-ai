import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  readDisciplineConfig,
  resolveProfile,
  effectiveProfile,
  hookActive,
  maxProfile,
} from "./discipline.js";

let tmpDir: string;
let savedEnvProfile: string | undefined;
let savedEnvTier: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-discipline-test-"));
  savedEnvProfile = process.env.LOOM_DISCIPLINE_PROFILE;
  savedEnvTier = process.env.LOOM_AGENT_TIER;
  delete process.env.LOOM_DISCIPLINE_PROFILE;
  delete process.env.LOOM_AGENT_TIER;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (savedEnvProfile === undefined) delete process.env.LOOM_DISCIPLINE_PROFILE;
  else process.env.LOOM_DISCIPLINE_PROFILE = savedEnvProfile;
  if (savedEnvTier === undefined) delete process.env.LOOM_AGENT_TIER;
  else process.env.LOOM_AGENT_TIER = savedEnvTier;
});

function writeOrchestration(content: string) {
  const claudeDir = path.join(tmpDir, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(path.join(claudeDir, "orchestration.toml"), content, "utf-8");
}

describe("readDisciplineConfig", () => {
  it("returns strict-equivalent defaults when orchestration.toml is missing", () => {
    const cfg = readDisciplineConfig(tmpDir);
    expect(cfg.profile).toBe("auto");
    expect(cfg.resolved).toBeNull();
    expect(cfg.tierOverrides.haiku).toBe("standard");
  });

  it("returns defaults when the section is absent", () => {
    writeOrchestration(`[settings]\nmaxParallelAgents = 6\n`);
    const cfg = readDisciplineConfig(tmpDir);
    expect(cfg.profile).toBe("auto");
    expect(cfg.resolved).toBeNull();
  });

  it("parses quoted and unquoted profile values", () => {
    writeOrchestration(`[settings.discipline]\nprofile = "standard"\n`);
    expect(readDisciplineConfig(tmpDir).profile).toBe("standard");

    writeOrchestration(`[settings.discipline]\nprofile = minimal\n`);
    expect(readDisciplineConfig(tmpDir).profile).toBe("minimal");
  });

  it("parses the resolved key and trailing comments", () => {
    writeOrchestration(
      `[settings.discipline]\nprofile = "auto"\nresolved = "standard" # written by doctor\n`
    );
    const cfg = readDisciplineConfig(tmpDir);
    expect(cfg.profile).toBe("auto");
    expect(cfg.resolved).toBe("standard");
  });

  it("ignores invalid profile values (stays auto)", () => {
    writeOrchestration(`[settings.discipline]\nprofile = "yolo"\n`);
    expect(readDisciplineConfig(tmpDir).profile).toBe("auto");
  });

  it("merges tierOverrides over built-in floors", () => {
    writeOrchestration(
      `[settings.discipline]\nprofile = "minimal"\n\n[settings.discipline.tierOverrides]\nhaiku = "strict"\nsweep = "standard"\n`
    );
    const cfg = readDisciplineConfig(tmpDir);
    expect(cfg.tierOverrides.haiku).toBe("strict");
    expect(cfg.tierOverrides.sweep).toBe("standard");
  });

  it("does not leak tierOverrides keys into the parent section parse", () => {
    writeOrchestration(
      `[settings.discipline]\nprofile = "minimal"\n\n[settings.discipline.tierOverrides]\nhaiku = "standard"\n\n[wiki]\nenabled = true\n`
    );
    const cfg = readDisciplineConfig(tmpDir);
    expect(cfg.profile).toBe("minimal");
    expect(cfg.tierOverrides.haiku).toBe("standard");
  });
});

describe("resolveProfile", () => {
  it("defaults to strict when nothing is configured (C-06)", () => {
    expect(resolveProfile(undefined, tmpDir)).toBe("strict");
  });

  it("honors an explicit pin", () => {
    writeOrchestration(`[settings.discipline]\nprofile = "standard"\n`);
    expect(resolveProfile(undefined, tmpDir)).toBe("standard");
  });

  it("uses resolved when profile is auto", () => {
    writeOrchestration(`[settings.discipline]\nprofile = "auto"\nresolved = "minimal"\n`);
    expect(resolveProfile(undefined, tmpDir)).toBe("minimal");
  });

  it("falls back to strict when auto has no resolved value", () => {
    writeOrchestration(`[settings.discipline]\nprofile = "auto"\n`);
    expect(resolveProfile(undefined, tmpDir)).toBe("strict");
  });

  it("prefers the pin over resolved", () => {
    writeOrchestration(`[settings.discipline]\nprofile = "strict"\nresolved = "minimal"\n`);
    expect(resolveProfile(undefined, tmpDir)).toBe("strict");
  });

  it("lets LOOM_DISCIPLINE_PROFILE override everything", () => {
    writeOrchestration(`[settings.discipline]\nprofile = "strict"\n`);
    process.env.LOOM_DISCIPLINE_PROFILE = "minimal";
    expect(resolveProfile(undefined, tmpDir)).toBe("minimal");
  });

  it("ignores an invalid env override", () => {
    process.env.LOOM_DISCIPLINE_PROFILE = "bogus";
    expect(resolveProfile(undefined, tmpDir)).toBe("strict");
  });
});

describe("effectiveProfile (tier floors)", () => {
  it("lifts minimal to standard for haiku-tier agents (built-in floor)", () => {
    writeOrchestration(`[settings.discipline]\nprofile = "minimal"\n`);
    expect(effectiveProfile({ tier: "haiku", cwd: tmpDir })).toBe("standard");
  });

  it("does not lift for tiers without a floor", () => {
    writeOrchestration(`[settings.discipline]\nprofile = "minimal"\n`);
    expect(effectiveProfile({ tier: "sonnet", cwd: tmpDir })).toBe("minimal");
  });

  it("never lowers the session profile", () => {
    writeOrchestration(`[settings.discipline]\nprofile = "strict"\n`);
    expect(effectiveProfile({ tier: "haiku", cwd: tmpDir })).toBe("strict");
  });

  it("reads the tier from LOOM_AGENT_TIER when not passed", () => {
    writeOrchestration(`[settings.discipline]\nprofile = "minimal"\n`);
    process.env.LOOM_AGENT_TIER = "haiku";
    expect(effectiveProfile({ cwd: tmpDir })).toBe("standard");
  });

  it("honors custom tier floors from config", () => {
    writeOrchestration(
      `[settings.discipline]\nprofile = "minimal"\n\n[settings.discipline.tierOverrides]\nsweep = "strict"\n`
    );
    expect(effectiveProfile({ tier: "sweep", cwd: tmpDir })).toBe("strict");
  });
});

describe("hookActive", () => {
  it("treats unknown hooks as core/always-on", () => {
    writeOrchestration(`[settings.discipline]\nprofile = "minimal"\n`);
    expect(hookActive("some-future-hook", { cwd: tmpDir })).toBe(true);
  });

  it("keeps core hooks on under minimal", () => {
    writeOrchestration(`[settings.discipline]\nprofile = "minimal"\n`);
    expect(hookActive("deploy-guard", { cwd: tmpDir })).toBe(true);
    expect(hookActive("contract-lock", { cwd: tmpDir })).toBe(true);
  });

  it("runs everything under strict (byte-identical today-behavior)", () => {
    writeOrchestration(`[settings.discipline]\nprofile = "strict"\n`);
    for (const hook of [
      "deploy-guard",
      "quality-gate",
      "context-budget",
      "budget-tracker",
      "context-monitor",
      "checkpoint-trigger",
      "status-updater",
      "wiki-impact-warner",
      "file-ownership",
    ]) {
      expect(hookActive(hook, { cwd: tmpDir })).toBe(true);
    }
  });

  it("runs everything when no config exists (C-06 default)", () => {
    expect(hookActive("context-budget", { cwd: tmpDir })).toBe(true);
    expect(hookActive("wiki-impact-warner", { cwd: tmpDir })).toBe(true);
  });

  it("turns scaffold hooks off under standard", () => {
    writeOrchestration(`[settings.discipline]\nprofile = "standard"\n`);
    for (const hook of [
      "context-budget",
      "budget-tracker",
      "context-monitor",
      "checkpoint-trigger",
      "status-updater",
      "wiki-impact-warner",
    ]) {
      expect(hookActive(hook, { cwd: tmpDir })).toBe(false);
    }
    expect(hookActive("quality-gate", { cwd: tmpDir })).toBe(true);
    expect(hookActive("file-ownership", { cwd: tmpDir })).toBe(true);
  });

  it("keeps quality-gate on under every profile (C-08/C-11)", () => {
    for (const profile of ["strict", "standard", "minimal"]) {
      writeOrchestration(`[settings.discipline]\nprofile = "${profile}"\n`);
      expect(hookActive("quality-gate", { cwd: tmpDir }), profile).toBe(true);
    }
  });

  it("keeps file-ownership on under minimal for haiku-tier agents", () => {
    writeOrchestration(`[settings.discipline]\nprofile = "minimal"\n`);
    expect(hookActive("file-ownership", { tier: "haiku", cwd: tmpDir })).toBe(true);
    expect(hookActive("file-ownership", { tier: null, cwd: tmpDir })).toBe(false);
  });

  it("does not apply tier floors to non-tier-sensitive hooks", () => {
    writeOrchestration(`[settings.discipline]\nprofile = "minimal"\n`);
    // haiku floor is "standard" — scaffold requires strict, so no lift applies
    expect(hookActive("context-budget", { tier: "haiku", cwd: tmpDir })).toBe(false);
    expect(hookActive("budget-tracker", { tier: "haiku", cwd: tmpDir })).toBe(false);
  });
});

describe("maxProfile", () => {
  it("orders minimal < standard < strict", () => {
    expect(maxProfile("minimal", "standard")).toBe("standard");
    expect(maxProfile("strict", "standard")).toBe("strict");
    expect(maxProfile("minimal", "minimal")).toBe("minimal");
  });
});
