import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runHook, parseDecision } from "./helpers/hook-runner.js";

let tmpDir: string;
let planExecDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-gate-test-"));
  planExecDir = path.join(tmpDir, ".plan-execution");
  fs.mkdirSync(planExecDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writePipelineState(stage: string, iteration = 1) {
  fs.writeFileSync(
    path.join(planExecDir, "pipeline-state.toon"),
    `schemaVersion: 1\ncurrentStage: ${stage}\nouterIteration: ${iteration}\nagentsSpawned: 5\nmaxAgents: 30\nfixCycleCount: 0`,
    "utf-8"
  );
}

const stopInput = { stop_reason: "end_turn" };

describe("quality-gate hook", () => {
  it("allows stop when stage is complete", async () => {
    writePipelineState("complete");
    const result = await runHook("quality-gate.ts", stopInput, { cwd: tmpDir });
    expect(result.exitCode).toBe(0);
  });

  it("allows stop when stage is escalated", async () => {
    writePipelineState("escalated");
    const result = await runHook("quality-gate.ts", stopInput, { cwd: tmpDir });
    expect(result.exitCode).toBe(0);
  });

  it("blocks stop during plan-create", async () => {
    writePipelineState("plan-create");
    const result = await runHook("quality-gate.ts", stopInput, { cwd: tmpDir });
    expect(result.exitCode).toBe(2);
    const decision = parseDecision(result.stdout);
    expect(decision?.decision).toBe("block");
    expect(decision?.reason).toContain("Plan Creation");
  });

  it("blocks stop during execute", async () => {
    writePipelineState("execute", 2);
    const result = await runHook("quality-gate.ts", stopInput, { cwd: tmpDir });
    expect(result.exitCode).toBe(2);
    const decision = parseDecision(result.stdout);
    expect(decision?.decision).toBe("block");
    expect(decision?.reason).toContain("Execution");
    expect(decision?.reason).toContain("iteration 2");
  });

  it("blocks stop during review-code", async () => {
    writePipelineState("review-code");
    const result = await runHook("quality-gate.ts", stopInput, { cwd: tmpDir });
    expect(result.exitCode).toBe(2);
    const decision = parseDecision(result.stdout);
    expect(decision?.reason).toContain("Code Review");
  });

  it("blocks stop during fix-code", async () => {
    writePipelineState("fix-code");
    const result = await runHook("quality-gate.ts", stopInput, { cwd: tmpDir });
    expect(result.exitCode).toBe(2);
  });

  it("blocks stop during test stage", async () => {
    writePipelineState("test");
    const result = await runHook("quality-gate.ts", stopInput, { cwd: tmpDir });
    expect(result.exitCode).toBe(2);
  });

  it("allows stop when no .plan-execution/ exists", async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-no-plan-"));
    const result = await runHook("quality-gate.ts", stopInput, { cwd: emptyDir });
    expect(result.exitCode).toBe(0);
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it("allows stop when pipeline-state.toon is missing", async () => {
    // planExecDir exists but no pipeline-state.toon
    const result = await runHook("quality-gate.ts", stopInput, { cwd: tmpDir });
    expect(result.exitCode).toBe(0);
  });

  it("allows stop when pipeline-state.toon is malformed", async () => {
    fs.writeFileSync(
      path.join(planExecDir, "pipeline-state.toon"),
      "this is not valid toon {{{",
      "utf-8"
    );
    const result = await runHook("quality-gate.ts", stopInput, { cwd: tmpDir });
    // "unknown" stage is not in KNOWN_STAGES, so hook fails open
    expect(result.exitCode).toBe(0);
  });
});
