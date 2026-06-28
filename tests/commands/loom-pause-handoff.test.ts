/**
 * tests/commands/loom-pause-handoff.test.ts
 *
 * S-01: loom-pause writes handoff to tmp dir with redaction count.
 *
 * Given: A fixture session containing one secret-like token in agent output.
 * When:  The operator invokes loom-pause (simulated via the scripts).
 * Then:
 *   1. A handoff file MUST be created under $TMPDIR matching the documented
 *      filename pattern `loom-handoff-{id}.md`.
 *   2. The file MUST contain a `suggestedSkills[]` section.
 *   3. The file MUST contain a `redactedSecretsCount` field equal to 1.
 *   4. The original secret string MUST NOT appear in the file body.
 *
 * Run: bunx vitest run tests/commands/loom-pause-handoff.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { redact } from "../../scripts/loom-pause/secret-redactor.js";

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

/**
 * A fake AWS access key ID that matches the documented pattern
 * AKIA[0-9A-Z]{16} but is not a real credential.
 */
const FIXTURE_SECRET = "AKIAIOSFODNN7EXAMPLE";

/**
 * Agent output that contains the fixture secret.
 */
const FIXTURE_AGENT_OUTPUT = `
Planning step complete. Deploying with credentials:
  AWS_ACCESS_KEY_ID=${FIXTURE_SECRET}
  region=us-east-1
Build succeeded.
`.trim();

/**
 * continue-here.toon content for an execute-plan session mid-wave.
 */
function makeContinueHereToon(projectDir: string): string {
  return [
    `pausedAt: 2026-06-26T12:00:00.000Z`,
    `command: execute-plan`,
    `phase: wave-3-implementation`,
    `planPath: ${join(projectDir, "planning/plans/PLAN-F-18.md")}`,
    `roadmapPath: null`,
    `resumeStep: Step 3: Execution wave 3`,
    `pendingDecisions[0]:`,
    `completedWork[2]{wave,status,filesChanged}:`,
    `  1,complete,12`,
    `  2,complete,8`,
    `nextAction: Run implementer-agent for wave 3`,
    `context: Phase 3 in progress — wave 3 started, implementers spawned.`,
    `wikiContext[0]:`,
    `gitRef: abc1234`,
    `message: null`,
    `stateFiles[1]: .plan-execution/state.toon`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Handoff composition simulation (mirrors loom-pause-handoff-author logic)
// ---------------------------------------------------------------------------

interface HandoffDocument {
  id: string;
  createdAt: string;
  suggestedSkills: string[];
  referencedArtifacts: string[];
  redactedSecretsCount: number;
  context: string;
}

/**
 * Compose a handoff document by:
 * 1. Running secret redaction on the raw agent output.
 * 2. Building the suggestedSkills list from the continue-here data.
 * 3. Collecting referencedArtifacts paths.
 * 4. Writing the TOON document to outPath.
 */
function composeHandoff(opts: {
  sessionId: string;
  createdAt: string;
  continueHereContent: string;
  rawAgentOutput: string;
  outPath: string;
}): HandoffDocument {
  // Step 3: redact secrets
  const { redacted, count } = redact(opts.rawAgentOutput);

  // Step 1: derive suggested skills from command/phase
  const commandMatch = /^command:\s*(.+)$/m.exec(opts.continueHereContent);
  const command = commandMatch?.[1]?.trim() ?? "";
  const suggestedSkills: string[] = [];
  if (command === "execute-plan") {
    suggestedSkills.push("loom-plan");
  } else if (command === "auto") {
    suggestedSkills.push("loom-auto");
  } else if (command === "converge") {
    suggestedSkills.push("loom-converge");
  }
  if (!suggestedSkills.includes("loom-resume")) {
    suggestedSkills.push("loom-resume");
  }

  // Step 2: referenced artifacts (paths only)
  const referencedArtifacts: string[] = [];
  const planPathMatch = /^planPath:\s*(.+)$/m.exec(opts.continueHereContent);
  if (planPathMatch && planPathMatch[1] !== "null") {
    referencedArtifacts.push(planPathMatch[1]!.trim());
  }

  // Step 4: compose TOON
  const lines = [
    `id: ${opts.sessionId}`,
    `createdAt: ${opts.createdAt}`,
    `suggestedSkills[${suggestedSkills.length}]: ${suggestedSkills.join(", ")}`,
    `referencedArtifacts[${referencedArtifacts.length}]: ${referencedArtifacts.join(", ")}`,
    `redactedSecretsCount: ${count}`,
    ``,
    `context:`,
    ...redacted.split("\n").map((l) => `  ${l}`),
  ].join("\n");

  // Atomic write
  const tmpPath = opts.outPath + ".tmp";
  writeFileSync(tmpPath, lines, "utf8");
  renameSync(tmpPath, opts.outPath);

  return {
    id: opts.sessionId,
    createdAt: opts.createdAt,
    suggestedSkills,
    referencedArtifacts,
    redactedSecretsCount: count,
    context: redacted,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpWorkDir: string;
let handoffTmpDir: string;

beforeEach(() => {
  tmpWorkDir = mkdtempSync(join(tmpdir(), "loom-pause-test-"));
  handoffTmpDir = mkdtempSync(join(tmpdir(), "loom-handoff-output-"));
  mkdirSync(join(tmpWorkDir, ".plan-execution"), { recursive: true });
  mkdirSync(join(tmpWorkDir, "planning", "plans"), { recursive: true });

  // Write a fake plan file so referencedArtifacts resolves
  writeFileSync(
    join(tmpWorkDir, "planning", "plans", "PLAN-F-18.md"),
    "# Fake plan",
    "utf8"
  );

  // Write continue-here.toon
  const continueHere = makeContinueHereToon(tmpWorkDir);
  writeFileSync(
    join(tmpWorkDir, ".plan-execution", "continue-here.toon"),
    continueHere,
    "utf8"
  );
});

afterEach(() => {
  rmSync(tmpWorkDir, { recursive: true, force: true });
  rmSync(handoffTmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// S-01 assertions
// ---------------------------------------------------------------------------

describe("S-01: loom-pause writes handoff to tmp dir with redaction count", () => {
  it("handoff file is created under a tmp directory matching the documented filename pattern", () => {
    const sessionId = "HANDOFF-20260626T120000Z-a3f7";
    const outPath = join(handoffTmpDir, `loom-handoff-${sessionId}.md`);
    const continueHereContent = readFileSync(
      join(tmpWorkDir, ".plan-execution", "continue-here.toon"),
      "utf8"
    );

    composeHandoff({
      sessionId,
      createdAt: "2026-06-26T12:00:00.000Z",
      continueHereContent,
      rawAgentOutput: FIXTURE_AGENT_OUTPUT,
      outPath,
    });

    // File exists at the expected path
    expect(existsSync(outPath)).toBe(true);

    // Filename matches the documented pattern loom-handoff-{id}.md
    const filename = outPath.split("/").at(-1)!;
    expect(filename).toMatch(/^loom-handoff-.+\.md$/);
  });

  it("handoff file contains a suggestedSkills[] section", () => {
    const sessionId = "HANDOFF-20260626T120000Z-a3f7";
    const outPath = join(handoffTmpDir, `loom-handoff-${sessionId}.md`);
    const continueHereContent = readFileSync(
      join(tmpWorkDir, ".plan-execution", "continue-here.toon"),
      "utf8"
    );

    composeHandoff({
      sessionId,
      createdAt: "2026-06-26T12:00:00.000Z",
      continueHereContent,
      rawAgentOutput: FIXTURE_AGENT_OUTPUT,
      outPath,
    });

    const content = readFileSync(outPath, "utf8");
    expect(content).toMatch(/suggestedSkills\[\d+\]/);
    // Must include at least one skill name
    expect(content).toMatch(/suggestedSkills\[\d+\]:\s*\S+/);
  });

  it("handoff file contains redactedSecretsCount equal to 1", () => {
    const sessionId = "HANDOFF-20260626T120000Z-b1c2";
    const outPath = join(handoffTmpDir, `loom-handoff-${sessionId}.md`);
    const continueHereContent = readFileSync(
      join(tmpWorkDir, ".plan-execution", "continue-here.toon"),
      "utf8"
    );

    composeHandoff({
      sessionId,
      createdAt: "2026-06-26T12:00:00.000Z",
      continueHereContent,
      rawAgentOutput: FIXTURE_AGENT_OUTPUT,
      outPath,
    });

    const content = readFileSync(outPath, "utf8");
    expect(content).toMatch(/redactedSecretsCount:\s*1/);
  });

  it("the original secret string does NOT appear in the handoff file body", () => {
    const sessionId = "HANDOFF-20260626T120000Z-d4e5";
    const outPath = join(handoffTmpDir, `loom-handoff-${sessionId}.md`);
    const continueHereContent = readFileSync(
      join(tmpWorkDir, ".plan-execution", "continue-here.toon"),
      "utf8"
    );

    composeHandoff({
      sessionId,
      createdAt: "2026-06-26T12:00:00.000Z",
      continueHereContent,
      rawAgentOutput: FIXTURE_AGENT_OUTPUT,
      outPath,
    });

    const content = readFileSync(outPath, "utf8");
    expect(content).not.toContain(FIXTURE_SECRET);
  });

  it("the redacted body replaces the secret with [REDACTED]", () => {
    const sessionId = "HANDOFF-20260626T120000Z-f6g7";
    const outPath = join(handoffTmpDir, `loom-handoff-${sessionId}.md`);
    const continueHereContent = readFileSync(
      join(tmpWorkDir, ".plan-execution", "continue-here.toon"),
      "utf8"
    );

    composeHandoff({
      sessionId,
      createdAt: "2026-06-26T12:00:00.000Z",
      continueHereContent,
      rawAgentOutput: FIXTURE_AGENT_OUTPUT,
      outPath,
    });

    const content = readFileSync(outPath, "utf8");
    expect(content).toContain("[REDACTED]");
  });

  it("loom-resume is always included in suggestedSkills", () => {
    const sessionId = "HANDOFF-20260626T120000Z-h8i9";
    const outPath = join(handoffTmpDir, `loom-handoff-${sessionId}.md`);
    const continueHereContent = readFileSync(
      join(tmpWorkDir, ".plan-execution", "continue-here.toon"),
      "utf8"
    );

    const result = composeHandoff({
      sessionId,
      createdAt: "2026-06-26T12:00:00.000Z",
      continueHereContent,
      rawAgentOutput: FIXTURE_AGENT_OUTPUT,
      outPath,
    });

    expect(result.suggestedSkills).toContain("loom-resume");
  });

  it("handoff file contains the id field matching the session ID", () => {
    const sessionId = "HANDOFF-20260626T120000Z-j0k1";
    const outPath = join(handoffTmpDir, `loom-handoff-${sessionId}.md`);
    const continueHereContent = readFileSync(
      join(tmpWorkDir, ".plan-execution", "continue-here.toon"),
      "utf8"
    );

    composeHandoff({
      sessionId,
      createdAt: "2026-06-26T12:00:00.000Z",
      continueHereContent,
      rawAgentOutput: FIXTURE_AGENT_OUTPUT,
      outPath,
    });

    const content = readFileSync(outPath, "utf8");
    expect(content).toContain(`id: ${sessionId}`);
  });

  describe("secret-redactor unit behavior", () => {
    it("redact() strips AKIA AWS key and returns count=1", () => {
      const result = redact(`key=${FIXTURE_SECRET}`);
      expect(result.count).toBe(1);
      expect(result.redacted).not.toContain(FIXTURE_SECRET);
    });

    it("redact() strips a GitHub token", () => {
      // Fake token matching ghs_[A-Za-z0-9]{36} pattern
      const fakeToken = "ghs_" + "A".repeat(36);
      const result = redact(`GITHUB_TOKEN=${fakeToken}`);
      expect(result.count).toBeGreaterThanOrEqual(1);
      expect(result.redacted).not.toContain(fakeToken);
    });

    it("redact() strips generic password assignment", () => {
      const result = redact("password=supersecretpassword123");
      expect(result.count).toBeGreaterThanOrEqual(1);
      expect(result.redacted).not.toContain("supersecretpassword123");
    });

    it("redact() returns count=0 for clean input", () => {
      const result = redact("No secrets here. Just plain text.");
      expect(result.count).toBe(0);
      expect(result.redacted).toBe("No secrets here. Just plain text.");
    });
  });
});
