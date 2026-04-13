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

describe("wiki-write-guard hook", () => {
  it("allows writes to non-wiki paths", async () => {
    writeStateToon(
      `status: running\ncurrentWave: 1\n1:\n  status: in_progress\n  tasks[1]{taskId,agent,status}:\n    w1-auth,implementer-agent,in_progress`
    );
    const result = await runHook(
      "wiki-write-guard.ts",
      makePreToolUseInput(path.join(tmpDir, "src/app.ts")),
      { cwd: tmpDir }
    );
    expect(result.exitCode).toBe(0);
  });

  it("allows when no file_path in input", async () => {
    writeStateToon(`status: running\ncurrentWave: 0`);
    const result = await runHook(
      "wiki-write-guard.ts",
      { tool_name: "Write", tool_input: { content: "hello" } },
      { cwd: tmpDir }
    );
    expect(result.exitCode).toBe(0);
  });

  it("allows wiki writes when no .plan-execution/ exists", async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-no-plan-"));
    const wikiFile = path.join(emptyDir, ".loom", "wiki", "pages", "foo.toon");
    const result = await runHook(
      "wiki-write-guard.ts",
      makePreToolUseInput(wikiFile),
      { cwd: emptyDir }
    );
    expect(result.exitCode).toBe(0);
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it("allows wiki writes when state is unreadable (fail-open)", async () => {
    // planExecDir exists but state.toon is missing — getCurrentWave returns null
    const wikiFile = path.join(tmpDir, ".loom", "wiki", "pages", "foo.toon");
    const result = await runHook(
      "wiki-write-guard.ts",
      makePreToolUseInput(wikiFile),
      { cwd: tmpDir }
    );
    expect(result.exitCode).toBe(0);
  });

  it("allows wiki writes when no active wave", async () => {
    writeStateToon(`status: running\ncurrentWave: 5`);
    // No wave 5 data → getCurrentWave returns null → allow
    const wikiFile = path.join(tmpDir, ".loom", "wiki", "pages", "foo.toon");
    const result = await runHook(
      "wiki-write-guard.ts",
      makePreToolUseInput(wikiFile),
      { cwd: tmpDir }
    );
    expect(result.exitCode).toBe(0);
  });

  it("allows wiki writes when ALL active tasks are wiki agents", async () => {
    writeStateToon(
      `status: running\ncurrentWave: 1\n1:\n  status: in_progress\n  tasks[2]{taskId,agent,status}:\n    w1-wiki-ingest,wiki-ingest-agent,in_progress\n    w1-wiki-lint,wiki-lint-agent,in_progress`
    );
    const wikiFile = path.join(tmpDir, ".loom", "wiki", "pages", "foo.toon");
    const result = await runHook(
      "wiki-write-guard.ts",
      makePreToolUseInput(wikiFile),
      { cwd: tmpDir }
    );
    expect(result.exitCode).toBe(0);
  });

  it("blocks wiki writes when non-wiki agents are active", async () => {
    writeStateToon(
      `status: running\ncurrentWave: 1\n1:\n  status: in_progress\n  tasks[2]{taskId,agent,status}:\n    w1-wiki-ingest,wiki-ingest-agent,in_progress\n    w1-auth,implementer-agent,in_progress`
    );
    const wikiFile = path.join(tmpDir, ".loom", "wiki", "pages", "foo.toon");
    const result = await runHook(
      "wiki-write-guard.ts",
      makePreToolUseInput(wikiFile),
      { cwd: tmpDir }
    );
    expect(result.exitCode).toBe(2);
    const decision = parseDecision(result.stdout);
    expect(decision?.decision).toBe("block");
    expect(decision?.reason).toContain("wiki agents");
  });
});
