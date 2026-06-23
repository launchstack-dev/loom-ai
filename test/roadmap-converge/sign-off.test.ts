/**
 * Vitest coverage for scripts/roadmap-converge/sign-off.ts.
 *
 * Covers:
 *   - S-09: ineligible state → exit 1 with SIGNOFF_NOT_ELIGIBLE:<sub>
 *   - S-10: eligible state with --yes → exit 0, signed-off written
 *   - Tiebreaker order: NO_PASS > OPEN_QUESTIONS > RED_DIMENSIONS
 *   - Missing state file → exit 1 with STATE_MISSING
 *   - Already signed-off → exit 0 idempotent guard
 *   - USER_REJECTED on prompt "no"
 *   - Stage-context written atomically on every terminal outcome
 *   - Atomic state write produces no leftover .tmp
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  runSignOff,
  resolveBlockers,
  SIGNOFF_STAGE_CONTEXT_PATH,
  LAST_ERROR_PATH,
} from "../../scripts/roadmap-converge/sign-off.js";
import {
  freshState,
  stateFileFor,
  writeState,
  readState,
} from "../../scripts/roadmap-converge/state-io.js";
import type {
  RoadmapConvergeStateV1,
} from "../../scripts/migrators/roadmap-converge-state/index.js";

let workdir: string;
let originalCwd: string;
const SLUG = "ROADMAP";
const ROADMAP_PATH = "planning/ROADMAP.md";
const ROADMAP_BODY = "# vision\n\nReady to ship.\n";

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "roadmap-signoff-"));
  originalCwd = process.cwd();
  process.chdir(workdir);
  mkdirSync("planning", { recursive: true });
  writeFileSync(ROADMAP_PATH, ROADMAP_BODY);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(workdir, { recursive: true, force: true });
});

function eligibleState(): RoadmapConvergeStateV1 {
  const hash = createHash("sha256").update(ROADMAP_BODY).digest("hex");
  const base = freshState({
    roadmapPath: ROADMAP_PATH,
    roadmapSlug: SLUG,
    archetype: "default",
    passLimit: 3,
    contentHash: hash,
  });
  return {
    ...base,
    round: 1,
    sign_off_state: "eligible",
    dimensions: [
      {
        name: "vision",
        status: "green",
        delta_since_last: "improved",
      },
      {
        name: "milestones",
        status: "green",
        delta_since_last: "improved",
      },
    ],
  };
}

const silentSinks = {
  stdout: () => {},
  stderr: () => {},
  isTty: () => false,
  prompt: async () => true,
};

describe("resolveBlockers (tiebreaker)", () => {
  it("returns NO_PASS first when round=0 and other issues exist", () => {
    const s = freshState({
      roadmapPath: ROADMAP_PATH,
      roadmapSlug: SLUG,
      archetype: "default",
      passLimit: 3,
      contentHash: "h",
    });
    s.open_questions = [
      { id: "Q1", dimension: "vision", text: "?", asked_at: "t" },
    ];
    s.dimensions = [{ name: "vision", status: "red", delta_since_last: "new" }];
    const out = resolveBlockers(s);
    expect(out[0]).toBe("NO_PASS");
    expect(out).toContain("OPEN_QUESTIONS");
    expect(out).toContain("RED_DIMENSIONS");
  });

  it("returns OPEN_QUESTIONS before RED_DIMENSIONS when round>0", () => {
    const s = eligibleState();
    s.open_questions = [
      { id: "Q1", dimension: "vision", text: "?", asked_at: "t" },
    ];
    s.dimensions = [{ name: "vision", status: "yellow", delta_since_last: "same" }];
    s.sign_off_state = "not-eligible";
    const out = resolveBlockers(s);
    expect(out[0]).toBe("OPEN_QUESTIONS");
    expect(out[1]).toBe("RED_DIMENSIONS");
  });

  it("returns only RED_DIMENSIONS when that's the sole blocker", () => {
    const s = eligibleState();
    s.dimensions = [{ name: "vision", status: "yellow", delta_since_last: "same" }];
    s.sign_off_state = "not-eligible";
    expect(resolveBlockers(s)).toEqual(["RED_DIMENSIONS"]);
  });

  it("returns empty when state is fully green and round>0", () => {
    const s = eligibleState();
    expect(resolveBlockers(s)).toEqual([]);
  });
});

describe("runSignOff", () => {
  it("exits 1 with STATE_MISSING when no state file exists", async () => {
    const result = await runSignOff({ slug: SLUG, yes: true, ...silentSinks });
    expect(result.exitCode).toBe(1);
    expect(result.error).toBe("STATE_MISSING");
  });

  it("S-09: exits 1 with SIGNOFF_NOT_ELIGIBLE on yellow dimension", async () => {
    const s = eligibleState();
    s.dimensions = [{ name: "vision", status: "yellow", delta_since_last: "same" }];
    s.sign_off_state = "not-eligible";
    writeState(SLUG, s);

    const result = await runSignOff({ slug: SLUG, yes: true, ...silentSinks });
    expect(result.exitCode).toBe(1);
    expect(result.error).toBe("SIGNOFF_NOT_ELIGIBLE:RED_DIMENSIONS");

    // State unchanged
    const post = readState(SLUG).state!;
    expect(post.sign_off_state).toBe("not-eligible");

    // Stage context written
    expect(existsSync(SIGNOFF_STAGE_CONTEXT_PATH)).toBe(true);
    expect(existsSync(SIGNOFF_STAGE_CONTEXT_PATH + ".tmp")).toBe(false);
  });

  it("records additional blockers in last-error.toon when multiple apply", async () => {
    const s = eligibleState();
    s.round = 1;
    s.sign_off_state = "not-eligible";
    s.open_questions = [
      { id: "Q1", dimension: "vision", text: "?", asked_at: "t" },
    ];
    s.dimensions = [{ name: "vision", status: "yellow", delta_since_last: "same" }];
    writeState(SLUG, s);

    const result = await runSignOff({ slug: SLUG, yes: true, ...silentSinks });
    expect(result.exitCode).toBe(1);
    expect(result.error).toBe("SIGNOFF_NOT_ELIGIBLE:OPEN_QUESTIONS");

    expect(existsSync(LAST_ERROR_PATH)).toBe(true);
    const body = readFileSync(LAST_ERROR_PATH, "utf-8");
    expect(body).toContain("code: SIGNOFF_NOT_ELIGIBLE:OPEN_QUESTIONS");
    expect(body).toContain("RED_DIMENSIONS");
  });

  it("S-10: eligible state with --yes writes signed-off atomically", async () => {
    writeState(SLUG, eligibleState());

    const fixedNow = "2026-06-16T12:00:00.000Z";
    const result = await runSignOff({
      slug: SLUG,
      yes: true,
      ...silentSinks,
      now: () => fixedNow,
    });
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeUndefined();

    const post = readState(SLUG).state!;
    expect(post.sign_off_state).toBe("signed-off");
    expect(post.sign_off_at).toBe(fixedNow);
    expect(post.sign_off_diff_hash).toBe(
      createHash("sha256").update(ROADMAP_BODY).digest("hex")
    );

    // No leftover tmp files
    const dir = readdirSync(join(".roadmap-converge", SLUG));
    expect(dir.some((f) => f.endsWith(".tmp"))).toBe(false);
  });

  it("USER_REJECTED when prompt returns false", async () => {
    writeState(SLUG, eligibleState());

    const result = await runSignOff({
      slug: SLUG,
      stdout: () => {},
      stderr: () => {},
      isTty: () => false,
      prompt: async () => false,
    });
    expect(result.exitCode).toBe(1);
    expect(result.error).toBe("USER_REJECTED");

    const post = readState(SLUG).state!;
    expect(post.sign_off_state).toBe("eligible");
  });

  it("ALREADY_SIGNED_OFF is idempotent (exit 0)", async () => {
    const s = eligibleState();
    s.sign_off_state = "signed-off";
    s.sign_off_at = "2026-06-15T00:00:00.000Z";
    writeState(SLUG, s);

    const result = await runSignOff({ slug: SLUG, yes: true, ...silentSinks });
    expect(result.exitCode).toBe(0);
    expect(result.error).toBe("ALREADY_SIGNED_OFF");
  });

  it("renders diff before prompting (prompt sees diff was emitted)", async () => {
    writeState(SLUG, eligibleState());
    const stdoutChunks: string[] = [];
    let promptedAfterDiff = false;

    await runSignOff({
      slug: SLUG,
      stdout: (c) => stdoutChunks.push(c),
      stderr: () => {},
      isTty: () => false,
      prompt: async () => {
        promptedAfterDiff = stdoutChunks.length > 0;
        return true;
      },
    });

    expect(promptedAfterDiff).toBe(true);
  });
});
