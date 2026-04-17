/**
 * Tests for hooks/lib/loom-context.ts — structured state extraction CLI.
 * Tests each subcommand by setting up temp directories with mock .toon files.
 * Tests graceful degradation when state files are missing.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

const LOOM_CONTEXT_SCRIPT = path.resolve(
  __dirname,
  "../../hooks/lib/loom-context.ts"
);

/**
 * Run the loom-context.ts script with the given subcommand, in a given cwd.
 * Returns stdout as a string. Uses bun to run .ts directly.
 */
function runLoomContext(
  subcommand: string,
  cwd: string
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`npx tsx ${LOOM_CONTEXT_SCRIPT} ${subcommand}`, {
      cwd,
      encoding: "utf-8",
      timeout: 10000,
      env: { ...process.env, HOME: process.env.HOME },
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      exitCode: err.status ?? 1,
    };
  }
}

/** Parse simple TOON key:value output into a record. */
function parseToonOutput(output: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();
    if (key && !key.includes("[")) {
      result[key] = value;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const tmpBase = path.join("/tmp", "loom-test-context-" + process.pid);

function setupPlanExecDir(base: string): string {
  const planDir = path.join(base, ".plan-execution");
  fs.mkdirSync(path.join(planDir, "stage-context"), { recursive: true });
  return planDir;
}

// ---------------------------------------------------------------------------
// 1. all-stages subcommand (AC #6)
// ---------------------------------------------------------------------------

describe("loom-context all-stages", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(tmpBase, "all-stages-" + Date.now());
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("returns valid TOON with stage data when stage-context files exist", () => {
    const planDir = setupPlanExecDir(testDir);
    fs.writeFileSync(
      path.join(planDir, "stage-context", "contracts.toon"),
      "stage: contracts\nwave: 0\nsummary: Generated contracts\n"
    );
    fs.writeFileSync(
      path.join(planDir, "stage-context", "execute.toon"),
      "stage: execute\nwave: 1\nsummary: Built features\n"
    );

    const { stdout } = runLoomContext("all-stages", testDir);
    const parsed = parseToonOutput(stdout);

    expect(parsed["status"]).toBe("ok");
    expect(parsed["stageCount"]).toBe("2");
    expect(stdout).toContain("contracts:");
    expect(stdout).toContain("execute:");
    expect(stdout).toContain("Generated contracts");
    expect(stdout).toContain("Built features");
  });

  it("returns unavailable TOON when no .plan-execution directory exists", () => {
    const emptyDir = path.join(testDir, "empty");
    fs.mkdirSync(emptyDir, { recursive: true });

    const { stdout } = runLoomContext("all-stages", emptyDir);
    const parsed = parseToonOutput(stdout);

    expect(parsed["status"]).toBe("unavailable");
    expect(parsed["reason"]).toBeTruthy();
  });

  it("returns unavailable TOON when stage-context directory is empty", () => {
    setupPlanExecDir(testDir);
    // stage-context dir exists but has no .toon files

    const { stdout } = runLoomContext("all-stages", testDir);
    const parsed = parseToonOutput(stdout);

    expect(parsed["status"]).toBe("unavailable");
    expect(parsed["reason"]).toContain("no stage-context .toon files");
  });
});

// ---------------------------------------------------------------------------
// 2. pipeline-position subcommand (AC #6)
// ---------------------------------------------------------------------------

describe("loom-context pipeline-position", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(tmpBase, "pipeline-" + Date.now());
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("returns valid TOON with pipeline state when pipeline-state.toon exists", () => {
    const planDir = setupPlanExecDir(testDir);
    fs.writeFileSync(
      path.join(planDir, "pipeline-state.toon"),
      [
        "currentStage: execute",
        "outerIteration: 1",
        "agentsSpawned: 4",
        "maxAgents: 50",
        "fixCycleCount: 0",
      ].join("\n")
    );

    const { stdout } = runLoomContext("pipeline-position", testDir);
    const parsed = parseToonOutput(stdout);

    expect(parsed["status"]).toBe("ok");
    expect(parsed["currentStage"]).toBe("execute");
    expect(parsed["outerIteration"]).toBe("1");
    expect(parsed["agentsSpawned"]).toBe("4");
    expect(parsed["maxAgents"]).toBe("50");
    expect(parsed["fixCycleCount"]).toBe("0");
  });

  it("returns unavailable when pipeline-state.toon is missing", () => {
    setupPlanExecDir(testDir);
    // No pipeline-state.toon

    const { stdout } = runLoomContext("pipeline-position", testDir);
    const parsed = parseToonOutput(stdout);

    expect(parsed["status"]).toBe("unavailable");
  });

  it("returns unavailable when no .plan-execution directory exists", () => {
    const emptyDir = path.join(testDir, "empty");
    fs.mkdirSync(emptyDir, { recursive: true });

    const { stdout } = runLoomContext("pipeline-position", emptyDir);
    const parsed = parseToonOutput(stdout);

    expect(parsed["status"]).toBe("unavailable");
  });
});

// ---------------------------------------------------------------------------
// 3. budget-status subcommand (AC #6)
// ---------------------------------------------------------------------------

describe("loom-context budget-status", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(tmpBase, "budget-" + Date.now());
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("returns valid TOON with default budget when no config exists", () => {
    const planDir = setupPlanExecDir(testDir);
    fs.writeFileSync(
      path.join(planDir, "rolling-context.md"),
      "x".repeat(400)
    );

    const { stdout } = runLoomContext("budget-status", testDir);
    const parsed = parseToonOutput(stdout);

    expect(parsed["status"]).toBe("ok");
    expect(parsed["contextWindow"]).toBe("200000");
    expect(parsed["agentBudgetCap"]).toBe("100000");
    expect(parsed["withinBudget"]).toBeTruthy();
  });

  it("reads custom budget config from orchestration.toml", () => {
    const planDir = setupPlanExecDir(testDir);
    fs.mkdirSync(path.join(testDir, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(testDir, ".claude", "orchestration.toml"),
      "[settings.contextBudget]\ncontextWindow = 1000000\n"
    );

    const { stdout } = runLoomContext("budget-status", testDir);
    const parsed = parseToonOutput(stdout);

    expect(parsed["status"]).toBe("ok");
    expect(parsed["contextWindow"]).toBe("1000000");
    expect(parsed["agentBudgetCap"]).toBe("500000");
  });

  it("includes breakdown in output", () => {
    const planDir = setupPlanExecDir(testDir);
    fs.writeFileSync(
      path.join(planDir, "rolling-context.md"),
      "a".repeat(2000)
    );
    fs.writeFileSync(
      path.join(planDir, "stage-context", "contracts.toon"),
      "b".repeat(800)
    );

    const { stdout } = runLoomContext("budget-status", testDir);

    expect(stdout).toContain("breakdown:");
    expect(stdout).toContain("rollingContext:");
    expect(stdout).toContain("stageContext:");
    expect(stdout).toContain("overhead: 5000");
  });
});

// ---------------------------------------------------------------------------
// 4. Graceful degradation (AC #7)
// ---------------------------------------------------------------------------

describe("loom-context graceful degradation", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(tmpBase, "graceful-" + Date.now());
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("all-stages returns valid TOON (unavailable) when no state files exist", () => {
    const emptyDir = path.join(testDir, "nowhere");
    fs.mkdirSync(emptyDir, { recursive: true });

    const { stdout, exitCode } = runLoomContext("all-stages", emptyDir);
    expect(exitCode).toBe(0);

    const parsed = parseToonOutput(stdout);
    expect(parsed["status"]).toBe("unavailable");
    // Must not throw or return an error exit code
  });

  it("pipeline-position returns valid TOON (unavailable) when no state files exist", () => {
    const emptyDir = path.join(testDir, "nowhere");
    fs.mkdirSync(emptyDir, { recursive: true });

    const { stdout, exitCode } = runLoomContext("pipeline-position", emptyDir);
    expect(exitCode).toBe(0);

    const parsed = parseToonOutput(stdout);
    expect(parsed["status"]).toBe("unavailable");
  });

  it("budget-status returns valid TOON with defaults when no config or state files exist", () => {
    const emptyDir = path.join(testDir, "nowhere");
    fs.mkdirSync(emptyDir, { recursive: true });

    const { stdout, exitCode } = runLoomContext("budget-status", emptyDir);
    expect(exitCode).toBe(0);

    const parsed = parseToonOutput(stdout);
    expect(parsed["status"]).toBe("ok");
    expect(parsed["contextWindow"]).toBe("200000");
    expect(parsed["agentBudgetCap"]).toBe("100000");
  });

  it("invalid subcommand exits with code 1 and shows usage", () => {
    const { stderr, exitCode } = runLoomContext("invalid-command", testDir);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage:");
  });
});
