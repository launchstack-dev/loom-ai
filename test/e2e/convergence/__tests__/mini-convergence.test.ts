import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, copyFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildDeltaReport } from "../src/lib/delta-report.js";
import { convergenceRate } from "../src/lib/scoring.js";
import { checkAll } from "../src/lib/circuit-breakers.js";
import { serializeConvergenceState, parseConvergenceState } from "../src/lib/convergence-state.js";
import type { ConvergeConfig, ConvergenceState, IterationRecord } from "../src/types.js";

const FIXTURES = resolve(import.meta.dirname, "../fixtures");

let tmpDir: string;
let actualDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mini-converge-"));
  actualDir = join(tmpDir, "actual");
  mkdirSync(actualDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeConfig(actualFiles: Record<string, string>): ConvergeConfig {
  const targets = [];
  for (const [id, actualPath] of Object.entries(actualFiles)) {
    const isJson = actualPath.endsWith(".json");
    targets.push({
      id,
      name: id,
      comparisonMethod: (isJson ? "json-deep-equal" : "text-diff") as "json-deep-equal" | "text-diff",
      tolerance: 1.0,
      baselinePath: join(FIXTURES, "targets", isJson ? "api-users.json" : "readme.txt"),
      actualPath,
    });
  }
  return { targets };
}

function copyFixture(src: string, dest: string): string {
  const destPath = join(actualDir, dest);
  copyFileSync(join(FIXTURES, src), destPath);
  return destPath;
}

function runConvergenceLoop(
  config: ConvergeConfig,
  maxIterations: number,
  agentBudget: number,
  fixFn: (iteration: number) => void
): ConvergenceState {
  const state: ConvergenceState = {
    iteration: 0,
    maxIterations,
    status: "iterating",
    totalTargets: config.targets.length,
    passing: 0,
    failing: config.targets.length,
    convergenceRate: 0,
    totalAgentsSpawned: 0,
    agentBudget,
    consecutiveStalls: 0,
    history: [],
  };

  for (let i = 1; i <= maxIterations; i++) {
    state.iteration = i;

    // Simulate fix BEFORE harness run (except first iteration)
    if (i > 1) {
      fixFn(i - 1);
    }

    // Run harness
    const report = buildDeltaReport(config);
    const priorFailing = state.failing;

    state.passing = report.passing;
    state.failing = report.failing;

    // Check convergence
    if (report.failing === 0) {
      state.status = "converged";
      const rate = priorFailing > 0 ? 1.0 : 0;
      state.convergenceRate = rate;
      state.history.push({
        iteration: i,
        passing: report.passing,
        failing: 0,
        rate,
        agentsUsed: i === 1 ? 0 : 1,
      });
      break;
    }

    // Simulate: spawn 1 fixer agent per iteration
    state.totalAgentsSpawned += 1;

    // Rate: first iteration has no prior, so rate is N/A (use 0)
    const rate = i === 1 ? 0 : convergenceRate(priorFailing, report.failing);
    state.convergenceRate = rate;

    const record: IterationRecord = {
      iteration: i,
      passing: report.passing,
      failing: report.failing,
      rate,
      agentsUsed: 1,
    };
    state.history.push(record);

    // Check circuit breakers individually with proper ordering
    // Per convergence-driver spec: regression > stall > budget > max_iterations
    if (i >= 2) {
      // Regression: compare this iteration's failing to previous
      const prevRecord = state.history[state.history.length - 2];
      if (prevRecord && report.failing > prevRecord.failing) {
        state.status = "regression";
        break;
      }

      // Stall: need at least 2 real rate measurements (iteration 1 rate is N/A)
      // So stall can only fire from iteration 3+
      if (i >= 3) {
        const lastTwo = state.history.slice(-2);
        if (lastTwo.length === 2 && lastTwo[0].rate < 0.01 && lastTwo[1].rate < 0.01) {
          state.status = "stall";
          break;
        }
      }

      // Budget
      if (state.totalAgentsSpawned >= state.agentBudget) {
        state.status = "budget_exhausted";
        break;
      }
    }
  }

  // If we exhausted iterations without converging or breaking
  if (state.status === "iterating") {
    state.status = "max_iterations";
  }

  return state;
}

describe("mini convergence loop", () => {
  it("converges in 3 iterations with synthetic JSON target", () => {
    // fixFn is called with iteration-1, so fixFn(1) runs before iteration 2's harness
    const actualPath = copyFixture("actual/api-users-v0.json", "api-users.json");
    const config = makeConfig({ "api-users": actualPath });

    const state = runConvergenceLoop(config, 10, 30, (afterIteration) => {
      if (afterIteration === 1) {
        copyFileSync(join(FIXTURES, "actual/api-users-v1.json"), actualPath);
      } else if (afterIteration === 2) {
        copyFileSync(join(FIXTURES, "actual/api-users-v2.json"), actualPath);
      }
    });

    expect(state.status).toBe("converged");
    expect(state.history.length).toBeLessThanOrEqual(3);
    expect(state.passing).toBe(1);
    expect(state.failing).toBe(0);

    // Verify scores improved monotonically
    for (let i = 1; i < state.history.length; i++) {
      expect(state.history[i].passing).toBeGreaterThanOrEqual(state.history[i - 1].passing);
    }
  });

  it("triggers stall circuit breaker when scores plateau", () => {
    const actualPath = copyFixture("actual/api-users-v0.json", "api-users.json");
    const config = makeConfig({ "api-users": actualPath });

    // Never fix — actual stays as v0 every iteration
    const state = runConvergenceLoop(config, 10, 30, () => {});

    expect(state.status).toBe("stall");
    expect(state.history.length).toBeGreaterThanOrEqual(2);
    // Last two iterations should have rate < 1%
    const last = state.history[state.history.length - 1];
    const prev = state.history[state.history.length - 2];
    expect(last.rate).toBeLessThan(0.01);
    expect(prev.rate).toBeLessThan(0.01);
  });

  it("triggers regression circuit breaker when scores worsen", () => {
    // Use 3 targets. Start with 2 passing, 1 failing.
    // After iteration 1 "fix", break 2 more targets so failing goes from 1 → 3.
    const apiPath = copyFixture("actual/api-users-v2.json", "api-users.json"); // starts passing
    const readmePath = copyFixture("actual/readme-v1.txt", "readme.txt");       // starts passing
    const configPath = copyFixture("actual/config-v1.json", "config.json");     // starts passing

    // One target deliberately wrong
    const apiPath2 = copyFixture("actual/api-users-v0.json", "api-users2.json");

    const config: ConvergeConfig = {
      targets: [
        { id: "api", name: "API", comparisonMethod: "json-deep-equal", tolerance: 1.0,
          baselinePath: join(FIXTURES, "targets/api-users.json"), actualPath: apiPath },
        { id: "readme", name: "Readme", comparisonMethod: "text-diff", tolerance: 1.0,
          baselinePath: join(FIXTURES, "targets/readme.txt"), actualPath: readmePath },
        { id: "config", name: "Config", comparisonMethod: "json-deep-equal", tolerance: 1.0,
          baselinePath: join(FIXTURES, "targets/config.json"), actualPath: configPath },
        { id: "api2", name: "API v2", comparisonMethod: "json-deep-equal", tolerance: 1.0,
          baselinePath: join(FIXTURES, "targets/api-users.json"), actualPath: apiPath2 },
      ],
    };

    const state = runConvergenceLoop(config, 10, 30, (afterIteration) => {
      if (afterIteration === 1) {
        // Regress: break 2 previously passing targets
        copyFileSync(join(FIXTURES, "actual/api-users-v0.json"), apiPath);
        copyFileSync(join(FIXTURES, "actual/readme-v0.txt"), readmePath);
      }
    });

    expect(state.status).toBe("regression");
  });

  it("triggers budget exhaustion", () => {
    const actualPath = copyFixture("actual/api-users-v0.json", "api-users.json");
    const config = makeConfig({ "api-users": actualPath });

    // Budget of 2 — fires at iteration 2 (before stall can trigger at iteration 3)
    const state = runConvergenceLoop(config, 10, 2, () => {});

    expect(state.status).toBe("budget_exhausted");
    expect(state.totalAgentsSpawned).toBeGreaterThanOrEqual(2);
  });

  it("respects max iterations cap", () => {
    const actualPath = copyFixture("actual/api-users-v0.json", "api-users.json");
    const config = makeConfig({ "api-users": actualPath });

    // Max 2 iterations, never fix, high budget (budget won't trip first)
    // But stall will trip at iteration 2 since rate is 0 for both
    // To test max_iterations specifically, we need rate > 1% to avoid stall
    // Use two targets where we fix one per iteration but never all
    const actualPath2 = copyFixture("actual/readme-v0.txt", "readme.txt");
    const config2 = makeConfig({
      "api-users": actualPath,
      "readme": actualPath2,
    });

    // Fix one target per iteration (but there are 2 targets, so can't converge in 1)
    const state = runConvergenceLoop(config2, 1, 30, () => {});

    expect(state.status).toBe("max_iterations");
    expect(state.iteration).toBe(1);
  });

  it("writes convergence-state.toon after loop and round-trips correctly", () => {
    const actualPath = copyFixture("actual/api-users-v0.json", "api-users.json");
    const config = makeConfig({ "api-users": actualPath });

    const state = runConvergenceLoop(config, 10, 30, (afterIteration) => {
      if (afterIteration === 1) copyFileSync(join(FIXTURES, "actual/api-users-v1.json"), actualPath);
      if (afterIteration === 2) copyFileSync(join(FIXTURES, "actual/api-users-v2.json"), actualPath);
    });

    // Serialize and write
    const toon = serializeConvergenceState(state);
    const stateFile = join(tmpDir, "convergence-state.toon");
    writeFileSync(stateFile, toon);

    // Read back and parse
    const content = readFileSync(stateFile, "utf-8");
    const parsed = parseConvergenceState(content);

    expect(parsed.status).toBe(state.status);
    expect(parsed.iteration).toBe(state.iteration);
    expect(parsed.passing).toBe(state.passing);
    expect(parsed.failing).toBe(state.failing);
    expect(parsed.history.length).toBe(state.history.length);

    // Verify each history record
    for (let i = 0; i < state.history.length; i++) {
      expect(parsed.history[i].iteration).toBe(state.history[i].iteration);
      expect(parsed.history[i].passing).toBe(state.history[i].passing);
      expect(parsed.history[i].failing).toBe(state.history[i].failing);
    }
  });
});
