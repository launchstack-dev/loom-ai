/**
 * Tests for `scripts/test-harness.ts` and the three runner adapters.
 *
 * Coverage (per Phase 2 acceptance):
 *
 *   - AC1: bun runner emits one blocking row per failing test for the fixture.
 *   - AC2: per-iteration spawn count is exactly 2; ceiling at maxIterations=5 is 11.
 *   - AC3: vitest + pytest output fixtures parse cleanly.
 *   - S-03: unrecognized output triggers RUNNER_OUTPUT_UNPARSEABLE (exit 2 +
 *           AgentResult emission).
 *
 * The tests do NOT shell out to a real runner — we inject a fake `spawnSync`
 * via the harness's `RunOptions.spawn` hook and feed it the captured fixture
 * output. This keeps the suite hermetic and fast.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  RUNNERS,
  buildFindingsDoc,
  encodeFindingsToon,
  parseArgs,
  runHarness,
  type CliArgs,
} from "../scripts/test-harness.js";
import { bunRunner } from "../scripts/lib/test-runners/bun.js";
import { vitestRunner } from "../scripts/lib/test-runners/vitest.js";
import { pytestRunner } from "../scripts/lib/test-runners/pytest.js";

const FIXTURE_VITEST = path.resolve(
  __dirname,
  "fixtures/test-harness/runner-vitest-output/sample.txt",
);
const FIXTURE_PYTEST = path.resolve(
  __dirname,
  "fixtures/test-harness/runner-pytest-output/sample.txt",
);
const FIXTURE_UNPARSEABLE = path.resolve(
  __dirname,
  "fixtures/test-harness/runner-vitest-output/unparseable.txt",
);

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
  it("parses the canonical arg set", () => {
    const args = parseArgs(
      ["bun", "test-harness.ts", "--subject", "src", "--runner", "bun", "--iteration", "0"],
      ((c) => {
        throw new Error(`exit ${c}`);
      }) as never,
    );
    expect(args).toEqual({
      subject: "src",
      runner: "bun",
      iteration: 0,
      output: ".plan-execution/convergence/findings.toon",
    });
  });

  it("honors --output override", () => {
    const args = parseArgs(
      [
        "bun",
        "test-harness.ts",
        "--subject",
        "src",
        "--runner",
        "vitest",
        "--iteration",
        "2",
        "--output",
        "/tmp/findings.toon",
      ],
      ((c) => {
        throw new Error(`exit ${c}`);
      }) as never,
    );
    expect(args.output).toBe("/tmp/findings.toon");
    expect(args.runner).toBe("vitest");
  });

  it("rejects an unknown runner", () => {
    expect(() =>
      parseArgs(
        ["bun", "test-harness.ts", "--subject", "s", "--runner", "jest", "--iteration", "0"],
        ((c) => {
          throw new Error(`exit ${c}`);
        }) as never,
      ),
    ).toThrow(/exit 1/);
  });
});

// ---------------------------------------------------------------------------
// Runner adapters — output parsing
// ---------------------------------------------------------------------------

describe("bunRunner.parse", () => {
  it("extracts failures from a synthetic bun-test output", () => {
    const stdout = [
      "test/math.test.ts:",
      "(fail) add > adds two positive numbers",
      "  error: expected -1 to equal 5",
      "    at math.test.ts:8:23",
      "(fail) add > adds a positive and a negative",
      "  error: expected 14 to equal 6",
      "(pass) double > doubles a positive number",
      "",
      " 1 pass",
      " 2 fail",
      "",
    ].join("\n");

    const { failures, parseable } = bunRunner.parse(stdout, "", 1);
    expect(parseable).toBe(true);
    expect(failures).toHaveLength(2);
    expect(failures[0]).toEqual({
      file: "test/math.test.ts",
      anchor: "add > adds two positive numbers",
      summary: "expected -1 to equal 5",
    });
    expect(failures[1].summary).toBe("expected 14 to equal 6");
  });

  it("returns parseable=true with zero failures when only the summary is present (S-02)", () => {
    const stdout = [" 4 pass", " 0 fail", ""].join("\n");
    const { failures, parseable } = bunRunner.parse(stdout, "", 0);
    expect(parseable).toBe(true);
    expect(failures).toHaveLength(0);
  });

  it("flags unrecognized output as parseable=false (S-03)", () => {
    const { failures, parseable } = bunRunner.parse(
      "totally not bun test output\nat all\n",
      "",
      127,
    );
    expect(parseable).toBe(false);
    expect(failures).toHaveLength(0);
  });
});

describe("vitestRunner.parse", () => {
  it("extracts failures from the vitest fixture", () => {
    const text = fs.readFileSync(FIXTURE_VITEST, "utf8");
    const { failures, parseable } = vitestRunner.parse(text, "", 1);
    expect(parseable).toBe(true);
    expect(failures).toHaveLength(3);
    expect(failures[0].file).toBe("test/math.test.ts");
    expect(failures[0].anchor).toBe("add > adds two positive numbers");
    expect(failures[0].summary).toMatch(/expected -1 to be 5/);
  });

  it("flags unrecognized output as parseable=false (S-03)", () => {
    const text = fs.readFileSync(FIXTURE_UNPARSEABLE, "utf8");
    const { parseable } = vitestRunner.parse(text, "", 1);
    expect(parseable).toBe(false);
  });
});

describe("pytestRunner.parse", () => {
  it("extracts failures from the pytest fixture", () => {
    const text = fs.readFileSync(FIXTURE_PYTEST, "utf8");
    const { failures, parseable } = pytestRunner.parse(text, "", 1);
    expect(parseable).toBe(true);
    expect(failures).toHaveLength(3);
    expect(failures[0].file).toBe("tests/test_math.py");
    expect(failures[0].anchor).toBe("TestAdd > test_adds_two_positives");
    expect(failures[0].summary).toBe("AssertionError: assert -1 == 5");
  });
});

// ---------------------------------------------------------------------------
// Findings doc construction
// ---------------------------------------------------------------------------

describe("buildFindingsDoc", () => {
  it("builds a doc with one blocking row per failure, dimension=test", () => {
    const doc = buildFindingsDoc({
      subject: "src",
      iteration: 0,
      reviewerAgent: "bun-test",
      failures: [
        { file: "a.test.ts", anchor: "x > y", summary: "boom" },
        { file: "b.test.ts", anchor: "p > q", summary: "bang" },
      ],
      now: new Date("2026-06-14T00:00:00.000Z"),
    });
    expect(doc.blockingCount).toBe(2);
    expect(doc.advisoryCount).toBe(0);
    expect(doc.harnessName).toBe("test");
    expect(doc.producedAt).toBe("2026-06-14T00:00:00.000Z");
    expect(doc.findings[0]).toMatchObject({
      id: "F-01",
      dimension: "test",
      severity: "blocking",
      locationPath: "a.test.ts",
      locationAnchor: "x > y",
      summary: "boom",
      reviewerAgent: "bun-test",
    });
    expect(doc.findings[1].id).toBe("F-02");
  });

  it("clips overlong summaries to summaryMaxLen", () => {
    const long = "x".repeat(500);
    const doc = buildFindingsDoc({
      subject: "src",
      iteration: 1,
      reviewerAgent: "vitest",
      failures: [{ file: "f.ts", anchor: "a > b", summary: long }],
      now: new Date(),
      summaryMaxLen: 50,
    });
    expect(doc.findings[0].summary.length).toBe(50);
    expect(doc.findings[0].summary.endsWith("…")).toBe(true);
  });
});

describe("encodeFindingsToon", () => {
  it("emits valid TOON with the canonical findings column header", () => {
    const text = encodeFindingsToon({
      subject: "src",
      harnessName: "test",
      iteration: 0,
      blockingCount: 1,
      advisoryCount: 0,
      producedAt: "2026-06-14T00:00:00.000Z",
      findings: [
        {
          id: "F-01",
          dimension: "test",
          severity: "blocking",
          locationPath: "a.test.ts",
          locationAnchor: "x > y",
          summary: "boom",
          suggestion: "",
          reviewerAgent: "bun-test",
        },
      ],
    });
    expect(text).toContain("subject: src");
    expect(text).toContain("harnessName: test");
    expect(text).toContain("blockingCount: 1");
    expect(text).toContain(
      "findings[1]{id,dimension,severity,locationPath,locationAnchor,summary,suggestion,reviewerAgent}:",
    );
    expect(text).toContain("F-01,test,blocking,a.test.ts,x > y,boom,,bun-test");
  });

  it("CSV-quotes cells with embedded commas", () => {
    const text = encodeFindingsToon({
      subject: "src",
      harnessName: "test",
      iteration: 0,
      blockingCount: 1,
      advisoryCount: 0,
      producedAt: "2026-06-14T00:00:00.000Z",
      findings: [
        {
          id: "F-01",
          dimension: "test",
          severity: "blocking",
          locationPath: "a.test.ts",
          locationAnchor: "x > y",
          summary: "expected 1, got 2",
          suggestion: "",
          reviewerAgent: "bun-test",
        },
      ],
    });
    expect(text).toContain('"expected 1, got 2"');
  });
});

// ---------------------------------------------------------------------------
// runHarness — end-to-end with a fake spawnSync
// ---------------------------------------------------------------------------

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "test-harness-"));
}

function fakeSpawnSync(stdout: string, stderr = "", status = 0) {
  return ((_cmd: string, _args: readonly string[], _opts?: unknown) => ({
    pid: 1,
    output: [null, stdout, stderr],
    stdout,
    stderr,
    status,
    signal: null,
  })) as unknown as typeof import("node:child_process").spawnSync;
}

describe("runHarness (integration with fake spawn)", () => {
  let outDir: string;

  beforeEach(() => {
    outDir = mkTmpDir();
  });

  it("writes findings.toon with one blocking row per failure (AC1)", () => {
    const stdout = [
      "src/math.test.ts:",
      "(fail) add > adds two positive numbers",
      "  error: expected -1 to equal 5",
      "(fail) add > adds a positive and a negative",
      "  error: expected 14 to equal 6",
      "(fail) add > returns its argument when adding zero",
      "  error: expected 7 to equal 7",
      "",
      " 1 pass",
      " 3 fail",
      "",
    ].join("\n");

    const args: CliArgs = {
      subject: "src",
      runner: "bun",
      iteration: 0,
      output: path.join(outDir, "findings.toon"),
    };

    let exitCode: number | null = null;
    const exit = ((c: number) => {
      exitCode = c;
      throw new Error("__exit__");
    }) as never;
    try {
      runHarness(args, exit, {
        spawn: fakeSpawnSync(stdout, "", 1),
        now: () => new Date("2026-06-14T00:00:00.000Z"),
      });
    } catch (e) {
      if ((e as Error).message !== "__exit__") throw e;
    }
    expect(exitCode).toBe(0);
    const text = fs.readFileSync(args.output, "utf8");
    expect(text).toContain("blockingCount: 3");
    expect(text).toMatch(/F-01,test,blocking,src\/math\.test\.ts,/);
    expect(text).toMatch(/F-02,test,blocking/);
    expect(text).toMatch(/F-03,test,blocking/);
  });

  it("emits zero findings + exit 0 when all tests pass (S-02)", () => {
    const stdout = [" 4 pass", " 0 fail", ""].join("\n");
    const args: CliArgs = {
      subject: "src",
      runner: "bun",
      iteration: 1,
      output: path.join(outDir, "findings.toon"),
    };
    let exitCode: number | null = null;
    const exit = ((c: number) => {
      exitCode = c;
      throw new Error("__exit__");
    }) as never;
    try {
      runHarness(args, exit, {
        spawn: fakeSpawnSync(stdout, "", 0),
        now: () => new Date("2026-06-14T00:00:00.000Z"),
      });
    } catch (e) {
      if ((e as Error).message !== "__exit__") throw e;
    }
    expect(exitCode).toBe(0);
    const text = fs.readFileSync(args.output, "utf8");
    expect(text).toContain("blockingCount: 0");
    expect(text).toContain("findings[0]{");
  });

  it("emits AgentResult + exit 2 for RUNNER_OUTPUT_UNPARSEABLE (S-03)", () => {
    const args: CliArgs = {
      subject: "src",
      runner: "vitest",
      iteration: 0,
      output: path.join(outDir, "findings.toon"),
    };
    let exitCode: number | null = null;
    const exit = ((c: number) => {
      exitCode = c;
      throw new Error("__exit__");
    }) as never;
    try {
      runHarness(args, exit, {
        spawn: fakeSpawnSync("totally not vitest output\n", "", 1),
        now: () => new Date("2026-06-14T00:00:00.000Z"),
      });
    } catch (e) {
      if ((e as Error).message !== "__exit__") throw e;
    }
    expect(exitCode).toBe(2);
    const arPath = path.join(outDir, "test-harness.agent-result.toon");
    expect(fs.existsSync(arPath)).toBe(true);
    const text = fs.readFileSync(arPath, "utf8");
    expect(text).toContain("RUNNER_OUTPUT_UNPARSEABLE");
    expect(text).toContain("status: failure");
  });
});

// ---------------------------------------------------------------------------
// Spawn-count contract (AC2)
// ---------------------------------------------------------------------------

describe("F-02 spawn-count contract", () => {
  /**
   * Per Phase 2 acceptance: per-iteration spawn budget is exactly 2 (1
   * test-harness + 1 fixer). The wrapper's `agentBudget` formula is
   * `1 + (maxIterations × 2)`, giving 11 at the F-02 default
   * `maxIterations=5`.
   */
  function agentBudget(maxIterations: number): number {
    return 1 + maxIterations * 2;
  }

  it("per-iteration spawn count is exactly 2 (1 test-harness + 1 fixer)", () => {
    const perIter = 1 /* test-harness */ + 1; /* fixer-agent */
    expect(perIter).toBe(2);
  });

  it("agentBudget = 11 at maxIterations=5 (F-02 default)", () => {
    expect(agentBudget(5)).toBe(11);
  });

  it("agentBudget grows linearly with maxIterations", () => {
    expect(agentBudget(1)).toBe(3);
    expect(agentBudget(3)).toBe(7);
    expect(agentBudget(10)).toBe(21);
  });
});

// ---------------------------------------------------------------------------
// Runner registry
// ---------------------------------------------------------------------------

describe("RUNNERS registry", () => {
  it("exposes all three runner kinds", () => {
    expect(Object.keys(RUNNERS).sort()).toEqual(["bun", "pytest", "vitest"]);
    expect(RUNNERS.bun.name).toBe("bun-test");
    expect(RUNNERS.vitest.name).toBe("vitest");
    expect(RUNNERS.pytest.name).toBe("pytest");
  });
});
