/**
 * Behavioral tests for hooks/agent-result-validator.ts (PLAN-exceed-gstack
 * Phase 3, F-03 / C-08).
 *
 * Every test spawns the hook as a real subprocess and feeds a Claude Code
 * hook payload on stdin — exactly how the harness invokes it. This is the
 * regression net for the original defect: `runHook(main)` (missing the name
 * argument) made every invocation throw into the fail-open catch and exit 0,
 * so the hook never validated anything.
 *
 * Covers:
 *   - valid envelope → allow (exit 0)
 *   - missing required confidence → block (exit 2, stderr names the field)
 *   - malformed TOON without a findings[] block → allow (not an envelope)
 *   - SubagentStop transcript payloads (registered event per plan Phase 3)
 *   - registration in .claude/settings.json on SubagentStop
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runHook, parseDecision } from "../../hooks/__tests__/helpers/hook-runner.js";

const HOOK = "agent-result-validator.ts";
const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

const VALID_ENVELOPE = [
  "agent: reviewer-agent",
  "status: success",
  "findings[2]{id,category,severity,confidence,message}:",
  "  F-01,performance,blocking,8,N+1 query in loader",
  "  F-02,style,info,5,Inconsistent naming",
  "",
].join("\n");

const MISSING_CONFIDENCE_ROW = [
  "agent: reviewer-agent",
  "findings[1]{id,category,severity,confidence,message}:",
  "  F-01,performance,blocking,,N+1 query in loader",
  "",
].join("\n");

function writeInput(content: string) {
  return {
    tool_name: "Write",
    tool_input: { file_path: "/tmp/loom-test-envelope.toon", content },
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-arv-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("agent-result-validator: core behavior", () => {
  it("allows a valid envelope (exit 0, no block decision)", async () => {
    const result = await runHook(HOOK, writeInput(VALID_ENVELOPE));
    expect(result.exitCode).toBe(0);
    expect(parseDecision(result.stdout)).toBeNull();
  });

  it("blocks an envelope with a row missing the required confidence value (exit 2)", async () => {
    const result = await runHook(HOOK, writeInput(MISSING_CONFIDENCE_ROW));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("confidence");
    expect(result.stderr).toContain("FINDING_MISSING_CONFIDENCE");
    const decision = parseDecision(result.stdout);
    expect(decision?.decision).toBe("block");
  });

  it("blocks an envelope whose findings[] header omits the confidence column", async () => {
    const content = [
      "findings[1]{id,category,severity,message}:",
      "  F-01,perf,blocking,slow",
      "",
    ].join("\n");
    const result = await runHook(HOOK, writeInput(content));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("'confidence'");
  });

  it("allows content with no findings[] block (not an envelope), even if oddly formatted", async () => {
    const malformed = "this is: not\n  really[: valid toon {{{\nnothing findings-shaped here\n";
    const result = await runHook(HOOK, writeInput(malformed));
    expect(result.exitCode).toBe(0);
  });

  it("blocks a findings[] block whose rows are truncated (malformed envelope)", async () => {
    // Malformed TOON *inside* a findings block is a broken envelope: the row
    // cannot supply the required cells, so validation must fail — not fall
    // through fail-open.
    const content = [
      "findings[1]{id,category,severity,confidence,message}:",
      "  F-01,perf",
      "",
    ].join("\n");
    const result = await runHook(HOOK, writeInput(content));
    expect(result.exitCode).toBe(2);
  });

  it("ignores non-inspectable files (exit 0)", async () => {
    const result = await runHook(HOOK, {
      tool_name: "Write",
      tool_input: { file_path: "/tmp/app.ts", content: MISSING_CONFIDENCE_ROW },
    });
    expect(result.exitCode).toBe(0);
  });

  it("fails open on an empty payload (exit 0)", async () => {
    const result = await runHook(HOOK, {});
    expect(result.exitCode).toBe(0);
  });
});

describe("agent-result-validator: SubagentStop transcript payloads", () => {
  function writeTranscript(assistantText: string): string {
    const transcriptPath = path.join(tmpDir, "transcript.jsonl");
    const lines = [
      JSON.stringify({ type: "user", message: { content: "run the review" } }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Working on it..." }] },
      }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: assistantText }] },
      }),
    ];
    fs.writeFileSync(transcriptPath, lines.join("\n") + "\n", "utf-8");
    return transcriptPath;
  }

  function subagentStopInput(transcriptPath: string) {
    return {
      session_id: "test-session",
      hook_event_name: "SubagentStop",
      transcript_path: transcriptPath,
      stop_hook_active: false,
    };
  }

  it("allows when the final assistant message carries a valid envelope", async () => {
    const transcriptPath = writeTranscript("Done. Result:\n\n" + VALID_ENVELOPE);
    const result = await runHook(HOOK, subagentStopInput(transcriptPath));
    expect(result.exitCode).toBe(0);
  });

  it("blocks when the final assistant message envelope misses required confidence", async () => {
    const transcriptPath = writeTranscript("Done. Result:\n\n" + MISSING_CONFIDENCE_ROW);
    const result = await runHook(HOOK, subagentStopInput(transcriptPath));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("confidence");
  });

  it("fails open when the transcript path does not exist", async () => {
    const result = await runHook(
      HOOK,
      subagentStopInput(path.join(tmpDir, "missing.jsonl"))
    );
    expect(result.exitCode).toBe(0);
  });
});

describe("agent-result-validator: registration", () => {
  it("is registered in .claude/settings.json under SubagentStop", () => {
    const settingsPath = path.join(REPO_ROOT, ".claude", "settings.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    const subagentStop = settings.hooks?.SubagentStop;
    expect(Array.isArray(subagentStop)).toBe(true);
    const commands = subagentStop.flatMap((entry: any) =>
      (entry.hooks ?? []).map((h: any) => h.command as string)
    );
    expect(
      commands.some((c: string) => c.includes("agent-result-validator.ts"))
    ).toBe(true);
  });
});
