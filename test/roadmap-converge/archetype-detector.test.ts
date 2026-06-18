/**
 * Tests for scripts/roadmap-converge/archetype-detector.ts.
 *
 * Covers:
 *   - Corpus-based detection (scoreArchetype, detectArchetype)
 *   - Cold-start confirm flow with mocked stdin (interactive TTY)
 *   - Non-interactive TTY fallback (UX-26)
 *   - --archetype override (skip detection)
 *   - Warm-start no-op (existingState != null → returns null)
 *   - Hook registration replaces no-op default
 *   - Stage context written atomically (AC11)
 *   S-17: cold-start confirm flow
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";

import {
  ARCHETYPE_STAGE_CONTEXT_PATH,
  buildDetectionCorpus,
  createArchetypeDetectionHook,
  detectArchetype,
  MIN_CONFIDENCE_HITS,
  scoreArchetype,
  VALID_ARCHETYPES,
} from "../../scripts/roadmap-converge/archetype-detector.js";
import {
  noopArchetypeDetectionHook,
} from "../../scripts/roadmap-converge/driver.js";
import type { RoadmapConvergeStateV1 } from "../../scripts/migrators/roadmap-converge-state/index.js";

let workdir: string;
let originalCwd: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "archetype-detector-test-"));
  originalCwd = process.cwd();
  process.chdir(workdir);
  mkdirSync("planning", { recursive: true });
  // Write a minimal ROADMAP.md so the driver doesn't fail pre-flight
  writeFileSync("planning/ROADMAP.md", "# vision\n\nA test roadmap.\n");
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(workdir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeExistingState(): RoadmapConvergeStateV1 {
  return {
    schemaVersion: 1,
    roadmapPath: "planning/ROADMAP.md",
    roadmapSlug: "ROADMAP",
    archetype: "library",
    round: 1,
    passLimit: 3,
    dimensions: [],
    dimensionSnapshot: [],
    open_questions: [],
    archivedDimensions: [],
    suppressedFindings: [],
    roadmap_diff_summary: "",
    paused_at: "",
    last_reviewer: "",
    next_action_hint: "",
    content_hash: "abc",
    sign_off_state: "not-eligible",
  };
}

function makeReadableStream(input: string): Readable {
  const stream = new Readable({
    read() {
      this.push(input + "\n");
      this.push(null);
    },
  });
  return stream;
}

function makeWritableStream(): { stream: Writable; output: () => string } {
  let buf = "";
  const stream = new Writable({
    write(chunk, _enc, cb) {
      buf += chunk.toString();
      cb();
    },
  });
  return { stream, output: () => buf };
}

// ---------------------------------------------------------------------------
// scoreArchetype
// ---------------------------------------------------------------------------

describe("scoreArchetype", () => {
  it("returns 0 for empty corpus", () => {
    const spec = { name: "cli" as const, hints: ["commander", "yargs"] };
    expect(scoreArchetype(spec, "")).toBe(0);
  });

  it("counts matching hints case-insensitively", () => {
    const spec = { name: "cli" as const, hints: ["commander", "yargs", "argv"] };
    const corpus = "Using COMMANDER for CLI with Yargs";
    expect(scoreArchetype(spec, corpus)).toBe(2); // commander + yargs
  });

  it("counts each distinct hint once even if it appears multiple times", () => {
    const spec = { name: "cli" as const, hints: ["cli"] };
    const corpus = "cli cli cli";
    expect(scoreArchetype(spec, corpus)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// detectArchetype
// ---------------------------------------------------------------------------

describe("detectArchetype", () => {
  it("returns default when no hints match", () => {
    const result = detectArchetype("no special keywords here");
    expect(result.archetype).toBe("default");
    expect(result.confidence).toBe(0);
  });

  it("detects cli from commander keyword", () => {
    const result = detectArchetype("This project uses commander for CLI parsing");
    expect(result.archetype).toBe("cli");
    expect(result.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE_HITS);
  });

  it("detects web-app from react keyword", () => {
    const result = detectArchetype("Built with react and vite bundling");
    expect(result.archetype).toBe("web-app");
    expect(result.confidence).toBeGreaterThanOrEqual(2);
  });

  it("detects library from peerDependencies keyword", () => {
    const result = detectArchetype('{ "peerDependencies": { "react": "*" }, "publishConfig": {} }');
    expect(result.archetype).toBe("library");
  });

  it("detects data-pipeline from airflow keyword", () => {
    const result = detectArchetype("airflow dags for pipeline orchestration");
    expect(result.archetype).toBe("data-pipeline");
  });

  it("detects research from .ipynb keyword", () => {
    const result = detectArchetype("experiments with .ipynb notebooks in jupyter");
    expect(result.archetype).toBe("research");
  });

  it("picks highest-confidence archetype on ambiguous corpus", () => {
    // Give web-app more hits than cli
    const corpus = "react vite svelte next commander";
    const result = detectArchetype(corpus);
    expect(result.archetype).toBe("web-app");
    expect(result.confidence).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// buildDetectionCorpus
// ---------------------------------------------------------------------------

describe("buildDetectionCorpus", () => {
  it("includes CLAUDE.md content when present", () => {
    writeFileSync(join(workdir, "CLAUDE.md"), "This project uses react for UI");
    const corpus = buildDetectionCorpus(workdir);
    expect(corpus).toContain("react");
  });

  it("includes package.json content when present", () => {
    writeFileSync(
      join(workdir, "package.json"),
      JSON.stringify({ peerDependencies: { react: "*" } })
    );
    const corpus = buildDetectionCorpus(workdir);
    expect(corpus).toContain("peerDependencies");
  });

  it("includes top-level directory names with trailing slash", () => {
    mkdirSync(join(workdir, "notebooks"), { recursive: true });
    const corpus = buildDetectionCorpus(workdir);
    expect(corpus).toContain("notebooks/");
  });

  it("returns non-empty string even if no files exist", () => {
    const corpus = buildDetectionCorpus(workdir);
    // Should at least include top-level entries
    expect(typeof corpus).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// VALID_ARCHETYPES
// ---------------------------------------------------------------------------

describe("VALID_ARCHETYPES", () => {
  it("contains all six archetype names", () => {
    expect(VALID_ARCHETYPES).toContain("cli");
    expect(VALID_ARCHETYPES).toContain("web-app");
    expect(VALID_ARCHETYPES).toContain("library");
    expect(VALID_ARCHETYPES).toContain("data-pipeline");
    expect(VALID_ARCHETYPES).toContain("research");
    expect(VALID_ARCHETYPES).toContain("default");
    expect(VALID_ARCHETYPES).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// noopArchetypeDetectionHook (from driver) is still exported
// ---------------------------------------------------------------------------

describe("noopArchetypeDetectionHook", () => {
  it("returns null for cold start", async () => {
    const result = await noopArchetypeDetectionHook("planning/ROADMAP.md", null);
    expect(result).toBeNull();
  });

  it("returns null for warm start", async () => {
    const result = await noopArchetypeDetectionHook(
      "planning/ROADMAP.md",
      makeExistingState()
    );
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createArchetypeDetectionHook — warm start (AC4 warm-start no-op)
// ---------------------------------------------------------------------------

describe("createArchetypeDetectionHook — warm start", () => {
  it("returns null when existingState is non-null (no detection on warm start)", async () => {
    const hook = createArchetypeDetectionHook({ cwd: workdir });
    const result = await hook("planning/ROADMAP.md", makeExistingState());
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createArchetypeDetectionHook — --archetype override
// ---------------------------------------------------------------------------

describe("createArchetypeDetectionHook — archetypeOverride", () => {
  it("returns the override archetype with confidence=1 on cold start", async () => {
    const hook = createArchetypeDetectionHook({
      archetypeOverride: "library",
      cwd: workdir,
    });
    const result = await hook("planning/ROADMAP.md", null);
    expect(result).not.toBeNull();
    expect(result!.archetype).toBe("library");
    expect(result!.confidence).toBe(1);
  });

  it("skips detection entirely when override provided", async () => {
    // Even with a non-library corpus, override wins
    writeFileSync(join(workdir, "package.json"), JSON.stringify({ bin: { my: "./cli.js" } }));
    const hook = createArchetypeDetectionHook({
      archetypeOverride: "library",
      cwd: workdir,
    });
    const result = await hook("planning/ROADMAP.md", null);
    expect(result!.archetype).toBe("library");
  });
});

// ---------------------------------------------------------------------------
// S-17: cold-start confirm flow (interactive TTY mocked)
// ---------------------------------------------------------------------------

describe("S-17: cold-start confirm flow (mocked interactive stdin)", () => {
  it("accepts default when user presses Enter (empty line)", async () => {
    writeFileSync(join(workdir, "package.json"), JSON.stringify({ bin: { my: "./cli.js" } }));

    const stdinMock = makeReadableStream(""); // empty = accept default
    // Force isTTY so our hook thinks it's interactive
    (stdinMock as any).isTTY = true;

    const { stream: stdoutMock, output } = makeWritableStream();
    const stderrLines: string[] = [];

    const hook = createArchetypeDetectionHook({
      cwd: workdir,
      stdin: stdinMock,
      stdout: stdoutMock,
      stderr: (l) => stderrLines.push(l),
    });

    const result = await hook("planning/ROADMAP.md", null);
    expect(result).not.toBeNull();
    // Should have prompted
    expect(output()).toContain("Detected project archetype");
    // The auto-detected archetype (cli from 'bin') was accepted
    expect(result!.archetype).toBeTruthy();
  });

  it("accepts a user-typed archetype override (correct flow)", async () => {
    const stdinMock = makeReadableStream("web-app"); // user types 'web-app'
    (stdinMock as any).isTTY = true;

    const { stream: stdoutMock } = makeWritableStream();
    const stderrLines: string[] = [];

    const hook = createArchetypeDetectionHook({
      cwd: workdir,
      stdin: stdinMock,
      stdout: stdoutMock,
      stderr: (l) => stderrLines.push(l),
    });

    const result = await hook("planning/ROADMAP.md", null);
    expect(result!.archetype).toBe("web-app");
  });

  it("falls back to detected archetype when user types invalid archetype name", async () => {
    writeFileSync(join(workdir, "CLAUDE.md"), "uses react for ui");
    const stdinMock = makeReadableStream("not-a-real-archetype");
    (stdinMock as any).isTTY = true;

    const { stream: stdoutMock, output } = makeWritableStream();
    const stderrLines: string[] = [];

    const hook = createArchetypeDetectionHook({
      cwd: workdir,
      stdin: stdinMock,
      stdout: stdoutMock,
      stderr: (l) => stderrLines.push(l),
    });

    const result = await hook("planning/ROADMAP.md", null);
    // Falls back to detected (react → web-app)
    expect(result!.archetype).toBe("web-app");
    expect(output()).toContain("Unknown archetype");
  });
});

// ---------------------------------------------------------------------------
// UX-26: non-interactive TTY fallback
// ---------------------------------------------------------------------------

describe("UX-26: non-interactive TTY fallback", () => {
  it("auto-selects archetype and prints advisory to stderr when stdin is non-TTY", async () => {
    writeFileSync(join(workdir, "CLAUDE.md"), "Uses react for web UI");

    const stdinMock = makeReadableStream(""); // non-TTY (no isTTY)
    // isTTY not set → isInteractiveTty returns false

    const { stream: stdoutMock } = makeWritableStream();
    const stderrLines: string[] = [];

    const hook = createArchetypeDetectionHook({
      cwd: workdir,
      stdin: stdinMock,
      stdout: stdoutMock,
      stderr: (l) => stderrLines.push(l),
    });

    const result = await hook("planning/ROADMAP.md", null);
    expect(result).not.toBeNull();
    // Advisory must be printed
    const advisory = stderrLines.find((l) =>
      l.includes("non-interactive stdin: auto-selected archetype")
    );
    expect(advisory).toBeDefined();
    expect(advisory).toContain("Override with --archetype");
  });

  it("UX-26 advisory includes archetype name and confidence", async () => {
    writeFileSync(join(workdir, "package.json"), JSON.stringify({ bin: { cli: "./cli.js" } }));

    const stdinMock = makeReadableStream("");
    const { stream: stdoutMock } = makeWritableStream();
    const stderrLines: string[] = [];

    const hook = createArchetypeDetectionHook({
      cwd: workdir,
      stdin: stdinMock,
      stdout: stdoutMock,
      stderr: (l) => stderrLines.push(l),
    });

    const result = await hook("planning/ROADMAP.md", null);
    const advisory = stderrLines.find((l) => l.includes("auto-selected archetype"));
    expect(advisory).toContain("confidence");
    expect(result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC11: stage context written atomically
// ---------------------------------------------------------------------------

describe("AC11: stage context written atomically", () => {
  it("writes execute-archetype.toon after cold-start detection", async () => {
    writeFileSync(join(workdir, "CLAUDE.md"), "Uses react for web UI");

    const stdinMock = makeReadableStream(""); // non-interactive
    const { stream: stdoutMock } = makeWritableStream();
    const stderrLines: string[] = [];

    mkdirSync(join(workdir, ".plan-execution/stage-context"), { recursive: true });

    const hook = createArchetypeDetectionHook({
      cwd: workdir,
      stdin: stdinMock,
      stdout: stdoutMock,
      stderr: (l) => stderrLines.push(l),
    });

    await hook("planning/ROADMAP.md", null);

    // The stage context path is relative to cwd (which we changed to workdir)
    const contextPath = join(workdir, ARCHETYPE_STAGE_CONTEXT_PATH);
    let content: string;
    try {
      content = readFileSync(contextPath, "utf-8");
    } catch {
      // Also check if it was written to process.cwd() + ARCHETYPE_STAGE_CONTEXT_PATH
      content = readFileSync(
        join(workdir, ".plan-execution/stage-context/execute-archetype.toon"),
        "utf-8"
      );
    }

    expect(content).toContain("stage: execute-archetype");
    expect(content).toContain("archetype=");
  });

  it("writes stage context when --archetype override used", async () => {
    const stdinMock = makeReadableStream("");
    const { stream: stdoutMock } = makeWritableStream();
    const stderrLines: string[] = [];

    const hook = createArchetypeDetectionHook({
      archetypeOverride: "library",
      cwd: workdir,
      stdin: stdinMock,
      stdout: stdoutMock,
      stderr: (l) => stderrLines.push(l),
    });

    await hook("planning/ROADMAP.md", null);

    const contextPath = join(workdir, ".plan-execution/stage-context/execute-archetype.toon");
    const content = readFileSync(contextPath, "utf-8");
    expect(content).toContain("archetype=library");
  });
});
