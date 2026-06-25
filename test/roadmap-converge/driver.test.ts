/**
 * Vitest coverage for scripts/roadmap-converge/driver.ts.
 *
 * Covers AC: reviewer 5-cap per dimension (not aggregate), reviewer-rendering
 * dispatch for each of green/yellow/red, no-op archetype hook returns null
 * without modifying state, content-hash invalidation, stage-context atomic
 * write, REVIEWER_NO_ENVELOPE handling, round-start banner.
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
import { dirname, join } from "node:path";

import {
  EXECUTE_STAGE_CONTEXT_PATH,
  noopArchetypeDetectionHook,
  parseRubric,
  PER_DIMENSION_FINDING_CAP,
  renderFinding,
  runConvergePass,
  type ReviewerEnvelope,
  type ReviewerInvoker,
} from "../../scripts/roadmap-converge/driver.js";
import { readState, stateFileFor } from "../../scripts/roadmap-converge/state-io.js";

let workdir: string;
let originalCwd: string;
let roadmapPath: string;
let rubricPath: string;

const ROADMAP_BODY = `# vision\n\nA roadmap for solo developers.\n\n# milestones\n\nM1, M2.\n`;
const RUBRIC_BODY = `# Rubric: Vision\n\nFraming.\n\n## Green\n\nGreen exemplar text.\n\n## Yellow\n\nYellow exemplar text.\n\n## Red\n\nRed exemplar text.\n`;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "roadmap-converge-driver-"));
  originalCwd = process.cwd();
  process.chdir(workdir);

  mkdirSync("planning", { recursive: true });
  mkdirSync("protocols/roadmap-rubrics", { recursive: true });
  roadmapPath = "planning/ROADMAP.md";
  rubricPath = "protocols/roadmap-rubrics/vision.md";
  writeFileSync(roadmapPath, ROADMAP_BODY);
  writeFileSync(rubricPath, RUBRIC_BODY);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(workdir, { recursive: true, force: true });
});

function buildInvoker(envelopesByDim: Record<string, ReviewerEnvelope>): ReviewerInvoker {
  return async ({ dimensionName }) => {
    const env = envelopesByDim[dimensionName];
    if (!env) throw new Error(`no envelope for ${dimensionName}`);
    return env;
  };
}

function defaultEnvelope(status: "green" | "yellow" | "red"): ReviewerEnvelope {
  return {
    ok: true,
    status,
    findings: [],
    evidence: "ok",
    evidenceRef: ["#vision"],
    blockers: [],
  };
}

describe("runConvergePass — happy path", () => {
  it("writes state.toon with round=1, content_hash set, dimensions present", async () => {
    const stderr: string[] = [];
    const result = await runConvergePass({
      roadmapPath,
      slug: "ROADMAP",
      dimensions: [{ name: "vision", rubricRef: rubricPath }],
      invokeReviewer: buildInvoker({ vision: defaultEnvelope("green") }),
      stderr: (s) => stderr.push(s),
      now: () => new Date("2026-06-17T00:00:00Z"),
    });
    expect(result.exitCode).toBe(0);
    expect(result.state).not.toBeNull();
    expect(result.state?.round).toBe(1);
    expect(result.state?.content_hash.length).toBe(64);
    expect(result.state?.dimensions).toHaveLength(1);
    expect(existsSync(stateFileFor("ROADMAP"))).toBe(true);
    expect(existsSync(EXECUTE_STAGE_CONTEXT_PATH)).toBe(true);

    // Banner emitted
    const banner = stderr.find((l) => l.includes("pass 1/3 starting for ROADMAP"));
    expect(banner).toBeDefined();
    expect(banner).toMatch(/1 dimensions, 0 open/);
  });
});

describe("runConvergePass — 5-cap per dimension (AW-15)", () => {
  it("keeps 5 findings in open_questions, drops 3 to suppressedFindings, emits footer", async () => {
    const stderr: string[] = [];
    const env: ReviewerEnvelope = {
      ok: true,
      status: "red",
      findings: Array.from({ length: 8 }, (_, i) => ({
        severity: "warning" as const,
        description: `finding ${i + 1}`,
      })),
    };
    const result = await runConvergePass({
      roadmapPath,
      slug: "ROADMAP",
      dimensions: [{ name: "vision", rubricRef: rubricPath }],
      invokeReviewer: buildInvoker({ vision: env }),
      stderr: (s) => stderr.push(s),
      now: () => new Date("2026-06-17T00:00:00Z"),
    });
    expect(result.state?.open_questions).toHaveLength(PER_DIMENSION_FINDING_CAP);
    expect(result.state?.suppressedFindings).toHaveLength(3);
    const footer = stderr.find((l) => /3 suppressed for vision/.test(l));
    expect(footer).toBeDefined();
  });

  it("cap is PER-dimension, not aggregate (two dimensions with 4 findings each = 8 kept)", async () => {
    const mkEnv = (status: "red" | "yellow"): ReviewerEnvelope => ({
      ok: true,
      status,
      findings: Array.from({ length: 4 }, (_, i) => ({
        severity: "warning" as const,
        description: `f${i}`,
      })),
    });
    writeFileSync(
      "protocols/roadmap-rubrics/milestones.md",
      RUBRIC_BODY
    );
    const result = await runConvergePass({
      roadmapPath,
      slug: "ROADMAP",
      dimensions: [
        { name: "vision", rubricRef: rubricPath },
        { name: "milestones", rubricRef: "protocols/roadmap-rubrics/milestones.md" },
      ],
      invokeReviewer: buildInvoker({
        vision: mkEnv("red"),
        milestones: mkEnv("yellow"),
      }),
      stderr: () => {},
      now: () => new Date("2026-06-17T00:00:00Z"),
    });
    expect(result.state?.open_questions).toHaveLength(8);
    expect(result.state?.suppressedFindings).toHaveLength(0);
  });
});

describe("rendering rule (F-15, P-03)", () => {
  const rubric = parseRubric(RUBRIC_BODY);

  it("green status → emits finding description verbatim, no exemplars appended", () => {
    const out = renderFinding(
      { severity: "warning", description: "base" },
      "green",
      rubric
    );
    expect(out).toBe("base");
    expect(out).not.toMatch(/Green-band exemplar/);
    expect(out).not.toMatch(/Red-band exemplar/);
  });

  it("yellow status → appends green-band exemplar only", () => {
    const out = renderFinding(
      { severity: "warning", description: "base" },
      "yellow",
      rubric
    );
    expect(out).toMatch(/Green-band exemplar/);
    expect(out).toMatch(/Green exemplar text/);
    expect(out).not.toMatch(/Red-band exemplar/);
  });

  it("red status → appends BOTH green-band and red-band exemplars", () => {
    const out = renderFinding(
      { severity: "blocking", description: "base" },
      "red",
      rubric
    );
    expect(out).toMatch(/Green-band exemplar/);
    expect(out).toMatch(/Green exemplar text/);
    expect(out).toMatch(/Red-band exemplar/);
    expect(out).toMatch(/Red exemplar text/);
  });

  it("parseRubric parses Green/Yellow/Red sections (case-insensitive)", () => {
    expect(rubric.green).toMatch(/Green exemplar text/);
    expect(rubric.yellow).toMatch(/Yellow exemplar text/);
    expect(rubric.red).toMatch(/Red exemplar text/);
  });

  it("missing rubric sections degrade gracefully to empty", () => {
    const partial = parseRubric("# title\n\nno sections here\n");
    expect(partial).toEqual({ green: "", yellow: "", red: "" });
  });
});

describe("archetype hook seam (P-02)", () => {
  it("no-op default returns null without modifying state", async () => {
    const result = await noopArchetypeDetectionHook(roadmapPath, null);
    expect(result).toBeNull();
  });

  it("driver preserves prior archetype when hook returns null", async () => {
    // Seed prior state with non-default archetype
    const r1 = await runConvergePass({
      roadmapPath,
      slug: "ROADMAP",
      dimensions: [{ name: "vision", rubricRef: rubricPath }],
      invokeReviewer: buildInvoker({ vision: defaultEnvelope("green") }),
      stderr: () => {},
      now: () => new Date("2026-06-17T00:00:00Z"),
    });
    // Manually overwrite state.archetype to simulate Phase 4 having set it
    const seeded = readState("ROADMAP").state!;
    seeded.archetype = "cli";
    writeFileSync(
      stateFileFor("ROADMAP"),
      readFileSync(stateFileFor("ROADMAP"), "utf-8").replace(
        /archetype: \S+/,
        "archetype: cli"
      )
    );

    const r2 = await runConvergePass({
      roadmapPath,
      slug: "ROADMAP",
      dimensions: [{ name: "vision", rubricRef: rubricPath }],
      invokeReviewer: buildInvoker({ vision: defaultEnvelope("green") }),
      stderr: () => {},
      now: () => new Date("2026-06-17T00:05:00Z"),
      // explicit no-op hook
      archetypeDetectionHook: noopArchetypeDetectionHook,
    });
    expect(r1.exitCode).toBe(0);
    expect(r2.state?.archetype).toBe("cli");
  });
});

describe("content-hash invalidation", () => {
  it("hash change between passes flips all dimensions to delta_since_last=invalidated", async () => {
    // pass 1
    await runConvergePass({
      roadmapPath,
      slug: "ROADMAP",
      dimensions: [{ name: "vision", rubricRef: rubricPath }],
      invokeReviewer: buildInvoker({ vision: defaultEnvelope("green") }),
      stderr: () => {},
      now: () => new Date("2026-06-17T00:00:00Z"),
    });
    // mutate roadmap
    writeFileSync(roadmapPath, ROADMAP_BODY + "\n# new section\n");
    const stderr: string[] = [];
    const r2 = await runConvergePass({
      roadmapPath,
      slug: "ROADMAP",
      dimensions: [{ name: "vision", rubricRef: rubricPath }],
      invokeReviewer: buildInvoker({ vision: defaultEnvelope("green") }),
      stderr: (s) => stderr.push(s),
      now: () => new Date("2026-06-17T00:05:00Z"),
    });
    expect(r2.state?.dimensions[0].delta_since_last).toBe("invalidated");
    expect(stderr.some((l) => /changed since last pass/.test(l))).toBe(true);
  });
});

describe("REVIEWER_NO_ENVELOPE handling (AW-16)", () => {
  it("non-envelope reviewer is skipped with warning; other dimensions proceed", async () => {
    writeFileSync(
      "protocols/roadmap-rubrics/milestones.md",
      RUBRIC_BODY
    );
    const stderr: string[] = [];
    const invoker: ReviewerInvoker = async ({ dimensionName }) => {
      if (dimensionName === "milestones") {
        return {
          ok: false,
          status: "yellow",
          findings: [],
        };
      }
      return defaultEnvelope("green");
    };
    const r = await runConvergePass({
      roadmapPath,
      slug: "ROADMAP",
      dimensions: [
        { name: "vision", rubricRef: rubricPath },
        { name: "milestones", rubricRef: "protocols/roadmap-rubrics/milestones.md" },
      ],
      invokeReviewer: invoker,
      stderr: (s) => stderr.push(s),
      now: () => new Date("2026-06-17T00:00:00Z"),
    });
    expect(r.exitCode).toBe(0);
    expect(r.state?.dimensions).toHaveLength(2);
    const milestones = r.state?.dimensions.find((d) => d.name === "milestones");
    expect(milestones?.delta_since_last).toBe("same");
    expect(stderr.some((l) => /REVIEWER_NO_ENVELOPE for milestones/.test(l))).toBe(
      true
    );
  });
});

describe("stage-context write (AW-03)", () => {
  it("writes execute.toon atomically on pass completion", async () => {
    await runConvergePass({
      roadmapPath,
      slug: "ROADMAP",
      dimensions: [{ name: "vision", rubricRef: rubricPath }],
      invokeReviewer: buildInvoker({ vision: defaultEnvelope("green") }),
      stderr: () => {},
      now: () => new Date("2026-06-17T00:00:00Z"),
    });
    expect(existsSync(EXECUTE_STAGE_CONTEXT_PATH)).toBe(true);
    expect(existsSync(EXECUTE_STAGE_CONTEXT_PATH + ".tmp")).toBe(false);
    const body = readFileSync(EXECUTE_STAGE_CONTEXT_PATH, "utf-8");
    expect(body).toMatch(/^stage: execute$/m);
    expect(body).toMatch(/^wave: 1$/m);
    expect(body).toMatch(/^iteration: 0$/m);
    expect(body).toMatch(/^summary: /m);
  });
});

describe("lock conflict abort path", () => {
  it("second pass while first holds the lock exits 1 with LOCK_CONFLICT", async () => {
    // Acquire the lock manually so the driver sees a fresh held lock.
    mkdirSync(".roadmap-converge/ROADMAP", { recursive: true });
    writeFileSync(
      ".roadmap-converge/ROADMAP/.lock",
      `pid: 12345\nstarted_at: ${new Date().toISOString()}\n`
    );
    const stderr: string[] = [];
    const r = await runConvergePass({
      roadmapPath,
      slug: "ROADMAP",
      dimensions: [{ name: "vision", rubricRef: rubricPath }],
      invokeReviewer: buildInvoker({ vision: defaultEnvelope("green") }),
      stderr: (s) => stderr.push(s),
    });
    expect(r.exitCode).toBe(1);
    expect(r.reason).toBe("LOCK_CONFLICT");
    expect(stderr.some((l) => /LOCK_CONFLICT/.test(l))).toBe(true);
  });
});

describe("sign-off eligibility transition", () => {
  it("sets sign_off_state=eligible when all dimensions are green and no open questions", async () => {
    const r = await runConvergePass({
      roadmapPath,
      slug: "ROADMAP",
      dimensions: [{ name: "vision", rubricRef: rubricPath }],
      invokeReviewer: buildInvoker({ vision: defaultEnvelope("green") }),
      stderr: () => {},
      now: () => new Date("2026-06-17T00:00:00Z"),
    });
    expect(r.exitCode).toBe(0);
    expect(r.state?.sign_off_state).toBe("eligible");
    const { state: disk } = readState("ROADMAP");
    expect(disk?.sign_off_state).toBe("eligible");
  });

  it("keeps sign_off_state=not-eligible when any dimension is yellow", async () => {
    const r = await runConvergePass({
      roadmapPath,
      slug: "ROADMAP",
      dimensions: [{ name: "vision", rubricRef: rubricPath }],
      invokeReviewer: buildInvoker({ vision: defaultEnvelope("yellow") }),
      stderr: () => {},
      now: () => new Date("2026-06-17T00:00:00Z"),
    });
    expect(r.state?.sign_off_state).toBe("not-eligible");
  });

  it("does not overwrite sign_off_state=signed-off (purity boundary)", async () => {
    // First pass to green → eligible
    await runConvergePass({
      roadmapPath,
      slug: "ROADMAP",
      dimensions: [{ name: "vision", rubricRef: rubricPath }],
      invokeReviewer: buildInvoker({ vision: defaultEnvelope("green") }),
      stderr: () => {},
      now: () => new Date("2026-06-17T00:00:00Z"),
    });
    // Mutate to signed-off (simulating sign-off.ts having run)
    const { state } = readState("ROADMAP");
    state!.sign_off_state = "signed-off";
    const { writeState } = await import("../../scripts/roadmap-converge/state-io.js");
    writeState("ROADMAP", state!);

    // Next driver pass MUST NOT downgrade signed-off
    const r = await runConvergePass({
      roadmapPath,
      slug: "ROADMAP",
      dimensions: [{ name: "vision", rubricRef: rubricPath }],
      invokeReviewer: buildInvoker({ vision: defaultEnvelope("green") }),
      stderr: () => {},
      now: () => new Date("2026-06-17T00:00:00Z"),
    });
    expect(r.state?.sign_off_state).toBe("signed-off");
  });
});

describe("stall detection — dimensionSnapshot ordering", () => {
  it("does NOT false-fire when current pass's statuses match prior snapshot but no questions resolved (round 2 baseline)", async () => {
    // Round 1: green pass — writes snapshot=[vision=green] at end.
    await runConvergePass({
      roadmapPath,
      slug: "ROADMAP",
      dimensions: [{ name: "vision", rubricRef: rubricPath }],
      invokeReviewer: buildInvoker({ vision: defaultEnvelope("green") }),
      stderr: () => {},
      now: () => new Date("2026-06-17T00:00:00Z"),
    });

    // Round 2: same green statuses, no resolutions.
    // Pre-fix this would false-fire STALL_DETECTED because the snapshot was
    // overwritten to the current pass's statuses before checkStall ran.
    // Post-fix the prior snapshot is preserved across the reviewer fan-out.
    const stderr: string[] = [];
    const r = await runConvergePass({
      roadmapPath,
      slug: "ROADMAP",
      dimensions: [{ name: "vision", rubricRef: rubricPath }],
      invokeReviewer: buildInvoker({ vision: defaultEnvelope("green") }),
      stderr: (s) => stderr.push(s),
      now: () => new Date("2026-06-17T00:00:01Z"),
    });

    // All-green at round 2 is a converged state, not a stall.
    expect(
      r.exitCode,
      `expected 0, got ${r.exitCode} reason=${r.reason} stderr=${stderr.join(" | ")}`
    ).toBe(0);
    expect(r.reason).toBeUndefined();
    expect(stderr.some((l) => /STALL_DETECTED/.test(l))).toBe(false);
    expect(r.state?.sign_off_state).toBe("eligible");
  });
});

describe("pre-flight: missing roadmap", () => {
  it("exits 1 with ROADMAP_MISSING when the roadmap file is absent", async () => {
    const stderr: string[] = [];
    const r = await runConvergePass({
      roadmapPath: "planning/DOES-NOT-EXIST.md",
      slug: "DOES-NOT-EXIST",
      dimensions: [],
      invokeReviewer: buildInvoker({}),
      stderr: (s) => stderr.push(s),
    });
    expect(r.exitCode).toBe(1);
    expect(r.reason).toBe("ROADMAP_MISSING");
    expect(stderr.some((l) => /roadmap not readable/.test(l))).toBe(true);
  });
});

describe("no duplicate open_questions across passes (finding 1)", () => {
  it("two passes against a dimension that stays yellow produce ONE question, not two", async () => {
    const yellowEnvWithFinding: ReviewerEnvelope = {
      ok: true,
      status: "yellow",
      findings: [{ severity: "warning", description: "still yellow" }],
    };

    // Pass 1: dimension is yellow, one finding emitted.
    const r1 = await runConvergePass({
      roadmapPath,
      slug: "ROADMAP",
      dimensions: [{ name: "vision", rubricRef: rubricPath }],
      invokeReviewer: buildInvoker({ vision: yellowEnvWithFinding }),
      stderr: () => {},
      now: () => new Date("2026-06-17T00:00:00Z"),
    });
    expect(r1.exitCode).toBe(0);
    expect(r1.state?.open_questions).toHaveLength(1);

    // Pass 2: same dimension still yellow, same finding — should NOT duplicate.
    // The stall detector fires (same statuses, no resolutions), so exitCode=1
    // with reason STALL_DETECTED is expected. The key assertion is that the
    // returned state has exactly 1 unresolved open question (not 2 accumulated).
    const r2 = await runConvergePass({
      roadmapPath,
      slug: "ROADMAP",
      dimensions: [{ name: "vision", rubricRef: rubricPath }],
      invokeReviewer: buildInvoker({ vision: yellowEnvWithFinding }),
      stderr: () => {},
      now: () => new Date("2026-06-17T00:01:00Z"),
    });
    // Must still be 1 (the fresh finding from this pass), not 2 (accumulated).
    expect(r2.state?.open_questions.filter((q) => !q.resolved_at)).toHaveLength(1);
  });
});

describe("parseRubric — subheadings inside a band are preserved (finding 2)", () => {
  it("### Subheading inside Green block is not truncated before ## Yellow", () => {
    const rubricWithSubheadings = [
      "# Rubric",
      "",
      "## Green",
      "",
      "Green intro.",
      "",
      "### Subheading",
      "",
      "More green content under subheading.",
      "",
      "## Yellow",
      "",
      "Yellow content.",
      "",
      "## Red",
      "",
      "Red content.",
    ].join("\n");

    const sections = parseRubric(rubricWithSubheadings);
    // Green section must include content after the ### Subheading.
    expect(sections.green).toMatch(/Green intro/);
    expect(sections.green).toMatch(/Subheading/);
    expect(sections.green).toMatch(/More green content under subheading/);
    // Green section must NOT bleed into Yellow or Red.
    expect(sections.green).not.toMatch(/Yellow content/);
    expect(sections.green).not.toMatch(/Red content/);
    // Yellow and Red must be parsed correctly too.
    expect(sections.yellow).toMatch(/Yellow content/);
    expect(sections.red).toMatch(/Red content/);
  });
});
