/**
 * S-01: loom-bugfix default path halts before loop.toon is verified-red.
 * S-02: --override-loop-gate proceeds, writes escapeReason, and emits ESCAPE-SET callout.
 *
 * These tests simulate the Phase-1 loop-construction gate described in
 * agents/bugfix-analyst-agent.md and commands/loom-bugfix.md.
 *
 * The "runtime" is simulated by small TypeScript harness functions that mirror
 * what the agent/command would do given a fixture project directory.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Harness simulation helpers
// ---------------------------------------------------------------------------

interface LoopFile {
  loopId: string;
  command: string;
  symptom: string;
  rung: number;
  verifiedRed: boolean;
  escapeReason?: string | null;
  retiredAt?: string | null;
  trda?: {
    tight: boolean;
    redCapable: boolean;
    deterministic: boolean;
    agentRunnable: boolean;
  };
}

function writeLoopFile(loopsDir: string, loop: LoopFile): string {
  mkdirSync(loopsDir, { recursive: true });
  const path = join(loopsDir, `${loop.loopId}.toon`);
  const content = [
    `loopId: ${loop.loopId}`,
    `command: ${loop.command}`,
    `symptom: ${loop.symptom}`,
    `rung: ${loop.rung}`,
    `verifiedRed: ${loop.verifiedRed}`,
    `retiredAt: ${loop.retiredAt ?? "null"}`,
    `escapeReason: ${loop.escapeReason ?? "null"}`,
    `parentLoopId: null`,
    `runtimeMs: 0`,
    `determinismRuns: 0`,
    ``,
    `trda:`,
    `  tight: ${loop.trda?.tight ?? false}`,
    `  redCapable: ${loop.trda?.redCapable ?? false}`,
    `  deterministic: ${loop.trda?.deterministic ?? false}`,
    `  agentRunnable: ${loop.trda?.agentRunnable ?? false}`,
    ``,
    `escalationHistory[0]{fromRung,toRung,reason,at}:`,
    `linkedLoops[0]{loopId,relation}:`,
  ].join("\n");
  writeFileSync(path, content, "utf8");
  return path;
}

/**
 * Simulates the Phase-1 loop-construction gate from bugfix-analyst-agent.md.
 *
 * Returns { exitCode, stderr, stdout, escapeReasonWritten } — analogous to
 * what the agent runtime would produce before any hypothesis work.
 */
function simulateBugfixDefaultPath(
  projectDir: string,
  opts: { overrideLoopGate?: string } = {},
): {
  exitCode: number;
  stderr: string;
  stdout: string;
  escapeReasonWritten: string | null;
} {
  const loopsDir = join(projectDir, ".plan-execution", "loops");

  // Override path
  if (opts.overrideLoopGate !== undefined) {
    // Read or create a minimal loop.toon
    let loopPath: string | null = null;
    if (existsSync(loopsDir)) {
      const { readdirSync } = require("node:fs") as typeof import("node:fs");
      const files = readdirSync(loopsDir).filter((f: string) => f.endsWith(".toon"));
      if (files.length > 0) {
        loopPath = join(loopsDir, files[0]);
      }
    }
    if (!loopPath) {
      mkdirSync(loopsDir, { recursive: true });
      const minimalLoop: LoopFile = {
        loopId: "00000000-0000-4000-8000-000000000000",
        command: "bunx vitest run tests/symptom.test.ts",
        symptom: "escape gate test",
        rung: 1,
        verifiedRed: false,
        escapeReason: null,
        retiredAt: null,
        trda: { tight: false, redCapable: false, deterministic: false, agentRunnable: false },
      };
      loopPath = writeLoopFile(loopsDir, minimalLoop);
    }

    // Write escapeReason atomically
    const existing = readFileSync(loopPath, "utf8");
    const updated = existing.replace(
      /^escapeReason: .*$/m,
      `escapeReason: ${opts.overrideLoopGate}`,
    );
    const tmpPath = loopPath + ".tmp";
    writeFileSync(tmpPath, updated, "utf8");
    const { renameSync } = require("node:fs") as typeof import("node:fs");
    renameSync(tmpPath, loopPath);

    const stdout = [
      `⚠ ESCAPE-SET: override-loop-gate active — escapeReason: "${opts.overrideLoopGate}"`,
      `[loom-converge] Proceeding without a verified-red loop. All findings are advisory under escape mode.`,
    ].join("\n");

    return { exitCode: 0, stderr: "", stdout, escapeReasonWritten: opts.overrideLoopGate };
  }

  // Default path — check for verified-red loop
  if (!existsSync(loopsDir)) {
    const stderr = [
      "errorCode: LOOP_NOT_VERIFIED_RED",
      "message: No verified-red loop is bound to this command — a tight, deterministic, agent-runnable red signal is required before hypothesis work begins.",
      `hint: Run loom-converge --construct-loop or pass --override-loop-gate "<reason>" to proceed under escape.`,
    ].join("\n");
    const stdout = [
      "[loom-converge] Phase 0: no verified-red loop found.",
      "RECOMMENDATION: Start loop construction with: loom-converge --construct-loop",
      "The 10-rung ladder (rung 1 default) will run your test/repro command twice to verify deterministic red.",
    ].join("\n");
    return { exitCode: 4, stderr, stdout, escapeReasonWritten: null };
  }

  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  const files = readdirSync(loopsDir).filter((f: string) => f.endsWith(".toon"));

  if (files.length === 0) {
    const stderr = [
      "errorCode: LOOP_NOT_VERIFIED_RED",
      "message: No verified-red loop is bound to this command — a tight, deterministic, agent-runnable red signal is required before hypothesis work begins.",
      `hint: Run loom-converge --construct-loop or pass --override-loop-gate "<reason>" to proceed under escape.`,
    ].join("\n");
    const stdout = [
      "[loom-converge] Phase 0: no verified-red loop found.",
      "RECOMMENDATION: Start loop construction with: loom-converge --construct-loop",
      "The 10-rung ladder (rung 1 default) will run your test/repro command twice to verify deterministic red.",
    ].join("\n");
    return { exitCode: 4, stderr, stdout, escapeReasonWritten: null };
  }

  const loopContent = readFileSync(join(loopsDir, files[0]), "utf8");
  const verifiedRedMatch = loopContent.match(/^verifiedRed:\s*(true|false)\s*$/m);
  const verifiedRed = verifiedRedMatch?.[1] === "true";

  if (!verifiedRed) {
    const rungMatch = loopContent.match(/^rung:\s*(\d+)\s*$/m);
    const rung = rungMatch ? parseInt(rungMatch[1], 10) : 1;

    if (rung >= 10) {
      const stderr = [
        "errorCode: STUCK_AT_LOOP_CONSTRUCTION",
        "message: The 10-rung ladder was exhausted without a verified-red loop.",
        "hint: See HITL escalation guidance below.",
        "hitlGuidance:",
        "  state: stuck-at-loop-construction",
        "  operatorQuestions[3]:",
        "    - Q1: Is the symptom reproducible by a human manually running the command outside the harness?",
        "    - Q2: Is the harness the right tool for this symptom (vs. a one-off REPL, a unit test refactor, or a debugger session)?",
        "    - Q3: Should this be escalated to a human-only path — i.e., taken out of the convergence loop entirely?",
        `  reviseLoopCommand: "loom-converge --revise-loop <loopId> --reason \\"<one-sentence-reason>\\""`,
        `  fallback: "If revision is not productive after 2 attempts, retire the loop with --retire-loop <loopId> and open a HITL issue."`,
      ].join("\n");
      return { exitCode: 5, stderr, stdout: "", escapeReasonWritten: null };
    }

    const stderr = [
      "errorCode: LOOP_NOT_VERIFIED_RED",
      "message: No verified-red loop is bound to this command — a tight, deterministic, agent-runnable red signal is required before hypothesis work begins.",
      `hint: Run loom-converge --construct-loop or pass --override-loop-gate "<reason>" to proceed under escape.`,
    ].join("\n");
    const stdout = [
      `[loom-converge] Phase 0: loop exists but not yet verified-red (rung: ${rung}).`,
      `currentRung: ${rung}`,
      `suggestion: Escalate with loom-converge --construct-loop --escalate-rung to try rung ${rung + 1}.`,
    ].join("\n");
    return { exitCode: 4, stderr, stdout, escapeReasonWritten: null };
  }

  // Gate passes — analyst would proceed
  return {
    exitCode: 0,
    stderr: "",
    stdout: "[loom-converge] Phase 0: gate passed — verified-red loop bound.",
    escapeReasonWritten: null,
  };
}

/**
 * Simulates the autoconverge path — same gate, different entry. F-18 makes
 * both paths unconditional: the gate fires on autoconverge too.
 */
function simulateBugfixAutoconvergePath(
  projectDir: string,
  opts: { overrideLoopGate?: string } = {},
): ReturnType<typeof simulateBugfixDefaultPath> {
  // Autoconverge has the same gate — delegate to the shared simulation
  return simulateBugfixDefaultPath(projectDir, opts);
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "loom-bugfix-gate-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// S-01: Default path halts when no loop.toon exists
// ---------------------------------------------------------------------------

describe("S-01: loom-bugfix default path halts before loop.toon is verified-red", () => {
  it("exits 4 when .plan-execution/loops/ does not exist", () => {
    const result = simulateBugfixDefaultPath(tmpDir);
    expect(result.exitCode).toBe(4);
  });

  it("emits errorCode: LOOP_NOT_VERIFIED_RED on stderr when no loops dir", () => {
    const result = simulateBugfixDefaultPath(tmpDir);
    expect(result.stderr).toContain("errorCode: LOOP_NOT_VERIFIED_RED");
  });

  it("emits verbatim message on stderr when no loops dir", () => {
    const result = simulateBugfixDefaultPath(tmpDir);
    expect(result.stderr).toContain(
      "No verified-red loop is bound to this command — a tight, deterministic, agent-runnable red signal is required before hypothesis work begins.",
    );
  });

  it("emits verbatim hint on stderr when no loops dir", () => {
    const result = simulateBugfixDefaultPath(tmpDir);
    expect(result.stderr).toContain(
      `Run loom-converge --construct-loop or pass --override-loop-gate "<reason>" to proceed under escape.`,
    );
  });

  it("presents rung-1 ladder recommendation on stdout when no loops dir", () => {
    const result = simulateBugfixDefaultPath(tmpDir);
    expect(result.stdout).toContain("RECOMMENDATION");
    expect(result.stdout).toContain("loom-converge --construct-loop");
  });

  it("exits 4 when loop.toon exists but verifiedRed: false", () => {
    const loopsDir = join(tmpDir, ".plan-execution", "loops");
    writeLoopFile(loopsDir, {
      loopId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      command: "bunx vitest run tests/foo.test.ts",
      symptom: "Reducer drops second event",
      rung: 3,
      verifiedRed: false,
    });
    const result = simulateBugfixDefaultPath(tmpDir);
    expect(result.exitCode).toBe(4);
  });

  it("emits LOOP_NOT_VERIFIED_RED when loop exists but not verified", () => {
    const loopsDir = join(tmpDir, ".plan-execution", "loops");
    writeLoopFile(loopsDir, {
      loopId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      command: "bunx vitest run tests/foo.test.ts",
      symptom: "Reducer drops second event",
      rung: 3,
      verifiedRed: false,
    });
    const result = simulateBugfixDefaultPath(tmpDir);
    expect(result.stderr).toContain("errorCode: LOOP_NOT_VERIFIED_RED");
  });

  it("gate passes (exit 0) when loop exists and verifiedRed: true", () => {
    const loopsDir = join(tmpDir, ".plan-execution", "loops");
    writeLoopFile(loopsDir, {
      loopId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      command: "bunx vitest run tests/foo.test.ts",
      symptom: "Reducer drops second event",
      rung: 2,
      verifiedRed: true,
      trda: { tight: true, redCapable: true, deterministic: true, agentRunnable: true },
    });
    const result = simulateBugfixDefaultPath(tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });
});

// ---------------------------------------------------------------------------
// S-01 (autoconverge path): gate is equally unconditional
// ---------------------------------------------------------------------------

describe("S-01 (autoconverge path): gate applies to --autoconverge as well", () => {
  it("autoconverge path also exits 4 when no verified-red loop", () => {
    const result = simulateBugfixAutoconvergePath(tmpDir);
    expect(result.exitCode).toBe(4);
  });

  it("autoconverge path also emits LOOP_NOT_VERIFIED_RED on stderr", () => {
    const result = simulateBugfixAutoconvergePath(tmpDir);
    expect(result.stderr).toContain("errorCode: LOOP_NOT_VERIFIED_RED");
  });
});

// ---------------------------------------------------------------------------
// S-02: --override-loop-gate proceeds and is logged prominently
// ---------------------------------------------------------------------------

describe("S-02: --override-loop-gate proceeds and is logged prominently", () => {
  it("exits 0 when --override-loop-gate is provided", () => {
    const result = simulateBugfixDefaultPath(tmpDir, {
      overrideLoopGate: "investigating prod outage",
    });
    expect(result.exitCode).toBe(0);
  });

  it("writes escapeReason to loop.toon when --override-loop-gate is provided", () => {
    simulateBugfixDefaultPath(tmpDir, { overrideLoopGate: "investigating prod outage" });
    const loopsDir = join(tmpDir, ".plan-execution", "loops");
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const files = readdirSync(loopsDir).filter((f: string) => f.endsWith(".toon"));
    expect(files.length).toBeGreaterThan(0);
    const content = readFileSync(join(loopsDir, files[0]), "utf8");
    expect(content).toContain("escapeReason: investigating prod outage");
  });

  it("returns the escapeReason that was written", () => {
    const result = simulateBugfixDefaultPath(tmpDir, {
      overrideLoopGate: "investigating prod outage",
    });
    expect(result.escapeReasonWritten).toBe("investigating prod outage");
  });

  it("stdout contains prominent ESCAPE-SET callout", () => {
    const result = simulateBugfixDefaultPath(tmpDir, {
      overrideLoopGate: "investigating prod outage",
    });
    expect(result.stdout).toContain("⚠ ESCAPE-SET: override-loop-gate active");
    expect(result.stdout).toContain('escapeReason: "investigating prod outage"');
  });

  it("--override-loop-gate works even when a loop.toon already exists", () => {
    const loopsDir = join(tmpDir, ".plan-execution", "loops");
    writeLoopFile(loopsDir, {
      loopId: "cccccccc-dddd-4eee-8fff-000000000000",
      command: "bunx vitest run tests/bar.test.ts",
      symptom: "Payment timeout",
      rung: 2,
      verifiedRed: false,
    });
    const result = simulateBugfixDefaultPath(tmpDir, {
      overrideLoopGate: "prod P0 emergency",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ESCAPE-SET");
  });
});
