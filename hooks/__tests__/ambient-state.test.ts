import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { gatherAmbientState } from "../lib/ambient-state.js";

/**
 * Create a temporary directory with optional fixture files.
 */
function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ambient-state-test-"));
}

function writeFixture(dir: string, relativePath: string, content: string): void {
  const fullPath = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf-8");
}

describe("gatherAmbientState", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns full state with valid PLAN.md, notes.toon, and status.toon", () => {
    writeFixture(tmpDir, "PLAN.md", `---
name: Claude Code Status Line
status: approved
---

# The Plan
Some content here.
`);

    writeFixture(tmpDir, ".plan-execution/notes.toon", `note1: Fix the flaky test
note2: Consider caching
`);

    writeFixture(tmpDir, ".plan-execution/ephemeral/status.toon", `command: execute-plan
phase: complete
updatedAt: 2026-04-09T10:00:00Z
`);

    // Initialize a git repo with a commit so gitBranch works
    const { execSync } = require("node:child_process");
    execSync("git init -b main", { cwd: tmpDir, stdio: "ignore" });
    execSync('git commit --allow-empty -m "init"', { cwd: tmpDir, stdio: "ignore" });

    const state = gatherAmbientState(tmpDir);

    expect(state.planName).toBe("Claude Code Status Line");
    expect(state.planStatus).toBe("approved");
    expect(state.pendingNotes).toBe(2);
    expect(state.lastCommand).toBe("execute-plan");
    expect(state.lastResult).toBe("ok");
    expect(state.gitBranch).toBe("main");
  });

  it("returns null plan fields when PLAN.md is missing", () => {
    const state = gatherAmbientState(tmpDir);

    expect(state.planName).toBeNull();
    expect(state.planStatus).toBeNull();
  });

  it("returns 0 pending notes when notes.toon is missing", () => {
    const state = gatherAmbientState(tmpDir);

    expect(state.pendingNotes).toBe(0);
  });

  it("returns null lastCommand and lastResult when status.toon is missing", () => {
    const state = gatherAmbientState(tmpDir);

    expect(state.lastCommand).toBeNull();
    expect(state.lastResult).toBeNull();
  });

  it("reads plan status from frontmatter with quoted values", () => {
    writeFixture(tmpDir, "PLAN.md", `---
name: "Quoted Plan Name"
status: 'executing'
---

Body text.
`);

    const state = gatherAmbientState(tmpDir);

    expect(state.planName).toBe("Quoted Plan Name");
    expect(state.planStatus).toBe("executing");
  });

  it("counts only top-level non-comment lines in notes.toon", () => {
    writeFixture(tmpDir, ".plan-execution/notes.toon", `# This is a comment
note1: First note
  indented-detail: not a top-level line
note2: Second note

# Another comment
note3: Third note
`);

    const state = gatherAmbientState(tmpDir);

    // Top-level non-comment non-empty lines: note1, note2, note3
    expect(state.pendingNotes).toBe(3);
  });

  it("returns null gitBranch when not in a git repo", () => {
    const state = gatherAmbientState(tmpDir);

    expect(state.gitBranch).toBeNull();
  });

  it("reads lastResult as 'failed' when phase is failed", () => {
    writeFixture(tmpDir, ".plan-execution/ephemeral/status.toon", `command: execute-plan
phase: failed
updatedAt: 2026-04-09T10:00:00Z
`);

    const state = gatherAmbientState(tmpDir);

    expect(state.lastCommand).toBe("execute-plan");
    expect(state.lastResult).toBe("failed");
  });

  it("returns null lastResult when phase is not terminal", () => {
    writeFixture(tmpDir, ".plan-execution/ephemeral/status.toon", `command: execute-plan
phase: implementing
updatedAt: 2026-04-09T10:00:00Z
`);

    const state = gatherAmbientState(tmpDir);

    expect(state.lastCommand).toBe("execute-plan");
    expect(state.lastResult).toBeNull();
  });

  it("returns null planName when PLAN.md has no frontmatter", () => {
    writeFixture(tmpDir, "PLAN.md", `# Just a heading

No frontmatter here.
`);

    const state = gatherAmbientState(tmpDir);

    expect(state.planName).toBeNull();
    expect(state.planStatus).toBeNull();
  });

  it("returns all null/zero for empty directory", () => {
    const state = gatherAmbientState(tmpDir);

    expect(state.planName).toBeNull();
    expect(state.planStatus).toBeNull();
    expect(state.pendingNotes).toBe(0);
    expect(state.lastCommand).toBeNull();
    expect(state.lastResult).toBeNull();
    expect(state.gitBranch).toBeNull();
  });
});
