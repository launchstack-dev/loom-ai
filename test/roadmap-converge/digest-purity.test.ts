/**
 * S-12, S-13, S-14 + digest purity grep guard.
 *
 * S-12: /loom-roadmap status renders digest with all required fields.
 * S-13: No files in .roadmap-converge are modified by status (purity).
 * S-14: resume-delegate places the more-recently-modified state first.
 *
 * Purity grep guard: no code path in digest.ts or status.md writes to disk.
 * The guard scans scripts/roadmap-converge/digest.ts for write-primitive usage
 * (writeFileSync, renameSync, mkdirSync, appendFileSync) and asserts zero
 * matches outside comment lines.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  buildDigest,
  buildDimensionStatusLine,
  renderDigest,
  renderDigestFromState,
  type RoadmapConvergeDigest,
} from "../../scripts/roadmap-converge/digest.js";
import {
  buildResumeDigests,
  orderByMtime,
  type StateExistenceCheck,
} from "../../scripts/roadmap-converge/resume-delegate.js";
import { encodeRoadmapConvergeStateToon } from "../../scripts/roadmap-converge/state-io.js";
import type { RoadmapConvergeStateV1 } from "../../scripts/migrators/roadmap-converge-state/index.js";

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let workdir: string;
let originalCwd: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "roadmap-converge-digest-"));
  originalCwd = process.cwd();
  process.chdir(workdir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(workdir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function sampleState(overrides: Partial<RoadmapConvergeStateV1> = {}): RoadmapConvergeStateV1 {
  return {
    schemaVersion: 1,
    roadmapPath: "planning/ROADMAP.md",
    roadmapSlug: "ROADMAP",
    archetype: "default",
    round: 2,
    passLimit: 3,
    roadmap_diff_summary: "+12 -3",
    paused_at: "2026-06-17T12:00:00Z",
    last_reviewer: "roadmap-converge-reviewer",
    next_action_hint: "/loom-roadmap converge",
    content_hash: "abc123",
    sign_off_state: "not-eligible",
    dimensions: [
      {
        name: "vision",
        status: "green",
        evidence: "Vision is clear",
        blockers: [],
        evidenceRef: ["#vision"],
        delta_since_last: "improved",
      },
      {
        name: "milestones",
        status: "yellow",
        evidence: "Missing effort estimates",
        blockers: ["No effort sizing on M-02"],
        evidenceRef: [],
        delta_since_last: "same",
      },
      {
        name: "tool-selection",
        status: "red",
        evidence: "No rationale for runtime choice",
        blockers: ["Missing tech stack section"],
        evidenceRef: [],
        delta_since_last: "degraded",
      },
    ],
    dimensionSnapshot: [],
    open_questions: [
      {
        id: "Q-01",
        dimension: "milestones",
        text: "What is the target deployment environment?",
        asked_at: "2026-06-17T11:00:00Z",
      },
      {
        id: "Q-02",
        dimension: "tool-selection",
        text: "Why was Node.js chosen over Deno?",
        asked_at: "2026-06-17T11:00:00Z",
      },
      {
        id: "Q-03",
        dimension: "vision",
        text: "Who is the primary user persona?",
        asked_at: "2026-06-17T11:00:00Z",
        resolved_at: "2026-06-17T14:00:00Z",
        resolution: "Answered: solo developers",
      },
    ],
    archivedDimensions: [],
    suppressedFindings: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// S-12: Status renders digest with all required fields
// ---------------------------------------------------------------------------

describe("S-12: buildDigest + renderDigest produce all required fields", () => {
  it("buildDigest maps state fields to digest correctly", () => {
    const state = sampleState();
    const digest = buildDigest(state);

    expect(digest.slug).toBe("ROADMAP");
    expect(digest.roadmapPath).toBe("planning/ROADMAP.md");
    expect(digest.passNumber).toBe(2);
    expect(digest.passLimit).toBe(3);
    expect(digest.lastTouched).toBe("2026-06-17T12:00:00Z");
    expect(digest.openQuestionCount).toBe(2); // Q-03 is resolved
    expect(digest.firstQuestion).toBe("What is the target deployment environment?");
    expect(digest.diffSinceLastPass).toBe("+12 -3");
    expect(digest.nextActionCommand).toBe("/loom-roadmap converge");
    expect(digest.signOffState).toBe("not-eligible");
  });

  it("openQuestionCount counts only unresolved questions", () => {
    const state = sampleState();
    // Q-01 and Q-02 have no resolved_at; Q-03 has resolved_at
    const digest = buildDigest(state);
    expect(digest.openQuestionCount).toBe(2);
  });

  it("firstQuestion is verbatim text of the first unresolved question", () => {
    const state = sampleState();
    const digest = buildDigest(state);
    expect(digest.firstQuestion).toBe("What is the target deployment environment?");
  });

  it("renderDigest contains pass number", () => {
    const state = sampleState();
    const rendered = renderDigestFromState(state);
    expect(rendered).toContain("Pass: 2/3");
  });

  it("renderDigest contains last-touched timestamp", () => {
    const state = sampleState();
    const rendered = renderDigestFromState(state);
    expect(rendered).toContain("2026-06-17T12:00:00Z");
  });

  it("renderDigest contains dimensionStatusLine with glyphs", () => {
    const state = sampleState();
    const rendered = renderDigestFromState(state);
    expect(rendered).toContain("✓");
    expect(rendered).toContain("⚠");
    expect(rendered).toContain("✗");
  });

  it("renderDigest contains open question count as label", () => {
    const state = sampleState();
    const rendered = renderDigestFromState(state);
    expect(rendered).toContain("2 open questions");
  });

  it("renderDigest contains first unresolved question verbatim", () => {
    const state = sampleState();
    const rendered = renderDigestFromState(state);
    expect(rendered).toContain("What is the target deployment environment?");
  });

  it("renderDigest contains diff since last pass", () => {
    const state = sampleState();
    const rendered = renderDigestFromState(state);
    expect(rendered).toContain("+12 -3");
  });

  it("renderDigest contains next-action command", () => {
    const state = sampleState();
    const rendered = renderDigestFromState(state);
    expect(rendered).toContain("/loom-roadmap converge");
  });

  it("convergence target: 3 unresolved questions → literal '3 open questions' + first question verbatim", () => {
    const state = sampleState({
      open_questions: [
        {
          id: "Q-01",
          dimension: "vision",
          text: "What is the target deployment environment?",
          asked_at: "2026-06-17T11:00:00Z",
        },
        {
          id: "Q-02",
          dimension: "milestones",
          text: "Why was Node.js chosen over Deno?",
          asked_at: "2026-06-17T11:00:00Z",
        },
        {
          id: "Q-03",
          dimension: "tool-selection",
          text: "Who is the primary user persona?",
          asked_at: "2026-06-17T11:00:00Z",
        },
      ],
    });
    const rendered = renderDigestFromState(state);
    expect(rendered).toContain("3 open questions");
    expect(rendered).toContain("What is the target deployment environment?");
  });

  it("singular label '1 open question' when exactly one open question", () => {
    const state = sampleState({
      open_questions: [
        {
          id: "Q-01",
          dimension: "vision",
          text: "Singleton question text",
          asked_at: "2026-06-17T11:00:00Z",
        },
      ],
    });
    const rendered = renderDigestFromState(state);
    expect(rendered).toContain("1 open question");
    expect(rendered).not.toContain("1 open questions");
  });

  it("0 open questions → '0 open questions', no firstQuestion", () => {
    const state = sampleState({ open_questions: [] });
    const rendered = renderDigestFromState(state);
    expect(rendered).toContain("0 open questions");
    const digest = buildDigest(state);
    expect(digest.firstQuestion).toBeUndefined();
  });

  it("buildDimensionStatusLine maps status to correct glyphs", () => {
    const state = sampleState();
    const line = buildDimensionStatusLine(state.dimensions);
    expect(line).toContain("✓ vision");
    expect(line).toContain("⚠ milestones");
    expect(line).toContain("✗ tool-selection");
  });

  it("buildDimensionStatusLine returns empty string for empty dimensions", () => {
    expect(buildDimensionStatusLine([])).toBe("");
  });

  it("signOffState signed-off includes signOffAt in digest", () => {
    const state = sampleState({
      sign_off_state: "signed-off",
      sign_off_at: "2026-06-17T15:00:00Z",
    });
    const digest = buildDigest(state);
    expect(digest.signOffState).toBe("signed-off");
    expect(digest.signOffAt).toBe("2026-06-17T15:00:00Z");
    const rendered = renderDigest(digest);
    expect(rendered).toContain("2026-06-17T15:00:00Z");
  });
});

// ---------------------------------------------------------------------------
// S-13: No files are written during status rendering (purity)
// ---------------------------------------------------------------------------

describe("S-13: digest.ts purity — no disk writes", () => {
  it("renderDigestFromState does not create new files in the workdir", () => {
    const state = sampleState();
    const before = listFilesSync(workdir);
    renderDigestFromState(state);
    const after = listFilesSync(workdir);
    expect(after).toEqual(before);
  });

  it("renderDigest is byte-identical on two consecutive invocations without state changes", () => {
    const state = sampleState();
    const digest = buildDigest(state);
    const first = renderDigest(digest);
    const second = renderDigest(digest);
    expect(first).toBe(second);
  });

  it("renderDigestFromState is byte-identical on two consecutive calls with same state", () => {
    const state = sampleState();
    const first = renderDigestFromState(state);
    const second = renderDigestFromState(state);
    expect(first).toBe(second);
  });
});

// ---------------------------------------------------------------------------
// S-13 grep guard: no write primitives in digest.ts
// ---------------------------------------------------------------------------

describe("S-13 grep guard: digest.ts contains no disk-write calls", () => {
  const DIGEST_FILE = resolve(__dirname, "..", "..", "scripts", "roadmap-converge", "digest.ts");

  /**
   * Strip line comments before pattern matching so commentary about "no writes"
   * does not false-positive on the word "writeFileSync" in a comment.
   */
  function stripLineComments(source: string): string {
    return source
      .split("\n")
      .map((line) => {
        const idx = line.indexOf("//");
        if (idx === -1) return line;
        const before = line.slice(0, idx);
        const dq = (before.match(/"/g) ?? []).length;
        const sq = (before.match(/'/g) ?? []).length;
        if (dq % 2 === 1 || sq % 2 === 1) return line;
        return before;
      })
      .join("\n");
  }

  it("digest.ts does not call writeFileSync", () => {
    const source = readFileSync(DIGEST_FILE, "utf-8");
    const stripped = stripLineComments(source);
    expect(stripped).not.toMatch(/\bwriteFileSync\s*\(/);
  });

  it("digest.ts does not call renameSync", () => {
    const source = readFileSync(DIGEST_FILE, "utf-8");
    const stripped = stripLineComments(source);
    expect(stripped).not.toMatch(/\brenameSync\s*\(/);
  });

  it("digest.ts does not call mkdirSync", () => {
    const source = readFileSync(DIGEST_FILE, "utf-8");
    const stripped = stripLineComments(source);
    expect(stripped).not.toMatch(/\bmkdirSync\s*\(/);
  });

  it("digest.ts does not call appendFileSync", () => {
    const source = readFileSync(DIGEST_FILE, "utf-8");
    const stripped = stripLineComments(source);
    expect(stripped).not.toMatch(/\bappendFileSync\s*\(/);
  });

  it("digest.ts does not call fs.writeFile (async)", () => {
    const source = readFileSync(DIGEST_FILE, "utf-8");
    const stripped = stripLineComments(source);
    // Check for both writeFile (async) and the callback form
    expect(stripped).not.toMatch(/\bwriteFile\s*\(/);
  });
});

// ---------------------------------------------------------------------------
// S-14: resume-delegate ordering (most-recently-modified first)
// ---------------------------------------------------------------------------

describe("S-14: resume-delegate orders by mtime descending", () => {
  it("orderByMtime returns only existing entries, most recent first", () => {
    const checks: StateExistenceCheck[] = [
      {
        path: ".plan-execution/pipeline-state.toon",
        exists: true,
        mtimeMs: 1000,
        kind: "pipeline-state",
      },
      {
        path: ".roadmap-converge/ROADMAP/state.toon",
        exists: true,
        mtimeMs: 2000,
        kind: "roadmap-converge",
        slug: "ROADMAP",
      },
    ];
    const ordered = orderByMtime(checks);
    expect(ordered[0].kind).toBe("roadmap-converge");
    expect(ordered[1].kind).toBe("pipeline-state");
  });

  it("orderByMtime excludes non-existent entries", () => {
    const checks: StateExistenceCheck[] = [
      {
        path: ".plan-execution/pipeline-state.toon",
        exists: false,
        mtimeMs: null,
        kind: "pipeline-state",
      },
      {
        path: ".roadmap-converge/ROADMAP/state.toon",
        exists: true,
        mtimeMs: 2000,
        kind: "roadmap-converge",
        slug: "ROADMAP",
      },
    ];
    const ordered = orderByMtime(checks);
    expect(ordered.length).toBe(1);
    expect(ordered[0].kind).toBe("roadmap-converge");
  });

  it("orderByMtime places pipeline-state first when it has higher mtime", () => {
    const checks: StateExistenceCheck[] = [
      {
        path: ".plan-execution/pipeline-state.toon",
        exists: true,
        mtimeMs: 9999,
        kind: "pipeline-state",
      },
      {
        path: ".roadmap-converge/ROADMAP/state.toon",
        exists: true,
        mtimeMs: 1000,
        kind: "roadmap-converge",
        slug: "ROADMAP",
      },
    ];
    const ordered = orderByMtime(checks);
    expect(ordered[0].kind).toBe("pipeline-state");
    expect(ordered[1].kind).toBe("roadmap-converge");
  });

  it("buildResumeDigests renders roadmap-converge digest when state file exists", () => {
    // Write a state.toon so readState can load it
    const slug = "ROADMAP";
    const state = sampleState();
    mkdirSync(`.roadmap-converge/${slug}`, { recursive: true });

    // Use the state-io encoder
    writeFileSync(`.roadmap-converge/${slug}/state.toon`, encodeRoadmapConvergeStateToon(state));

    const checks: StateExistenceCheck[] = [
      {
        path: `.roadmap-converge/${slug}/state.toon`,
        exists: true,
        mtimeMs: 2000,
        kind: "roadmap-converge",
        slug,
      },
    ];

    const results = buildResumeDigests(checks);
    expect(results.length).toBe(1);
    expect(results[0]).toContain("Roadmap Convergence Status");
    expect(results[0]).toContain("ROADMAP");
  });

  it("buildResumeDigests renders pipeline-state stub for pipeline-state kind", () => {
    const checks: StateExistenceCheck[] = [
      {
        path: ".plan-execution/pipeline-state.toon",
        exists: true,
        mtimeMs: 9999,
        kind: "pipeline-state",
      },
    ];
    const results = buildResumeDigests(checks, {
      renderPipelineState: (path) => `PIPELINE: ${path}`,
    });
    expect(results.length).toBe(1);
    expect(results[0]).toBe("PIPELINE: .plan-execution/pipeline-state.toon");
  });

  it("buildResumeDigests returns empty array when no checks exist", () => {
    const results = buildResumeDigests([]);
    expect(results).toEqual([]);
  });

  it("buildResumeDigests returns empty array when all checks have exists=false", () => {
    const checks: StateExistenceCheck[] = [
      {
        path: ".plan-execution/pipeline-state.toon",
        exists: false,
        mtimeMs: null,
        kind: "pipeline-state",
      },
      {
        path: ".roadmap-converge/ROADMAP/state.toon",
        exists: false,
        mtimeMs: null,
        kind: "roadmap-converge",
        slug: "ROADMAP",
      },
    ];
    const results = buildResumeDigests(checks);
    expect(results).toEqual([]);
  });

  it("S-14 scenario: roadmap-converge state has higher mtime → placed first", () => {
    // T1 = pipeline-state mtime, T2 = roadmap-converge mtime, T2 > T1
    const checks: StateExistenceCheck[] = [
      {
        path: ".plan-execution/pipeline-state.toon",
        exists: true,
        mtimeMs: 1000, // T1
        kind: "pipeline-state",
      },
      {
        path: ".roadmap-converge/ROADMAP/state.toon",
        exists: true,
        mtimeMs: 2000, // T2 > T1
        kind: "roadmap-converge",
        slug: "ROADMAP",
      },
    ];
    const ordered = orderByMtime(checks);
    // roadmap-converge (T2=2000) should come first
    expect(ordered[0].kind).toBe("roadmap-converge");
    expect(ordered[0].mtimeMs).toBe(2000);
    expect(ordered[1].kind).toBe("pipeline-state");
    expect(ordered[1].mtimeMs).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function listFilesSync(dir: string): string[] {
  try {
    const entries = readdirSync(dir, { recursive: true } as Parameters<typeof readdirSync>[1]);
    return (entries as string[]).filter((e) => {
      try {
        return statSync(join(dir, e)).isFile();
      } catch {
        return false;
      }
    }).sort();
  } catch {
    return [];
  }
}
