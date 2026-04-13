import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const SCRIPT_PATH = path.resolve(__dirname, "../statusline-command.sh");

/**
 * Create a temporary directory with optional fixture files.
 */
function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "statusline-cmd-test-"));
}

function writeFixture(dir: string, relativePath: string, content: string): void {
  const fullPath = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf-8");
}

/**
 * Run the statusline command with CWD set to the given directory.
 * Returns stdout as a string. Always expects exit code 0.
 */
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
    // The script should always exit 0; if it doesn't, return whatever we got
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
 * Extract the Loom status line (Line 2, starts with 🧵) from renderer output.
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

describe("statusline-command.sh", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    // Initialize git repo so the script can read branch name
    execSync("git init -b main", { cwd: tmpDir, stdio: "ignore" });
    // Create an initial commit so HEAD is valid
    execSync('git commit --allow-empty -m "init"', { cwd: tmpDir, stdio: "ignore" });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("active mode", () => {
    it("renders active output when status.toon has a fresh updatedAt", () => {
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

      const output = runScript(tmpDir);
      const loom = stripAnsi(getLoomLine(output));

      expect(loom).toContain("execute-plan");
      expect(loom).toContain("implementing");
      expect(loom).toContain("2/4");
      expect(loom).toContain("agents(3/5)");
    });

    it("includes FAIL count when agentsFailed > 0", () => {
      writeFixture(tmpDir, ".plan-execution/status.toon", `command: execute-plan
phase: wiring
wave: 2
totalWaves: 4
agentsDone: 4
agentsTotal: 5
agentsFailed: 1
findings: 0
updatedAt: ${freshTimestamp()}
`);

      const output = runScript(tmpDir);
      const loom = stripAnsi(getLoomLine(output));

      expect(loom).toContain("FAIL:1");
    });

    it("includes findings count when findings > 0", () => {
      writeFixture(tmpDir, ".plan-execution/status.toon", `command: review-code
phase: reviewing
wave: 1
totalWaves: 1
agentsDone: 2
agentsTotal: 3
agentsFailed: 0
findings: 7
updatedAt: ${freshTimestamp()}
`);

      const output = runScript(tmpDir);
      const loom = stripAnsi(getLoomLine(output));

      expect(loom).toContain("findings:7");
    });

    it("produces Loom line under 120 chars", () => {
      writeFixture(tmpDir, ".plan-execution/status.toon", `command: execute-plan
phase: implementing
wave: 2
totalWaves: 4
agentsDone: 3
agentsTotal: 5
agentsFailed: 1
findings: 12
updatedAt: ${freshTimestamp()}
`);

      const output = runScript(tmpDir);
      const loom = stripAnsi(getLoomLine(output));

      expect(loom.split("\n")).toHaveLength(1);
      expect(loom.length).toBeLessThanOrEqual(120);
    });
  });

  describe("idle mode", () => {
    it("renders idle output when status.toon has a stale updatedAt", () => {
      writeFixture(tmpDir, ".plan-execution/status.toon", `command: execute-plan
phase: complete
updatedAt: ${staleTimestamp()}
`);

      writeFixture(tmpDir, "PLAN.md", `---
status: approved
---
# Plan
`);

      const output = runScript(tmpDir);
      const loom = stripAnsi(getLoomLine(output));

      // Should be in idle mode -- showing plan status and branch
      expect(loom).toContain("approved");
      expect(loom).toContain("main");
      // Should also show "ok" since phase was complete
      expect(loom).toContain("ok");
    });

    it("renders idle output when status.toon is missing", () => {
      writeFixture(tmpDir, "PLAN.md", `---
status: draft
---
# Plan
`);

      const output = runScript(tmpDir);
      const loom = stripAnsi(getLoomLine(output));

      expect(loom).toContain("draft");
      expect(loom).toContain("main");
    });

    it("includes note count in idle mode", () => {
      writeFixture(tmpDir, "PLAN.md", `---
status: approved
---
# Plan
`);

      writeFixture(tmpDir, ".plan-execution/notes.toon", `note1: Fix tests
note2: Add caching
note3: Review docs
`);

      const output = runScript(tmpDir);
      const loom = stripAnsi(getLoomLine(output));

      expect(loom).toContain("3 notes");
    });

    it("shows only branch when plan and notes are absent", () => {
      // The script needs .plan-execution or PLAN.md to find root.
      // Create an empty .plan-execution dir so root detection works.
      fs.mkdirSync(path.join(tmpDir, ".plan-execution"), { recursive: true });

      const output = runScript(tmpDir);
      const loom = stripAnsi(getLoomLine(output));

      expect(loom).toContain("main");
    });
  });

  describe("graceful fallback", () => {
    it("returns no Loom line when no project files exist at all", () => {
      // Create a tmp dir that is NOT a git repo and has no PLAN.md / .plan-execution
      const bareDir = makeTmpDir();
      try {
        const output = runScript(bareDir);
        // No Loom line (no project root found)
        expect(getLoomLine(output)).toBe("");
      } finally {
        fs.rmSync(bareDir, { recursive: true, force: true });
      }
    });

    it("always exits with code 0", () => {
      const bareDir = makeTmpDir();
      try {
        // Should not throw even with no project structure
        const result = execSync(`bash "${SCRIPT_PATH}"; echo "EXIT:$?"`, {
          cwd: bareDir,
          encoding: "utf-8",
          timeout: 5000,
          stdio: ["ignore", "pipe", "pipe"],
        });
        expect(result.trim()).toContain("EXIT:0");
      } finally {
        fs.rmSync(bareDir, { recursive: true, force: true });
      }
    });

    it("falls back to idle mode when active mode fields are incomplete", () => {
      // status.toon is fresh but missing required command/phase fields
      writeFixture(tmpDir, ".plan-execution/status.toon", `updatedAt: ${freshTimestamp()}
`);

      writeFixture(tmpDir, "PLAN.md", `---
status: approved
---
# Plan
`);

      const output = runScript(tmpDir);
      const loom = stripAnsi(getLoomLine(output));

      // Should fall back to idle mode
      expect(loom).toContain("approved");
      expect(loom).toContain("main");
    });
  });
});
