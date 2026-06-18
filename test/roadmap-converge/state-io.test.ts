/**
 * Vitest coverage for scripts/roadmap-converge/state-io.ts.
 *
 * Covers AC: atomic state writes (.tmp + rename), read via the F-13 migrator
 * entrypoint, roundtrip fidelity of the v1 fields enumerated in
 * agents/protocols/roadmap-converge-state.schema.toon.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  encodeRoadmapConvergeStateToon,
  freshState,
  parseRoadmapConvergeStateToon,
  readState,
  stateFileFor,
  writeState,
} from "../../scripts/roadmap-converge/state-io.js";
import type { RoadmapConvergeStateV1 } from "../../scripts/migrators/roadmap-converge-state/index.js";

let workdir: string;
let originalCwd: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "roadmap-converge-state-"));
  originalCwd = process.cwd();
  process.chdir(workdir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(workdir, { recursive: true, force: true });
});

function sampleState(): RoadmapConvergeStateV1 {
  return {
    schemaVersion: 1,
    roadmapPath: "planning/ROADMAP.md",
    roadmapSlug: "ROADMAP",
    archetype: "default",
    round: 2,
    passLimit: 3,
    dimensions: [
      {
        name: "vision",
        status: "green",
        evidence: "Names solo + small-team audience; cites SaaS-pricing wave.",
        blockers: [],
        evidenceRef: ["#vision"],
        delta_since_last: "improved",
      },
      {
        name: "milestones",
        status: "yellow",
        evidence: "Three milestones; second lacks a measurable success bar.",
        blockers: ["Add measurable success criteria to milestone M2"],
        evidenceRef: ["#milestones"],
        delta_since_last: "same",
      },
    ],
    dimensionSnapshot: [
      { name: "vision", status: "yellow" },
      { name: "milestones", status: "yellow" },
    ],
    open_questions: [
      {
        id: "Q-01",
        dimension: "milestones",
        text: "What measurable bar for M2?",
        asked_at: "2026-06-17T00:00:00.000Z",
      },
    ],
    archivedDimensions: [],
    suppressedFindings: [],
    roadmap_diff_summary: "+12 -3",
    paused_at: "",
    last_reviewer: "roadmap-converge-reviewer",
    next_action_hint: "/loom-roadmap converge",
    content_hash: "abc123",
    sign_off_state: "not-eligible",
  };
}

describe("encode/decode roundtrip", () => {
  it("v1 state roundtrips through TOON without loss", () => {
    const original = sampleState();
    const encoded = encodeRoadmapConvergeStateToon(original);
    const decoded = parseRoadmapConvergeStateToon(encoded);
    expect(decoded).toEqual(original);
  });

  it("freshState produces a minimal v1 instance with empty arrays", () => {
    const s = freshState({
      roadmapPath: "planning/ROADMAP.md",
      roadmapSlug: "ROADMAP",
      archetype: "default",
      passLimit: 3,
      contentHash: "abc",
    });
    expect(s.schemaVersion).toBe(1);
    expect(s.round).toBe(0);
    expect(s.dimensions).toEqual([]);
    expect(s.open_questions).toEqual([]);
    expect(s.sign_off_state).toBe("not-eligible");
  });
});

describe("writeState — atomic", () => {
  it("publishes via .tmp + rename — no stray .tmp left behind", () => {
    writeState("ROADMAP", sampleState());
    const dir = dirname(stateFileFor("ROADMAP"));
    expect(existsSync(stateFileFor("ROADMAP"))).toBe(true);
    const stragglers = readdirSync(dir).filter((f) => f.endsWith(".tmp"));
    expect(stragglers).toEqual([]);
  });

  it("creates the parent directory when missing", () => {
    // No mkdir beforehand.
    expect(existsSync(".roadmap-converge")).toBe(false);
    writeState("ROADMAP", sampleState());
    expect(existsSync(stateFileFor("ROADMAP"))).toBe(true);
  });

  it("written file roundtrips back through readState", () => {
    const original = sampleState();
    writeState("ROADMAP", original);
    const { state } = readState("ROADMAP");
    expect(state).not.toBeNull();
    expect(state).toEqual(original);
  });
});

describe("readState — F-13 migrator entrypoint", () => {
  it("returns state=null when no file exists (cold start)", () => {
    const result = readState("ROADMAP");
    expect(result.state).toBeNull();
    expect(result.detectedVersion).toBe(0);
    expect(result.migrated).toBe(false);
  });

  it("rethrows MigrationDowngradeError when content declares a future version", () => {
    // Hand-craft a v99 file
    const dir = ".roadmap-converge/ROADMAP";
    const file = `${dir}/state.toon`;
    require("node:fs").mkdirSync(dir, { recursive: true });
    writeFileSync(
      file,
      "schemaVersion: 99\nroadmapPath: planning/ROADMAP.md\nroadmapSlug: ROADMAP\n"
    );
    expect(() => readState("ROADMAP")).toThrow(/downgrade/i);
  });

  it("detects v1 as current (no migration needed)", () => {
    writeState("ROADMAP", sampleState());
    const result = readState("ROADMAP");
    expect(result.detectedVersion).toBe(1);
    expect(result.currentVersion).toBe(1);
    expect(result.migrated).toBe(false);
  });
});

describe("encoder edge cases", () => {
  it("preserves newlines/tabs in evidence via escape primitives", () => {
    const s = sampleState();
    s.dimensions[0].evidence = "line1\nline2\twith tab";
    const encoded = encodeRoadmapConvergeStateToon(s);
    const decoded = parseRoadmapConvergeStateToon(encoded);
    expect(decoded.dimensions[0].evidence).toBe("line1\nline2\twith tab");
  });

  it("preserves commas in cell values via escape primitives", () => {
    const s = sampleState();
    s.dimensions[0].evidence = "a, b, c";
    const encoded = encodeRoadmapConvergeStateToon(s);
    const decoded = parseRoadmapConvergeStateToon(encoded);
    expect(decoded.dimensions[0].evidence).toBe("a, b, c");
  });

  it("preserves pipes in blockers list via escape primitives", () => {
    const s = sampleState();
    s.dimensions[1].blockers = ["alpha|beta", "gamma"];
    const encoded = encodeRoadmapConvergeStateToon(s);
    const decoded = parseRoadmapConvergeStateToon(encoded);
    expect(decoded.dimensions[1].blockers).toEqual(["alpha|beta", "gamma"]);
  });
});
