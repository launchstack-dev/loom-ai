/**
 * Vitest coverage for scripts/roadmap-converge/integrator.ts,
 * scripts/roadmap-converge/stall-detector.ts, and the Phase 5 driver wiring.
 *
 * Covers:
 *   S-18 — Integrator applies resolved question to ROADMAP surgically
 *   S-19 — Stall detector halts on two identical passes
 *   S-20 — Pass cap halts when round equals passLimit without all-green
 *   FC-05 — Retire-dimension auto-resolves orphan open_questions
 *   INTEGRATOR_NO_ENVELOPE — driver halts when integrator returns non-envelope
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  defaultIntegratorInvoker,
  autoResolveArchivedDimensions,
  isIntegratorEnvelope,
  type IntegratorEnvelope,
  type IntegratorInvoker,
} from "../../scripts/roadmap-converge/integrator.js";
import {
  checkStall,
  checkPassCap,
} from "../../scripts/roadmap-converge/stall-detector.js";
import {
  runConvergePass,
  EXECUTE_INTEGRATOR_STAGE_CONTEXT_PATH,
  type ReviewerEnvelope,
  type ReviewerInvoker,
} from "../../scripts/roadmap-converge/driver.js";
import { freshState, writeState, readState } from "../../scripts/roadmap-converge/state-io.js";
import type {
  OpenQuestionV1,
  RoadmapConvergeStateV1,
} from "../../scripts/migrators/roadmap-converge-state/index.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let workdir: string;
let originalCwd: string;
let roadmapPath: string;

const ROADMAP_INITIAL = `# vision

A roadmap for solo developers.

# milestones

M1, M2.
`;

const RUBRIC_BODY = `# Rubric\n\n## Green\nGreen exemplar.\n\n## Yellow\nYellow exemplar.\n\n## Red\nRed exemplar.\n`;

function fixedNow(): Date {
  return new Date("2026-06-18T00:00:00Z");
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "roadmap-converge-integrator-"));
  originalCwd = process.cwd();
  process.chdir(workdir);

  mkdirSync("planning", { recursive: true });
  mkdirSync("protocols/roadmap-rubrics", { recursive: true });
  roadmapPath = "planning/ROADMAP.md";
  writeFileSync(roadmapPath, ROADMAP_INITIAL);
  writeFileSync("protocols/roadmap-rubrics/vision.md", RUBRIC_BODY);
  writeFileSync("protocols/roadmap-rubrics/milestones.md", RUBRIC_BODY);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(workdir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helper builders
// ---------------------------------------------------------------------------

function buildReviewerInvoker(
  envelopesByDim: Record<string, ReviewerEnvelope>
): ReviewerInvoker {
  return async ({ dimensionName }) => {
    const env = envelopesByDim[dimensionName];
    if (!env) throw new Error(`no envelope for ${dimensionName}`);
    return env;
  };
}

function greenEnvelope(): ReviewerEnvelope {
  return { ok: true, status: "green", findings: [], evidence: "ok", blockers: [], evidenceRef: [] };
}

function redEnvelope(
  findings: { description: string }[] = []
): ReviewerEnvelope {
  return { ok: true, status: "red", findings: findings.map((f) => ({ ...f, severity: "warning" as const })), evidence: "issues found", blockers: [], evidenceRef: [] };
}

function makeFreshStateWithDimensions(
  dims: { name: string; status: "green" | "yellow" | "red" }[]
): RoadmapConvergeStateV1 {
  const state = freshState({
    roadmapPath,
    roadmapSlug: "ROADMAP",
    archetype: "default",
    passLimit: 3,
    contentHash: "abc123",
  });
  state.dimensions = dims.map((d) => ({
    name: d.name,
    status: d.status,
    delta_since_last: "new",
    blockers: [],
    evidenceRef: [],
  }));
  return state;
}

// ---------------------------------------------------------------------------
// S-18: Integrator applies resolved question to ROADMAP surgically
// ---------------------------------------------------------------------------

describe("S-18: integrator surgical edit", () => {
  it("inserts resolution into targeted section only", async () => {
    const resolvedQuestion: OpenQuestionV1 = {
      id: "Q-01",
      dimension: "vision",
      text: "What is the target user?",
      asked_at: "2026-06-18T00:00:00Z",
      resolved_at: "2026-06-18T01:00:00Z",
      resolution: "Target users are solo indie developers building side-projects.",
    };

    const state = makeFreshStateWithDimensions([
      { name: "vision", status: "red" },
    ]);

    const result = await defaultIntegratorInvoker({
      roadmapPath,
      resolvedQuestions: [resolvedQuestion],
      state,
      now: fixedNow,
    });

    expect(result.ok).toBe(true);
    expect(result.filesModified).toContain(roadmapPath);
    expect(result.unapplied).toHaveLength(0);

    const updated = readFileSync(roadmapPath, "utf-8");
    // Resolution was inserted into the vision section.
    expect(updated).toContain("Target users are solo indie developers");
    // The milestones section was NOT modified.
    const milestoneIdx = updated.indexOf("# milestones");
    const visionIdx = updated.indexOf("# vision");
    const resolutionIdx = updated.indexOf("Target users are solo indie developers");
    expect(milestoneIdx).toBeGreaterThan(0);
    // Resolution must appear BEFORE the milestones section.
    expect(resolutionIdx).toBeLessThan(milestoneIdx);
    // Resolution must appear AFTER the vision heading.
    expect(resolutionIdx).toBeGreaterThan(visionIdx);

    // Milestones section content unchanged (M1, M2 still present).
    expect(updated).toContain("M1, M2.");
  });

  it("increments state.round after driver integrator-pass step", async () => {
    // First pass to seed state with a resolved question.
    const stderrLines: string[] = [];
    const result1 = await runConvergePass({
      roadmapPath,
      slug: "ROADMAP",
      dimensions: [{ name: "vision", rubricRef: "protocols/roadmap-rubrics/vision.md" }],
      invokeReviewer: buildReviewerInvoker({ vision: redEnvelope([{ description: "Vision too vague" }]) }),
      stderr: (s) => stderrLines.push(s),
      now: fixedNow,
    });
    expect(result1.exitCode).toBe(0);
    expect(result1.state?.round).toBe(1);

    // Manually resolve the open question in state.
    const state = readState("ROADMAP").state!;
    const q = state.open_questions[0];
    state.open_questions = [
      {
        ...q,
        resolved_at: "2026-06-18T01:00:00Z",
        resolution: "Vision clarified: target solo developers.",
      },
    ];
    writeState("ROADMAP", state);

    // Second pass — driver should run integrator and increment round.
    const result2 = await runConvergePass({
      roadmapPath,
      slug: "ROADMAP",
      dimensions: [{ name: "vision", rubricRef: "protocols/roadmap-rubrics/vision.md" }],
      invokeReviewer: buildReviewerInvoker({ vision: greenEnvelope() }),
      stderr: (s) => stderrLines.push(s),
      now: () => new Date("2026-06-18T02:00:00Z"),
    });
    expect(result2.exitCode).toBe(0);
    expect(result2.state?.round).toBe(2);

    // ROADMAP.md should contain the resolution.
    const updated = readFileSync(roadmapPath, "utf-8");
    expect(updated).toContain("Vision clarified: target solo developers.");
  });

  it("recomputes content_hash after ROADMAP edit", async () => {
    const resolvedQuestion: OpenQuestionV1 = {
      id: "Q-01",
      dimension: "vision",
      text: "Who is this for?",
      asked_at: "2026-06-18T00:00:00Z",
      resolved_at: "2026-06-18T01:00:00Z",
      resolution: "This is for indie hackers.",
    };

    const state = makeFreshStateWithDimensions([{ name: "vision", status: "yellow" }]);
    const initialHash = state.content_hash;

    const result = await defaultIntegratorInvoker({
      roadmapPath,
      resolvedQuestions: [resolvedQuestion],
      state,
      now: fixedNow,
    });

    expect(result.ok).toBe(true);
    expect(result.newContentHash).not.toBe(initialHash);
    expect(result.newContentHash).toHaveLength(64); // sha256 hex
  });

  it("returns unapplied[] when section not found", async () => {
    const resolvedQuestion: OpenQuestionV1 = {
      id: "Q-01",
      dimension: "nonexistent-section",
      text: "Where is it?",
      asked_at: "2026-06-18T00:00:00Z",
      resolved_at: "2026-06-18T01:00:00Z",
      resolution: "It does not exist.",
    };

    const state = makeFreshStateWithDimensions([{ name: "nonexistent-section", status: "red" }]);

    const result = await defaultIntegratorInvoker({
      roadmapPath,
      resolvedQuestions: [resolvedQuestion],
      state,
      now: fixedNow,
    });

    expect(result.ok).toBe(true);
    expect(result.unapplied).toContain("Q-01");
    // ROADMAP.md should be unchanged.
    const content = readFileSync(roadmapPath, "utf-8");
    expect(content).toBe(ROADMAP_INITIAL);
  });

  it("skips dimension-archived questions (no ROADMAP edit)", async () => {
    const archivedQuestion: OpenQuestionV1 = {
      id: "Q-01",
      dimension: "vision",
      text: "Some vision question",
      asked_at: "2026-06-18T00:00:00Z",
      resolved_at: "2026-06-18T01:00:00Z",
      resolution: "dimension archived",
    };

    const state = makeFreshStateWithDimensions([]);
    state.archivedDimensions = [
      { name: "vision", reason: "no longer relevant", timestamp: "2026-06-18T01:00:00Z" },
    ];

    const result = await defaultIntegratorInvoker({
      roadmapPath,
      resolvedQuestions: [archivedQuestion],
      state,
      now: fixedNow,
    });

    expect(result.ok).toBe(true);
    expect(result.filesModified).toHaveLength(0);
    // ROADMAP.md should be unchanged.
    const content = readFileSync(roadmapPath, "utf-8");
    expect(content).toBe(ROADMAP_INITIAL);
  });
});

// ---------------------------------------------------------------------------
// S-19: Stall detector halts on two identical passes
// ---------------------------------------------------------------------------

describe("S-19: stall detection", () => {
  it("checkStall returns stalled=false when round < 2", () => {
    const state = makeFreshStateWithDimensions([{ name: "vision", status: "red" }]);
    state.round = 1;
    state.dimensionSnapshot = [{ name: "vision", status: "red" }];
    expect(checkStall({ state, resolvedThisRound: 0 }).stalled).toBe(false);
  });

  it("checkStall returns stalled=false when questions resolved this round", () => {
    const state = makeFreshStateWithDimensions([{ name: "vision", status: "red" }]);
    state.round = 2;
    state.dimensionSnapshot = [{ name: "vision", status: "red" }];
    expect(checkStall({ state, resolvedThisRound: 1 }).stalled).toBe(false);
  });

  it("checkStall returns stalled=false when statuses changed", () => {
    const state = makeFreshStateWithDimensions([{ name: "vision", status: "yellow" }]);
    state.round = 2;
    state.dimensionSnapshot = [{ name: "vision", status: "red" }]; // was red, now yellow
    expect(checkStall({ state, resolvedThisRound: 0 }).stalled).toBe(false);
  });

  it("checkStall returns stalled=true when round>=2, no resolved, statuses identical", () => {
    const state = makeFreshStateWithDimensions([{ name: "vision", status: "red" }]);
    state.round = 2;
    state.dimensionSnapshot = [{ name: "vision", status: "red" }];
    const result = checkStall({ state, resolvedThisRound: 0 });
    expect(result.stalled).toBe(true);
    if (result.stalled) {
      expect(result.reason).toMatch(/identical dimension statuses/);
    }
  });

  it("driver halts with STALL_DETECTED and exitCode=1 after two identical passes", async () => {
    const stderrLines: string[] = [];

    // First pass: vision=red, no resolved questions
    const result1 = await runConvergePass({
      roadmapPath,
      slug: "ROADMAP",
      dimensions: [{ name: "vision", rubricRef: "protocols/roadmap-rubrics/vision.md" }],
      invokeReviewer: buildReviewerInvoker({ vision: redEnvelope([{ description: "vision unclear" }]) }),
      stderr: (s) => stderrLines.push(s),
      now: fixedNow,
    });
    expect(result1.exitCode).toBe(0);
    expect(result1.state?.round).toBe(1);

    // Second pass: same red status, no questions resolved
    const result2 = await runConvergePass({
      roadmapPath,
      slug: "ROADMAP",
      dimensions: [{ name: "vision", rubricRef: "protocols/roadmap-rubrics/vision.md" }],
      invokeReviewer: buildReviewerInvoker({ vision: redEnvelope() }),
      stderr: (s) => stderrLines.push(s),
      now: () => new Date("2026-06-18T01:00:00Z"),
    });

    expect(result2.exitCode).toBe(1);
    expect(result2.reason).toBe("STALL_DETECTED");
    const stallMsg = stderrLines.find((l) => l.includes("STALL_DETECTED"));
    expect(stallMsg).toBeDefined();

    // State next_action_hint references retire-dimension or --force
    expect(result2.state?.next_action_hint).toMatch(/retire.dimension|--force/i);
  });
});

// ---------------------------------------------------------------------------
// S-20: Pass-cap halt when round equals passLimit
// ---------------------------------------------------------------------------

describe("S-20: pass-cap halt", () => {
  it("checkPassCap returns exceeded=false when round < passLimit", () => {
    const state = makeFreshStateWithDimensions([{ name: "vision", status: "red" }]);
    state.round = 2;
    state.passLimit = 3;
    expect(checkPassCap(state).exceeded).toBe(false);
  });

  it("checkPassCap returns exceeded=false when all-green at passLimit", () => {
    const state = makeFreshStateWithDimensions([{ name: "vision", status: "green" }]);
    state.round = 3;
    state.passLimit = 3;
    expect(checkPassCap(state).exceeded).toBe(false);
  });

  it("checkPassCap returns exceeded=true when round==passLimit with non-green", () => {
    const state = makeFreshStateWithDimensions([
      { name: "vision", status: "red" },
      { name: "milestones", status: "green" },
    ]);
    state.round = 3;
    state.passLimit = 3;
    const result = checkPassCap(state);
    expect(result.exceeded).toBe(true);
    if (result.exceeded) {
      expect(result.reason).toMatch(/Pass cap reached/);
      expect(result.reason).toMatch(/vision=red/);
    }
  });

  it("driver halts with PASS_CAP_REACHED at round==passLimit (default 3) with non-green", async () => {
    const stderrLines: string[] = [];

    async function runRedPass(round: number): Promise<void> {
      await runConvergePass({
        roadmapPath,
        slug: "ROADMAP",
        dimensions: [
          { name: "vision", rubricRef: "protocols/roadmap-rubrics/vision.md" },
        ],
        invokeReviewer: buildReviewerInvoker({
          vision: redEnvelope([{ description: "still red" }]),
        }),
        stderr: (s) => stderrLines.push(s),
        now: () => new Date(`2026-06-18T0${round}:00:00Z`),
        passLimit: 3,
      });
    }

    // Pass 1 — succeeds
    const result1 = await runConvergePass({
      roadmapPath,
      slug: "ROADMAP",
      dimensions: [{ name: "vision", rubricRef: "protocols/roadmap-rubrics/vision.md" }],
      invokeReviewer: buildReviewerInvoker({ vision: redEnvelope([{ description: "r1" }]) }),
      stderr: (s) => stderrLines.push(s),
      now: () => new Date("2026-06-18T01:00:00Z"),
      passLimit: 3,
    });
    expect(result1.exitCode).toBe(0);
    expect(result1.state?.round).toBe(1);

    // Pass 2 — we need statuses to differ so stall doesn't trigger first.
    // Resolve a question to avoid stall on pass 2.
    const stateAfter1 = readState("ROADMAP").state!;
    if (stateAfter1.open_questions.length > 0) {
      stateAfter1.open_questions[0] = {
        ...stateAfter1.open_questions[0],
        resolved_at: "2026-06-18T01:30:00Z",
        resolution: "Resolved for pass 2",
      };
      writeState("ROADMAP", stateAfter1);
    }

    const result2 = await runConvergePass({
      roadmapPath,
      slug: "ROADMAP",
      dimensions: [{ name: "vision", rubricRef: "protocols/roadmap-rubrics/vision.md" }],
      invokeReviewer: buildReviewerInvoker({ vision: redEnvelope([{ description: "r2" }]) }),
      stderr: (s) => stderrLines.push(s),
      now: () => new Date("2026-06-18T02:00:00Z"),
      passLimit: 3,
    });
    expect(result2.exitCode).toBe(0);
    expect(result2.state?.round).toBe(2);

    // Pass 3 — resolve another question to avoid stall.
    const stateAfter2 = readState("ROADMAP").state!;
    if (stateAfter2.open_questions.length > 0) {
      const unresolved = stateAfter2.open_questions.find((q) => !q.resolved_at);
      if (unresolved) {
        unresolved.resolved_at = "2026-06-18T02:30:00Z";
        unresolved.resolution = "Resolved for pass 3";
      }
      writeState("ROADMAP", stateAfter2);
    }

    const result3 = await runConvergePass({
      roadmapPath,
      slug: "ROADMAP",
      dimensions: [{ name: "vision", rubricRef: "protocols/roadmap-rubrics/vision.md" }],
      invokeReviewer: buildReviewerInvoker({ vision: redEnvelope() }),
      stderr: (s) => stderrLines.push(s),
      now: () => new Date("2026-06-18T03:00:00Z"),
      passLimit: 3,
    });

    expect(result3.exitCode).toBe(1);
    expect(result3.reason).toBe("PASS_CAP_REACHED");

    const capMsg = stderrLines.find((l) => l.includes("PASS_CAP_REACHED"));
    expect(capMsg).toBeDefined();

    // State hint should reference sign-off or blockers
    expect(result3.state?.next_action_hint).toMatch(/sign.off|blockers/i);
  });
});

// ---------------------------------------------------------------------------
// FC-05: retire-dimension auto-resolves orphan open_questions
// ---------------------------------------------------------------------------

describe("FC-05: retire-dimension auto-resolution", () => {
  it("autoResolveArchivedDimensions sets resolution='dimension archived' for matching questions", () => {
    const state = makeFreshStateWithDimensions([{ name: "vision", status: "red" }]);
    state.archivedDimensions = [
      { name: "vision", reason: "not needed", timestamp: "2026-06-18T00:00:00Z" },
    ];
    state.open_questions = [
      {
        id: "Q-01",
        dimension: "vision",
        text: "Some vision question",
        asked_at: "2026-06-18T00:00:00Z",
      },
      {
        id: "Q-02",
        dimension: "milestones",
        text: "Some milestones question",
        asked_at: "2026-06-18T00:00:00Z",
      },
    ];

    const updated = autoResolveArchivedDimensions(state, fixedNow);

    const q1 = updated.open_questions.find((q) => q.id === "Q-01")!;
    const q2 = updated.open_questions.find((q) => q.id === "Q-02")!;

    expect(q1.resolved_at).toBe("2026-06-18T00:00:00.000Z");
    expect(q1.resolution).toBe("dimension archived");
    // Non-matching dimension is untouched.
    expect(q2.resolved_at).toBeUndefined();
    expect(q2.resolution).toBeUndefined();
  });

  it("autoResolveArchivedDimensions does not modify already-resolved questions", () => {
    const state = makeFreshStateWithDimensions([]);
    state.archivedDimensions = [
      { name: "vision", reason: "done", timestamp: "2026-06-18T00:00:00Z" },
    ];
    state.open_questions = [
      {
        id: "Q-01",
        dimension: "vision",
        text: "Already resolved",
        asked_at: "2026-06-18T00:00:00Z",
        resolved_at: "2026-06-17T00:00:00Z",
        resolution: "manual resolution",
      },
    ];

    const updated = autoResolveArchivedDimensions(state, fixedNow);
    const q1 = updated.open_questions.find((q) => q.id === "Q-01")!;
    expect(q1.resolution).toBe("manual resolution");
    expect(q1.resolved_at).toBe("2026-06-17T00:00:00Z");
  });

  it("autoResolveArchivedDimensions is a no-op when archivedDimensions is empty", () => {
    const state = makeFreshStateWithDimensions([{ name: "vision", status: "red" }]);
    state.open_questions = [
      { id: "Q-01", dimension: "vision", text: "q", asked_at: "2026-06-18T00:00:00Z" },
    ];
    const result = autoResolveArchivedDimensions(state, fixedNow);
    // Returns same reference when no changes needed.
    expect(result).toBe(state);
  });

  it("driver runs auto-resolve in the same pass as archiving", async () => {
    const stderrLines: string[] = [];

    // First pass creates an open question for vision dimension.
    const result1 = await runConvergePass({
      roadmapPath,
      slug: "ROADMAP",
      dimensions: [{ name: "vision", rubricRef: "protocols/roadmap-rubrics/vision.md" }],
      invokeReviewer: buildReviewerInvoker({
        vision: redEnvelope([{ description: "vision unclear" }]),
      }),
      stderr: (s) => stderrLines.push(s),
      now: fixedNow,
    });
    expect(result1.exitCode).toBe(0);
    expect(result1.state?.open_questions.length).toBeGreaterThan(0);

    // Archive the vision dimension in state.
    const state = readState("ROADMAP").state!;
    state.archivedDimensions = [
      { name: "vision", reason: "out of scope", timestamp: "2026-06-18T01:00:00Z" },
    ];
    writeState("ROADMAP", state);

    // Second pass — with no dimensions (dimension archived), stall detector won't trip
    // because resolvedThisRound > 0 (auto-resolved questions count).
    // Run with an empty dimensions list to simulate archived dimension.
    const result2 = await runConvergePass({
      roadmapPath,
      slug: "ROADMAP",
      dimensions: [], // vision dimension archived
      invokeReviewer: async () => ({
        ok: false,
        status: "yellow",
        findings: [],
      }),
      stderr: (s) => stderrLines.push(s),
      now: () => new Date("2026-06-18T01:00:00Z"),
    });

    // After this pass, open_questions for vision should be auto-resolved.
    const finalState = readState("ROADMAP").state!;
    const visionQuestions = finalState.open_questions.filter(
      (q) => q.dimension === "vision"
    );
    for (const q of visionQuestions) {
      expect(q.resolved_at).toBeDefined();
      expect(q.resolution).toBe("dimension archived");
    }
  });
});

// ---------------------------------------------------------------------------
// INTEGRATOR_NO_ENVELOPE
// ---------------------------------------------------------------------------

describe("INTEGRATOR_NO_ENVELOPE rejection", () => {
  it("isIntegratorEnvelope returns false for non-envelope values", () => {
    expect(isIntegratorEnvelope(null)).toBe(false);
    expect(isIntegratorEnvelope("string")).toBe(false);
    expect(isIntegratorEnvelope({})).toBe(false);
    expect(isIntegratorEnvelope({ ok: true })).toBe(false);
  });

  it("isIntegratorEnvelope returns true for valid envelope", () => {
    const env: IntegratorEnvelope = {
      ok: true,
      filesModified: ["planning/ROADMAP.md"],
      newContentHash: "abc123",
      unapplied: [],
      summary: "ok",
    };
    expect(isIntegratorEnvelope(env)).toBe(true);
  });

  it("driver halts with INTEGRATOR_NO_ENVELOPE when invoker throws", async () => {
    const stderrLines: string[] = [];

    // First pass to create some resolved questions.
    await runConvergePass({
      roadmapPath,
      slug: "ROADMAP",
      dimensions: [{ name: "vision", rubricRef: "protocols/roadmap-rubrics/vision.md" }],
      invokeReviewer: buildReviewerInvoker({
        vision: redEnvelope([{ description: "unclear" }]),
      }),
      stderr: (s) => stderrLines.push(s),
      now: fixedNow,
    });

    // Manually resolve a question.
    const state = readState("ROADMAP").state!;
    if (state.open_questions.length > 0) {
      state.open_questions[0] = {
        ...state.open_questions[0],
        resolved_at: "2026-06-18T01:00:00Z",
        resolution: "Resolved.",
      };
      writeState("ROADMAP", state);
    }

    const badInvoker: IntegratorInvoker = async () => {
      throw new Error("agent crashed");
    };

    const result = await runConvergePass({
      roadmapPath,
      slug: "ROADMAP",
      dimensions: [{ name: "vision", rubricRef: "protocols/roadmap-rubrics/vision.md" }],
      invokeReviewer: buildReviewerInvoker({ vision: greenEnvelope() }),
      invokeIntegrator: badInvoker,
      stderr: (s) => stderrLines.push(s),
      now: () => new Date("2026-06-18T02:00:00Z"),
    });

    expect(result.exitCode).toBe(1);
    expect(result.reason).toBe("INTEGRATOR_NO_ENVELOPE");
    const msg = stderrLines.find((l) => l.includes("INTEGRATOR_NO_ENVELOPE"));
    expect(msg).toBeDefined();
  });

  it("driver halts with INTEGRATOR_NO_ENVELOPE when invoker returns non-envelope", async () => {
    const stderrLines: string[] = [];

    // First pass with a resolved question to trigger integrator.
    await runConvergePass({
      roadmapPath,
      slug: "ROADMAP",
      dimensions: [{ name: "vision", rubricRef: "protocols/roadmap-rubrics/vision.md" }],
      invokeReviewer: buildReviewerInvoker({
        vision: redEnvelope([{ description: "bad" }]),
      }),
      stderr: (s) => stderrLines.push(s),
      now: fixedNow,
    });

    const state = readState("ROADMAP").state!;
    if (state.open_questions.length > 0) {
      state.open_questions[0] = {
        ...state.open_questions[0],
        resolved_at: "2026-06-18T01:00:00Z",
        resolution: "Fixed.",
      };
      writeState("ROADMAP", state);
    }

    const badInvoker: IntegratorInvoker = async () => {
      // Return something that is not an IntegratorEnvelope.
      return "not an envelope" as unknown as IntegratorEnvelope;
    };

    const result = await runConvergePass({
      roadmapPath,
      slug: "ROADMAP",
      dimensions: [{ name: "vision", rubricRef: "protocols/roadmap-rubrics/vision.md" }],
      invokeReviewer: buildReviewerInvoker({ vision: greenEnvelope() }),
      invokeIntegrator: badInvoker,
      stderr: (s) => stderrLines.push(s),
      now: () => new Date("2026-06-18T02:00:00Z"),
    });

    expect(result.exitCode).toBe(1);
    expect(result.reason).toBe("INTEGRATOR_NO_ENVELOPE");
  });
});

// ---------------------------------------------------------------------------
// StageContext for integrator pass
// ---------------------------------------------------------------------------

describe("execute-integrator.toon StageContext", () => {
  it("writes execute-integrator.toon atomically after a pass", async () => {
    const stderrLines: string[] = [];
    await runConvergePass({
      roadmapPath,
      slug: "ROADMAP",
      dimensions: [{ name: "vision", rubricRef: "protocols/roadmap-rubrics/vision.md" }],
      invokeReviewer: buildReviewerInvoker({ vision: greenEnvelope() }),
      stderr: (s) => stderrLines.push(s),
      now: fixedNow,
    });

    expect(existsSync(EXECUTE_INTEGRATOR_STAGE_CONTEXT_PATH)).toBe(true);

    const content = readFileSync(EXECUTE_INTEGRATOR_STAGE_CONTEXT_PATH, "utf-8");
    expect(content).toMatch(/stage: execute-integrator/);
    expect(content).toMatch(/wave: 5/);
  });
});
