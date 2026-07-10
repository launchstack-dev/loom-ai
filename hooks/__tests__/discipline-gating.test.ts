/**
 * Integration tests for discipline-profile gating (roadmap M-1).
 * Spawns real hooks with a [settings.discipline] config and verifies:
 * - strict (and no-config) behavior is identical to pre-profile Loom
 * - scaffold hooks are silent (exit 0, no stdout) below strict
 * - engine hooks do not block under minimal
 * - tier floors keep file-ownership enforcement for haiku-tier agents
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runHook, parseDecision } from "./helpers/hook-runner.js";

let tmpDir: string;
let planExecDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-discipline-gate-"));
  planExecDir = path.join(tmpDir, ".plan-execution");
  fs.mkdirSync(planExecDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeProfile(profile: string) {
  const claudeDir = path.join(tmpDir, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(
    path.join(claudeDir, "orchestration.toml"),
    `[settings.discipline]\nprofile = "${profile}"\n`,
    "utf-8"
  );
}

function writePipelineState(spawned: number, max: number, stage = "execute") {
  fs.writeFileSync(
    path.join(planExecDir, "pipeline-state.toon"),
    `schemaVersion: 1\nagentsSpawned: ${spawned}\nmaxAgents: ${max}\ncurrentStage: ${stage}\nouterIteration: 1\nfixCycleCount: 0`,
    "utf-8"
  );
}

function writeOwnershipState() {
  fs.writeFileSync(
    path.join(planExecDir, "state.toon"),
    `status: running\ncurrentWave: 1\n1:\n  status: in_progress\n  tasks[1]{taskId,agent,status,fileOwnership}:\n    w1-auth,implementer-agent,in_progress,src/owned.ts`,
    "utf-8"
  );
}

const spawnInput = { tool_name: "Agent", tool_input: { prompt: "do stuff" } };

describe("budget-tracker gating (scaffold)", () => {
  it("still blocks at 100% budget under strict", async () => {
    writeProfile("strict");
    writePipelineState(30, 30);
    const result = await runHook("budget-tracker.ts", spawnInput, { cwd: tmpDir });
    expect(result.exitCode).toBe(2);
    expect(parseDecision(result.stdout)?.decision).toBe("block");
  });

  it("still blocks at 100% budget with no discipline config (C-06)", async () => {
    writePipelineState(30, 30);
    const result = await runHook("budget-tracker.ts", spawnInput, { cwd: tmpDir });
    expect(result.exitCode).toBe(2);
  });

  it("is silent at 100% budget under standard", async () => {
    writeProfile("standard");
    writePipelineState(30, 30);
    const result = await runHook("budget-tracker.ts", spawnInput, { cwd: tmpDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("is silent at 100% budget under minimal", async () => {
    writeProfile("minimal");
    writePipelineState(30, 30);
    const result = await runHook("budget-tracker.ts", spawnInput, { cwd: tmpDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("does not emit the 80% warning injection under standard", async () => {
    writeProfile("standard");
    writePipelineState(24, 30);
    const result = await runHook("budget-tracker.ts", spawnInput, { cwd: tmpDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });
});

describe("quality-gate gating (core per C-08 — blocks under every profile)", () => {
  const stopInput = {};

  it.each(["strict", "standard", "minimal"])(
    "blocks mid-stage stops under %s",
    async (profile) => {
      writeProfile(profile);
      writePipelineState(1, 30, "execute");
      const result = await runHook("quality-gate.ts", stopInput, { cwd: tmpDir });
      expect(result.exitCode).toBe(2);
      expect(parseDecision(result.stdout)?.decision).toBe("block");
    }
  );
});

describe("file-ownership gating (core, tier-gated)", () => {
  function outOfBoundaryInput() {
    return {
      tool_name: "Write",
      tool_input: { file_path: path.join(tmpDir, "src", "not-owned.ts") },
    };
  }

  it("still blocks out-of-boundary writes under strict", async () => {
    writeProfile("strict");
    writeOwnershipState();
    const result = await runHook("file-ownership.ts", outOfBoundaryInput(), { cwd: tmpDir });
    expect(result.exitCode).toBe(2);
    expect(parseDecision(result.stdout)?.decision).toBe("block");
  });

  it("still blocks out-of-boundary writes under standard", async () => {
    writeProfile("standard");
    writeOwnershipState();
    const result = await runHook("file-ownership.ts", outOfBoundaryInput(), { cwd: tmpDir });
    expect(result.exitCode).toBe(2);
  });

  it("allows main-session writes under minimal", async () => {
    writeProfile("minimal");
    writeOwnershipState();
    const result = await runHook("file-ownership.ts", outOfBoundaryInput(), { cwd: tmpDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("still blocks haiku-tier agents under minimal (tier floor)", async () => {
    writeProfile("minimal");
    writeOwnershipState();
    const result = await runHook("file-ownership.ts", outOfBoundaryInput(), {
      cwd: tmpDir,
      env: { LOOM_AGENT_TIER: "haiku" },
    });
    expect(result.exitCode).toBe(2);
    expect(parseDecision(result.stdout)?.decision).toBe("block");
  });

  it("does not lift enforcement for un-floored tiers under minimal", async () => {
    writeProfile("minimal");
    writeOwnershipState();
    const result = await runHook("file-ownership.ts", outOfBoundaryInput(), {
      cwd: tmpDir,
      env: { LOOM_AGENT_TIER: "opus" },
    });
    expect(result.exitCode).toBe(0);
  });
});

describe("scaffold silence under minimal (roadmap metric)", () => {
  it("checkpoint-trigger, context-monitor, status-updater emit nothing", async () => {
    writeProfile("minimal");
    writePipelineState(1, 30);
    for (const hook of ["checkpoint-trigger.ts", "context-monitor.ts", "status-updater.ts"]) {
      const result = await runHook(hook, { tool_name: "Write", tool_input: {} }, { cwd: tmpDir });
      expect(result.exitCode, hook).toBe(0);
      expect(result.stdout, hook).toBe("");
    }
  });

  it("context-budget allows an over-cap spawn silently under minimal", async () => {
    writeProfile("minimal");
    const bigPrompt = "x".repeat(500);
    const claudePath = path.join(tmpDir, ".claude", "orchestration.toml");
    fs.writeFileSync(
      claudePath,
      `[settings.discipline]\nprofile = "minimal"\n\n[settings.contextBudget]\ncontextWindow = 200\nagentBudgetCap = 10\n`,
      "utf-8"
    );
    const result = await runHook(
      "context-budget.ts",
      { tool_name: "Agent", tool_input: { prompt: bigPrompt } },
      { cwd: tmpDir }
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("context-budget still blocks the same over-cap spawn under strict", async () => {
    const claudeDir = path.join(tmpDir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, "orchestration.toml"),
      `[settings.discipline]\nprofile = "strict"\n\n[settings.contextBudget]\ncontextWindow = 200\nagentBudgetCap = 10\n`,
      "utf-8"
    );
    const result = await runHook(
      "context-budget.ts",
      { tool_name: "Agent", tool_input: { prompt: "x".repeat(500) } },
      { cwd: tmpDir }
    );
    expect(result.exitCode).toBe(2);
  });
});
