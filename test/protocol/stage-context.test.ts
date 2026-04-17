/**
 * Tests for StageContext TOON format: roundtrip encode/decode,
 * and validation of required fields and stage name enum.
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// StageContext types (from stage-context.schema.md contract)
// ---------------------------------------------------------------------------

interface StageContext {
  stage: string;
  wave: number;
  iteration: number;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  inputTokensEstimate: number;
  outputTokensEstimate: number;
  filesChanged: string[];
  exportsAdded: string[];
  findingsResolved: number;
  findingsRemaining: number;
  summary: string;
  keyDecisions: string[];
  nextStageHints: string[];
}

const VALID_STAGES = [
  "contracts",
  "execute",
  "review",
  "test",
  "converge",
  "fix",
] as const;

// ---------------------------------------------------------------------------
// TOON encode/decode helpers for StageContext
// ---------------------------------------------------------------------------

/** Encode a StageContext to TOON string format. */
function encodeStageContext(ctx: StageContext): string {
  const lines: string[] = [];

  lines.push(`stage: ${ctx.stage}`);
  lines.push(`wave: ${ctx.wave}`);
  lines.push(`iteration: ${ctx.iteration}`);
  lines.push(`startedAt: ${ctx.startedAt}`);
  lines.push(`completedAt: ${ctx.completedAt}`);
  lines.push(`durationMs: ${ctx.durationMs}`);
  lines.push(`inputTokensEstimate: ${ctx.inputTokensEstimate}`);
  lines.push(`outputTokensEstimate: ${ctx.outputTokensEstimate}`);

  // Inline arrays
  lines.push(`filesChanged[${ctx.filesChanged.length}]: ${ctx.filesChanged.join(",")}`);
  lines.push(`exportsAdded[${ctx.exportsAdded.length}]: ${ctx.exportsAdded.join(",")}`);

  lines.push(`findingsResolved: ${ctx.findingsResolved}`);
  lines.push(`findingsRemaining: ${ctx.findingsRemaining}`);
  lines.push(`summary: ${ctx.summary}`);

  // Multi-line arrays (indented)
  lines.push(`keyDecisions[${ctx.keyDecisions.length}]:`);
  for (const d of ctx.keyDecisions) {
    lines.push(`  ${d}`);
  }

  lines.push(`nextStageHints[${ctx.nextStageHints.length}]:`);
  for (const h of ctx.nextStageHints) {
    lines.push(`  ${h}`);
  }

  return lines.join("\n");
}

/** Decode a TOON string back to a StageContext object. */
function decodeStageContext(toon: string): StageContext {
  const lines = toon.split("\n");
  const flat: Record<string, string> = {};
  let currentArrayName: string | null = null;
  const multiLineArrays: Record<string, string[]> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Multi-line array header: keyDecisions[N]:
    const multiArrayMatch = trimmed.match(/^(\w+)\[(\d+)\]:$/);
    if (multiArrayMatch) {
      currentArrayName = multiArrayMatch[1];
      multiLineArrays[currentArrayName] = [];
      continue;
    }

    // We're inside a multi-line array
    if (currentArrayName && line.startsWith("  ")) {
      multiLineArrays[currentArrayName].push(trimmed);
      continue;
    } else if (currentArrayName && !line.startsWith("  ") && trimmed) {
      currentArrayName = null;
      // Fall through to parse this line
    }

    // Inline array: filesChanged[N]: val1,val2,...
    const inlineArrayMatch = trimmed.match(/^(\w+)\[(\d+)\]:\s*(.*)$/);
    if (inlineArrayMatch) {
      const name = inlineArrayMatch[1];
      const count = parseInt(inlineArrayMatch[2], 10);
      const valStr = inlineArrayMatch[3].trim();
      if (count === 0 || !valStr) {
        multiLineArrays[name] = [];
      } else {
        multiLineArrays[name] = valStr.split(",").map((v) => v.trim());
      }
      continue;
    }

    // Flat key: value
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim();
      const value = trimmed.slice(colonIdx + 1).trim();
      flat[key] = value;
    }
  }

  return {
    stage: flat["stage"] ?? "",
    wave: parseInt(flat["wave"] ?? "0", 10),
    iteration: parseInt(flat["iteration"] ?? "0", 10),
    startedAt: flat["startedAt"] ?? "",
    completedAt: flat["completedAt"] ?? "",
    durationMs: parseInt(flat["durationMs"] ?? "0", 10),
    inputTokensEstimate: parseInt(flat["inputTokensEstimate"] ?? "0", 10),
    outputTokensEstimate: parseInt(flat["outputTokensEstimate"] ?? "0", 10),
    filesChanged: multiLineArrays["filesChanged"] ?? [],
    exportsAdded: multiLineArrays["exportsAdded"] ?? [],
    findingsResolved: parseInt(flat["findingsResolved"] ?? "0", 10),
    findingsRemaining: parseInt(flat["findingsRemaining"] ?? "0", 10),
    summary: flat["summary"] ?? "",
    keyDecisions: multiLineArrays["keyDecisions"] ?? [],
    nextStageHints: multiLineArrays["nextStageHints"] ?? [],
  };
}

/** Validate a StageContext, returning an array of error messages (empty = valid). */
function validateStageContext(ctx: StageContext): string[] {
  const errors: string[] = [];

  // Required fields must be present and non-empty
  if (!ctx.stage) errors.push("stage is required");
  if (ctx.wave === undefined || ctx.wave === null) errors.push("wave is required");
  if (!ctx.startedAt) errors.push("startedAt is required");
  if (!ctx.completedAt) errors.push("completedAt is required");
  if (ctx.durationMs === undefined || ctx.durationMs === null) errors.push("durationMs is required");
  if (!ctx.summary) errors.push("summary is required");

  // Valid stage enum
  if (ctx.stage && !VALID_STAGES.includes(ctx.stage as any)) {
    errors.push(
      `Invalid stage '${ctx.stage}'. Must be one of: ${VALID_STAGES.join(", ")}`
    );
  }

  // Non-negative integers
  if (ctx.wave < 0) errors.push("wave must be >= 0");
  if (ctx.iteration < 0) errors.push("iteration must be >= 0");
  if (ctx.durationMs < 0) errors.push("durationMs must be >= 0");

  return errors;
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function createSampleStageContext(): StageContext {
  return {
    stage: "execute",
    wave: 2,
    iteration: 0,
    startedAt: "2026-04-17T09:10:00Z",
    completedAt: "2026-04-17T09:18:42Z",
    durationMs: 522000,
    inputTokensEstimate: 45000,
    outputTokensEstimate: 32000,
    filesChanged: [
      "src/auth/middleware.ts",
      "src/auth/token.ts",
      "src/routes/auth.ts",
    ],
    exportsAdded: ["authMiddleware", "signToken", "verifyToken"],
    findingsResolved: 0,
    findingsRemaining: 0,
    summary:
      "Implemented auth middleware with JWT validation and user CRUD endpoints.",
    keyDecisions: [
      "JWT refresh handled via sliding window rather than explicit refresh endpoint",
      "User passwords hashed with bcrypt cost factor 12",
    ],
    nextStageHints: [
      "authMiddleware must be registered before protected routes in app.ts",
      "JWT_SECRET env var required",
    ],
  };
}

// ---------------------------------------------------------------------------
// 1. Roundtrip encode/decode (AC #8)
// ---------------------------------------------------------------------------

describe("StageContext TOON roundtrip", () => {
  it("roundtrip encode/decode preserves all scalar fields", () => {
    const original = createSampleStageContext();
    const encoded = encodeStageContext(original);
    const decoded = decodeStageContext(encoded);

    expect(decoded.stage).toBe(original.stage);
    expect(decoded.wave).toBe(original.wave);
    expect(decoded.iteration).toBe(original.iteration);
    expect(decoded.startedAt).toBe(original.startedAt);
    expect(decoded.completedAt).toBe(original.completedAt);
    expect(decoded.durationMs).toBe(original.durationMs);
    expect(decoded.inputTokensEstimate).toBe(original.inputTokensEstimate);
    expect(decoded.outputTokensEstimate).toBe(original.outputTokensEstimate);
    expect(decoded.findingsResolved).toBe(original.findingsResolved);
    expect(decoded.findingsRemaining).toBe(original.findingsRemaining);
    expect(decoded.summary).toBe(original.summary);
  });

  it("roundtrip encode/decode preserves array fields", () => {
    const original = createSampleStageContext();
    const encoded = encodeStageContext(original);
    const decoded = decodeStageContext(encoded);

    expect(decoded.filesChanged).toEqual(original.filesChanged);
    expect(decoded.exportsAdded).toEqual(original.exportsAdded);
    expect(decoded.keyDecisions).toEqual(original.keyDecisions);
    expect(decoded.nextStageHints).toEqual(original.nextStageHints);
  });

  it("roundtrip preserves empty arrays", () => {
    const original = createSampleStageContext();
    original.filesChanged = [];
    original.exportsAdded = [];
    original.keyDecisions = [];
    original.nextStageHints = [];

    const encoded = encodeStageContext(original);
    const decoded = decodeStageContext(encoded);

    expect(decoded.filesChanged).toEqual([]);
    expect(decoded.exportsAdded).toEqual([]);
    expect(decoded.keyDecisions).toEqual([]);
    expect(decoded.nextStageHints).toEqual([]);
  });

  it("roundtrip preserves a contracts stage context", () => {
    const ctx: StageContext = {
      stage: "contracts",
      wave: 0,
      iteration: 0,
      startedAt: "2026-04-17T09:00:00Z",
      completedAt: "2026-04-17T09:02:34Z",
      durationMs: 154000,
      inputTokensEstimate: 12400,
      outputTokensEstimate: 8200,
      filesChanged: ["src/types.ts", "src/schema.sql"],
      exportsAdded: ["User", "Site", "Event"],
      findingsResolved: 0,
      findingsRemaining: 0,
      summary: "Generated shared contracts.",
      keyDecisions: ["Used discriminated unions for API error types"],
      nextStageHints: ["migration-agent should read schema.sql"],
    };

    const decoded = decodeStageContext(encodeStageContext(ctx));
    expect(decoded).toEqual(ctx);
  });

  it("roundtrip preserves a converge stage context with non-zero iteration", () => {
    const ctx: StageContext = {
      stage: "converge",
      wave: 2,
      iteration: 3,
      startedAt: "2026-04-17T09:30:00Z",
      completedAt: "2026-04-17T09:45:22Z",
      durationMs: 922000,
      inputTokensEstimate: 120000,
      outputTokensEstimate: 65000,
      filesChanged: ["src/auth/middleware.ts", "src/services/user-service.ts"],
      exportsAdded: [],
      findingsResolved: 6,
      findingsRemaining: 1,
      summary: "Converged over 3 iterations.",
      keyDecisions: ["Froze naming advisory after iteration 2"],
      nextStageHints: ["Remaining naming finding is non-blocking"],
    };

    const decoded = decodeStageContext(encodeStageContext(ctx));
    expect(decoded).toEqual(ctx);
  });

  it("encodes to valid TOON format with expected line structure", () => {
    const ctx = createSampleStageContext();
    const encoded = encodeStageContext(ctx);

    // Check structural aspects of the TOON output
    expect(encoded).toContain("stage: execute");
    expect(encoded).toContain("wave: 2");
    expect(encoded).toContain("durationMs: 522000");
    expect(encoded).toMatch(/filesChanged\[\d+\]:/);
    expect(encoded).toMatch(/keyDecisions\[\d+\]:/);
  });
});

// ---------------------------------------------------------------------------
// 2. Validation (AC #9)
// ---------------------------------------------------------------------------

describe("StageContext validation", () => {
  it("accepts a valid StageContext with no errors", () => {
    const ctx = createSampleStageContext();
    const errors = validateStageContext(ctx);
    expect(errors).toEqual([]);
  });

  it("catches missing required field: stage", () => {
    const ctx = createSampleStageContext();
    ctx.stage = "";
    const errors = validateStageContext(ctx);
    expect(errors).toContain("stage is required");
  });

  it("catches missing required field: startedAt", () => {
    const ctx = createSampleStageContext();
    ctx.startedAt = "";
    const errors = validateStageContext(ctx);
    expect(errors).toContain("startedAt is required");
  });

  it("catches missing required field: summary", () => {
    const ctx = createSampleStageContext();
    ctx.summary = "";
    const errors = validateStageContext(ctx);
    expect(errors).toContain("summary is required");
  });

  it("catches multiple missing required fields", () => {
    const ctx = createSampleStageContext();
    ctx.stage = "";
    ctx.summary = "";
    ctx.completedAt = "";
    const errors = validateStageContext(ctx);
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects invalid stage names", () => {
    const ctx = createSampleStageContext();
    ctx.stage = "deploy";
    const errors = validateStageContext(ctx);
    expect(errors.some((e) => e.includes("Invalid stage"))).toBe(true);
    expect(errors.some((e) => e.includes("deploy"))).toBe(true);
  });

  it("rejects another invalid stage name", () => {
    const ctx = createSampleStageContext();
    ctx.stage = "build";
    const errors = validateStageContext(ctx);
    expect(errors.some((e) => e.includes("Invalid stage 'build'"))).toBe(true);
  });

  it("accepts all valid stage names", () => {
    for (const stage of VALID_STAGES) {
      const ctx = createSampleStageContext();
      ctx.stage = stage;
      const errors = validateStageContext(ctx);
      expect(errors).toEqual([]);
    }
  });

  it("catches negative wave value", () => {
    const ctx = createSampleStageContext();
    ctx.wave = -1;
    const errors = validateStageContext(ctx);
    expect(errors.some((e) => e.includes("wave must be >= 0"))).toBe(true);
  });

  it("catches negative durationMs", () => {
    const ctx = createSampleStageContext();
    ctx.durationMs = -100;
    const errors = validateStageContext(ctx);
    expect(errors.some((e) => e.includes("durationMs must be >= 0"))).toBe(
      true
    );
  });
});
