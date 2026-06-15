/**
 * F-04 PR-review harness — unit + integration tests.
 *
 * Covers Phase 6 acceptance criteria:
 *   AC1: `bun run scripts/pr-review-harness.ts --config <path> --iteration 0`
 *        writes pr-state.toon with headSha/baseSha/diffHash/commentIds keys.
 *   AC2: Dispatcher delegates to gemini.ts when botAdapter=gemini; emits
 *        CODE: ADAPTER_UNKNOWN + exit 1 on unknown adapters.
 *   AC3: `/loom-git review-pr --autoconverge` generates a converge.config with
 *        the F-04 shape (asserted via `buildWrapperConfig`).
 *   AC4: Canned-PR fixture converges in 2 iterations.
 *   AC5: convergence-summary.toon regression — no `customTerminationOutcome`
 *        key in the schema (asserted by scanning the schema doc).
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  buildWrapperConfig,
  encodeWrapperConfigToToon,
} from "../scripts/lib/pr-review-harness/wrapper-config.js";
import {
  buildPrState,
  encodePrStateToToon,
  writePrStateFile,
  type GhRunner,
} from "../scripts/lib/pr-review-harness/pr-state-writer.js";
import {
  run,
  readConvergeConfig,
  emitAgentResult,
} from "../scripts/pr-review-harness.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXTURES = path.join(__dirname, "fixtures", "pr-review", "canned-pr");

interface GhFixture {
  prView: unknown;
  diff: string;
  nameWithOwner: string;
  comments: unknown;
}

function loadGhFixture(file: string): GhFixture {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, file), "utf8")) as GhFixture;
}

/** Build a GhRunner that returns canned responses keyed by the leading args. */
function makeGhStub(fixture: GhFixture): GhRunner {
  return (args: readonly string[]) => {
    if (args[0] === "pr" && args[1] === "view") {
      return JSON.stringify(fixture.prView);
    }
    if (args[0] === "pr" && args[1] === "diff") {
      return fixture.diff;
    }
    if (args[0] === "repo" && args[1] === "view") {
      return fixture.nameWithOwner + "\n";
    }
    if (args[0] === "api") {
      return JSON.stringify(fixture.comments);
    }
    throw new Error(`unexpected gh invocation: gh ${args.join(" ")}`);
  };
}

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pr-review-harness-"));
}

const FIXED_NOW = () => new Date("2026-06-15T12:00:00.000Z");

class ExitCalled extends Error {
  constructor(public code: number) {
    super(`exit(${code})`);
  }
}
function makeExit(): (code: number) => never {
  return ((code: number) => {
    throw new ExitCalled(code);
  }) as (code: number) => never;
}

// ---------------------------------------------------------------------------
// AC1: pr-state.toon shape
// ---------------------------------------------------------------------------

describe("pr-state-writer", () => {
  it("buildPrState shells out via the injected gh-runner and produces all required keys", async () => {
    const stub = makeGhStub(loadGhFixture("gh-iter-1.json"));
    const state = await buildPrState({
      prNumber: 42,
      runner: stub,
      now: FIXED_NOW,
    });

    expect(state.prNumber).toBe(42);
    expect(state.baseSha).toMatch(/^base/);
    expect(state.headSha).toMatch(/^head/);
    expect(state.diffHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(state.producedAt).toBe("2026-06-15T12:00:00.000Z");
    expect(state.files.length).toBe(2);
    expect(state.comments.length).toBe(2);
    // commentIds extractable per AC1.
    const commentIds = state.comments.map((c) => c.id);
    expect(commentIds).toEqual(["1001", "1002"]);
  });

  it("encodePrStateToToon emits the documented F-04 projection shape", async () => {
    const stub = makeGhStub(loadGhFixture("gh-iter-1.json"));
    const state = await buildPrState({
      prNumber: 42,
      runner: stub,
      now: FIXED_NOW,
    });
    const toon = encodePrStateToToon(state);

    expect(toon).toContain("prNumber: 42");
    expect(toon).toMatch(/baseSha: base/);
    expect(toon).toMatch(/headSha: head/);
    expect(toon).toMatch(/diffHash: sha256:/);
    expect(toon).toContain("producedAt: 2026-06-15T12:00:00.000Z");
    expect(toon).toMatch(/files\[2\]\{path,status,additions,deletions\}:/);
    expect(toon).toMatch(
      /comments\[2\]\{id,author,path,line,body,createdAt\}:/,
    );
  });

  it("writePrStateFile writes atomically (tmp file then rename)", async () => {
    const dir = makeTempDir();
    const out = path.join(dir, "pr-state.toon");
    const stub = makeGhStub(loadGhFixture("gh-iter-1.json"));
    const state = await buildPrState({
      prNumber: 42,
      runner: stub,
      now: FIXED_NOW,
    });
    const absPath = writePrStateFile(state, out);
    expect(fs.existsSync(absPath)).toBe(true);
    // The .tmp companion must NOT linger.
    expect(fs.existsSync(`${absPath}.tmp`)).toBe(false);
  });

  it("rejects non-positive prNumber", async () => {
    const stub = makeGhStub(loadGhFixture("gh-iter-1.json"));
    await expect(
      buildPrState({ prNumber: 0, runner: stub, now: FIXED_NOW }),
    ).rejects.toThrow(/prNumber/);
  });
});

// ---------------------------------------------------------------------------
// AC3: wrapper-config shape (used by /loom-git review-pr --autoconverge)
// ---------------------------------------------------------------------------

describe("wrapper-config (used by /loom-git review-pr --autoconverge)", () => {
  it("buildWrapperConfig emits the F-04 default shape per OQ-02", () => {
    const cfg = buildWrapperConfig({ prNumber: 42 });
    expect(cfg).toEqual({
      mode: "document",
      subject: ".plan-execution/pr-review/pr-state.toon",
      harness: "scripts/pr-review-harness.ts",
      integrator: "pr-fixer-agent",
      maxIterations: 5,
      snapshotEnabled: true,
      botAdapter: "gemini",
      prNumber: 42,
    });
  });

  it("encoded TOON includes every required field", () => {
    const text = encodeWrapperConfigToToon(buildWrapperConfig({ prNumber: 42 }));
    expect(text).toContain("mode: document");
    expect(text).toContain("subject: .plan-execution/pr-review/pr-state.toon");
    expect(text).toContain("harness: scripts/pr-review-harness.ts");
    expect(text).toContain("integrator: pr-fixer-agent");
    expect(text).toContain("maxIterations: 5");
    expect(text).toContain("snapshotEnabled: true");
    expect(text).toContain("botAdapter: gemini");
    expect(text).toContain("prNumber: 42");
  });

  it("rejects invalid inputs", () => {
    expect(() => buildWrapperConfig({ prNumber: 0 })).toThrow(/prNumber/);
    expect(() =>
      buildWrapperConfig({ prNumber: 42, maxIterations: 0 }),
    ).toThrow(/maxIterations/);
    expect(() =>
      buildWrapperConfig({
        prNumber: 42,
        // @ts-expect-error — runtime guard
        botAdapter: "unsupportedBot",
      }),
    ).toThrow(/botAdapter/);
  });
});

// ---------------------------------------------------------------------------
// converge.config reader
// ---------------------------------------------------------------------------

describe("readConvergeConfig", () => {
  it("parses the F-04 wrapper config from disk", () => {
    const exit = makeExit();
    const cfg = readConvergeConfig(
      path.join(FIXTURES, "converge.config.toon"),
      exit,
    );
    expect(cfg.botAdapter).toBe("gemini");
    expect(cfg.prNumber).toBe(42);
    expect(cfg.subject).toBe(".plan-execution/pr-review/pr-state.toon");
    expect(cfg.harness).toBe("scripts/pr-review-harness.ts");
    expect(cfg.integrator).toBe("pr-fixer-agent");
    expect(cfg.maxIterations).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// AC2: dispatcher delegates / unknown-adapter error path
// ---------------------------------------------------------------------------

describe("pr-review-harness dispatcher", () => {
  let workDir: string;
  beforeEach(() => {
    workDir = makeTempDir();
  });

  it("AC1+AC2: delegates to gemini adapter and writes findings.toon (iter 0 smoke)", async () => {
    const subjectPath = path.join(workDir, "pr-state.toon");
    const outputPath = path.join(workDir, "iter-0", "findings.toon");
    const configPath = path.join(workDir, "converge.config.toon");
    fs.writeFileSync(
      configPath,
      encodeWrapperConfigToToon(
        buildWrapperConfig({
          prNumber: 42,
          subject: subjectPath,
        }),
      ),
      "utf8",
    );

    const stub = makeGhStub(loadGhFixture("gh-iter-1.json"));
    const exit = makeExit();

    try {
      await run({
        argv: [
          "bun",
          "scripts/pr-review-harness.ts",
          "--config",
          configPath,
          "--iteration",
          "0",
          "--output",
          outputPath,
        ],
        exit,
        runner: stub,
        now: FIXED_NOW,
      });
      throw new Error("expected exit() to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ExitCalled);
      expect((e as ExitCalled).code).toBe(0);
    }

    // pr-state.toon contains the required keys per AC1.
    const stateText = fs.readFileSync(subjectPath, "utf8");
    expect(stateText).toContain("headSha:");
    expect(stateText).toContain("baseSha:");
    expect(stateText).toContain("diffHash:");
    expect(stateText).toMatch(/comments\[\d+\]\{id,/);

    // findings.toon written by the gemini adapter.
    const findingsText = fs.readFileSync(outputPath, "utf8");
    expect(findingsText).toContain("harnessName: pr-review");
    expect(findingsText).toMatch(/blockingCount: 2/);
    // reviewerAgent column populated with `gemini`.
    expect(findingsText).toContain("gemini");
  });

  it("AC2: emits CODE: ADAPTER_UNKNOWN and exits 1 when botAdapter is unknown", async () => {
    const stub = makeGhStub(loadGhFixture("gh-iter-1.json"));
    const exit = makeExit();
    const captured: string[] = [];
    const originalStderrWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      captured.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    }) as typeof process.stderr.write;

    try {
      try {
        await run({
          argv: [
            "bun",
            "scripts/pr-review-harness.ts",
            "--config",
            path.join(FIXTURES, "unknown-adapter.config.toon"),
            "--iteration",
            "1",
          ],
          exit,
          runner: stub,
          now: FIXED_NOW,
        });
        throw new Error("expected exit() to throw");
      } catch (e) {
        expect(e).toBeInstanceOf(ExitCalled);
        expect((e as ExitCalled).code).toBe(1);
      }
      const joined = captured.join("");
      expect(joined).toContain("CODE: ADAPTER_UNKNOWN");
      expect(joined).toContain("unsupportedBot");
    } finally {
      process.stderr.write = originalStderrWrite;
    }
  });

  it("emitAgentResult writes a parseable AgentResult envelope", () => {
    const captured: string[] = [];
    const stream = {
      write(chunk: string) {
        captured.push(chunk);
        return true;
      },
    } as unknown as NodeJS.WritableStream;
    emitAgentResult({
      status: "failure",
      issues: [
        {
          severity: "blocking",
          description: "CODE: ADAPTER_UNKNOWN — test",
          file: "x.toon",
        },
      ],
      destination: stream,
    });
    const text = captured.join("");
    expect(text).toContain("agent: pr-review-harness");
    expect(text).toContain("status: failure");
    expect(text).toContain("issues[1]{severity,description,file}:");
    expect(text).toMatch(/blocking,CODE: ADAPTER_UNKNOWN — test,x\.toon/);
  });
});

// ---------------------------------------------------------------------------
// AC4: canned PR fixture converges in 2 iterations
// ---------------------------------------------------------------------------

describe("canned-PR fixture converges in 2 iterations (AC4)", () => {
  it("iteration 1 produces 2 blocking findings; iteration 2 produces 0", async () => {
    const workDir = makeTempDir();
    const subjectPath = path.join(workDir, "pr-state.toon");
    const configPath = path.join(workDir, "converge.config.toon");
    fs.writeFileSync(
      configPath,
      encodeWrapperConfigToToon(
        buildWrapperConfig({ prNumber: 42, subject: subjectPath }),
      ),
      "utf8",
    );

    const iter1Output = path.join(workDir, "iter-1", "findings.toon");
    const iter2Output = path.join(workDir, "iter-2", "findings.toon");

    // Iteration 1.
    const exit1 = makeExit();
    try {
      await run({
        argv: [
          "bun",
          "scripts/pr-review-harness.ts",
          "--config",
          configPath,
          "--iteration",
          "1",
          "--output",
          iter1Output,
        ],
        exit: exit1,
        runner: makeGhStub(loadGhFixture("gh-iter-1.json")),
        now: FIXED_NOW,
      });
    } catch (e) {
      expect((e as ExitCalled).code).toBe(0);
    }
    const iter1Text = fs.readFileSync(iter1Output, "utf8");
    expect(iter1Text).toMatch(/blockingCount: 2/);

    // Iteration 2 — pass iter-1 findings via --prior-findings to exercise
    // OQ-04 dedup; iter-2 comments are at different lines so dedup keeps them.
    const exit2 = makeExit();
    try {
      await run({
        argv: [
          "bun",
          "scripts/pr-review-harness.ts",
          "--config",
          configPath,
          "--iteration",
          "2",
          "--output",
          iter2Output,
          "--prior-findings",
          iter1Output,
        ],
        exit: exit2,
        runner: makeGhStub(loadGhFixture("gh-iter-2.json")),
        now: FIXED_NOW,
      });
    } catch (e) {
      expect((e as ExitCalled).code).toBe(0);
    }
    const iter2Text = fs.readFileSync(iter2Output, "utf8");
    // No blocking comments in iter-2 → CONVERGED-ready.
    expect(iter2Text).toMatch(/blockingCount: 0/);
  });
});

// ---------------------------------------------------------------------------
// AC5: convergence-summary regression — no customTerminationOutcome key
// ---------------------------------------------------------------------------

describe("convergence-summary schema regression (AC5)", () => {
  it("convergence-summary.schema.md does NOT mention customTerminationOutcome", () => {
    const schemaPath = path.resolve(
      __dirname,
      "..",
      "agents",
      "protocols",
      "convergence-summary.schema.md",
    );
    const text = fs.readFileSync(schemaPath, "utf8");
    expect(text).not.toMatch(/customTerminationOutcome/i);
  });
});
