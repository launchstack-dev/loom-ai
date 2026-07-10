/**
 * Step-recorder CLI tests (M-2 chunk 2) — fixture trajectories reproducing
 * every driver-emittable haltReason with the markdown driver's locked
 * semantics (roadmap metric: circuit-breaker parity).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { preflight, record, finalize, validateFindings } from "../iterate.js";

let tmpDir: string;
let prevCwd: string;
let stdoutLines: string[];
let writeSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-engine-iter-"));
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

function allStdout(): string {
  return stdoutLines.join("");
}

const CONFIG_PATH = () => path.join(tmpDir, "converge.config");

function writeConfig(overrides: Record<string, string | number> = {}) {
  const defaults: Record<string, string | number> = {
    runId: "conv-test-001",
    convergenceMode: "document",
    subject: "planning/PLAN.md",
    harness: "harness.ts",
    integrator: "plan-builder-agent",
    maxIterations: 10,
    agentBudget: 40,
    outputDir: ".plan-execution/convergence/",
  };
  const merged = { ...defaults, ...overrides };
  fs.writeFileSync(
    CONFIG_PATH(),
    Object.entries(merged)
      .filter(([, v]) => v !== "")
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n") + "\n",
    "utf-8"
  );
  // harness + integrator exist by default
  fs.writeFileSync(path.join(tmpDir, "harness.ts"), "// harness stub\n", "utf-8");
  fs.mkdirSync(path.join(tmpDir, "agents"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, "agents", "plan-builder-agent.md"),
    "---\nname: plan-builder-agent\nmodel: sonnet\n---\n",
    "utf-8"
  );
}

function writeFindings(iteration: number, blocking: number, advisory = 0) {
  const rows: string[] = [];
  for (let i = 0; i < blocking; i += 1) {
    rows.push(`  B-${iteration}-${i},phasing,blocking,planning/PLAN.md,##X,issue,fix it,phasing-reviewer-agent`);
  }
  for (let i = 0; i < advisory; i += 1) {
    rows.push(`  A-${iteration}-${i},ux,warning,planning/PLAN.md,##Y,nit,polish,ux-reviewer-agent`);
  }
  const p = path.join(tmpDir, ".plan-execution", "convergence", "findings.toon");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(
    p,
    [
      `subject: planning/PLAN.md`,
      `harnessName: plan-review`,
      `iteration: ${iteration}`,
      `blockingCount: ${blocking}`,
      `advisoryCount: ${advisory}`,
      `producedAt: 2026-07-09T12:00:00.000Z`,
      ``,
      `findings[${blocking + advisory}]{id,dimension,severity,locationPath,locationAnchor,summary,suggestion,reviewerAgent}:`,
      ...rows,
      ``,
    ].join("\n"),
    "utf-8"
  );
  return p;
}

function runIteration(
  iteration: number,
  blocking: number,
  agentsSpawned: number,
  extra: Partial<Parameters<typeof record>[0]> = {}
): Record<string, unknown> {
  stdoutLines = [];
  const findingsPath = writeFindings(iteration, blocking);
  const code = record({
    configPath: CONFIG_PATH(),
    iteration,
    findingsPath,
    agentsSpawned,
    scopeExpansion: false,
    allBlockingFrozen: false,
    ...extra,
  });
  expect(code).toBe(0);
  return verdict();
}

describe("preflight", () => {
  it("passes a valid config and reports resolved fields", () => {
    writeConfig();
    expect(preflight(CONFIG_PATH())).toBe(0);
    expect(verdict()).toMatchObject({
      ok: true,
      mode: "document",
      integrator: "plan-builder-agent",
      agentBudget: 40,
    });
  });

  it("fails HARNESS_MISSING and writes the preflight envelope (no summary)", () => {
    writeConfig({ harness: "nope.ts" });
    fs.rmSync(path.join(tmpDir, "nope.ts"), { force: true });
    expect(preflight(CONFIG_PATH())).toBe(1);
    expect(verdict()).toMatchObject({ ok: false, haltReason: "HARNESS_MISSING" });
    expect(fs.existsSync(path.join(tmpDir, ".plan-execution", "convergence-preflight.toon"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".plan-execution", "convergence-summary.toon"))).toBe(false);
  });

  it("fails INTEGRATOR_NOT_FOUND when the agent file is absent", () => {
    writeConfig({ integrator: "ghost-agent" });
    expect(preflight(CONFIG_PATH())).toBe(1);
    expect(verdict()).toMatchObject({ ok: false, haltReason: "INTEGRATOR_NOT_FOUND" });
  });

  it("rejects document mode without a subject", () => {
    writeConfig({ subject: "" });
    expect(preflight(CONFIG_PATH())).toBe(1);
    expect((verdict() as { detail: string }).detail).toContain("subject");
  });
});

describe("record — breaker parity trajectories", () => {
  beforeEach(() => writeConfig());

  it("converges when blocking reaches 0 (locked stdout line included)", () => {
    runIteration(1, 5, 10);
    runIteration(2, 2, 18);
    const v = runIteration(3, 0, 25);
    expect(v).toMatchObject({ halt: true, status: "converged", blockingCount: 0, fixed: 2 });
    expect(allStdout()).toContain(
      "[autoconverge] iteration 3/10 — blockingCount: 2 → 0 (2 fixed, 0 new)"
    );
  });

  it("STALL after two consecutive unchanged iterations (S-01 trajectory)", () => {
    runIteration(1, 5, 10);
    const two = runIteration(2, 5, 18);
    expect(two.halt).toBe(false);
    expect(two.consecutiveStalls).toBe(1);
    const three = runIteration(3, 5, 25);
    expect(three).toMatchObject({ halt: true, haltReason: "STALL", status: "halted-stall" });
    expect(allStdout()).toContain("[autoconverge] HALT haltReason=STALL");
    expect(allStdout()).toContain("recovery: /loom-converge --resume");
  });

  it("REGRESSION halts immediately with the locked halt block", () => {
    runIteration(1, 3, 10);
    const v = runIteration(2, 5, 18);
    expect(v).toMatchObject({ halt: true, haltReason: "REGRESSION", status: "halted-regression", new: 2 });
    expect(allStdout()).toContain("[autoconverge] HALT haltReason=REGRESSION");
  });

  it("BUDGET_EXHAUSTED when cumulative spawns reach agentBudget", () => {
    runIteration(1, 5, 10);
    const v = runIteration(2, 3, 40);
    expect(v).toMatchObject({ halt: true, haltReason: "BUDGET_EXHAUSTED", status: "halted-budget" });
  });

  it("MAX_ITERATIONS at the cap without convergence", () => {
    writeConfig({ maxIterations: 2 });
    runIteration(1, 5, 10);
    const v = runIteration(2, 3, 18);
    expect(v).toMatchObject({ halt: true, haltReason: "MAX_ITERATIONS", status: "halted-max-iter" });
  });

  it("SCOPE_EXPANSION when the guard reports a new top-level section", () => {
    runIteration(1, 5, 10);
    const v = runIteration(2, 3, 18, { scopeExpansion: true });
    expect(v).toMatchObject({ halt: true, haltReason: "SCOPE_EXPANSION", status: "halted-scope-expansion" });
  });

  it("FINDINGS_SCHEMA_INVALID on count-invariant violation", () => {
    writeConfig();
    const findingsPath = writeFindings(1, 2);
    // Corrupt: claim 5 blocking but only 2 rows
    fs.writeFileSync(
      findingsPath,
      fs.readFileSync(findingsPath, "utf-8").replace("blockingCount: 2", "blockingCount: 5"),
      "utf-8"
    );
    stdoutLines = [];
    const code = record({
      configPath: CONFIG_PATH(),
      iteration: 1,
      findingsPath,
      agentsSpawned: 5,
      scopeExpansion: false,
      allBlockingFrozen: false,
    });
    expect(code).toBe(1);
    expect(verdict()).toMatchObject({ halt: true, haltReason: "FINDINGS_SCHEMA_INVALID" });
  });

  it("writes iter-N.toon with the uniform shape and halt fields", () => {
    runIteration(1, 3, 10);
    runIteration(2, 5, 18); // regression
    const iterFile = fs.readFileSync(
      path.join(tmpDir, ".plan-execution", "convergence", "iterations", "iter-2.toon"),
      "utf-8"
    );
    expect(iterFile).toContain("haltReason: REGRESSION");
    expect(iterFile).toContain("findingsBefore: 3");
    expect(iterFile).toContain("findingsAfter: 5");
    // cause + recovery verbatim in summary field (fresh-context resume rule)
    expect(iterFile).toContain("blockingCount` increased vs prior iteration");
  });

  it("criteria-mode frozen-blocking halts as STALL", () => {
    writeConfig({ convergenceMode: "criteria", subject: "" });
    runIteration(1, 5, 10);
    const v = runIteration(2, 3, 15, { allBlockingFrozen: true });
    expect(v).toMatchObject({ halt: true, haltReason: "STALL" });
  });
});

describe("document-mode safeguards (C-06 scope guard, C-07 snapshots)", () => {
  function writeSubject(content: string) {
    fs.mkdirSync(path.join(tmpDir, "planning"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "planning", "PLAN.md"), content, "utf-8");
  }

  it("detects integrator-added top-level sections via the subject baseline", () => {
    writeConfig();
    writeSubject("# Plan\n### Phase 1 — setup\n");
    runIteration(1, 5, 10); // captures baseline
    // Integrator adds a new top-level phase between iterations
    writeSubject("# Plan\n### Phase 1 — setup\n### Phase 2 — extras\n");
    const v = runIteration(2, 3, 18);
    expect(v).toMatchObject({ halt: true, haltReason: "SCOPE_EXPANSION" });
    expect(v.newSections).toEqual(["### Phase 2 — extras"]);
  });

  it("does not fire the guard on unchanged structure", () => {
    writeConfig();
    writeSubject("# Plan\n### Phase 1 — setup\n");
    runIteration(1, 5, 10);
    writeSubject("# Plan\n### Phase 1 — setup\nedited body only\n");
    const v = runIteration(2, 3, 18);
    expect(v.halt).toBe(false);
  });

  it("writes a snapshot before the integrator for iterations >= 2", () => {
    writeConfig();
    writeSubject("# Plan\n### Phase 1 — setup\n");
    const first = runIteration(1, 5, 10);
    expect(first.snapshotRef).toBeNull(); // iteration 1: no snapshot per spec
    const second = runIteration(2, 3, 18);
    expect(second.snapshotRef).toBe(
      path.join("planning/history/snapshots", "PLAN-pass-2.md")
    );
    const meta = fs.readFileSync(
      path.join(tmpDir, "planning/history/snapshots", "PLAN-pass-2.toon"),
      "utf-8"
    );
    expect(meta).toContain("slug: PLAN");
    expect(meta).toContain("snapshotChecksum: sha256-");
  });

  it("skips snapshots when the breaker halts the iteration", () => {
    writeConfig();
    writeSubject("# Plan\n### Phase 1 — setup\n");
    runIteration(1, 3, 10);
    const v = runIteration(2, 5, 18); // REGRESSION
    expect(v.halt).toBe(true);
    expect(v.snapshotRef).toBeNull();
  });
});

describe("finalize — convergence-summary.toon (locked C-11)", () => {
  beforeEach(() => writeConfig());

  it("writes the converged summary with all locked fields", () => {
    runIteration(1, 2, 10);
    runIteration(2, 0, 16);
    stdoutLines = [];
    expect(finalize({ configPath: CONFIG_PATH() })).toBe(0);
    const summary = fs.readFileSync(
      path.join(tmpDir, ".plan-execution", "convergence-summary.toon"),
      "utf-8"
    );
    expect(summary).toContain("status: converged");
    expect(summary).toContain("finalBlockingCount: 0");
    expect(summary).toContain("iterationsRun: 2");
    expect(summary).toContain("integratorName: plan-builder-agent");
    expect(summary).toContain("haltReason: \n"); // null when converged
  });

  it("maps haltReason to the locked status", () => {
    runIteration(1, 5, 10);
    stdoutLines = [];
    finalize({ configPath: CONFIG_PATH(), haltReason: "STALL" });
    const summary = fs.readFileSync(
      path.join(tmpDir, ".plan-execution", "convergence-summary.toon"),
      "utf-8"
    );
    expect(summary).toContain("status: halted-stall");
    expect(summary).toContain("haltReason: STALL");
  });
});

describe("goal-backward convergence (M-2 metric: completed tasks + unwired promise must fail)", () => {
  function writeMatrix(status: "covered" | "uncovered") {
    fs.mkdirSync(path.join(tmpDir, ".plan-execution"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".plan-execution", "coverage-matrix.toon"),
      [
        `schemaVersion: 1`,
        `generatedAt: 2026-07-09T12:00:00.000Z`,
        ``,
        `matrix[2]{requirementId,requirementText,source,coverageStatus,testRefs}:`,
        `  C-01,Blocks unauthenticated requests,criteria,covered,S-01`,
        `  P-01,Admin audit log records every mutation,phase-promise,${status},${status === "covered" ? "S-07" : ""}`,
        ``,
      ].join("\n"),
      "utf-8"
    );
  }

  it("does NOT converge on zero findings while a phase promise is uncovered", () => {
    writeConfig();
    writeMatrix("uncovered");
    const v = runIteration(1, 0, 10); // harness: zero blocking findings
    expect(v.halt).toBe(false); // not converged — the gap blocks
    expect(v.blockingCount).toBe(1);
    expect(v.findingsBlockingCount).toBe(0);
    expect(v.gaps).toEqual([
      {
        requirementId: "P-01",
        requirementText: "Admin audit log records every mutation",
        source: "phase-promise",
      },
    ]);
    expect(allStdout()).toContain("blockingCount: 1 → 1");
  });

  it("converges once the promise is wired (matrix row covered)", () => {
    writeConfig();
    writeMatrix("uncovered");
    runIteration(1, 0, 10);
    writeMatrix("covered"); // gap fixer closed the row
    const v = runIteration(2, 0, 16);
    expect(v).toMatchObject({ halt: true, status: "converged", blockingCount: 0 });
  });
});

describe("validateFindings", () => {
  it("flags missing files, iteration mismatch, and duplicate ids", () => {
    writeConfig();
    expect(validateFindings(path.join(tmpDir, "missing.toon"), 1).errors).toContain(
      "findings.toon missing"
    );
    const p = writeFindings(2, 1);
    expect(validateFindings(p, 1).errors.join(" ")).toContain("iteration mismatch");
    const dup = fs
      .readFileSync(p, "utf-8")
      .replace("B-2-0,phasing", "B-2-0,phasing")
      .replace("findings[1]", "findings[2]")
      .replace(
        "  B-2-0,phasing,blocking,planning/PLAN.md,##X,issue,fix it,phasing-reviewer-agent",
        "  B-2-0,phasing,blocking,planning/PLAN.md,##X,issue,fix it,phasing-reviewer-agent\n  B-2-0,phasing,blocking,planning/PLAN.md,##X,issue,fix it,phasing-reviewer-agent"
      );
    fs.writeFileSync(p, dup, "utf-8");
    const result = validateFindings(p, 2);
    expect(result.errors.join(" ")).toContain("duplicate finding id");
  });
});
