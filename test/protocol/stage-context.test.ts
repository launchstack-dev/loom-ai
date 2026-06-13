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

// ---------------------------------------------------------------------------
// ConvergenceIterationSummary types (from stage-context.schema.md
// § ConvergenceIterationSummary Schema). Per the locked Uniform Shape Across
// Modes rule, the on-disk shape is identical for `target`, `criteria`, and
// `document` modes. `subject`, `snapshotRef`, and `haltReason` are present in
// every iteration summary but null in non-document modes (or when not halted).
// ---------------------------------------------------------------------------

type ConvergenceMode = "target" | "criteria" | "document";
type HarnessResult = "pass" | "fail" | "partial";
type HaltReason =
  | "STALL"
  | "REGRESSION"
  | "BUDGET_EXHAUSTED"
  | "MAX_ITERATIONS"
  | "SCOPE_EXPANSION"
  | "INTEGRATOR_NOT_FOUND"
  | "HARNESS_MISSING"
  | "FINDINGS_SCHEMA_INVALID";

interface ConvergenceIterationSummary {
  iteration: number;
  mode: ConvergenceMode;
  /** Document mode: required path. Target/criteria: null. */
  subject: string | null;
  /** Document mode + snapshotEnabled: required path. Otherwise null. */
  snapshotRef: string | null;
  /** ISO 8601 with ms precision per locked W-01: YYYY-MM-DDTHH:mm:ss.sssZ */
  startedAt: string;
  completedAt: string;
  durationMs: number;
  harnessResult: HarnessResult;
  findingsBefore: number;
  findingsAfter: number;
  findingsFixed: string[];
  findingsNew: string[];
  filesModified: string[];
  stalled: boolean;
  summary: string;
  /** Null unless the driver halts at this iteration. */
  haltReason: HaltReason | null;
  /** Optional cumulative observability metric. Absent when not measurable. */
  tokensUsed?: number;
}

const VALID_MODES: readonly ConvergenceMode[] = [
  "target",
  "criteria",
  "document",
];
const VALID_HARNESS_RESULTS: readonly HarnessResult[] = [
  "pass",
  "fail",
  "partial",
];
const VALID_HALT_REASONS: readonly HaltReason[] = [
  "STALL",
  "REGRESSION",
  "BUDGET_EXHAUSTED",
  "MAX_ITERATIONS",
  "SCOPE_EXPANSION",
  "INTEGRATOR_NOT_FOUND",
  "HARNESS_MISSING",
  "FINDINGS_SCHEMA_INVALID",
];

/** W-01: ISO 8601 with millisecond precision. */
const W01_TIMESTAMP_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// ---------------------------------------------------------------------------
// TOON encode/decode helpers for ConvergenceIterationSummary.
//
// TOON null is serialized as the bareword `null`; the decoder recognizes it.
// Inline arrays use `name[N]: a,b,c`; multi-line (block) arrays use
// `name[N]:` followed by `  item` lines per the project's TOON quick reference.
// ---------------------------------------------------------------------------

function encodeIterationSummary(s: ConvergenceIterationSummary): string {
  const lines: string[] = [];

  lines.push(`iteration: ${s.iteration}`);
  lines.push(`mode: ${s.mode}`);
  lines.push(`subject: ${s.subject ?? "null"}`);
  lines.push(`snapshotRef: ${s.snapshotRef ?? "null"}`);
  lines.push(`startedAt: ${s.startedAt}`);
  lines.push(`completedAt: ${s.completedAt}`);
  lines.push(`durationMs: ${s.durationMs}`);
  lines.push(`harnessResult: ${s.harnessResult}`);
  lines.push(`findingsBefore: ${s.findingsBefore}`);
  lines.push(`findingsAfter: ${s.findingsAfter}`);

  // findingsFixed and findingsNew are multi-line (each row is a finding
  // description that may contain commas, so inline form would be ambiguous).
  lines.push(`findingsFixed[${s.findingsFixed.length}]:`);
  for (const f of s.findingsFixed) {
    lines.push(`  ${f}`);
  }
  lines.push(`findingsNew[${s.findingsNew.length}]:`);
  for (const f of s.findingsNew) {
    lines.push(`  ${f}`);
  }

  // filesModified uses the inline array form (paths are comma-safe).
  lines.push(
    `filesModified[${s.filesModified.length}]: ${s.filesModified.join(",")}`
  );

  lines.push(`stalled: ${s.stalled}`);
  lines.push(`summary: ${s.summary}`);
  lines.push(`haltReason: ${s.haltReason ?? "null"}`);

  if (s.tokensUsed !== undefined) {
    lines.push(`tokensUsed: ${s.tokensUsed}`);
  }

  return lines.join("\n");
}

function decodeIterationSummary(toon: string): ConvergenceIterationSummary {
  const lines = toon.split("\n");
  const flat: Record<string, string> = {};
  const multiLineArrays: Record<string, string[]> = {};
  let currentArrayName: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Multi-line array header: name[N]:
    const multiArrayMatch = trimmed.match(/^(\w+)\[(\d+)\]:$/);
    if (multiArrayMatch) {
      currentArrayName = multiArrayMatch[1];
      multiLineArrays[currentArrayName] = [];
      continue;
    }

    // Indented row inside a multi-line array.
    if (currentArrayName && line.startsWith("  ")) {
      multiLineArrays[currentArrayName].push(trimmed);
      continue;
    } else if (currentArrayName && !line.startsWith("  ") && trimmed) {
      currentArrayName = null;
      // Fall through to parse this line as a new construct.
    }

    // Inline array: name[N]: val1,val2,...
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

  const parseNullable = (v: string | undefined): string | null =>
    v === undefined || v === "null" ? null : v;

  const summary: ConvergenceIterationSummary = {
    iteration: parseInt(flat["iteration"] ?? "0", 10),
    mode: (flat["mode"] ?? "target") as ConvergenceMode,
    subject: parseNullable(flat["subject"]),
    snapshotRef: parseNullable(flat["snapshotRef"]),
    startedAt: flat["startedAt"] ?? "",
    completedAt: flat["completedAt"] ?? "",
    durationMs: parseInt(flat["durationMs"] ?? "0", 10),
    harnessResult: (flat["harnessResult"] ?? "fail") as HarnessResult,
    findingsBefore: parseInt(flat["findingsBefore"] ?? "0", 10),
    findingsAfter: parseInt(flat["findingsAfter"] ?? "0", 10),
    findingsFixed: multiLineArrays["findingsFixed"] ?? [],
    findingsNew: multiLineArrays["findingsNew"] ?? [],
    filesModified: multiLineArrays["filesModified"] ?? [],
    stalled: (flat["stalled"] ?? "false") === "true",
    summary: flat["summary"] ?? "",
    haltReason: parseNullable(flat["haltReason"]) as HaltReason | null,
  };

  if (flat["tokensUsed"] !== undefined) {
    summary.tokensUsed = parseInt(flat["tokensUsed"], 10);
  }

  return summary;
}

/**
 * Validate a ConvergenceIterationSummary against the schema rules from
 * stage-context.schema.md § ConvergenceIterationSummary § Validation Rules.
 * Returns an empty array on success, or one error string per rule violated.
 */
function validateIterationSummary(
  s: ConvergenceIterationSummary
): string[] {
  const errors: string[] = [];

  // Required fields
  if (s.iteration === undefined || s.iteration === null)
    errors.push("iteration is required");
  if (!s.mode) errors.push("mode is required");
  if (!s.startedAt) errors.push("startedAt is required");
  if (!s.completedAt) errors.push("completedAt is required");
  if (s.durationMs === undefined || s.durationMs === null)
    errors.push("durationMs is required");
  if (!s.harnessResult) errors.push("harnessResult is required");
  if (s.findingsBefore === undefined || s.findingsBefore === null)
    errors.push("findingsBefore is required");
  if (s.findingsAfter === undefined || s.findingsAfter === null)
    errors.push("findingsAfter is required");
  if (s.stalled === undefined || s.stalled === null)
    errors.push("stalled is required");
  if (!s.summary) errors.push("summary is required");

  // Iteration must be positive
  if (s.iteration < 1) errors.push("iteration must be >= 1");

  // Valid mode enum
  if (s.mode && !VALID_MODES.includes(s.mode))
    errors.push(
      `Invalid mode '${s.mode}'. Must be one of: ${VALID_MODES.join(", ")}`
    );

  // Valid harnessResult enum
  if (
    s.harnessResult &&
    !VALID_HARNESS_RESULTS.includes(s.harnessResult)
  )
    errors.push(
      `Invalid harnessResult '${s.harnessResult}'. Must be one of: ${VALID_HARNESS_RESULTS.join(", ")}`
    );

  // Stall consistency
  if (s.stalled && s.findingsAfter < s.findingsBefore)
    errors.push(
      "stalled is true but findingsAfter < findingsBefore (stall consistency)"
    );

  // Finding math: findingsAfter == findingsBefore - len(findingsFixed) + len(findingsNew)
  const expectedAfter =
    s.findingsBefore - s.findingsFixed.length + s.findingsNew.length;
  if (s.findingsAfter !== expectedAfter)
    errors.push(
      `findingsAfter (${s.findingsAfter}) does not equal findingsBefore - findingsFixed.length + findingsNew.length (${expectedAfter})`
    );

  // Timestamp precision (locked W-01)
  if (s.startedAt && !W01_TIMESTAMP_REGEX.test(s.startedAt))
    errors.push(
      `startedAt '${s.startedAt}' lacks W-01 millisecond precision (expected YYYY-MM-DDTHH:mm:ss.sssZ)`
    );
  if (s.completedAt && !W01_TIMESTAMP_REGEX.test(s.completedAt))
    errors.push(
      `completedAt '${s.completedAt}' lacks W-01 millisecond precision (expected YYYY-MM-DDTHH:mm:ss.sssZ)`
    );

  // Document-mode required optionals
  if (s.mode === "document") {
    if (s.subject === null || s.subject === undefined)
      errors.push("mode=document requires non-null subject");
  } else {
    if (s.subject !== null)
      errors.push(`mode=${s.mode} requires subject to be null`);
    if (s.snapshotRef !== null)
      errors.push(`mode=${s.mode} requires snapshotRef to be null`);
  }

  // haltReason enum (when populated)
  if (s.haltReason !== null && !VALID_HALT_REASONS.includes(s.haltReason))
    errors.push(
      `Invalid haltReason '${s.haltReason}'. Must be one of: ${VALID_HALT_REASONS.join(", ")}`
    );

  // tokensUsed non-negative
  if (s.tokensUsed !== undefined && s.tokensUsed < 0)
    errors.push("tokensUsed must be >= 0");

  return errors;
}

// ---------------------------------------------------------------------------
// Test fixtures for each mode
// ---------------------------------------------------------------------------

function createTargetModeIteration(): ConvergenceIterationSummary {
  return {
    iteration: 2,
    mode: "target",
    subject: null,
    snapshotRef: null,
    startedAt: "2026-04-17T09:36:00.000Z",
    completedAt: "2026-04-17T09:40:45.000Z",
    durationMs: 285000,
    harnessResult: "pass",
    findingsBefore: 3,
    findingsAfter: 0,
    findingsFixed: [
      "T-01: GET /api/users response body mismatch",
      "T-02: POST /api/users missing validation error format",
      "T-03: Login page layout shift in header",
    ],
    findingsNew: [],
    filesModified: [
      "src/routes/users.ts",
      "src/validation/user.ts",
      "src/components/LoginHeader.tsx",
    ],
    stalled: false,
    summary: "All 3 remaining targets now passing. Convergence complete.",
    haltReason: null,
  };
}

function createCriteriaModeIteration(): ConvergenceIterationSummary {
  return {
    iteration: 1,
    mode: "criteria",
    subject: null,
    snapshotRef: null,
    startedAt: "2026-04-17T09:30:00.000Z",
    completedAt: "2026-04-17T09:35:12.000Z",
    durationMs: 312000,
    harnessResult: "partial",
    findingsBefore: 7,
    findingsAfter: 4,
    findingsFixed: [
      "C-01: SQL injection in user lookup",
      "C-02: Missing 401 on expired token",
      "T-03: auth middleware test -- invalid token path",
    ],
    findingsNew: [],
    filesModified: [
      "src/services/user-service.ts",
      "src/auth/middleware.ts",
    ],
    stalled: false,
    summary:
      "Fixed 3 findings (1 security, 1 error handling, 1 test failure). No regressions introduced.",
    haltReason: null,
  };
}

function createDocumentModeIteration(): ConvergenceIterationSummary {
  return {
    iteration: 2,
    mode: "document",
    subject: "planning/PLAN-convergence-generalization.md",
    snapshotRef:
      "planning/history/snapshots/PLAN-convergence-generalization-pass-2.toon",
    startedAt: "2026-06-12T15:20:00.000Z",
    completedAt: "2026-06-12T15:31:14.250Z",
    durationMs: 674250,
    harnessResult: "partial",
    findingsBefore: 5,
    findingsAfter: 2,
    findingsFixed: [
      "F-01: Wave 2 has 9 deliverables (>8 limit)",
      "F-02: Plan does not address C-06 scope-expansion guard",
      "F-04: Two phases share src/foo/** without wiring boundary",
    ],
    findingsNew: [],
    filesModified: ["planning/PLAN-convergence-generalization.md"],
    stalled: false,
    summary:
      "Integrator pass resolved 3 blocking findings; 2 remain. No regressions introduced.",
    haltReason: null,
    tokensUsed: 95000,
  };
}

function createDocumentModeHaltedIteration(): ConvergenceIterationSummary {
  return {
    iteration: 2,
    mode: "document",
    subject: "planning/PLAN-x.v2.md",
    snapshotRef:
      "planning/history/snapshots/PLAN-x.v2-pass-2.toon",
    startedAt: "2026-06-12T16:08:00.000Z",
    completedAt: "2026-06-12T16:14:02.100Z",
    durationMs: 362100,
    harnessResult: "partial",
    findingsBefore: 4,
    findingsAfter: 3,
    findingsFixed: ["F-01: Phase 3 has 11 deliverables (>8 limit)"],
    findingsNew: [],
    filesModified: ["planning/PLAN-x.v2.md"],
    stalled: false,
    summary:
      "Integrator added a new top-level Phase 16 -- scope-expansion guard tripped. Run halted under --auto.",
    haltReason: "SCOPE_EXPANSION",
    tokensUsed: 88000,
  };
}

// ---------------------------------------------------------------------------
// ConvergenceIterationSummary roundtrip tests (all three modes)
// ---------------------------------------------------------------------------

describe("ConvergenceIterationSummary TOON roundtrip", () => {
  it("target-mode iteration roundtrips losslessly with subject/snapshotRef null", () => {
    const original = createTargetModeIteration();
    const decoded = decodeIterationSummary(encodeIterationSummary(original));

    expect(decoded).toEqual(original);
    expect(decoded.subject).toBeNull();
    expect(decoded.snapshotRef).toBeNull();
    expect(decoded.haltReason).toBeNull();
  });

  it("criteria-mode iteration roundtrips losslessly with subject/snapshotRef null", () => {
    const original = createCriteriaModeIteration();
    const decoded = decodeIterationSummary(encodeIterationSummary(original));

    expect(decoded).toEqual(original);
    expect(decoded.mode).toBe("criteria");
    expect(decoded.subject).toBeNull();
    expect(decoded.snapshotRef).toBeNull();
  });

  it("document-mode iteration roundtrips losslessly with subject + snapshotRef populated", () => {
    const original = createDocumentModeIteration();
    const decoded = decodeIterationSummary(encodeIterationSummary(original));

    expect(decoded).toEqual(original);
    expect(decoded.mode).toBe("document");
    expect(decoded.subject).toBe(
      "planning/PLAN-convergence-generalization.md"
    );
    expect(decoded.snapshotRef).toBe(
      "planning/history/snapshots/PLAN-convergence-generalization-pass-2.toon"
    );
    expect(decoded.tokensUsed).toBe(95000);
  });

  it("document-mode halted iteration preserves haltReason on roundtrip", () => {
    const original = createDocumentModeHaltedIteration();
    const decoded = decodeIterationSummary(encodeIterationSummary(original));

    expect(decoded).toEqual(original);
    expect(decoded.haltReason).toBe("SCOPE_EXPANSION");
  });

  it("document-mode subject with multi-dot filename round-trips verbatim (W-02 slug source)", () => {
    // The slug rule in iteration-snapshot.schema.md (W-02) strips only the
    // FINAL extension when computing snapshot filenames. The subject field in
    // the iteration summary, however, is the ORIGINAL path -- multi-dot and
    // all -- so a fresh-context reader can recompute the slug deterministically.
    const original = createDocumentModeHaltedIteration();
    // PLAN-x.v2.md -> slug PLAN-x.v2 -> snapshotRef PLAN-x.v2-pass-2.toon
    expect(original.subject).toBe("planning/PLAN-x.v2.md");
    expect(original.snapshotRef).toContain("PLAN-x.v2-pass-2.toon");

    const decoded = decodeIterationSummary(encodeIterationSummary(original));
    expect(decoded.subject).toBe(original.subject);
    expect(decoded.snapshotRef).toBe(original.snapshotRef);
  });

  it("emits the literal token 'null' for null subject/snapshotRef/haltReason fields", () => {
    const target = createTargetModeIteration();
    const encoded = encodeIterationSummary(target);

    expect(encoded).toContain("subject: null");
    expect(encoded).toContain("snapshotRef: null");
    expect(encoded).toContain("haltReason: null");
  });

  it("omits tokensUsed when undefined and includes it when present", () => {
    const target = createTargetModeIteration();
    expect(target.tokensUsed).toBeUndefined();
    const targetEncoded = encodeIterationSummary(target);
    expect(targetEncoded).not.toMatch(/^tokensUsed:/m);

    const doc = createDocumentModeIteration();
    const docEncoded = encodeIterationSummary(doc);
    expect(docEncoded).toMatch(/^tokensUsed: 95000$/m);
  });
});

// ---------------------------------------------------------------------------
// ConvergenceIterationSummary validation tests
// ---------------------------------------------------------------------------

describe("ConvergenceIterationSummary validation", () => {
  it("accepts a valid target-mode iteration", () => {
    expect(validateIterationSummary(createTargetModeIteration())).toEqual([]);
  });

  it("accepts a valid criteria-mode iteration", () => {
    expect(validateIterationSummary(createCriteriaModeIteration())).toEqual(
      []
    );
  });

  it("accepts a valid document-mode iteration", () => {
    expect(validateIterationSummary(createDocumentModeIteration())).toEqual(
      []
    );
  });

  it("accepts a valid document-mode halted iteration", () => {
    expect(
      validateIterationSummary(createDocumentModeHaltedIteration())
    ).toEqual([]);
  });

  it("rejects mode=document with null subject", () => {
    const s = createDocumentModeIteration();
    s.subject = null;
    const errors = validateIterationSummary(s);
    expect(
      errors.some((e) => e.includes("mode=document requires non-null subject"))
    ).toBe(true);
  });

  it("rejects mode=target with non-null subject", () => {
    const s = createTargetModeIteration();
    s.subject = "some/path.md";
    const errors = validateIterationSummary(s);
    expect(
      errors.some((e) => e.includes("mode=target requires subject to be null"))
    ).toBe(true);
  });

  it("rejects mode=criteria with non-null snapshotRef", () => {
    const s = createCriteriaModeIteration();
    s.snapshotRef = "planning/history/snapshots/foo-pass-1.toon";
    const errors = validateIterationSummary(s);
    expect(
      errors.some((e) =>
        e.includes("mode=criteria requires snapshotRef to be null")
      )
    ).toBe(true);
  });

  it("rejects an iteration with sub-second timestamp precision (W-01)", () => {
    const s = createTargetModeIteration();
    s.startedAt = "2026-04-17T09:36:00Z"; // no ms
    const errors = validateIterationSummary(s);
    expect(
      errors.some((e) =>
        e.includes("startedAt") && e.includes("W-01")
      )
    ).toBe(true);
  });

  it("accepts ISO 8601 with millisecond precision per locked W-01", () => {
    const s = createDocumentModeIteration();
    // s already uses ms precision; assert directly via regex.
    expect(W01_TIMESTAMP_REGEX.test(s.startedAt)).toBe(true);
    expect(W01_TIMESTAMP_REGEX.test(s.completedAt)).toBe(true);
    expect(validateIterationSummary(s)).toEqual([]);
  });

  it("rejects invalid mode enum", () => {
    const s = createTargetModeIteration();
    (s as any).mode = "freestyle";
    const errors = validateIterationSummary(s);
    expect(errors.some((e) => e.includes("Invalid mode"))).toBe(true);
  });

  it("rejects invalid harnessResult enum", () => {
    const s = createTargetModeIteration();
    (s as any).harnessResult = "ok";
    const errors = validateIterationSummary(s);
    expect(errors.some((e) => e.includes("Invalid harnessResult"))).toBe(
      true
    );
  });

  it("rejects iteration < 1", () => {
    const s = createTargetModeIteration();
    s.iteration = 0;
    const errors = validateIterationSummary(s);
    expect(errors.some((e) => e.includes("iteration must be >= 1"))).toBe(
      true
    );
  });

  it("catches finding-math inconsistency", () => {
    const s = createTargetModeIteration();
    // findingsBefore=3, fixed=3, new=0 -> expected after=0; force a mismatch
    s.findingsAfter = 1;
    const errors = validateIterationSummary(s);
    expect(
      errors.some((e) => e.includes("findingsAfter") && e.includes("does not equal"))
    ).toBe(true);
  });

  it("catches stall consistency violation", () => {
    const s = createTargetModeIteration();
    s.stalled = true;
    s.findingsBefore = 3;
    s.findingsAfter = 0; // stalled but progress was made
    const errors = validateIterationSummary(s);
    expect(errors.some((e) => e.includes("stall consistency"))).toBe(true);
  });

  it("rejects invalid haltReason enum", () => {
    const s = createDocumentModeHaltedIteration();
    (s as any).haltReason = "GAVE_UP";
    const errors = validateIterationSummary(s);
    expect(errors.some((e) => e.includes("Invalid haltReason"))).toBe(true);
  });

  it("accepts all locked haltReason enum values", () => {
    for (const reason of VALID_HALT_REASONS) {
      const s = createDocumentModeHaltedIteration();
      s.haltReason = reason;
      // The fixture's finding math holds regardless of haltReason, so this
      // is a clean check that each enum value parses without error.
      expect(validateIterationSummary(s)).toEqual([]);
    }
  });

  it("rejects negative tokensUsed", () => {
    const s = createDocumentModeIteration();
    s.tokensUsed = -1;
    const errors = validateIterationSummary(s);
    expect(errors.some((e) => e.includes("tokensUsed must be >= 0"))).toBe(
      true
    );
  });
});

// ---------------------------------------------------------------------------
// Uniform-shape parser test: a single decoder handles all three modes
// (load-bearing for /loom-converge --resume).
// ---------------------------------------------------------------------------

describe("ConvergenceIterationSummary uniform shape across modes", () => {
  it("the same decoder parses target, criteria, and document iter-{N}.toon files", () => {
    const fixtures: ConvergenceIterationSummary[] = [
      createTargetModeIteration(),
      createCriteriaModeIteration(),
      createDocumentModeIteration(),
      createDocumentModeHaltedIteration(),
    ];

    for (const original of fixtures) {
      const encoded = encodeIterationSummary(original);
      const decoded = decodeIterationSummary(encoded);

      // Same required fields recovered for every mode
      expect(decoded.iteration).toBe(original.iteration);
      expect(decoded.mode).toBe(original.mode);
      expect(decoded.startedAt).toBe(original.startedAt);
      expect(decoded.completedAt).toBe(original.completedAt);
      expect(decoded.durationMs).toBe(original.durationMs);
      expect(decoded.harnessResult).toBe(original.harnessResult);
      expect(decoded.findingsBefore).toBe(original.findingsBefore);
      expect(decoded.findingsAfter).toBe(original.findingsAfter);
      expect(decoded.stalled).toBe(original.stalled);
      expect(decoded.summary).toBe(original.summary);

      // subject/snapshotRef present-but-null in non-document modes
      if (original.mode === "document") {
        expect(decoded.subject).not.toBeNull();
        // snapshotRef is non-null when populated by the fixture (snapshotEnabled implied)
        expect(decoded.snapshotRef).not.toBeNull();
      } else {
        expect(decoded.subject).toBeNull();
        expect(decoded.snapshotRef).toBeNull();
      }
    }
  });
});
