/**
 * Integration tests for `scripts/code-review-harness.ts` (F-01).
 *
 * Mirrors `test/protocol/plan-review-harness.test.ts` in structure; exercises
 * the harness's I/O wiring (arg parsing, envelope parsing, two-mode dispatch,
 * atomic write, partial failure UX) and the F-01 aggregator.
 *
 * The end-to-end `--autoconverge` test (S-02) depends on Phase 4
 * (fixer-agent Integrator Mode) shipping. Until then it is skipped via the
 * `PHASE_4_SHIPPED` env flag; verification-agent will re-run it once Phase 4
 * artifacts land.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  parseArgs,
  readConvergeConfig,
  readAgentResultEnvelope,
  buildSpawnRequest,
  collectEnvelopes,
  atomicWriteFile,
  CODE_REVIEWER_AGENTS,
  main,
} from "../scripts/code-review-harness.js";

import {
  aggregateCodeReviewFindings,
  encodeCodeReviewFindingsToToon,
  CODE_REVIEW_DIMENSION,
} from "../scripts/lib/code-review-harness/spawn-reviewers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function throwingExit(code: number): never {
  throw new Error(`EXIT:${code}`);
}

function writeFile(absPath: string, content: string): void {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content);
}

function csvQuote(raw: string): string {
  if (raw === "") return "";
  if (/[,\n"]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

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
  const out = [
    `agent: ${agent}`,
    `wave: 1`,
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
    out.push(`issues[0]{severity,description,file,line}:`);
  } else {
    out.push(
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
      out.push(`  ${cells}`);
    }
  }
  out.push(`contractAmendments[0]{file,issue}:`);
  out.push(`crossBoundaryRequests[0]{file,reason,suggestedChange}:`);
  out.push(`durationMs: 0`);
  out.push("");
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// CODE_REVIEWER_AGENTS registry
// ---------------------------------------------------------------------------

describe("CODE_REVIEWER_AGENTS registry", () => {
  it("registers at least 9 reviewers (matches /loom-code review --full fan-out)", () => {
    expect(CODE_REVIEWER_AGENTS.length).toBeGreaterThanOrEqual(9);
  });

  it("includes the 3 bespoke reviewers with on-disk agent files", () => {
    const names = CODE_REVIEWER_AGENTS.map((r) => r.reviewerAgent);
    expect(names).toContain("security-reviewer");
    expect(names).toContain("architecture-reviewer");
    expect(names).toContain("plan-compliance-reviewer");
  });

  it("flags built-in reviewers with builtin=true and empty agentFile", () => {
    const builtins = CODE_REVIEWER_AGENTS.filter((r) => r.builtin);
    expect(builtins.length).toBeGreaterThan(0);
    for (const b of builtins) {
      expect(b.agentFile).toBe("");
    }
  });
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
  it("parses --subject, --iteration, --output, --results-dir", () => {
    const args = parseArgs(
      [
        "bun",
        "scripts/code-review-harness.ts",
        "--subject",
        "src/foo.ts",
        "--iteration",
        "1",
        "--output",
        "/tmp/findings.toon",
        "--results-dir",
        "/tmp/results",
      ],
      throwingExit,
    );
    expect(args.subject).toBe("src/foo.ts");
    expect(args.iteration).toBe(1);
    expect(args.outputPath).toBe("/tmp/findings.toon");
    expect(args.resultsDir).toBe("/tmp/results");
  });

  it("accepts --iteration 0 (standalone smoke test)", () => {
    const args = parseArgs(
      [
        "bun",
        "scripts/code-review-harness.ts",
        "--subject",
        "src/foo.ts",
        "--iteration",
        "0",
      ],
      throwingExit,
    );
    expect(args.iteration).toBe(0);
  });

  it("exits 1 when --iteration is missing", () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      expect(() =>
        parseArgs(
          [
            "bun",
            "scripts/code-review-harness.ts",
            "--subject",
            "src/foo.ts",
          ],
          throwingExit,
        ),
      ).toThrow("EXIT:1");
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("exits 1 when --iteration is negative", () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      expect(() =>
        parseArgs(
          [
            "bun",
            "scripts/code-review-harness.ts",
            "--subject",
            "src/foo.ts",
            "--iteration",
            "-1",
          ],
          throwingExit,
        ),
      ).toThrow("EXIT:1");
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("exits 1 when neither --subject nor --config is provided", () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      expect(() =>
        parseArgs(
          ["bun", "scripts/code-review-harness.ts", "--iteration", "1"],
          throwingExit,
        ),
      ).toThrow("EXIT:1");
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("rejects bare positional arguments", () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      expect(() =>
        parseArgs(
          [
            "bun",
            "scripts/code-review-harness.ts",
            "--subject",
            "src/foo.ts",
            "--iteration",
            "1",
            "stray",
          ],
          throwingExit,
        ),
      ).toThrow("EXIT:1");
    } finally {
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
    tmp = makeTempDir("code-review-config-");
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("reads subject and outputDir from a valid converge.config", () => {
    const cfgPath = path.join(tmp, "converge.config");
    fs.writeFileSync(
      cfgPath,
      [
        "convergenceMode: document",
        "subject: src/foo.ts",
        "harness: scripts/code-review-harness.ts",
        "integrator: fixer-agent",
        "maxIterations: 3",
        "agentBudget: 30",
        "outputDir: .plan-execution/convergence/",
        "",
      ].join("\n"),
    );
    const cfg = readConvergeConfig(cfgPath, throwingExit);
    expect(cfg.subject).toBe("src/foo.ts");
    expect(cfg.outputDir).toBe(".plan-execution/convergence/");
    expect(cfg.convergenceMode).toBe("document");
    expect(cfg.harness).toBe("scripts/code-review-harness.ts");
  });

  it("exits 2 when the config file is unreadable", () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      expect(() =>
        readConvergeConfig(path.join(tmp, "missing.toon"), throwingExit),
      ).toThrow("EXIT:2");
    } finally {
      stderrSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// readAgentResultEnvelope
// ---------------------------------------------------------------------------

describe("readAgentResultEnvelope", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir("code-review-envelope-");
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("parses a non-empty issues table", () => {
    const filePath = path.join(tmp, "envelope.toon");
    fs.writeFileSync(
      filePath,
      encodeAgentResult({
        agent: "security-reviewer",
        status: "success",
        issues: [
          {
            severity: "critical",
            description: "SQL injection",
            file: "src/foo.ts",
            location: "42",
            suggestion: "Use parameterized query",
          },
        ],
      }),
    );
    const env = readAgentResultEnvelope(filePath);
    expect(env).not.toBeNull();
    expect(env!.agent).toBe("security-reviewer");
    expect(env!.status).toBe("success");
    expect(env!.issues!.length).toBe(1);
    expect(env!.issues![0].severity).toBe("critical");
  });

  it("accepts convergence-aligned severity values (blocking, warning)", () => {
    const filePath = path.join(tmp, "envelope.toon");
    fs.writeFileSync(
      filePath,
      encodeAgentResult({
        agent: "security-reviewer",
        status: "success",
        issues: [
          { severity: "blocking", description: "blocker A" },
          { severity: "warning", description: "warn B" },
        ],
      }),
    );
    const env = readAgentResultEnvelope(filePath);
    expect(env).not.toBeNull();
    expect(env!.issues!.length).toBe(2);
    expect(env!.issues![0].severity).toBe("blocking");
    expect(env!.issues![1].severity).toBe("warning");
  });

  it("returns null for nonexistent files", () => {
    expect(readAgentResultEnvelope(path.join(tmp, "ghost.toon"))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// aggregateCodeReviewFindings (F-01 row variant)
// ---------------------------------------------------------------------------

describe("aggregateCodeReviewFindings", () => {
  it("maps severities via severityToConvergenceSeverity (W-03 reuse)", () => {
    const result = aggregateCodeReviewFindings({
      subject: "src/foo.ts",
      iteration: 0,
      envelopes: [
        {
          agent: "security-reviewer",
          status: "success",
          issues: [
            { severity: "critical", message: "X", file: "src/foo.ts" },
            { severity: "medium", message: "Y", file: "src/foo.ts" },
            { severity: "low", message: "Z", file: "src/foo.ts" },
          ],
        },
      ],
      now: () => new Date("2026-06-14T00:00:00.000Z"),
    });
    expect(result.blockingCount).toBe(1);
    expect(result.advisoryCount).toBe(2);
    expect(result.findings.map((f) => f.severity)).toEqual([
      "blocking",
      "warning",
      "info",
    ]);
  });

  it("attributes every row with reviewerAgent (W-03)", () => {
    const result = aggregateCodeReviewFindings({
      subject: "src/foo.ts",
      iteration: 1,
      envelopes: [
        {
          agent: "security-reviewer",
          status: "success",
          issues: [
            { severity: "high", message: "SQL inj", file: "src/foo.ts" },
          ],
        },
        {
          agent: "architecture-reviewer",
          status: "success",
          issues: [
            { severity: "high", message: "Layer bypass", file: "src/foo.ts" },
          ],
        },
      ],
      now: () => new Date("2026-06-14T00:00:00.000Z"),
    });
    expect(result.findings.length).toBe(2);
    const reviewers = result.findings.map((f) => f.reviewerAgent);
    expect(reviewers).toContain("security-reviewer");
    expect(reviewers).toContain("architecture-reviewer");
    for (const f of result.findings) {
      expect(f.dimension).toBe(CODE_REVIEW_DIMENSION);
    }
  });

  it("assigns sequential F-NN ids in canonical reviewer order", () => {
    const result = aggregateCodeReviewFindings({
      subject: "src/foo.ts",
      iteration: 0,
      envelopes: [
        // Pass them out of canonical order.
        {
          agent: "security-reviewer",
          status: "success",
          issues: [{ severity: "high", message: "sec" }],
        },
        {
          agent: "code-reviewer",
          status: "success",
          issues: [{ severity: "low", message: "style" }],
        },
      ],
      now: () => new Date("2026-06-14T00:00:00.000Z"),
    });
    expect(result.findings[0].id).toBe("F-01");
    expect(result.findings[0].reviewerAgent).toBe("code-reviewer");
    expect(result.findings[1].id).toBe("F-02");
    expect(result.findings[1].reviewerAgent).toBe("security-reviewer");
  });

  it("ignores envelopes with status=failure (partial-failure)", () => {
    const result = aggregateCodeReviewFindings({
      subject: "src/foo.ts",
      iteration: 0,
      envelopes: [
        {
          agent: "security-reviewer",
          status: "failure",
          issues: [{ severity: "high", message: "ignored" }],
        },
        {
          agent: "code-reviewer",
          status: "success",
          issues: [{ severity: "medium", message: "kept" }],
        },
      ],
    });
    expect(result.findings.length).toBe(1);
    expect(result.findings[0].reviewerAgent).toBe("code-reviewer");
  });

  it("enforces count invariants (blockingCount + advisoryCount == findings.length)", () => {
    const result = aggregateCodeReviewFindings({
      subject: "src/foo.ts",
      iteration: 0,
      envelopes: [
        {
          agent: "security-reviewer",
          status: "success",
          issues: [
            { severity: "critical", message: "a" },
            { severity: "warning", message: "b" },
            { severity: "info", message: "c" },
          ],
        },
      ],
    });
    expect(result.findings.length).toBe(
      result.blockingCount + result.advisoryCount,
    );
  });

  it("emits ISO 8601 with millisecond precision (locked W-01)", () => {
    const result = aggregateCodeReviewFindings({
      subject: "src/foo.ts",
      iteration: 0,
      envelopes: [],
      now: () => new Date("2026-06-14T12:34:56.789Z"),
    });
    expect(result.producedAt).toBe("2026-06-14T12:34:56.789Z");
    expect(result.producedAt).toMatch(/\.\d{3}Z$/);
  });
});

// ---------------------------------------------------------------------------
// encodeCodeReviewFindingsToToon
// ---------------------------------------------------------------------------

describe("encodeCodeReviewFindingsToToon", () => {
  it("emits header + typed array matching findings.schema.md", () => {
    const text = encodeCodeReviewFindingsToToon({
      subject: "src/foo.ts",
      harnessName: "code-review",
      iteration: 0,
      blockingCount: 1,
      advisoryCount: 0,
      producedAt: "2026-06-14T00:00:00.000Z",
      findings: [
        {
          id: "F-01",
          dimension: "code-review",
          severity: "blocking",
          locationPath: "src/foo.ts",
          locationAnchor: ":42",
          summary: "x",
          reviewerAgent: "security-reviewer",
        },
      ],
    });
    expect(text).toContain("subject: src/foo.ts");
    expect(text).toContain("harnessName: code-review");
    expect(text).toContain(
      "findings[1]{id,dimension,severity,locationPath,locationAnchor,summary,suggestion,reviewerAgent}:",
    );
    expect(text).toContain("F-01,code-review,blocking,src/foo.ts,:42,x,,security-reviewer");
  });

  it("CSV-quotes suggestions containing commas (regression)", () => {
    const text = encodeCodeReviewFindingsToToon({
      subject: "src/foo.ts",
      harnessName: "code-review",
      iteration: 0,
      blockingCount: 1,
      advisoryCount: 0,
      producedAt: "2026-06-14T00:00:00.000Z",
      findings: [
        {
          id: "F-01",
          dimension: "code-review",
          severity: "blocking",
          locationPath: "src/foo.ts",
          locationAnchor: ":42",
          summary: "SQL injection",
          suggestion: "Use db.query('q', [a, b, c])",
          reviewerAgent: "security-reviewer",
        },
      ],
    });
    expect(text).toContain(`"Use db.query('q', [a, b, c])"`);
  });
});

// ---------------------------------------------------------------------------
// collectEnvelopes
// ---------------------------------------------------------------------------

describe("collectEnvelopes", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir("code-review-collect-");
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("reports missing reviewers when only some envelopes are present", () => {
    for (const r of CODE_REVIEWER_AGENTS.slice(0, 3)) {
      writeFile(
        path.join(tmp, `${r.reviewerAgent}.toon`),
        encodeAgentResult({ agent: r.reviewerAgent, status: "success" }),
      );
    }
    const result = collectEnvelopes(tmp);
    expect(result.envelopes.length).toBe(3);
    expect(result.missing.length).toBe(CODE_REVIEWER_AGENTS.length - 3);
  });

  it("flags corrupted envelopes separately from missing/failed", () => {
    writeFile(
      path.join(tmp, "security-reviewer.toon"),
      "garbage content\n",
    );
    writeFile(
      path.join(tmp, "architecture-reviewer.toon"),
      encodeAgentResult({
        agent: "architecture-reviewer",
        status: "failure",
      }),
    );
    const result = collectEnvelopes(tmp);
    expect(result.corrupted).toEqual(["security-reviewer"]);
    expect(result.failed).toEqual(["architecture-reviewer"]);
  });
});

// ---------------------------------------------------------------------------
// buildSpawnRequest
// ---------------------------------------------------------------------------

describe("buildSpawnRequest", () => {
  it("builds a request covering all 9+ reviewers with deterministic rerunCommand", () => {
    const req = buildSpawnRequest({
      configPath: "converge.config",
      subject: "src/foo.ts",
      resultDir: ".plan-execution/convergence/reviewer-results",
      iteration: 2,
      outputPath: ".plan-execution/convergence/iterations/iter-2/findings.toon",
      now: new Date("2026-06-14T10:00:00.000Z"),
    });
    expect(req.spawns.length).toBe(CODE_REVIEWER_AGENTS.length);
    expect(req.spawns.every((s) => s.subject === "src/foo.ts")).toBe(true);
    expect(req.rerunCommand).toContain("bun run scripts/code-review-harness.ts");
    expect(req.rerunCommand).toContain("--subject src/foo.ts");
    expect(req.rerunCommand).toContain("--iteration 2");
    expect(req.rerunCommand).toContain(
      "--results-dir .plan-execution/convergence/reviewer-results",
    );
    expect(req.createdAt).toBe("2026-06-14T10:00:00.000Z");
    expect(req.requestedBy).toBe("scripts/code-review-harness.ts");
  });
});

// ---------------------------------------------------------------------------
// atomicWriteFile
// ---------------------------------------------------------------------------

describe("atomicWriteFile", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTempDir("code-review-atomic-");
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("creates nested parent dirs and leaves no .tmp behind", () => {
    const target = path.join(tmp, "a", "b", "findings.toon");
    atomicWriteFile(target, "hello\n");
    expect(fs.readFileSync(target, "utf8")).toBe("hello\n");
    expect(fs.existsSync(`${target}.tmp`)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// main() — end-to-end
// ---------------------------------------------------------------------------

describe("main() — aggregate mode (AC1: standalone smoke test)", () => {
  let sandbox: string;
  let originalCwd: string;

  beforeEach(() => {
    sandbox = makeTempDir("code-review-main-");
    originalCwd = process.cwd();
    process.chdir(sandbox);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  it("AC1: --subject + --iteration 0 produces findings.toon with non-zero blockingCount", () => {
    const subject = "test/fixtures/code-review/converges-in-2-iters/input.ts";
    const resultsDir = path.dirname(subject) + "/reviewer-results";
    writeFile(path.join(sandbox, subject), "// fixture\n");

    // Seed reviewer envelopes with a blocking finding from security-reviewer.
    for (const r of CODE_REVIEWER_AGENTS) {
      const issues =
        r.reviewerAgent === "security-reviewer"
          ? [
              {
                severity: "critical",
                description: "SQL injection",
                file: subject,
                location: "6",
                suggestion: "Parameterize",
              },
            ]
          : [];
      writeFile(
        path.join(sandbox, resultsDir, `${r.reviewerAgent}.toon`),
        encodeAgentResult({
          agent: r.reviewerAgent,
          status: "success",
          issues,
        }),
      );
    }

    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    let exitCode: number | null = null;
    const exitStub = (code: number) => {
      exitCode = code;
      return undefined as never;
    };
    try {
      main(
        [
          "bun",
          "scripts/code-review-harness.ts",
          "--subject",
          subject,
          "--iteration",
          "0",
        ],
        exitStub as (code: number) => never,
      );
    } finally {
      stderrSpy.mockRestore();
    }
    expect(exitCode).toBe(0);

    const findingsPath = path.join(
      sandbox,
      ".plan-execution/convergence/iterations/iter-0/findings.toon",
    );
    expect(fs.existsSync(findingsPath)).toBe(true);
    const content = fs.readFileSync(findingsPath, "utf8");
    expect(content).toContain("harnessName: code-review");
    expect(content).toContain(`subject: ${subject}`);
    // AC1: non-zero blockingCount.
    expect(content).toMatch(/blockingCount: [1-9]\d*/);
    // AC2: reviewerAgent attribution per W-03.
    expect(content).toContain("security-reviewer");
  });

  it("writes spawn-request.toon when no envelopes are present", () => {
    const subject = "src/foo.ts";
    writeFile(path.join(sandbox, subject), "// stub\n");
    fs.mkdirSync(path.join(sandbox, "src/reviewer-results"), {
      recursive: true,
    });

    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    let exitCode: number | null = null;
    const exitStub = (code: number) => {
      exitCode = code;
      return undefined as never;
    };
    try {
      main(
        [
          "bun",
          "scripts/code-review-harness.ts",
          "--subject",
          subject,
          "--iteration",
          "1",
        ],
        exitStub as (code: number) => never,
      );
    } finally {
      stderrSpy.mockRestore();
    }
    expect(exitCode).toBe(0);

    const spawnReqPath = path.join(
      sandbox,
      ".plan-execution/convergence/iterations/iter-1/spawn-request.toon",
    );
    expect(fs.existsSync(spawnReqPath)).toBe(true);
    const content = fs.readFileSync(spawnReqPath, "utf8");
    expect(content).toContain("requestId: ");
    expect(content).toContain(`spawns[${CODE_REVIEWER_AGENTS.length}]`);
    expect(content).toContain("security-reviewer");
    expect(content).toContain("architecture-reviewer");
  });

  it("halts with exit 1 on corrupted envelopes (Gemini HIGH precedent)", () => {
    const subject = "src/foo.ts";
    writeFile(path.join(sandbox, subject), "// stub\n");
    const resultsDir = path.join(sandbox, "src/reviewer-results");
    fs.mkdirSync(resultsDir, { recursive: true });
    // Write valid envelopes for the first N-1 reviewers; corrupt the last.
    for (const r of CODE_REVIEWER_AGENTS.slice(0, -1)) {
      writeFile(
        path.join(resultsDir, `${r.reviewerAgent}.toon`),
        encodeAgentResult({ agent: r.reviewerAgent, status: "success" }),
      );
    }
    const corruptedName =
      CODE_REVIEWER_AGENTS[CODE_REVIEWER_AGENTS.length - 1].reviewerAgent;
    fs.writeFileSync(
      path.join(resultsDir, `${corruptedName}.toon`),
      "garbage\n",
    );

    const stderrWrites: string[] = [];
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        stderrWrites.push(String(chunk));
        return true;
      });
    let exitCode: number | null = null;
    const fakeExit = (code: number): never => {
      exitCode = code;
      throw new Error(`EXIT:${code}`);
    };
    try {
      expect(() =>
        main(
          [
            "bun",
            "scripts/code-review-harness.ts",
            "--subject",
            subject,
            "--iteration",
            "1",
          ],
          fakeExit as never,
        ),
      ).toThrow("EXIT:1");
    } finally {
      stderrSpy.mockRestore();
    }
    expect(exitCode).toBe(1);
    expect(stderrWrites.join("")).toContain("corrupted");
    expect(stderrWrites.join("")).toContain(corruptedName);

    // findings.toon must NOT have been written.
    const findingsPath = path.join(
      sandbox,
      ".plan-execution/convergence/iterations/iter-1/findings.toon",
    );
    expect(fs.existsSync(findingsPath)).toBe(false);
  });

  it("emits stderr warning for failed reviewers and still exits 0", () => {
    const subject = "src/foo.ts";
    writeFile(path.join(sandbox, subject), "// stub\n");
    const resultsDir = path.join(sandbox, "src/reviewer-results");
    fs.mkdirSync(resultsDir, { recursive: true });
    for (const r of CODE_REVIEWER_AGENTS) {
      const status =
        r.reviewerAgent === "code-simplifier" ? "failure" : "success";
      writeFile(
        path.join(resultsDir, `${r.reviewerAgent}.toon`),
        encodeAgentResult({ agent: r.reviewerAgent, status }),
      );
    }
    const stderrWrites: string[] = [];
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        stderrWrites.push(String(chunk));
        return true;
      });
    let exitCode: number | null = null;
    const exitStub = (code: number) => {
      exitCode = code;
      return undefined as never;
    };
    try {
      main(
        [
          "bun",
          "scripts/code-review-harness.ts",
          "--subject",
          subject,
          "--iteration",
          "1",
        ],
        exitStub as (code: number) => never,
      );
    } finally {
      stderrSpy.mockRestore();
    }
    expect(exitCode).toBe(0);
    const joined = stderrWrites.join("");
    expect(joined).toContain("code-simplifier");
    expect(joined).toContain("status=failed");
  });
});

// ---------------------------------------------------------------------------
// Wrapper-generated converge.config (AC4)
// ---------------------------------------------------------------------------

/**
 * The `/loom-code review --autoconverge` flag generates a converge.config
 * before invoking /loom-converge. This test asserts the shape the wrapper
 * MUST emit — the wrapper itself is a prompt instruction (in
 * `commands/loom-code.md`), so this test exercises the contract by encoding
 * the same TOON the wrapper instructions specify and validating its fields
 * against `converge.config.applications.md`'s F-01 row.
 */
describe("converge.config emitted by /loom-code review --autoconverge (AC4)", () => {
  function expectedAutoconvergeConfig(subject: string, runId: string): string {
    return [
      `runId: ${runId}`,
      `convergenceMode: document`,
      `subject: ${subject}`,
      `harness: scripts/code-review-harness.ts`,
      `integrator: fixer-agent`,
      `maxIterations: 3`,
      `agentBudget: 30`,
      `snapshotEnabled: true`,
      `outputDir: .plan-execution/convergence/`,
      "",
    ].join("\n");
  }

  it("conforms to F-01 row in converge.config.applications.md", () => {
    const cfg = expectedAutoconvergeConfig(
      "src/auth/login.ts",
      "conv-2026-06-14-12-00-00-001",
    );
    expect(cfg).toContain("convergenceMode: document");
    expect(cfg).toContain("harness: scripts/code-review-harness.ts");
    expect(cfg).toContain("integrator: fixer-agent");
    expect(cfg).toContain("maxIterations: 3");
    expect(cfg).toContain("snapshotEnabled: true");
  });

  it("a roundtrip through readConvergeConfig parses to the same field values", () => {
    const tmp = makeTempDir("code-review-autoconverge-cfg-");
    try {
      const cfgPath = path.join(tmp, "converge.config");
      fs.writeFileSync(
        cfgPath,
        expectedAutoconvergeConfig(
          "src/auth/login.ts",
          "conv-2026-06-14-12-00-00-001",
        ),
      );
      const parsed = readConvergeConfig(cfgPath, throwingExit);
      expect(parsed.convergenceMode).toBe("document");
      expect(parsed.subject).toBe("src/auth/login.ts");
      expect(parsed.harness).toBe("scripts/code-review-harness.ts");
      expect(parsed.outputDir).toBe(".plan-execution/convergence/");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// S-02 / S-03 — full --autoconverge convergence loop (depends on Phase 4)
// ---------------------------------------------------------------------------

describe.skipIf(!process.env.PHASE_4_SHIPPED)(
  "S-02 / S-03 — /loom-code review --autoconverge end-to-end",
  () => {
    it.skip("converges the fixture within 2 iterations", () => {
      // Stub: this scenario depends on the Phase 4 fixer-agent Integrator
      // Mode. Once that ships, replace this stub with a child_process spawn
      // of /loom-converge against the wrapper-generated config and assert
      // convergence-summary.toon.status === 'converged' &&
      // iterationCount <= 2.
    });

    it.skip("halts with SCOPE_EXPANSION when integrator touches a file outside subject", () => {
      // Stub: needs Phase 4. Replace with a synthetic integrator that
      // writes outside the subject set and assert
      // convergence-summary.toon.haltCause === 'SCOPE_EXPANSION'.
    });
  },
);
