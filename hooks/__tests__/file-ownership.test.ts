import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runHook, parseDecision } from "./helpers/hook-runner.js";

let tmpDir: string;
let planExecDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-hook-test-"));
  planExecDir = path.join(tmpDir, ".plan-execution");
  fs.mkdirSync(planExecDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeStateToon(content: string) {
  fs.writeFileSync(path.join(planExecDir, "state.toon"), content, "utf-8");
}

function makePreToolUseInput(filePath: string) {
  return {
    tool_name: "Write",
    tool_input: { file_path: filePath },
  };
}

describe("file-ownership hook", () => {
  it("allows writes when no .plan-execution/ exists", async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-no-plan-"));
    const result = await runHook("file-ownership.ts", makePreToolUseInput("/tmp/any-file.ts"), {
      cwd: emptyDir,
    });
    expect(result.exitCode).toBe(0);
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it("allows writes to .plan-execution/ meta-files", async () => {
    writeStateToon(`status: running\ncurrentWave: 0`);
    const metaFile = path.join(planExecDir, "status.toon");
    const result = await runHook("file-ownership.ts", makePreToolUseInput(metaFile), {
      cwd: tmpDir,
    });
    expect(result.exitCode).toBe(0);
  });

  it("allows writes when no active tasks (between waves)", async () => {
    writeStateToon(`status: running\ncurrentWave: 1`);
    const result = await runHook(
      "file-ownership.ts",
      makePreToolUseInput(path.join(tmpDir, "src/app.ts")),
      { cwd: tmpDir }
    );
    // No wave 1 data → getCurrentWave returns null → no active tasks → allow
    expect(result.exitCode).toBe(0);
  });

  it("allows writes when no file_path in input", async () => {
    writeStateToon(`status: running\ncurrentWave: 0`);
    const result = await runHook(
      "file-ownership.ts",
      { tool_name: "Write", tool_input: { content: "hello" } },
      { cwd: tmpDir }
    );
    expect(result.exitCode).toBe(0);
  });

  it("exits 0 on malformed input (fail open)", async () => {
    const result = await runHook("file-ownership.ts", { garbage: true }, { cwd: tmpDir });
    expect(result.exitCode).toBe(0);
  });

  // Regression (2026-07-10 live wave-driver e2e): fileOwnership is a COLUMN in
  // the tasks typed-array table (protocols/state.schema.md), multi-path cells
  // joined with ";". readExecutionState previously looked for a standalone
  // nested `fileOwnership[N]:` key, parsed [] for every task, and blocked
  // agents from writing their own owned files ("Owned files: []").
  it("allows writes to a file owned by an in_progress task (table-cell format)", async () => {
    const realTmp = fs.realpathSync(tmpDir);
    const owned = path.join(realTmp, "src", "greeter.ts");
    writeStateToon(
      `status: running\ncurrentWave: 1\n1:\n  status: in_progress\n  tasks[1]{taskId,agent,description,status,fileOwnership,retryCount}:\n    task-002,implementer-agent,Create greeter.ts,in_progress,${owned},0`
    );
    const result = await runHook("file-ownership.ts", makePreToolUseInput(owned), {
      cwd: tmpDir,
    });
    expect(result.exitCode).toBe(0);
  });

  it("blocks unowned writes and lists the parsed owned files", async () => {
    const realTmp = fs.realpathSync(tmpDir);
    const owned = path.join(realTmp, "src", "greeter.ts");
    writeStateToon(
      `status: running\ncurrentWave: 1\n1:\n  status: in_progress\n  tasks[1]{taskId,agent,description,status,fileOwnership,retryCount}:\n    task-002,implementer-agent,Create greeter.ts,in_progress,${owned},0`
    );
    const result = await runHook(
      "file-ownership.ts",
      makePreToolUseInput(path.join(realTmp, "src", "other.ts")),
      { cwd: tmpDir }
    );
    expect(result.exitCode).toBe(2);
    const decision = parseDecision(result.stdout);
    expect(decision?.decision).toBe("block");
    // The owned list must reflect the parsed cell — "[]" was the bug signature.
    expect(decision?.reason).toContain("greeter.ts");
  });

  it("parses multi-file ownership cells joined with ';'", async () => {
    const realTmp = fs.realpathSync(tmpDir);
    const a = path.join(realTmp, "src", "a.ts");
    const b = path.join(realTmp, "src", "b.ts");
    writeStateToon(
      `status: running\ncurrentWave: 1\n1:\n  status: in_progress\n  tasks[1]{taskId,agent,description,status,fileOwnership,retryCount}:\n    task-004,implementer-agent,Create both modules,in_progress,${a};${b},0`
    );
    for (const target of [a, b]) {
      const result = await runHook("file-ownership.ts", makePreToolUseInput(target), {
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(0);
    }
  });

  it("allows writes to .loom/wiki/ during active execution", async () => {
    writeStateToon(
      `status: running\ncurrentWave: 1\n1:\n  status: in_progress\n  tasks[1]{taskId,agent,status}:\n    w1-auth,implementer-agent,in_progress`
    );
    const wikiFile = path.join(tmpDir, ".loom", "wiki", "pages", "foo.toon");
    const result = await runHook(
      "file-ownership.ts",
      makePreToolUseInput(wikiFile),
      { cwd: tmpDir }
    );
    expect(result.exitCode).toBe(0);
  });
});

describe("contract-lock hook", () => {
  it("allows writes to non-contract files", async () => {
    writeStateToon(`status: running\ncurrentWave: 1\n0:\n  status: succeeded`);
    const result = await runHook(
      "contract-lock.ts",
      makePreToolUseInput(path.join(tmpDir, "src/app.ts")),
      { cwd: tmpDir }
    );
    expect(result.exitCode).toBe(0);
  });

  it("allows contract writes when wave 0 is still in progress", async () => {
    writeStateToon(`status: running\ncurrentWave: 0\n0:\n  status: in_progress`);
    const contractFile = path.join(tmpDir, ".plan-execution/contracts/types.ts");
    const result = await runHook("contract-lock.ts", makePreToolUseInput(contractFile), {
      cwd: tmpDir,
    });
    expect(result.exitCode).toBe(0);
  });

  it("blocks contract writes after wave 0 succeeds", async () => {
    writeStateToon(`status: running\ncurrentWave: 1\n0:\n  status: succeeded`);
    const contractFile = path.join(tmpDir, ".plan-execution/contracts/types.ts");
    const result = await runHook("contract-lock.ts", makePreToolUseInput(contractFile), {
      cwd: tmpDir,
    });
    expect(result.exitCode).toBe(2);
    const decision = parseDecision(result.stdout);
    expect(decision?.decision).toBe("block");
    expect(decision?.reason).toContain("locked after Wave 0");
  });

  it("allows when no .plan-execution/ exists", async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-no-plan-"));
    const result = await runHook(
      "contract-lock.ts",
      makePreToolUseInput("/some/contracts/types.ts"),
      { cwd: emptyDir }
    );
    expect(result.exitCode).toBe(0);
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});

describe("budget-tracker hook", () => {
  function writePipelineState(spawned: number, max: number) {
    fs.writeFileSync(
      path.join(planExecDir, "pipeline-state.toon"),
      `schemaVersion: 1\nagentsSpawned: ${spawned}\nmaxAgents: ${max}\ncurrentStage: execute\nouterIteration: 1\nfixCycleCount: 0`,
      "utf-8"
    );
  }

  it("allows agent spawn when under budget", async () => {
    writePipelineState(5, 30);
    const result = await runHook(
      "budget-tracker.ts",
      { tool_name: "Agent", tool_input: { prompt: "do stuff" } },
      { cwd: tmpDir }
    );
    expect(result.exitCode).toBe(0);
  });

  it("warns at 80% budget on PreToolUse", async () => {
    writePipelineState(24, 30);
    const result = await runHook(
      "budget-tracker.ts",
      { tool_name: "Agent", tool_input: { prompt: "do stuff" } },
      { cwd: tmpDir }
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("budget at 80%");
  });

  it("blocks agent spawn at 100% budget", async () => {
    writePipelineState(30, 30);
    const result = await runHook(
      "budget-tracker.ts",
      { tool_name: "Agent", tool_input: { prompt: "do stuff" } },
      { cwd: tmpDir }
    );
    expect(result.exitCode).toBe(2);
    const decision = parseDecision(result.stdout);
    expect(decision?.decision).toBe("block");
    expect(decision?.reason).toContain("exhausted");
  });

  it("increments count on SubagentStop", async () => {
    writePipelineState(10, 30);
    const result = await runHook(
      "budget-tracker.ts",
      { task_id: "w1-auth", agent_name: "implementer-agent" },
      { cwd: tmpDir }
    );
    expect(result.exitCode).toBe(0);

    // Verify the file was updated
    const updated = fs.readFileSync(
      path.join(planExecDir, "pipeline-state.toon"),
      "utf-8"
    );
    expect(updated).toContain("agentsSpawned: 11");
  });

  it("warns on SubagentStop when reaching 80%", async () => {
    writePipelineState(23, 30); // Will become 24 = 80%
    const result = await runHook(
      "budget-tracker.ts",
      { task_id: "w1-auth", agent_name: "implementer-agent" },
      { cwd: tmpDir }
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("budget at 80%");
  });

  it("allows when no pipeline-state.toon exists", async () => {
    // planExecDir exists but no pipeline-state.toon
    const result = await runHook(
      "budget-tracker.ts",
      { tool_name: "Agent", tool_input: { prompt: "do stuff" } },
      { cwd: tmpDir }
    );
    expect(result.exitCode).toBe(0);
  });
});
