/**
 * Engine-core parity tests (M-2 chunk 1).
 * Breaker semantics, haltReason/status/cause/recovery strings, and stdout
 * formats are LOCKED (agents/convergence-driver.md + convergence-summary
 * schema C-10/C-11). These tests pin the executable form to that spec.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  evaluateBreakers,
  computeRate,
  detectScopeExpansion,
  renderIterationLine,
  renderHaltMessage,
  STATUS_BY_HALT_REASON,
  HALT_CAUSE,
  HALT_RECOVERY,
  DRIVER_HALT_REASONS,
  type IterationRecord,
} from "../breakers.js";
import { clampShape, fitRoundToBudget } from "../shape.js";
import {
  resolveAgentModel,
  readFrontmatterModel,
  readTomlModelOverride,
} from "../model-resolution.js";

function hist(...blocking: number[]): IterationRecord[] {
  return blocking.map((b, i) => ({ iteration: i + 1, blocking: b }));
}

const base = {
  mode: "document" as const,
  maxIterations: 10,
  agentBudget: 40,
  totalAgentsSpawned: 5,
};

describe("computeRate (locked step-9 semantics)", () => {
  it("computes (prior - current) / prior", () => {
    expect(computeRate(10, 5)).toBe(0.5);
    expect(computeRate(5, 10)).toBe(-1);
  });
  it("returns 0.00 when prior is 0 (locked edge case)", () => {
    expect(computeRate(0, 3)).toBe(0);
  });
});

describe("evaluateBreakers", () => {
  it("converges when blocking hits 0 (short-circuit before breakers)", () => {
    const v = evaluateBreakers({ ...base, iteration: 3, history: hist(5, 2, 0) });
    expect(v).toMatchObject({ halt: true, status: "converged" });
    expect(v.haltReason).toBeUndefined();
  });

  it("continues on healthy progress", () => {
    const v = evaluateBreakers({ ...base, iteration: 2, history: hist(5, 3) });
    expect(v.halt).toBe(false);
    expect(v.consecutiveStalls).toBe(0);
  });

  it("STALL fires after 2 consecutive no-progress iterations (S-01 trajectory)", () => {
    // iter2 == iter1 AND iter3 == iter2 → halt at end of iteration 3
    const afterTwo = evaluateBreakers({ ...base, iteration: 2, history: hist(5, 5) });
    expect(afterTwo.halt).toBe(false);
    expect(afterTwo.consecutiveStalls).toBe(1);

    const afterThree = evaluateBreakers({ ...base, iteration: 3, history: hist(5, 5, 5) });
    expect(afterThree).toMatchObject({
      halt: true,
      haltReason: "STALL",
      status: "halted-stall",
    });
  });

  it("STALL uses the rate<0.01 rule, so tiny improvements on large counts stall", () => {
    // 1000 → 999 → 998: rate ~0.001 twice → STALL
    const v = evaluateBreakers({ ...base, iteration: 3, history: hist(1000, 999, 998) });
    expect(v.haltReason).toBe("STALL");
  });

  it("REGRESSION fires immediately when blocking increases", () => {
    const v = evaluateBreakers({ ...base, iteration: 2, history: hist(3, 5) });
    expect(v).toMatchObject({
      halt: true,
      haltReason: "REGRESSION",
      status: "halted-regression",
    });
  });

  it("BUDGET_EXHAUSTED fires at spawns >= agentBudget", () => {
    const v = evaluateBreakers({
      ...base,
      iteration: 2,
      history: hist(5, 3),
      totalAgentsSpawned: 40,
    });
    expect(v).toMatchObject({ halt: true, haltReason: "BUDGET_EXHAUSTED", status: "halted-budget" });
  });

  it("criteria-mode frozen-blocking triggers STALL", () => {
    const v = evaluateBreakers({
      ...base,
      mode: "criteria",
      iteration: 2,
      history: hist(5, 3),
      allBlockingFrozen: true,
    });
    expect(v.haltReason).toBe("STALL");
  });

  it("frozen-blocking is criteria-scoped (inert in document mode)", () => {
    const v = evaluateBreakers({
      ...base,
      iteration: 2,
      history: hist(5, 3),
      allBlockingFrozen: true,
    });
    expect(v.halt).toBe(false);
  });

  it("SCOPE_EXPANSION fires in document mode only", () => {
    const doc = evaluateBreakers({
      ...base,
      iteration: 2,
      history: hist(5, 3),
      scopeExpansionDetected: true,
    });
    expect(doc).toMatchObject({ halt: true, haltReason: "SCOPE_EXPANSION", status: "halted-scope-expansion" });

    const target = evaluateBreakers({
      ...base,
      mode: "target",
      iteration: 2,
      history: hist(5, 3),
      scopeExpansionDetected: true,
    });
    expect(target.halt).toBe(false);
  });

  it("MAX_ITERATIONS fires when the cap is reached without convergence", () => {
    const v = evaluateBreakers({
      ...base,
      iteration: 10,
      maxIterations: 10,
      history: hist(9, 8, 7, 6, 5, 4, 3, 2, 2.5, 1).map((r, i) => ({ iteration: i + 1, blocking: Math.ceil(r.blocking) })),
    });
    // healthy progress but cap reached
    expect(v).toMatchObject({ halt: true, haltReason: "MAX_ITERATIONS", status: "halted-max-iter" });
  });

  it("breaker precedence: REGRESSION beats BUDGET beats MAX_ITERATIONS (step-10 order)", () => {
    const v = evaluateBreakers({
      ...base,
      iteration: 10,
      maxIterations: 10,
      totalAgentsSpawned: 99,
      history: hist(3, 5),
    });
    expect(v.haltReason).toBe("REGRESSION");
  });
});

describe("locked C-10/C-11 string tables", () => {
  it("maps every driver halt reason to its locked status", () => {
    expect(STATUS_BY_HALT_REASON.STALL).toBe("halted-stall");
    expect(STATUS_BY_HALT_REASON.REGRESSION).toBe("halted-regression");
    expect(STATUS_BY_HALT_REASON.BUDGET_EXHAUSTED).toBe("halted-budget");
    expect(STATUS_BY_HALT_REASON.MAX_ITERATIONS).toBe("halted-max-iter");
    expect(STATUS_BY_HALT_REASON.SCOPE_EXPANSION).toBe("halted-scope-expansion");
    expect(STATUS_BY_HALT_REASON.VALIDATION_EXHAUSTED).toBe("halted-validation");
  });

  it("VALIDATION_EXHAUSTED is not a driver-emittable breaker", () => {
    expect(DRIVER_HALT_REASONS.has("VALIDATION_EXHAUSTED")).toBe(false);
    expect(DRIVER_HALT_REASONS.size).toBe(5);
  });

  it("every halt reason has cause + recovery strings", () => {
    for (const reason of Object.keys(HALT_CAUSE)) {
      expect(HALT_CAUSE[reason as keyof typeof HALT_CAUSE]).toBeTruthy();
      expect(HALT_RECOVERY[reason as keyof typeof HALT_RECOVERY]).toBeTruthy();
    }
  });

  it("renders the locked stdout formats", () => {
    expect(renderIterationLine(2, 10, 5, 3, 2, 0)).toBe(
      "[autoconverge] iteration 2/10 — blockingCount: 5 → 3 (2 fixed, 0 new)"
    );
    const msg = renderHaltMessage("STALL");
    expect(msg).toContain("[autoconverge] HALT haltReason=STALL");
    expect(msg).toContain("  cause: `blockingCount` unchanged across 2 consecutive iterations");
    expect(msg).toContain("  recovery: /loom-converge --resume after fixing integrator prompt or splitting work");
  });
});

describe("detectScopeExpansion (locked C-06 regexes)", () => {
  const before = "# Plan\n### Phase 1 — setup\n### F-01\nbody\n";

  it("detects a new top-level Phase/Feature/Milestone heading", () => {
    expect(detectScopeExpansion(before, before + "### Phase 2 — extras\n")).toEqual([
      "### Phase 2 — extras",
    ]);
    expect(detectScopeExpansion(before, before + "### M-03\n")).toEqual(["### M-03"]);
  });

  it("ignores non-matching headings and pre-existing sections", () => {
    expect(detectScopeExpansion(before, before + "### Notes\n#### Phase 9\n")).toEqual([]);
    expect(detectScopeExpansion(before, before)).toEqual([]);
  });
});

describe("clampShape / fitRoundToBudget (C-07: caps enforced, shape free)", () => {
  const caps = {
    agentBudget: 40,
    maxIterations: 10,
    maxParallelAgents: 6,
    perDimensionFindingCap: 5,
  };

  it("passes an in-cap shape through untouched", () => {
    const r = clampShape({ reviewers: ["a", "b", "c"], maxIterations: 5 }, caps);
    expect(r.reviewers).toEqual(["a", "b", "c"]);
    expect(r.maxIterations).toBe(5);
    expect(r.clamps).toEqual([]);
  });

  it("clamps oversized panels and reports what was dropped (no silent caps)", () => {
    const r = clampShape(
      { reviewers: ["a", "b", "c", "d", "e", "f", "g", "h"] },
      caps
    );
    expect(r.reviewers).toHaveLength(6);
    expect(r.clamps.join(" ")).toContain("dropped: g, h");
  });

  it("clamps maxIterations to the schema ceiling and floor", () => {
    expect(clampShape({ reviewers: [], maxIterations: 99 }, caps).maxIterations).toBe(10);
    expect(clampShape({ reviewers: [], maxIterations: 0 }, caps).maxIterations).toBe(1);
  });

  it("cuts a spawn round to the remaining budget with a note", () => {
    expect(fitRoundToBudget(6, 30, 40)).toEqual({ size: 6, note: null });
    const cut = fitRoundToBudget(6, 38, 40);
    expect(cut.size).toBe(2);
    expect(cut.note).toContain("6 → 2");
  });
});

describe("resolveAgentModel (mandatory chain: toml tier → frontmatter → inherit)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-model-res-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeAgent(name: string, frontmatter: string): string {
    const p = path.join(tmpDir, `${name}.md`);
    fs.writeFileSync(p, `---\n${frontmatter}\n---\n\nBody.\n`, "utf-8");
    return p;
  }

  function writeToml(content: string) {
    fs.mkdirSync(path.join(tmpDir, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".claude", "orchestration.toml"), content, "utf-8");
  }

  it("reads frontmatter model", () => {
    const agent = writeAgent("fixer", "name: fixer\nmodel: haiku");
    expect(readFrontmatterModel(agent)).toBe("haiku");
    expect(resolveAgentModel({ agentFile: agent, cwd: tmpDir })).toBe("haiku");
  });

  it("orchestration.toml registration overrides frontmatter", () => {
    const agent = writeAgent("sec", "name: sec\nmodel: haiku");
    writeToml(`[[review.agents]]\nname = "sec"\nmodel = "opus"\n`);
    expect(readTomlModelOverride("sec", tmpDir)).toBe("opus");
    expect(resolveAgentModel({ agentFile: agent, agentName: "sec", cwd: tmpDir })).toBe("opus");
  });

  it("falls through to inherit when nothing declares a model", () => {
    const agent = writeAgent("plain", "name: plain");
    expect(resolveAgentModel({ agentFile: agent, cwd: tmpDir })).toBe("inherit");
    expect(resolveAgentModel({ agentFile: path.join(tmpDir, "missing.md"), cwd: tmpDir })).toBe(
      "inherit"
    );
  });
});
