import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const SCRIPT_PATH = path.resolve(__dirname, "../statusline-command.sh");

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "statusline-e2e-"));
}

function writeFixture(dir: string, relativePath: string, content: string): void {
  const fullPath = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf-8");
}

function runScript(cwd: string): string {
  try {
    const result = execSync(`bash "${SCRIPT_PATH}"`, {
      cwd,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return result.trim();
  } catch (err: any) {
    return (err.stdout || "").trim();
  }
}

/**
 * Generate a fresh UTC ISO timestamp (within the staleness window).
 * The Node.js renderer uses `new Date(updatedAt)` which interprets Z as UTC.
 */
function freshTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Generate a stale UTC ISO timestamp (older than 300s).
 */
function staleTimestamp(): string {
  return new Date(Date.now() - 600 * 1000).toISOString();
}

/**
 * Extract the Loom status line (starts with 🧵) from renderer output.
 * The renderer outputs Line 1 (session/CWD) + optional Line 2 (Loom state).
 */
function getLoomLine(output: string): string {
  const lines = output.split("\n");
  return lines.find((l) => l.includes("\u{1F9F5}")) ?? "";
}

/**
 * Strip ANSI escape codes for easier assertion matching.
 */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("statusline E2E integration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    execSync("git init -b main", { cwd: tmpDir, stdio: "ignore" });
    execSync('git commit --allow-empty -m "init"', { cwd: tmpDir, stdio: "ignore" });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("full active-mode pipeline", () => {
    it("renders contract-compliant active output from a realistic directory structure", () => {
      // Build a realistic project fixture with all files present
      writeFixture(tmpDir, "PLAN.md", `---
name: Test Plan
status: in-progress
---

# Test Plan

## Phase 1
Some work to do.
`);

      writeFixture(tmpDir, ".plan-execution/notes.toon", `note1: Review test coverage
note2: Check edge cases
`);

      writeFixture(tmpDir, ".plan-execution/ephemeral/status.toon", `command: execute-plan
phase: implementing
wave: 2
totalWaves: 4
agentsDone: 3
agentsTotal: 5
agentsFailed: 0
findings: 0
updatedAt: ${freshTimestamp()}
`);

      writeFixture(tmpDir, ".plan-execution/ephemeral/progress/task-001.toon", `taskId: task-001
agent: implementer-agent
wave: 2
phase: implementing
percentComplete: 60
`);

      const output = runScript(tmpDir);
      const loom = stripAnsi(getLoomLine(output));

      // Contract format: Loom line contains command, phase, wave/total, agents
      expect(loom).toContain("execute-plan");
      expect(loom).toContain("implementing");
      expect(loom).toContain("2/4");
      expect(loom).toContain("agents(3/5)");
      // Loom line is single line, within max length
      expect(loom.split("\n")).toHaveLength(1);
      expect(loom.length).toBeLessThanOrEqual(120);
    });

    it("includes failures and findings when present in full project context", () => {
      writeFixture(tmpDir, "PLAN.md", `---
name: Review Plan
status: in-progress
---
# Review
`);

      writeFixture(tmpDir, ".plan-execution/notes.toon", `note1: Some note
`);

      writeFixture(tmpDir, ".plan-execution/ephemeral/status.toon", `command: review-code
phase: reviewing
wave: 1
totalWaves: 1
agentsDone: 2
agentsTotal: 3
agentsFailed: 1
findings: 7
updatedAt: ${freshTimestamp()}
`);

      const output = runScript(tmpDir);
      const loom = stripAnsi(getLoomLine(output));

      // Active mode should show all segments
      expect(loom).toContain("review-code");
      expect(loom).toContain("reviewing");
      expect(loom).toContain("1/1");
      expect(loom).toContain("agents(2/3)");
      expect(loom).toContain("FAIL:1");
      expect(loom).toContain("findings:7");
    });
  });

  describe("active-to-idle transition", () => {
    it("switches from active to idle when updatedAt becomes stale", () => {
      // First verify active mode works
      const statusContent = `command: execute-plan
phase: implementing
wave: 2
totalWaves: 4
agentsDone: 3
agentsTotal: 5
agentsFailed: 0
findings: 0
updatedAt: ${freshTimestamp()}
`;
      writeFixture(tmpDir, ".plan-execution/ephemeral/status.toon", statusContent);
      writeFixture(tmpDir, "PLAN.md", `---
status: in-progress
name: Test Plan
---
# Test Plan
`);
      writeFixture(tmpDir, ".plan-execution/notes.toon", `note1: First note
note2: Second note
`);

      const activeOutput = runScript(tmpDir);
      const activeLoom = stripAnsi(getLoomLine(activeOutput));
      expect(activeLoom).toContain("execute-plan");
      expect(activeLoom).toContain("implementing");

      // Now make it stale by rewriting with an old timestamp
      const staleStatusContent = `command: execute-plan
phase: implementing
wave: 2
totalWaves: 4
agentsDone: 3
agentsTotal: 5
agentsFailed: 0
findings: 0
updatedAt: ${staleTimestamp()}
`;
      writeFixture(tmpDir, ".plan-execution/ephemeral/status.toon", staleStatusContent);

      const idleOutput = runScript(tmpDir);
      const idleLoom = stripAnsi(getLoomLine(idleOutput));

      // Should now be in idle mode -- no active-mode segments
      expect(idleLoom).not.toContain("implementing");
      expect(idleLoom).not.toContain("agents(");
      // Should show idle indicators
      expect(idleLoom).toContain("in-progress");
      expect(idleLoom).toContain("main");
      expect(idleLoom).toContain("2 notes");
    });
  });

  describe("idle mode with PLAN.md and notes", () => {
    it("shows plan status, branch, note count, and no active segments", () => {
      writeFixture(tmpDir, "PLAN.md", `---
status: in-progress
name: Test Plan
---
# Test Plan

Work items here.
`);

      writeFixture(tmpDir, ".plan-execution/notes.toon", `note1: First entry
note2: Second entry
note3: Third entry
`);

      const output = runScript(tmpDir);
      const loom = stripAnsi(getLoomLine(output));

      expect(loom).toContain("in-progress");
      expect(loom).toContain("main");
      expect(loom).toContain("3 notes");
      // No active-mode artifacts
      expect(loom).not.toContain("agents(");
      // Loom line is single line, within max length
      expect(loom.split("\n")).toHaveLength(1);
      expect(loom.length).toBeLessThanOrEqual(120);
    });
  });

  describe("performance", () => {
    // Each runScript invocation is a fresh bash → node cold start (~100-300ms
    // on dev hardware, more on a busy/contended machine). The threshold below
    // (1500ms) reflects worst-case dev environment latency, not a meaningful
    // render-time budget — what we're actually guarding against is a regression
    // that makes the renderer hang or do orders-of-magnitude more I/O. We take
    // the best of 3 runs to smooth jitter from concurrent test workers.
    const TIMING_BUDGET_MS = 1500;

    function bestOfThree(fn: () => void): number {
      const samples: number[] = [];
      for (let i = 0; i < 3; i++) {
        const start = performance.now();
        fn();
        samples.push(performance.now() - start);
      }
      return Math.min(...samples);
    }

    it(`completes within ${TIMING_BUDGET_MS}ms for active mode with full fixture`, () => {
      writeFixture(tmpDir, "PLAN.md", `---
name: Perf Test
status: in-progress
---
# Plan
`);
      writeFixture(tmpDir, ".plan-execution/notes.toon", `note1: A note
`);
      writeFixture(tmpDir, ".plan-execution/ephemeral/status.toon", `command: execute-plan
phase: implementing
wave: 1
totalWaves: 3
agentsDone: 1
agentsTotal: 4
agentsFailed: 0
findings: 0
updatedAt: ${freshTimestamp()}
`);

      const elapsed = bestOfThree(() => runScript(tmpDir));
      expect(elapsed).toBeLessThan(TIMING_BUDGET_MS);
    });

    it(`completes within ${TIMING_BUDGET_MS}ms for idle mode`, () => {
      writeFixture(tmpDir, "PLAN.md", `---
status: approved
---
# Plan
`);
      writeFixture(tmpDir, ".plan-execution/notes.toon", `note1: A
note2: B
note3: C
`);

      const elapsed = bestOfThree(() => runScript(tmpDir));
      expect(elapsed).toBeLessThan(TIMING_BUDGET_MS);
    });

    it(`completes within ${TIMING_BUDGET_MS}ms for empty directory`, () => {
      const bareDir = makeTmpDir();
      try {
        const elapsed = bestOfThree(() => runScript(bareDir));
        expect(elapsed).toBeLessThan(TIMING_BUDGET_MS);
      } finally {
        fs.rmSync(bareDir, { recursive: true, force: true });
      }
    });
  });

  describe("empty directory fallback", () => {
    it("exits 0 with empty or minimal output when no project files exist", () => {
      const bareDir = makeTmpDir();
      try {
        // Verify exit code is 0
        const result = execSync(`bash "${SCRIPT_PATH}"; echo "EXIT:$?"`, {
          cwd: bareDir,
          encoding: "utf-8",
          timeout: 5000,
          stdio: ["ignore", "pipe", "pipe"],
        });
        expect(result.trim()).toContain("EXIT:0");

        // Verify output is empty or minimal
        const output = runScript(bareDir);
        expect(output.length).toBeLessThanOrEqual(120);
      } finally {
        fs.rmSync(bareDir, { recursive: true, force: true });
      }
    });

    it("exits 0 when .plan-execution exists but is empty", () => {
      fs.mkdirSync(path.join(tmpDir, ".plan-execution"), { recursive: true });

      const output = runScript(tmpDir);
      const loom = stripAnsi(getLoomLine(output));

      // Should be idle mode with just the branch
      expect(loom).toContain("main");
    });
  });
});
