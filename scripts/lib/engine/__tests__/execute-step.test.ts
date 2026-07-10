/**
 * Wave-execution step CLI tests (M-2). Pins the auto quality-gate rules
 * (execute.md Step 4/9), state.toon interop shape, retry bookkeeping, and
 * wave-summary output.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { init, startWave, recordWave, finalizeRun, decideGate } from "../execute-step.js";

let tmpDir: string;
let prevCwd: string;
let stdoutLines: string[];
let writeSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-exec-step-"));
  prevCwd = process.cwd();
  process.chdir(tmpDir);
  stdoutLines = [];
  writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string) => {
    stdoutLines.push(String(chunk));
    return true;
  }) as never);
});

afterEach(() => {
  writeSpy.mockRestore();
  process.chdir(prevCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function verdict(): Record<string, unknown> {
  const lines = stdoutLines.join("").trim().split("\n");
  return JSON.parse(lines[lines.length - 1]);
}

function setupPlan() {
  const wavesFile = path.join(tmpDir, "waves.json");
  fs.writeFileSync(
    wavesFile,
    JSON.stringify({
      waves: [
        {
          index: 0,
          tasks: [
            {
              taskId: "task-001",
              agent: "contracts-agent",
              description: "Create shared types",
              fileOwnership: ["src/types.ts"],
              model: "sonnet",
            },
          ],
        },
        {
          index: 1,
          tasks: [
            {
              taskId: "task-002",
              agent: "implementer-agent",
              description: "Auth routes",
              fileOwnership: ["src/routes/auth.ts"],
              model: "haiku",
            },
            {
              taskId: "task-003",
              agent: "implementer-agent",
              description: "User routes",
              fileOwnership: ["src/routes/users.ts"],
            },
          ],
        },
      ],
    }),
    "utf-8"
  );
  expect(init({ planFile: "PLAN.md", runId: "run-1", wavesFile })).toBe(0);
  stdoutLines = [];
}

function writeResults(wave: number, body: object): string {
  const p = path.join(tmpDir, `results-${wave}.json`);
  fs.writeFileSync(p, JSON.stringify(body), "utf-8");
  return p;
}

describe("decideGate (execute.md --auto rules)", () => {
  const task = (retryCount: number) => ({
    taskId: "t",
    agent: "implementer-agent",
    description: "d",
    fileOwnership: [],
    retryCount,
    status: "failed" as const,
  });

  it("proceeds on pass + zero blocking + no failures", () => {
    expect(
      decideGate({ verification: { result: "pass" }, blockingIssues: 0, failedTasks: [] }).decision
    ).toBe("proceed");
  });

  it("retries owned-file verification failures with retry budget left", () => {
    expect(
      decideGate({
        verification: { result: "fail", failuresInOwnedFiles: true },
        blockingIssues: 0,
        failedTasks: [task(1)],
      }).decision
    ).toBe("retry");
  });

  it("escalates when failures are outside owned files", () => {
    expect(
      decideGate({
        verification: { result: "fail", failuresInOwnedFiles: false },
        blockingIssues: 0,
        failedTasks: [],
      }).decision
    ).toBe("escalate");
  });

  it("escalates when retry budget is exhausted (retryCount >= 2)", () => {
    expect(
      decideGate({
        verification: { result: "fail", failuresInOwnedFiles: true },
        blockingIssues: 0,
        failedTasks: [task(2)],
      }).decision
    ).toBe("escalate");
  });

  it("escalates blocking issues even when verification passes", () => {
    expect(
      decideGate({ verification: { result: "pass" }, blockingIssues: 3, failedTasks: [] }).decision
    ).toBe("escalate");
  });
});

describe("init / start-wave / record-wave / finalize", () => {
  it("init writes driver state and a schema-shaped state.toon", () => {
    setupPlan();
    const toon = fs.readFileSync(path.join(tmpDir, ".plan-execution", "state.toon"), "utf-8");
    expect(toon).toContain("schemaVersion: 1");
    expect(toon).toContain("status: running");
    expect(toon).toContain("task-002,implementer-agent");
    expect(
      fs.existsSync(path.join(tmpDir, ".plan-execution", "ephemeral", "execute-driver-state.json"))
    ).toBe(true);
  });

  it("start-wave activates tasks and returns the spawn list with models", () => {
    setupPlan();
    expect(startWave({ wave: 1 })).toBe(0);
    const v = verdict() as { tasks: { taskId: string; model: string }[] };
    expect(v.tasks.map((t) => t.taskId)).toEqual(["task-002", "task-003"]);
    expect(v.tasks[0].model).toBe("haiku");
    expect(v.tasks[1].model).toBe("inherit");
    const toon = fs.readFileSync(path.join(tmpDir, ".plan-execution", "state.toon"), "utf-8");
    expect(toon).toContain("currentWave: 1");
    expect(toon).toMatch(/task-002.*in_progress/);
  });

  it("record-wave proceed path writes wave summary and marks wave succeeded", () => {
    setupPlan();
    startWave({ wave: 0 });
    stdoutLines = [];
    const resultsFile = writeResults(0, {
      tasks: [{ taskId: "task-001", status: "succeeded", filesModified: ["src/types.ts"] }],
      verification: { result: "pass" },
    });
    expect(recordWave({ wave: 0, resultsFile })).toBe(0);
    expect(verdict()).toMatchObject({ gate: "proceed", verification: "pass" });
    const summary = fs.readFileSync(
      path.join(tmpDir, ".plan-execution", "wave-0-summary.toon"),
      "utf-8"
    );
    expect(summary).toContain("gateDecision: proceed");
    expect(summary).toContain("filesChanged[1]: src/types.ts");
  });

  it("record-wave retry path resets failed tasks to pending and reports them", () => {
    setupPlan();
    startWave({ wave: 1 });
    stdoutLines = [];
    const resultsFile = writeResults(1, {
      tasks: [
        { taskId: "task-002", status: "failed" },
        { taskId: "task-003", status: "succeeded" },
      ],
      verification: { result: "fail", failuresInOwnedFiles: true },
    });
    recordWave({ wave: 1, resultsFile });
    expect(verdict()).toMatchObject({ gate: "retry", retryTasks: ["task-002"] });

    // start-wave again re-activates ONLY the failed task
    stdoutLines = [];
    startWave({ wave: 1 });
    const v = verdict() as { tasks: { taskId: string; retryCount: number }[] };
    expect(v.tasks.map((t) => t.taskId)).toEqual(["task-002"]);
    expect(v.tasks[0].retryCount).toBe(1);
  });

  it("record-wave escalates after the retry budget and finalize marks the run failed", () => {
    setupPlan();
    startWave({ wave: 1 });
    for (const attempt of [1, 2]) {
      stdoutLines = [];
      const resultsFile = writeResults(1, {
        tasks: [{ taskId: "task-002", status: "failed" }],
        verification: { result: "fail", failuresInOwnedFiles: true },
      });
      recordWave({ wave: 1, resultsFile });
      if (attempt < 2) {
        expect((verdict() as { gate: string }).gate).toBe("retry");
        startWave({ wave: 1 });
      }
    }
    expect((verdict() as { gate: string }).gate).toBe("escalate");

    stdoutLines = [];
    finalizeRun({ status: "failed" });
    expect(verdict()).toMatchObject({ ok: true, status: "failed" });
    const toon = fs.readFileSync(path.join(tmpDir, ".plan-execution", "state.toon"), "utf-8");
    expect(toon).toContain("status: failed");
    expect(toon).toContain("gateApproval: escalated");
  });
});
