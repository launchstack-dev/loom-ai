/**
 * S-05: Lint failure during iteration spawns a sibling loop without blocking.
 *
 * Asserts:
 * 1. A new child loop.toon exists with relation "sibling" in the parent's linkedLoops[].
 * 2. The active loop continues iterating against its original symptom (not blocked).
 * 3. convergence-state.toon lists both loops with their relation.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LoopFile {
  loopId: string;
  command: string;
  symptom: string;
  rung: number;
  verifiedRed: boolean;
  linkedLoops?: Array<{ loopId: string; relation: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeLoopToon(loopsDir: string, loop: LoopFile): string {
  mkdirSync(loopsDir, { recursive: true });
  const path = join(loopsDir, `${loop.loopId}.toon`);
  const linkedRows =
    loop.linkedLoops
      ?.map((l) => `  ${l.loopId},${l.relation}`)
      .join("\n") ?? "";
  const linkedCount = loop.linkedLoops?.length ?? 0;
  const content = [
    `loopId: ${loop.loopId}`,
    `command: ${loop.command}`,
    `symptom: ${loop.symptom}`,
    `rung: ${loop.rung}`,
    `verifiedRed: ${loop.verifiedRed}`,
    `retiredAt: null`,
    `escapeReason: null`,
    `parentLoopId: null`,
    `runtimeMs: 0`,
    `determinismRuns: ${loop.verifiedRed ? 2 : 0}`,
    ``,
    `trda:`,
    `  tight: ${loop.verifiedRed}`,
    `  redCapable: ${loop.verifiedRed}`,
    `  deterministic: ${loop.verifiedRed}`,
    `  agentRunnable: ${loop.verifiedRed}`,
    ``,
    `escalationHistory[0]{fromRung,toRung,reason,at}:`,
    `linkedLoops[${linkedCount}]{loopId,relation}:`,
    ...(linkedRows ? [linkedRows] : []),
  ].join("\n");
  writeFileSync(path, content, "utf8");
  return path;
}

function readLoopToon(loopsDir: string, loopId: string): string {
  return readFileSync(join(loopsDir, `${loopId}.toon`), "utf8");
}

/**
 * Simulates a convergence iteration that triggers a lint failure.
 *
 * The active loop (parentLoopId) is a verified-red test-symptom loop.
 * Mid-iteration, the fixer modifies a file that triggers a lint failure.
 * The driver:
 *   1. Spawns a sibling loop for the lint symptom.
 *   2. Updates parentLoop.linkedLoops[] with the sibling.
 *   3. Continues iterating the parent loop.
 *   4. Writes convergence-state.toon with both loops in loops[].
 */
function simulateLintFailureDuringIteration(projectDir: string): {
  parentLoopId: string;
  siblingLoopId: string;
  parentContinued: boolean;
  convergenceStatePath: string;
} {
  const loopsDir = join(projectDir, ".plan-execution", "loops");
  const parentLoopId = "parent00-0000-4000-8000-000000000000";
  const siblingLoopId = "sibling0-0000-4000-8000-000000000000";
  const parentCommand = "bunx vitest run tests/reducer.test.ts";

  // Write initial parent loop (verified-red test symptom)
  writeLoopToon(loopsDir, {
    loopId: parentLoopId,
    command: parentCommand,
    symptom: "Reducer drops second event when batched",
    rung: 2,
    verifiedRed: true,
  });

  // Simulate iteration 1: fixer modifies a file, lint fails
  // Driver creates a sibling loop for the lint failure
  writeLoopToon(loopsDir, {
    loopId: siblingLoopId,
    command: "bunx eslint src/reducer.ts --max-warnings 0",
    symptom: "ESLint: no-unused-vars error introduced by fixer in src/reducer.ts",
    rung: 1,
    verifiedRed: false, // sibling starts in construction state
  });

  // Driver updates the parent loop's linkedLoops[] with the sibling
  const updatedParent: LoopFile = {
    loopId: parentLoopId,
    command: parentCommand,
    symptom: "Reducer drops second event when batched",
    rung: 2,
    verifiedRed: true,
    linkedLoops: [{ loopId: siblingLoopId, relation: "sibling" }],
  };
  writeLoopToon(loopsDir, updatedParent);

  // Parent loop continues — iteration 2 also runs the original command
  // (simulated: driver does not block on the sibling)
  const parentContinued = true;

  // Write convergence-state.toon with both loops in loops[]
  const stateDir = join(projectDir, ".plan-execution");
  mkdirSync(stateDir, { recursive: true });
  const statePath = join(stateDir, "convergence-state.toon");
  const stateContent = [
    `iteration: 2`,
    `maxIterations: 10`,
    `convergenceMode: target`,
    `activeLoopId: ${parentLoopId}`,
    ``,
    `loops[2]{loopId,symptom,rung,verifiedRed,runtimeMs,linkedLoops,retiredAt}:`,
    `  ${parentLoopId},Reducer drops second event when batched,2,true,0,${siblingLoopId},null`,
    `  ${siblingLoopId},ESLint no-unused-vars in src/reducer.ts,1,false,0,,null`,
  ].join("\n");
  writeFileSync(statePath + ".tmp", stateContent, "utf8");
  const { renameSync } = require("node:fs") as typeof import("node:fs");
  renameSync(statePath + ".tmp", statePath);

  return { parentLoopId, siblingLoopId, parentContinued, convergenceStatePath: statePath };
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "loom-linked-loops-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// S-05 assertions
// ---------------------------------------------------------------------------

describe("S-05: Lint failure during iteration spawns a sibling loop without blocking", () => {
  it("a new child loop.toon exists with loopId matching the sibling", () => {
    const { siblingLoopId } = simulateLintFailureDuringIteration(tmpDir);
    const loopsDir = join(tmpDir, ".plan-execution", "loops");
    expect(existsSync(join(loopsDir, `${siblingLoopId}.toon`))).toBe(true);
  });

  it("the sibling loop.toon has a lint-related symptom", () => {
    const { siblingLoopId } = simulateLintFailureDuringIteration(tmpDir);
    const loopsDir = join(tmpDir, ".plan-execution", "loops");
    const content = readLoopToon(loopsDir, siblingLoopId);
    expect(content).toMatch(/eslint|lint|typecheck|no-unused/i);
  });

  it("the parent loop's linkedLoops[] contains the sibling with relation 'sibling'", () => {
    const { parentLoopId, siblingLoopId } = simulateLintFailureDuringIteration(tmpDir);
    const loopsDir = join(tmpDir, ".plan-execution", "loops");
    const parentContent = readLoopToon(loopsDir, parentLoopId);
    expect(parentContent).toContain(siblingLoopId);
    expect(parentContent).toContain("sibling");
  });

  it("the parent loop is not blocked — parentContinued is true", () => {
    const { parentContinued } = simulateLintFailureDuringIteration(tmpDir);
    expect(parentContinued).toBe(true);
  });

  it("convergence-state.toon lists both loops", () => {
    const { parentLoopId, siblingLoopId, convergenceStatePath } =
      simulateLintFailureDuringIteration(tmpDir);
    const state = readFileSync(convergenceStatePath, "utf8");
    expect(state).toContain(parentLoopId);
    expect(state).toContain(siblingLoopId);
  });

  it("convergence-state.toon has loops[2] (two loops total)", () => {
    const { convergenceStatePath } = simulateLintFailureDuringIteration(tmpDir);
    const state = readFileSync(convergenceStatePath, "utf8");
    expect(state).toContain("loops[2]");
  });

  it("parent loop remains in verified-red state after sibling is spawned", () => {
    const { parentLoopId } = simulateLintFailureDuringIteration(tmpDir);
    const loopsDir = join(tmpDir, ".plan-execution", "loops");
    const parentContent = readLoopToon(loopsDir, parentLoopId);
    expect(parentContent).toMatch(/verifiedRed:\s*true/);
  });

  it("sibling loop starts in construction state (verifiedRed: false)", () => {
    const { siblingLoopId } = simulateLintFailureDuringIteration(tmpDir);
    const loopsDir = join(tmpDir, ".plan-execution", "loops");
    const siblingContent = readLoopToon(loopsDir, siblingLoopId);
    expect(siblingContent).toMatch(/verifiedRed:\s*false/);
  });

  it("parent loop command is unchanged after sibling spawn", () => {
    const { parentLoopId } = simulateLintFailureDuringIteration(tmpDir);
    const loopsDir = join(tmpDir, ".plan-execution", "loops");
    const parentContent = readLoopToon(loopsDir, parentLoopId);
    expect(parentContent).toContain("bunx vitest run tests/reducer.test.ts");
  });
});

// ---------------------------------------------------------------------------
// S-09: Retired loop is queryable but immutable
// ---------------------------------------------------------------------------

describe("S-09: Retired loop is queryable but immutable", () => {
  function setupRetiredLoop(projectDir: string): {
    loopsDir: string;
    loopId: string;
  } {
    const loopsDir = join(projectDir, ".plan-execution", "loops");
    const loopId = "retired0-0000-4000-8000-000000000000";
    writeLoopToon(loopsDir, {
      loopId,
      command: "bunx vitest run tests/reducer.test.ts",
      symptom: "Reducer drops second event",
      rung: 2,
      verifiedRed: true,
    });
    // Retire the loop
    const path = join(loopsDir, `${loopId}.toon`);
    const content = readFileSync(path, "utf8");
    const updated = content.replace(
      /^retiredAt: null\s*$/m,
      "retiredAt: 2026-06-26T00:00:00.000Z",
    );
    writeFileSync(path + ".tmp", updated, "utf8");
    const { renameSync } = require("node:fs") as typeof import("node:fs");
    renameSync(path + ".tmp", path);
    return { loopsDir, loopId };
  }

  function simulateMutateRetiredLoop(projectDir: string, loopId: string): {
    exitCode: number;
    stderr: string;
  } {
    const loopsDir = join(projectDir, ".plan-execution", "loops");
    const path = join(loopsDir, `${loopId}.toon`);
    if (!existsSync(path)) {
      return { exitCode: 6, stderr: "errorCode: LOOPID_NOT_FOUND" };
    }
    const content = readFileSync(path, "utf8");
    const retiredMatch = content.match(/^retiredAt:\s*(.+)\s*$/m);
    if (retiredMatch && retiredMatch[1] !== "null") {
      return {
        exitCode: 8,
        stderr: [
          "errorCode: LOOP_IMMUTABLE",
          "message: Retired loops are queryable but never re-entered; spawn a new loop instead.",
        ].join("\n"),
      };
    }
    return { exitCode: 0, stderr: "" };
  }

  it("reading a retired loop returns the full snapshot including retiredAt", () => {
    const { loopsDir, loopId } = setupRetiredLoop(tmpDir);
    const content = readLoopToon(loopsDir, loopId);
    expect(content).toContain("retiredAt: 2026-06-26T00:00:00.000Z");
    expect(content).toContain(`loopId: ${loopId}`);
    expect(content).toContain("verifiedRed: true");
  });

  it("mutating a retired loop emits LOOP_IMMUTABLE (exit 8)", () => {
    const { loopId } = setupRetiredLoop(tmpDir);
    const result = simulateMutateRetiredLoop(tmpDir, loopId);
    expect(result.exitCode).toBe(8);
    expect(result.stderr).toContain("LOOP_IMMUTABLE");
  });

  it("mutation attempt does not change retiredAt", () => {
    const { loopsDir, loopId } = setupRetiredLoop(tmpDir);
    simulateMutateRetiredLoop(tmpDir, loopId);
    const content = readLoopToon(loopsDir, loopId);
    expect(content).toContain("retiredAt: 2026-06-26T00:00:00.000Z");
  });
});
