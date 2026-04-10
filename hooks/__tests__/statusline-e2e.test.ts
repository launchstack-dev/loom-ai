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
 * Format a Date as a local-time ISO-like string for BSD date compatibility.
 * The shell script uses `date -j -f '%Y-%m-%d %H:%M:%S'` which interprets
 * timestamps as local time on macOS.
 */
function toLocalISO(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}Z`;
}

function freshTimestamp(): string {
  return toLocalISO(new Date());
}

function staleTimestamp(): string {
  return toLocalISO(new Date(Date.now() - 600 * 1000));
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

      writeFixture(tmpDir, ".plan-execution/status.toon", `command: execute-plan
phase: implementing
wave: 2
totalWaves: 4
agentsDone: 3
agentsTotal: 5
agentsFailed: 0
findings: 0
updatedAt: ${freshTimestamp()}
`);

      writeFixture(tmpDir, ".plan-execution/progress/task-001.toon", `taskId: task-001
agent: implementer-agent
wave: 2
phase: implementing
percentComplete: 60
`);

      const output = runScript(tmpDir);

      // Contract format: "[command] phase wave/total agents(done/total)"
      expect(output).toMatch(/^execute-plan implementing 2\/4 agents\(3\/5\)$/);
      // Single line, within max length
      expect(output.split("\n")).toHaveLength(1);
      expect(output.length).toBeLessThanOrEqual(120);
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

      writeFixture(tmpDir, ".plan-execution/status.toon", `command: review-code
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

      // Active mode should show all segments
      expect(output).toContain("review-code");
      expect(output).toContain("reviewing");
      expect(output).toContain("1/1");
      expect(output).toContain("agents(2/3)");
      expect(output).toContain("FAILED:1");
      expect(output).toContain("findings:7");
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
      writeFixture(tmpDir, ".plan-execution/status.toon", statusContent);
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
      expect(activeOutput).toContain("execute-plan");
      expect(activeOutput).toContain("implementing");

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
      writeFixture(tmpDir, ".plan-execution/status.toon", staleStatusContent);

      const idleOutput = runScript(tmpDir);

      // Should now be in idle mode -- no active-mode segments
      expect(idleOutput).not.toContain("implementing");
      expect(idleOutput).not.toContain("agents(");
      // Should show idle indicators
      expect(idleOutput).toContain("in-progress");
      expect(idleOutput).toContain("main");
      expect(idleOutput).toContain("2 notes");
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

      expect(output).toContain("in-progress");
      expect(output).toContain("main");
      expect(output).toContain("3 notes");
      // No active-mode artifacts
      expect(output).not.toContain("agents(");
      expect(output).not.toContain("wave");
      expect(output.split("\n")).toHaveLength(1);
      expect(output.length).toBeLessThanOrEqual(120);
    });
  });

  describe("performance", () => {
    it("completes within 200ms for active mode with full fixture", () => {
      writeFixture(tmpDir, "PLAN.md", `---
name: Perf Test
status: in-progress
---
# Plan
`);
      writeFixture(tmpDir, ".plan-execution/notes.toon", `note1: A note
`);
      writeFixture(tmpDir, ".plan-execution/status.toon", `command: execute-plan
phase: implementing
wave: 1
totalWaves: 3
agentsDone: 1
agentsTotal: 4
agentsFailed: 0
findings: 0
updatedAt: ${freshTimestamp()}
`);

      const start = performance.now();
      runScript(tmpDir);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(200);
    });

    it("completes within 200ms for idle mode", () => {
      writeFixture(tmpDir, "PLAN.md", `---
status: approved
---
# Plan
`);
      writeFixture(tmpDir, ".plan-execution/notes.toon", `note1: A
note2: B
note3: C
`);

      const start = performance.now();
      runScript(tmpDir);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(200);
    });

    it("completes within 200ms for empty directory", () => {
      const bareDir = makeTmpDir();
      try {
        const start = performance.now();
        runScript(bareDir);
        const elapsed = performance.now() - start;

        expect(elapsed).toBeLessThan(200);
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

      // Should be idle mode with just the branch
      expect(output).toBe("main");
    });
  });
});
