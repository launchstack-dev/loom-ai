/**
 * Tests for the budget-tracker hook: enforcement during a live pipeline run,
 * and no enforcement or counting once the run has finished.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const HOOK = path.resolve(__dirname, "../../hooks/budget-tracker.ts");

let dir: string;

function writeState(currentStage: string, agentsSpawned: number): void {
  fs.mkdirSync(path.join(dir, ".plan-execution"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".plan-execution", "pipeline-state.toon"),
    `currentStage: ${currentStage}\nagentsSpawned: ${agentsSpawned}\nmaxAgents: 50\n`
  );
}

function readCount(): string | undefined {
  const content = fs.readFileSync(path.join(dir, ".plan-execution", "pipeline-state.toon"), "utf-8");
  return /^agentsSpawned:\s*(\d+)$/m.exec(content)?.[1];
}

function runHook(input: object) {
  return spawnSync("npx", ["tsx", HOOK], { cwd: dir, input: JSON.stringify(input), encoding: "utf-8" });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "budget-tracker-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("budget-tracker — live run", () => {
  it("blocks an Agent spawn when the budget is exhausted", () => {
    writeState("execute", 50);
    const result = runHook({ tool_name: "Agent" });
    expect(result.status).toBe(2);
    expect(result.stdout).toContain("Agent budget exhausted: 50/50");
  });

  it("counts a finished subagent", () => {
    writeState("execute", 3);
    expect(runHook({}).status).toBe(0);
    expect(readCount()).toBe("4");
  });
});

describe.each(["complete", "escalated"])("budget-tracker — finished run (%s)", (stage) => {
  it("allows an Agent spawn over the old budget", () => {
    writeState(stage, 922);
    const result = runHook({ tool_name: "Agent" });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("does not count a finished subagent", () => {
    writeState(stage, 922);
    expect(runHook({}).status).toBe(0);
    expect(readCount()).toBe("922");
  });
});
