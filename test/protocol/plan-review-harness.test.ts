/**
 * Integration tests for `scripts/plan-review-harness.ts`.
 *
 * The aggregator is exhaustively tested as a pure function in
 * `aggregate-findings.test.ts`; this file exercises the harness's I/O wiring:
 * config reading, agent-result file parsing, two-mode dispatch (spawn-request
 * vs aggregate), atomic write to findings.toon, and partial-failure UX.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  parseArgs,
  readConvergeConfig,
  readAgentModel,
  readAgentResultEnvelope,
  buildSpawnRequest,
  collectEnvelopes,
  atomicWriteFile,
  REVIEWER_AGENT_FILES,
  main,
} from "../../scripts/plan-review-harness.js";

import {
  encodeSpawnRequestToToon,
} from "../../hooks/lib/spawn-agent.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(absPath: string, content: string): void {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content);
}

/** Mock AgentResult envelope encoder for tests. */
function encodeAgentResult(args: {
  agent: string;
  status: "success" | "failure" | "partial";
  issues?: Array<{
    severity: string;
    description: string;
    file?: string;
    location?: string;
    suggestion?: string;
  }>;
}): string {
  const { agent, status, issues = [] } = args;
  const head = [
    `agent: ${agent}`,
    `wave: 0`,
    `taskId: t-${agent}`,
    `status: ${status}`,
    `filesCreated[0]:`,
    `filesModified[0]:`,
    `filesDeleted[0]:`,
    `exportsAdded[0]{file,name,kind}:`,
    `dependenciesAdded[0]:`,
    `integrationNotes: synthetic`,
  ];

  if (issues.length === 0) {
    head.push(`issues[0]{severity,description,file,line}:`);
  } else {
    head.push(
      `issues[${issues.length}]{severity,description,file,location,suggestion}:`,
    );
    for (const i of issues) {
      const cells = [
        i.severity,
        csvQuote(i.description),
        csvQuote(i.file ?? ""),
        csvQuote(i.location ?? ""),
        csvQuote(i.suggestion ?? ""),
      ].join(",");
      head.push(`  ${cells}`);
    }
  }

  head.push(`contractAmendments[0]{file,issue}:`);
  head.push(`crossBoundaryRequests[0]{file,reason,suggestedChange}:`);
  head.push(`durationMs: 0`);
  head.push("");
  return head.join("\n");
}

function csvQuote(raw: string): string {
  if (raw === "") return "";
  if (/[,\n"]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
  it("parses --config, --iteration, and --results-dir", () => {
    const args = parseArgs([
      "bun",
      "scripts/plan-review-harness.ts",
      "--config",
      "converge.config",
      "--iteration",
      "2",
      "--results-dir",
      "/tmp/results",
    ]);
    expect(args.configPath).toBe("converge.config");
    expect(args.iteration).toBe(2);
    expect(args.resultsDir).toBe("/tmp/results");
  });

  it("exits 1 when --config is missing", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`EXIT:${code}`);
    }) as never);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      expect(() =>
        parseArgs(["bun", "scripts/plan-review-harness.ts", "--iteration", "1"]),
      ).toThrow("EXIT:1");
    } finally {
      exitSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  });

  it("exits 1 when --iteration is missing", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`EXIT:${code}`);
    }) as never);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      expect(() =>
        parseArgs([
          "bun",
          "scripts/plan-review-harness.ts",
          "--config",
          "foo",
        ]),
      ).toThrow("EXIT:1");
    } finally {
      exitSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  });

  it("exits 1 when --iteration is not a positive integer", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`EXIT:${code}`);
    }) as never);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      expect(() =>
        parseArgs([
          "bun",
          "scripts/plan-review-harness.ts",
          "--config",
          "foo",
          "--iteration",
          "0",
        ]),
      ).toThrow("EXIT:1");
    } finally {
      exitSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// readConvergeConfig
// ---------------------------------------------------------------------------

describe("readConvergeConfig", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir("loom-harness-config-");
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("reads subject and outputPath from a valid config", () => {
    const cfgPath = path.join(tmp, "converge.config");
    fs.writeFileSync(
      cfgPath,
      [
        "convergenceMode: document",
        "subject: planning/PLAN.md",
        "harness: scripts/plan-review-harness.ts",
        "outputPath: .plan-execution/convergence/findings.toon",
        "maxIterations: 3",
        "agentBudget: 30",
        "",
      ].join("\n"),
    );

    const cfg = readConvergeConfig(cfgPath);
    expect(cfg.subject).toBe("planning/PLAN.md");
    expect(cfg.outputPath).toBe(".plan-execution/convergence/findings.toon");
    expect(cfg.convergenceMode).toBe("document");
  });

  it("defaults outputPath to the canonical location when absent", () => {
    const cfgPath = path.join(tmp, "converge.config");
    fs.writeFileSync(cfgPath, "subject: planning/PLAN.md\n");
    const cfg = readConvergeConfig(cfgPath);
    expect(cfg.outputPath).toBe(".plan-execution/convergence/findings.toon");
  });
});

// ---------------------------------------------------------------------------
// readAgentModel
// ---------------------------------------------------------------------------

describe("readAgentModel", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir("loom-harness-agent-");
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("extracts model from frontmatter", () => {
    const file = path.join(tmp, "some-agent.md");
    fs.writeFileSync(
      file,
      ["---", "name: some-agent", "model: sonnet", "---", "body"].join("\n"),
    );
    expect(readAgentModel(file)).toBe("sonnet");
  });

  it("returns 'inherit' for missing files", () => {
    expect(readAgentModel(path.join(tmp, "does-not-exist.md"))).toBe("inherit");
  });

  it("returns 'inherit' when there is no model field", () => {
    const file = path.join(tmp, "no-model.md");
    fs.writeFileSync(file, "---\nname: foo\n---\nbody\n");
    expect(readAgentModel(file)).toBe("inherit");
  });
});

// ---------------------------------------------------------------------------
// readAgentResultEnvelope
// ---------------------------------------------------------------------------

describe("readAgentResultEnvelope", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir("loom-harness-envelope-");
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("parses an envelope with a non-empty issues table", () => {
    const filePath = path.join(tmp, "envelope.toon");
    fs.writeFileSync(
      filePath,
      encodeAgentResult({
        agent: "feature-coverage-reviewer-agent",
        status: "success",
        issues: [
          {
            severity: "high",
            description: "missing API surface",
            file: "planning/PLAN.md",
            location: "##Overview",
            suggestion: "list endpoints",
          },
        ],
      }),
    );

    const env = readAgentResultEnvelope(filePath);
    expect(env).not.toBeNull();
    expect(env!.agent).toBe("feature-coverage-reviewer-agent");
    expect(env!.status).toBe("success");
    expect(env!.issues!.length).toBe(1);
    expect(env!.issues![0].severity).toBe("high");
    expect(env!.issues![0].file).toBe("planning/PLAN.md");
    expect(env!.issues![0].location).toBe("##Overview");
  });

  it("parses an empty issues array", () => {
    const filePath = path.join(tmp, "empty.toon");
    fs.writeFileSync(
      filePath,
      encodeAgentResult({
        agent: "phasing-reviewer-agent",
        status: "success",
        issues: [],
      }),
    );
    const env = readAgentResultEnvelope(filePath);
    expect(env).not.toBeNull();
    expect(env!.issues).toEqual([]);
  });

  it("returns null for non-existent files", () => {
    expect(readAgentResultEnvelope(path.join(tmp, "ghost.toon"))).toBeNull();
  });

  it("tolerates the 'failed' status alias and maps it to 'failure'", () => {
    const filePath = path.join(tmp, "failed.toon");
    fs.writeFileSync(
      filePath,
      encodeAgentResult({
        agent: "ux-reviewer-agent",
        status: "success", // base
      }).replace("status: success", "status: failed"),
    );
    const env = readAgentResultEnvelope(filePath);
    expect(env!.status).toBe("failure");
  });

  // Regression: Smoke 2 Finding A (2026-06-13) — the validator at line 433
  // only accepted the classic severity ladder, so reviewer-emitted
  // `severity: warning` and `severity: blocking` rows were dropped at parse
  // time with a stderr warning. Real reviewer-emit envelopes use the
  // convergence-aligned enum. These tests assert the validator accepts both
  // enums end-to-end (parse + pass through to aggregator).
  it("accepts severity: blocking from reviewer envelopes (Smoke 2 Finding A regression)", () => {
    const filePath = path.join(tmp, "blocking.toon");
    fs.writeFileSync(
      filePath,
      encodeAgentResult({
        agent: "feature-coverage-reviewer-agent",
        status: "success",
        issues: [
          {
            severity: "blocking",
            description: "missing scenario coverage on F-01",
            file: "planning/PLAN.md",
          },
        ],
      }),
    );
    const env = readAgentResultEnvelope(filePath);
    expect(env).not.toBeNull();
    expect(env!.issues!.length).toBe(1);
    expect(env!.issues![0].severity).toBe("blocking");
  });

  it("accepts severity: warning from reviewer envelopes (Smoke 2 Finding A regression)", () => {
    const filePath = path.join(tmp, "warning.toon");
    fs.writeFileSync(
      filePath,
      encodeAgentResult({
        agent: "agentic-workflow-reviewer-agent",
        status: "success",
        issues: [
          {
            severity: "warning",
            description: "Phase 1 stdout-assertion gap",
            file: "planning/PLAN.md",
          },
        ],
      }),
    );
    const env = readAgentResultEnvelope(filePath);
    expect(env).not.toBeNull();
    expect(env!.issues!.length).toBe(1);
    expect(env!.issues![0].severity).toBe("warning");
  });

  it("accepts a mixed envelope with both classic-ladder and convergence-aligned severities", () => {
    const filePath = path.join(tmp, "mixed.toon");
    fs.writeFileSync(
      filePath,
      encodeAgentResult({
        agent: "strategy-reviewer-agent",
        status: "success",
        issues: [
          { severity: "blocking", description: "convergence-aligned blocker" },
          { severity: "critical", description: "classic-ladder blocker" },
          { severity: "warning", description: "convergence-aligned warning" },
          { severity: "medium", description: "classic-ladder warning" },
          { severity: "info", description: "shared info" },
        ],
      }),
    );
    const env = readAgentResultEnvelope(filePath);
    expect(env).not.toBeNull();
    expect(env!.issues!.length).toBe(5);
    const severities = env!.issues!.map((i) => i.severity);
    expect(severities).toEqual([
      "blocking",
      "critical",
      "warning",
      "medium",
      "info",
    ]);
  });
});

// ---------------------------------------------------------------------------
// buildSpawnRequest
// ---------------------------------------------------------------------------

describe("buildSpawnRequest", () => {
  it("includes 6 spawns in canonical order and a deterministic rerunCommand", () => {
    const req = buildSpawnRequest({
      configPath: "converge.config",
      subject: "planning/PLAN.md",
      resultDir: ".plan-execution/convergence/reviewer-results",
      iteration: 2,
      now: new Date("2026-06-13T10:00:00.000Z"),
    });
    expect(req.spawns.length).toBe(6);
    expect(req.spawns.map((s) => s.agentName)).toEqual(
      REVIEWER_AGENT_FILES.map((r) => r.reviewerAgent),
    );
    expect(req.spawns.every((s) => s.subject === "planning/PLAN.md")).toBe(true);
    expect(req.rerunCommand).toContain("bun run scripts/plan-review-harness.ts");
    expect(req.rerunCommand).toContain("--config converge.config");
    expect(req.rerunCommand).toContain("--iteration 2");
    expect(req.rerunCommand).toContain(
      "--results-dir .plan-execution/convergence/reviewer-results",
    );
    expect(req.createdAt).toBe("2026-06-13T10:00:00.000Z");
    expect(req.requestedBy).toBe("scripts/plan-review-harness.ts");
  });
});

// ---------------------------------------------------------------------------
// encodeSpawnRequestToToon
// ---------------------------------------------------------------------------

describe("encodeSpawnRequestToToon", () => {
  it("emits a valid TOON document with required header fields and the spawns table", () => {
    const text = encodeSpawnRequestToToon({
      requestId: "abc-1234",
      requestedBy: "scripts/plan-review-harness.ts",
      createdAt: "2026-06-13T10:00:00.000Z",
      resultDir: "/tmp/r",
      rerunCommand: "bun run scripts/plan-review-harness.ts --config foo",
      spawns: [
        {
          agentName: "feature-coverage-reviewer-agent",
          agentFile: "agents/feature-coverage-agent.md",
          model: "sonnet",
          subject: "planning/PLAN.md",
        },
      ],
    });
    expect(text).toContain("requestId: abc-1234");
    expect(text).toContain("createdAt: 2026-06-13T10:00:00.000Z");
    expect(text).toContain(
      "spawns[1]{agentName,agentFile,model,subject,extraInputs}:",
    );
    expect(text).toContain("feature-coverage-reviewer-agent");
    expect(text).toContain("sonnet");
  });
});

// ---------------------------------------------------------------------------
// collectEnvelopes
// ---------------------------------------------------------------------------

describe("collectEnvelopes", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir("loom-harness-collect-");
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("reports missing reviewers when only some envelopes are present", () => {
    // Write only 3 of 6.
    for (const r of REVIEWER_AGENT_FILES.slice(0, 3)) {
      writeFile(
        path.join(tmp, `${r.reviewerAgent}.toon`),
        encodeAgentResult({ agent: r.reviewerAgent, status: "success" }),
      );
    }
    const result = collectEnvelopes(tmp);
    expect(result.envelopes.length).toBe(3);
    expect(result.missing.length).toBe(3);
    expect(result.failed.length).toBe(0);
  });

  it("normalizes the agent field to the schema-side name", () => {
    // Write an envelope using the file-side name (no `-reviewer-` infix);
    // collectEnvelopes should rewrite it to the canonical schema-side name.
    writeFile(
      path.join(tmp, "feature-coverage-reviewer-agent.toon"),
      encodeAgentResult({
        agent: "feature-coverage-agent", // file-side name
        status: "success",
      }),
    );
    const result = collectEnvelopes(tmp);
    expect(result.envelopes.length).toBe(1);
    expect(result.envelopes[0].agent).toBe("feature-coverage-reviewer-agent");
  });

  it("flags envelopes with status=failure in the failed list", () => {
    writeFile(
      path.join(tmp, "strategy-reviewer-agent.toon"),
      encodeAgentResult({
        agent: "strategy-reviewer-agent",
        status: "failure",
      }),
    );
    const result = collectEnvelopes(tmp);
    expect(result.failed).toEqual(["strategy-reviewer-agent"]);
  });
});

// ---------------------------------------------------------------------------
// atomicWriteFile
// ---------------------------------------------------------------------------

describe("atomicWriteFile", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir("loom-harness-atomic-");
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("creates parent directories and leaves no .tmp behind on success", () => {
    const target = path.join(tmp, "nested", "out", "findings.toon");
    atomicWriteFile(target, "hello\n");
    expect(fs.readFileSync(target, "utf8")).toBe("hello\n");
    expect(fs.existsSync(`${target}.tmp`)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// main() end-to-end (synthetic sandbox)
// ---------------------------------------------------------------------------

describe("main() — aggregate mode", () => {
  let sandbox: string;
  let originalCwd: string;

  beforeEach(() => {
    sandbox = makeTempDir("loom-harness-main-");
    originalCwd = process.cwd();
    process.chdir(sandbox);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  it("aggregates 6 envelopes and writes findings.toon when --results-dir contains all 6 envelopes", () => {
    // Write a converge.config.
    fs.writeFileSync(
      path.join(sandbox, "converge.config"),
      [
        "convergenceMode: document",
        "subject: planning/PLAN.md",
        "harness: scripts/plan-review-harness.ts",
        "outputPath: .plan-execution/convergence/findings.toon",
        "",
      ].join("\n"),
    );

    // Write the subject (just for realism; harness doesn't read it).
    writeFile(path.join(sandbox, "planning/PLAN.md"), "# plan\n");

    // Write 6 envelopes; only feature-coverage emits a finding.
    const resultsDir = path.join(
      sandbox,
      ".plan-execution/convergence/reviewer-results",
    );
    for (const r of REVIEWER_AGENT_FILES) {
      const issues =
        r.reviewerAgent === "feature-coverage-reviewer-agent"
          ? [
              {
                severity: "critical",
                description: "missing endpoint",
                file: "planning/PLAN.md",
                location: "##API",
              },
            ]
          : [];
      writeFile(
        path.join(resultsDir, `${r.reviewerAgent}.toon`),
        encodeAgentResult({
          agent: r.reviewerAgent,
          status: "success",
          issues,
        }),
      );
    }

    // Capture stderr.
    const stderrChunks: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderrChunks.push(String(chunk));
      return true;
    });
    // Stub process.exit to capture the code without halting the test runner.
    let exitCode: number | null = null;
    const exitStub = ((code: number) => {
      exitCode = code;
      return undefined as never;
    });

    try {
      main(
        [
          "bun",
          "scripts/plan-review-harness.ts",
          "--config",
          "converge.config",
          "--iteration",
          "1",
          "--results-dir",
          ".plan-execution/convergence/reviewer-results",
        ],
        exitStub as (code: number) => never,
      );
    } finally {
      stderrSpy.mockRestore();
    }
    expect(exitCode).toBe(0);

    const findingsPath = path.join(
      sandbox,
      ".plan-execution/convergence/findings.toon",
    );
    expect(fs.existsSync(findingsPath)).toBe(true);
    const content = fs.readFileSync(findingsPath, "utf8");
    expect(content).toContain("subject: planning/PLAN.md");
    expect(content).toContain("harnessName: plan-review");
    expect(content).toContain("blockingCount: 1");
    expect(content).toContain("advisoryCount: 0");
    expect(content).toContain("feature-coverage-reviewer-agent");
    expect(content).toContain("F-01");
  });

  it("emits a stderr warning naming the failed reviewer (partial-failure UX) and still exits 0", () => {
    fs.writeFileSync(
      path.join(sandbox, "converge.config"),
      "convergenceMode: document\nsubject: planning/PLAN.md\n",
    );
    writeFile(path.join(sandbox, "planning/PLAN.md"), "# plan\n");

    const resultsDir = path.join(
      sandbox,
      ".plan-execution/convergence/reviewer-results",
    );
    for (const r of REVIEWER_AGENT_FILES) {
      const status =
        r.reviewerAgent === "ux-reviewer-agent" ? "failure" : "success";
      writeFile(
        path.join(resultsDir, `${r.reviewerAgent}.toon`),
        encodeAgentResult({
          agent: r.reviewerAgent,
          status,
        }),
      );
    }

    const stderrChunks: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderrChunks.push(String(chunk));
      return true;
    });
    let exitCode: number | null = null;
    const exitStub = ((code: number) => {
      exitCode = code;
      return undefined as never;
    });
    try {
      main(
        [
          "bun",
          "scripts/plan-review-harness.ts",
          "--config",
          "converge.config",
          "--iteration",
          "1",
          "--results-dir",
          ".plan-execution/convergence/reviewer-results",
        ],
        exitStub as (code: number) => never,
      );
    } finally {
      stderrSpy.mockRestore();
    }

    expect(exitCode).toBe(0);
    const joinedStderr = stderrChunks.join("");
    expect(joinedStderr).toContain("ux-reviewer-agent");
    expect(joinedStderr).toContain("status=failed");
  });

  it("writes spawn-request.toon when --results-dir does not contain all 6 envelopes", () => {
    fs.writeFileSync(
      path.join(sandbox, "converge.config"),
      "convergenceMode: document\nsubject: planning/PLAN.md\n",
    );

    // Empty results directory.
    const resultsDir = path.join(
      sandbox,
      ".plan-execution/convergence/reviewer-results",
    );
    fs.mkdirSync(resultsDir, { recursive: true });

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let exitCode: number | null = null;
    const exitStub = ((code: number) => {
      exitCode = code;
      return undefined as never;
    });
    try {
      main(
        [
          "bun",
          "scripts/plan-review-harness.ts",
          "--config",
          "converge.config",
          "--iteration",
          "1",
          "--results-dir",
          ".plan-execution/convergence/reviewer-results",
        ],
        exitStub as (code: number) => never,
      );
    } finally {
      stderrSpy.mockRestore();
    }

    expect(exitCode).toBe(0);
    const reqPath = path.join(
      sandbox,
      ".plan-execution/convergence/spawn-request.toon",
    );
    expect(fs.existsSync(reqPath)).toBe(true);
    const reqContent = fs.readFileSync(reqPath, "utf8");
    expect(reqContent).toContain("requestId: ");
    expect(reqContent).toContain(
      "spawns[6]{agentName,agentFile,model,subject,extraInputs}:",
    );
    expect(reqContent).toContain("feature-coverage-reviewer-agent");
    expect(reqContent).toContain("agentic-workflow-reviewer-agent");
    expect(reqContent).toContain("--results-dir");

    // findings.toon must NOT have been written in spawn-request mode.
    const findingsPath = path.join(
      sandbox,
      ".plan-execution/convergence/findings.toon",
    );
    expect(fs.existsSync(findingsPath)).toBe(false);
  });
});

// Re-import vitest globals for vi.spyOn (vitest config sets globals: true).
import { vi } from "vitest";
