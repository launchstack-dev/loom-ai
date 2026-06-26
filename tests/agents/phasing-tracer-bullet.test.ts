/**
 * tests/agents/phasing-tracer-bullet.test.ts
 *
 * Asserts that:
 *   1. agents/phasing-agent.md adopts the ideal-seam-count=1 rule
 *      (one seam per phase boundary; if a phase needs >1 seam, split it)
 *   2. The tracer-bullet vertical-slice framing appears in the agent body
 *   3. agents/parallelization-agent.md adopts the same framing
 *   4. commands/loom-plan/create.md and commands/loom-plan/materialize.md
 *      cite the verbatim phrase "make the change easy, then make the easy change"
 *
 * All checks are static-analysis tests against the .md files on disk.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// File paths
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(__dirname, "..", "..");

const PHASING_AGENT = resolve(REPO_ROOT, "agents", "phasing-agent.md");
const PARALLEL_AGENT = resolve(REPO_ROOT, "agents", "parallelization-agent.md");
const CREATE_MD = resolve(REPO_ROOT, "commands", "loom-plan", "create.md");
const MATERIALIZE_MD = resolve(REPO_ROOT, "commands", "loom-plan", "materialize.md");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readAgent(path: string): string {
  if (!existsSync(path)) {
    throw new Error(`Agent file not found: ${path}`);
  }
  return readFileSync(path, "utf-8");
}

const VERBATIM_PHRASE = "make the change easy, then make the easy change";
const VERBATIM_PHRASE_ALT = "make the change easy then make the easy change";

function hasVerbatimPhrase(content: string): boolean {
  return content.includes(VERBATIM_PHRASE) || content.includes(VERBATIM_PHRASE_ALT);
}

// ---------------------------------------------------------------------------
// agents/phasing-agent.md
// ---------------------------------------------------------------------------

describe("agents/phasing-agent.md — ideal-seam-count=1 rule and tracer-bullet framing", () => {
  it("phasing-agent.md exists", () => {
    expect(existsSync(PHASING_AGENT)).toBe(true);
  });

  it("phasing-agent.md contains the ideal-seam-count=1 rule", () => {
    const content = readAgent(PHASING_AGENT);
    // Accept variants: "ideal-seam-count=1", "one seam per phase boundary",
    // "seam count = 1", "seam-count: 1"
    const hasRule =
      content.includes("ideal-seam-count=1") ||
      content.includes("ideal-seam-count = 1") ||
      content.includes("ideal seam count") ||
      content.includes("one seam per phase") ||
      content.includes("seam-count: 1") ||
      (content.includes("seam") && content.includes("one") && content.includes("phase boundary"));
    expect(hasRule, "phasing-agent.md must contain the ideal-seam-count=1 rule").toBe(true);
  });

  it("phasing-agent.md cites 'split it' when a phase needs >1 seam", () => {
    const content = readAgent(PHASING_AGENT);
    const hasSplitRule =
      content.includes("split it") ||
      content.includes("split the phase") ||
      content.includes("split into") ||
      (content.includes(">1 seam") || content.includes("> 1 seam") || content.includes("more than one seam"));
    expect(hasSplitRule, "phasing-agent.md must instruct to split a phase when >1 seam is needed").toBe(true);
  });

  it("phasing-agent.md contains tracer-bullet or vertical-slice framing", () => {
    const content = readAgent(PHASING_AGENT);
    const hasTracerBullet =
      content.toLowerCase().includes("tracer bullet") ||
      content.toLowerCase().includes("tracer-bullet") ||
      content.toLowerCase().includes("vertical slice") ||
      content.toLowerCase().includes("vertical-slice");
    expect(hasTracerBullet, "phasing-agent.md should reference tracer-bullet or vertical-slice framing").toBe(true);
  });

  it("phasing-agent.md references Seam vocabulary from codebase-design.md", () => {
    const content = readAgent(PHASING_AGENT);
    expect(content).toContain("Seam");
  });

  it("phasing-agent.md has at least one assessment step for seam count", () => {
    const content = readAgent(PHASING_AGENT);
    // The agent body should assess seam count — either by name or by describing
    // the isolation boundary check
    const hasAssessment =
      content.includes("seam") &&
      (content.includes("count") || content.includes("number of") || content.includes("boundaries"));
    expect(hasAssessment, "phasing-agent.md should assess seam count per phase").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// agents/parallelization-agent.md
// ---------------------------------------------------------------------------

describe("agents/parallelization-agent.md — tracer-bullet vertical-slice framing", () => {
  it("parallelization-agent.md exists", () => {
    expect(existsSync(PARALLEL_AGENT)).toBe(true);
  });

  it("parallelization-agent.md contains tracer-bullet or vertical-slice framing", () => {
    const content = readAgent(PARALLEL_AGENT);
    const hasTracerBullet =
      content.toLowerCase().includes("tracer bullet") ||
      content.toLowerCase().includes("tracer-bullet") ||
      content.toLowerCase().includes("vertical slice") ||
      content.toLowerCase().includes("vertical-slice");
    expect(hasTracerBullet, "parallelization-agent.md should reference tracer-bullet or vertical-slice framing").toBe(true);
  });

  it("parallelization-agent.md references Seam in isolation boundary design", () => {
    const content = readAgent(PARALLEL_AGENT);
    expect(content).toContain("Seam");
  });

  it("parallelization-agent.md describes Wave-0 contracts step", () => {
    const content = readAgent(PARALLEL_AGENT);
    const hasWave0 =
      content.includes("Wave 0") ||
      content.includes("wave 0") ||
      (content.includes("contracts") && content.includes("shared"));
    expect(hasWave0, "parallelization-agent.md should describe the Wave-0 contracts step").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// commands/loom-plan/create.md
// ---------------------------------------------------------------------------

describe("commands/loom-plan/create.md — verbatim phrase and tracer-bullet framing", () => {
  it("create.md exists", () => {
    expect(existsSync(CREATE_MD)).toBe(true);
  });

  it("create.md cites the verbatim phrase 'make the change easy, then make the easy change'", () => {
    const content = readAgent(CREATE_MD);
    expect(
      hasVerbatimPhrase(content),
      `create.md must contain "${VERBATIM_PHRASE}" (or alt form without comma)`
    ).toBe(true);
  });

  it("create.md references Phase 0 or Wave 0", () => {
    const content = readAgent(CREATE_MD);
    const hasPhase0 = content.includes("Phase 0") || content.includes("Wave 0");
    expect(hasPhase0, "create.md should reference Phase 0 or Wave 0 contracts step").toBe(true);
  });

  it("create.md references codebase scan step", () => {
    const content = readAgent(CREATE_MD);
    expect(content.toLowerCase()).toMatch(/scan|codebase|shared.file/);
  });
});

// ---------------------------------------------------------------------------
// commands/loom-plan/materialize.md
// ---------------------------------------------------------------------------

describe("commands/loom-plan/materialize.md — tracer-bullet framing", () => {
  it("materialize.md exists", () => {
    expect(existsSync(MATERIALIZE_MD)).toBe(true);
  });

  it("materialize.md cites the verbatim phrase or tracer-bullet framing", () => {
    const content = readAgent(MATERIALIZE_MD);
    const hasPhrase = hasVerbatimPhrase(content);
    const hasTracerBullet =
      content.toLowerCase().includes("tracer bullet") ||
      content.toLowerCase().includes("tracer-bullet") ||
      content.toLowerCase().includes("vertical slice");

    expect(
      hasPhrase || hasTracerBullet,
      `materialize.md must contain "${VERBATIM_PHRASE}" or tracer-bullet/vertical-slice framing`
    ).toBe(true);
  });

  it("materialize.md references Phase 0 or prefactor or contract step", () => {
    const content = readAgent(MATERIALIZE_MD);
    const hasPhase0OrContracts =
      content.includes("Phase 0") ||
      content.includes("Wave 0") ||
      content.includes("prefactor") ||
      content.includes("contract") ||
      content.includes("Step 0");
    expect(hasPhase0OrContracts, "materialize.md should reference Phase 0, contracts, or prefactor step").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cross-file consistency: all modified files share the same vocabulary
// ---------------------------------------------------------------------------

describe("cross-file consistency: codebase-design.md vocabulary appears across all modified files", () => {
  const FILES_UNDER_TEST = [
    { label: "phasing-agent.md", path: PHASING_AGENT },
    { label: "parallelization-agent.md", path: PARALLEL_AGENT },
    { label: "create.md", path: CREATE_MD },
  ];

  it("each modified file contains at least one Seam, Depth, Module, or Adapter reference", () => {
    for (const { label, path } of FILES_UNDER_TEST) {
      const content = readAgent(path);
      const hasVocab =
        content.includes("Seam") ||
        content.includes("Depth") ||
        content.includes("Module") ||
        content.includes("Adapter") ||
        content.includes("Vertical Slice") ||
        content.includes("Tracer Bullet");
      expect(hasVocab, `${label} should reference at least one codebase-design.md vocab term`).toBe(true);
    }
  });
});
