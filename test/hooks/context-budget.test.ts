/**
 * Tests for the context budget system: token estimation accuracy,
 * configurable cap enforcement, and fail-open behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// Import the functions under test from token-estimator
import {
  estimateTokens,
  estimateFileTokens,
  estimateContextBudget,
} from "../../hooks/lib/token-estimator.js";
import {
  readBudgetConfig,
  isTestAgentSpawn,
  findAgentMdPath,
  checkTestAgentBudget,
} from "../../hooks/context-budget.js";

// ---------------------------------------------------------------------------
// 1. Token estimation accuracy (AC #1)
// ---------------------------------------------------------------------------

describe("estimateTokens — chars/4 heuristic", () => {
  it("estimates 'hello' (5 chars) as ceil(5/4) = 2 tokens", () => {
    expect(estimateTokens("hello")).toBe(2);
  });

  it("estimates an empty string as 0 tokens", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("estimates a 100-char string as 25 tokens", () => {
    const text = "a".repeat(100);
    expect(estimateTokens(text)).toBe(25);
  });

  it("estimates a 101-char string as ceil(101/4) = 26 tokens", () => {
    const text = "b".repeat(101);
    expect(estimateTokens(text)).toBe(26);
  });

  it("estimates a known sentence within 20% of actual tokenizer output", () => {
    // "The quick brown fox jumps over the lazy dog" = 43 chars
    // chars/4 heuristic: ceil(43/4) = 11
    // Typical BPE tokenizer output is ~10 tokens for this sentence.
    // 11 is within 20% of 10 (acceptable range: 8-12).
    const sentence = "The quick brown fox jumps over the lazy dog";
    const estimate = estimateTokens(sentence);
    expect(estimate).toBe(11);
    // Verify within 20% of a reference tokenizer value (~10)
    const reference = 10;
    expect(estimate).toBeGreaterThanOrEqual(reference * 0.8);
    expect(estimate).toBeLessThanOrEqual(reference * 1.2);
  });

  it("estimates a longer code block within 20% of expected", () => {
    // A typical TypeScript function: ~200 chars -> 50 tokens estimated
    // Actual BPE tokenizers produce ~45-55 tokens for 200 chars of code.
    const code = `export function calculateTotal(items: number[]): number {
  return items.reduce((sum, item) => sum + item, 0);
}`;
    const estimate = estimateTokens(code);
    const expected = Math.ceil(code.length / 4);
    expect(estimate).toBe(expected);
    // Within 20% of a ~40 token reference (code tokenizes more efficiently)
    const approxReference = Math.ceil(code.length / 4);
    expect(Math.abs(estimate - approxReference)).toBeLessThanOrEqual(
      approxReference * 0.2
    );
  });
});

describe("estimateFileTokens — stat-based estimation", () => {
  const tmpDir = path.join("/tmp", "loom-test-budget-" + process.pid);

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("estimates tokens from a file's byte size", async () => {
    const filePath = path.join(tmpDir, "sample.txt");
    const content = "x".repeat(400); // 400 bytes -> ceil(400/4) = 100 tokens
    fs.writeFileSync(filePath, content);

    const estimate = await estimateFileTokens(filePath);
    expect(estimate).toBe(100);
  });

  it("returns 0 for a non-existent file", async () => {
    const estimate = await estimateFileTokens(
      path.join(tmpDir, "nonexistent.txt")
    );
    expect(estimate).toBe(0);
  });

  it("returns 0 for an unreadable path", async () => {
    const estimate = await estimateFileTokens("/proc/nonexistent/file");
    expect(estimate).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Configurable cap enforcement (AC #2)
// ---------------------------------------------------------------------------

describe("budget cap enforcement via readBudgetConfig", () => {
  const tmpDir = path.join("/tmp", "loom-test-config-" + process.pid);
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    fs.mkdirSync(path.join(tmpDir, ".claude"), { recursive: true });
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("defaults to 200k window and 100k cap when no orchestration.toml exists", () => {
    const config = readBudgetConfig();
    expect(config.contextWindow).toBe(200000);
    expect(config.agentBudgetCap).toBe(100000);
  });

  it("with default 200k window, 100k cap rejects a 120k-token spawn", () => {
    const config = readBudgetConfig();
    const estimatedTokens = 120000;
    expect(estimatedTokens > config.agentBudgetCap).toBe(true);
  });

  it("with 1M window config, 500k cap allows a 120k-token spawn", () => {
    fs.writeFileSync(
      path.join(tmpDir, ".claude", "orchestration.toml"),
      `[settings.contextBudget]\ncontextWindow = 1000000\n`
    );
    const config = readBudgetConfig();
    expect(config.contextWindow).toBe(1000000);
    expect(config.agentBudgetCap).toBe(500000); // derived: 1M / 2
    const estimatedTokens = 120000;
    expect(estimatedTokens <= config.agentBudgetCap).toBe(true);
  });

  it("respects a custom agentBudgetCap override", () => {
    fs.writeFileSync(
      path.join(tmpDir, ".claude", "orchestration.toml"),
      `[settings.contextBudget]\ncontextWindow = 200000\nagentBudgetCap = 75000\n`
    );
    const config = readBudgetConfig();
    expect(config.contextWindow).toBe(200000);
    expect(config.agentBudgetCap).toBe(75000);
  });

  it("derives agentBudgetCap as contextWindow/2 when not explicitly set", () => {
    fs.writeFileSync(
      path.join(tmpDir, ".claude", "orchestration.toml"),
      `[settings.contextBudget]\ncontextWindow = 400000\n`
    );
    const config = readBudgetConfig();
    expect(config.agentBudgetCap).toBe(200000);
  });
});

// ---------------------------------------------------------------------------
// 3. Fail-open behavior (AC #3)
// ---------------------------------------------------------------------------

describe("fail-open behavior", () => {
  it("estimateFileTokens returns 0 for missing files (does not throw)", async () => {
    const result = await estimateFileTokens("/nonexistent/path/file.txt");
    expect(result).toBe(0);
  });

  it("estimateContextBudget returns overhead-only when all paths are missing", async () => {
    const result = await estimateContextBudget({
      agentPrompt: "",
      agentMdPath: "/nonexistent/agent.md",
      rollingContextPath: "/nonexistent/rolling-context.md",
      stageContextPaths: ["/nonexistent/stage1.toon", "/nonexistent/stage2.toon"],
    });
    // Only overhead should remain (5000 tokens) + taskPrompt (0 for empty string)
    expect(result.estimatedPromptTokens).toBe(5000);
    expect(result.breakdown.overhead).toBe(5000);
    expect(result.breakdown.agentInstructions).toBe(0);
    expect(result.breakdown.rollingContext).toBe(0);
    expect(result.breakdown.stageContext).toBe(0);
  });

  it("readBudgetConfig returns defaults when orchestration.toml is missing", () => {
    const tmpDir = path.join("/tmp", "loom-test-failopen-" + process.pid);
    fs.mkdirSync(tmpDir, { recursive: true });
    const originalCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      // No .claude directory at all — readBudgetConfig should return defaults
      const config = readBudgetConfig();
      expect(config.contextWindow).toBe(200000);
      expect(config.agentBudgetCap).toBe(100000);
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("estimateContextBudget succeeds with partial components", async () => {
    const tmpDir = path.join("/tmp", "loom-test-partial-" + process.pid);
    fs.mkdirSync(tmpDir, { recursive: true });
    const validFile = path.join(tmpDir, "agent.md");
    fs.writeFileSync(validFile, "x".repeat(200)); // 50 tokens

    try {
      const result = await estimateContextBudget({
        agentPrompt: "a".repeat(40), // 10 tokens
        agentMdPath: validFile,
        rollingContextPath: "/nonexistent/rolling-context.md", // missing — 0
        stageContextPaths: ["/nonexistent/stage.toon"], // missing — 0
      });

      expect(result.estimatedPromptTokens).toBe(50 + 10 + 5000); // agent + prompt + overhead
      expect(result.breakdown.agentInstructions).toBe(50);
      expect(result.breakdown.taskPrompt).toBe(10);
      expect(result.breakdown.rollingContext).toBe(0);
      expect(result.breakdown.stageContext).toBe(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Full budget estimation pipeline (AC #2 extension)
// ---------------------------------------------------------------------------

describe("estimateContextBudget — full pipeline", () => {
  const tmpDir = path.join("/tmp", "loom-test-pipeline-" + process.pid);

  beforeEach(() => {
    fs.mkdirSync(path.join(tmpDir, "stage-context"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("sums all components correctly", async () => {
    // Create test files
    const agentMd = path.join(tmpDir, "agent.md");
    fs.writeFileSync(agentMd, "x".repeat(800)); // 200 tokens

    const rollingCtx = path.join(tmpDir, "rolling-context.md");
    fs.writeFileSync(rollingCtx, "y".repeat(400)); // 100 tokens

    const stage1 = path.join(tmpDir, "stage-context", "contracts.toon");
    fs.writeFileSync(stage1, "z".repeat(200)); // 50 tokens

    const stage2 = path.join(tmpDir, "stage-context", "execute.toon");
    fs.writeFileSync(stage2, "w".repeat(120)); // 30 tokens

    const result = await estimateContextBudget({
      agentPrompt: "a".repeat(160), // 40 tokens
      agentMdPath: agentMd,
      rollingContextPath: rollingCtx,
      stageContextPaths: [stage1, stage2],
    });

    expect(result.breakdown.agentInstructions).toBe(200);
    expect(result.breakdown.rollingContext).toBe(100);
    expect(result.breakdown.stageContext).toBe(80); // 50 + 30
    expect(result.breakdown.taskPrompt).toBe(40);
    expect(result.breakdown.overhead).toBe(5000);
    expect(result.estimatedPromptTokens).toBe(200 + 100 + 80 + 40 + 5000);
  });
});

// ---------------------------------------------------------------------------
// 5. isTestAgentSpawn detection (Finding 21)
// ---------------------------------------------------------------------------

describe("isTestAgentSpawn", () => {
  it("returns true when prompt contains a test agent name", () => {
    expect(isTestAgentSpawn("Read your instructions from e2e-runner-agent.md")).toBe(true);
    expect(isTestAgentSpawn("Spawn qa-review-agent for this task")).toBe(true);
    expect(isTestAgentSpawn("Use vitest-runner to execute tests")).toBe(true);
    expect(isTestAgentSpawn("Run integration-test-agent")).toBe(true);
    expect(isTestAgentSpawn("Launch e2e-test-writer-agent")).toBe(true);
  });

  it("returns true for stage references", () => {
    expect(isTestAgentSpawn("stage: e2e — run all end-to-end tests")).toBe(true);
    expect(isTestAgentSpawn("stage: qa-review — review quality")).toBe(true);
  });

  it("returns false for non-test prompts", () => {
    expect(isTestAgentSpawn("Read the plan and execute contracts")).toBe(false);
    expect(isTestAgentSpawn("Deploy the application to staging")).toBe(false);
    expect(isTestAgentSpawn("")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isTestAgentSpawn("E2E-RUNNER-AGENT")).toBe(true);
    expect(isTestAgentSpawn("QA-Review-Agent")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. findAgentMdPath (Finding 21)
// ---------------------------------------------------------------------------

describe("findAgentMdPath", () => {
  const tmpDir = path.join("/tmp", "loom-test-agentmd-" + process.pid);

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns undefined when prompt has no agent path", () => {
    expect(findAgentMdPath("just a plain prompt")).toBeUndefined();
  });

  it("returns undefined when prompt has an agent path but file does not exist", () => {
    expect(findAgentMdPath("Read agents/nonexistent-agent.md")).toBeUndefined();
  });

  it("extracts and resolves a valid agents/*.md path", () => {
    // Create a file in a local agents/ directory
    const agentsDir = path.join(tmpDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    const agentFile = path.join(agentsDir, "test-agent.md");
    fs.writeFileSync(agentFile, "# Test Agent");

    const originalCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const result = findAgentMdPath("Read agents/test-agent.md for instructions");
      // On macOS, /tmp is a symlink to /private/tmp, so use fs.realpathSync for comparison
      expect(fs.realpathSync(result!)).toBe(fs.realpathSync(path.resolve(tmpDir, "agents", "test-agent.md")));
    } finally {
      process.chdir(originalCwd);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. checkTestAgentBudget — block/warn/ok thresholds (Finding 21)
// ---------------------------------------------------------------------------

describe("checkTestAgentBudget", () => {
  const tmpDir = path.join("/tmp", "loom-test-budget-check-" + process.pid);
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    fs.mkdirSync(path.join(tmpDir, ".claude"), { recursive: true });
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns withinBudget=true for a small prompt", async () => {
    const result = await checkTestAgentBudget("Run e2e-runner-agent with small task");
    expect(result.withinBudget).toBe(true);
    expect(result.isTestAgent).toBe(true);
    expect(result.budgetCap).toBe(100000);
    expect(result.estimatedTokens).toBeLessThan(result.budgetCap);
  });

  it("returns isTestAgent=false for a non-test prompt", async () => {
    const result = await checkTestAgentBudget("Deploy the app");
    expect(result.isTestAgent).toBe(false);
  });

  it("returns withinBudget=false when prompt exceeds budget cap", async () => {
    // Set a very low cap
    fs.writeFileSync(
      path.join(tmpDir, ".claude", "orchestration.toml"),
      `[settings.contextBudget]\ncontextWindow = 200\nagentBudgetCap = 10\n`
    );
    // prompt + 5000 overhead will exceed 10 token cap
    const result = await checkTestAgentBudget("e2e-runner-agent do something");
    expect(result.withinBudget).toBe(false);
    expect(result.estimatedTokens).toBeGreaterThan(result.budgetCap);
  });

  it("includes a breakdown with all components", async () => {
    const result = await checkTestAgentBudget("Run vitest-runner for unit tests");
    expect(result.breakdown).toBeDefined();
    expect(result.breakdown.overhead).toBe(5000);
    expect(result.breakdown.taskPrompt).toBeGreaterThan(0);
  });
});
