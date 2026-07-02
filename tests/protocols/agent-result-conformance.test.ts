/**
 * Phase 6 (F-07, C-07/C-08, defects 11/12): AgentResult conformance.
 *
 * 1. Tiered mandate (C-07) — the schema doc enumerates which agent classes
 *    MUST emit the envelope (pipeline participants: stage teammates,
 *    reviewers, executors, converge drivers) and which are exempt
 *    (standalone/utility).
 * 2. Confidence enforcement (C-08) — a participant envelope with integer
 *    confidence in 1..10 validates; confidence 0, 11, or missing is
 *    rejected with FINDING_MISSING_CONFIDENCE. Exercised against the real
 *    production validator (`validateAgentResultToon`), not a reimplementation.
 * 3. Exemption behavior — utility-agent output carrying no envelope passes
 *    through the validator with no findings-related rejection.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The validator module ends with a top-level `runHook(...)` call that
// consumes stdin and exits the process. Mock the harness so importing the
// pure validation function is side-effect free under vitest.
vi.mock("../../hooks/lib/run-hook.js", () => ({
  runHook: vi.fn(),
  allow: (message?: string) => ({ decision: "allow", message }),
  block: (reason: string) => ({ decision: "block", reason }),
}));

import { validateAgentResultToon } from "../../hooks/agent-result-validator.js";

const DOC_PATH = resolve(__dirname, "../../protocols/agent-result.schema.md");
const doc = readFileSync(DOC_PATH, "utf8");

/**
 * Minimal TOON typed-array reader: given `name[N]{col1,col2,...}:` inside a
 * document, return the N rows as objects. Quoted cells may contain commas.
 */
function parseTypedArrayRows(
  source: string,
  arrayName: string,
): Array<Record<string, string>> {
  const headerRe = new RegExp(
    `^${arrayName}\\[(\\d+)\\]\\{([^}]+)\\}:\\s*$`,
    "m",
  );
  const m = headerRe.exec(source);
  if (!m) throw new Error(`typed-array header for ${arrayName} not found`);
  const count = parseInt(m[1], 10);
  const cols = m[2].split(",").map((c) => c.trim());
  const headerLineIdx = source.slice(0, m.index).split("\n").length - 1;
  const allLines = source.split("\n");
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i <= count; i++) {
    const line = allLines[headerLineIdx + i];
    if (!line || !/^\s{2,}\S/.test(line)) break;
    const cells = splitQuoted(line.trim());
    const row: Record<string, string> = {};
    cols.forEach((col, idx) => {
      row[col] = (cells[idx] ?? "").replace(/^"|"$/g, "");
    });
    rows.push(row);
  }
  return rows;
}

function splitQuoted(row: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (const ch of row) {
    if (ch === '"') {
      inQuote = !inQuote;
      cur += ch;
      continue;
    }
    if (ch === "," && !inQuote) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Build a full participant AgentResult envelope with one finding row. */
function participantEnvelope(confidenceCell: string): string {
  return [
    "agent: review-stage-teammate",
    "wave: 2",
    "taskId: task-042",
    "status: success",
    "filesCreated[N]:",
    "filesModified[N]: src/reducer.ts",
    "filesDeleted[N]:",
    "exportsAdded[N]{file,name,kind}:",
    "dependenciesAdded[N]:",
    'integrationNotes: "Reviewed reducer module."',
    "issues[N]{severity,description,file,line}:",
    "findings[N]{id,category,severity,confidence,message}:",
    `  F-01,llm-trust,blocking,${confidenceCell},"Reducer drops the second concurrent event"`,
    "contractAmendments[N]{file,issue}:",
    "crossBoundaryRequests[N]{file,reason,suggestedChange}:",
    "durationMs: 4200",
    "verificationStatus: verified",
  ].join("\n");
}

describe("C-07 tiered mandate is enumerated in agent-result.schema.md", () => {
  const mandateRows = parseTypedArrayRows(doc, "envelopeMandate");

  it("enumerates all four must-emit pipeline-participant classes", () => {
    const classes = mandateRows.map((r) => r.class);
    expect(classes).toContain("stage-teammate");
    expect(classes).toContain("reviewer");
    expect(classes).toContain("executor");
    expect(classes).toContain("converge-driver");
  });

  it("marks every participant class as must-emit", () => {
    expect(mandateRows.length).toBeGreaterThanOrEqual(4);
    for (const row of mandateRows) {
      expect(row.requirement).toBe("must-emit");
    }
  });

  it("enumerates exempt standalone/utility classes", () => {
    const exemptRows = parseTypedArrayRows(doc, "envelopeExempt");
    const classes = exemptRows.map((r) => r.class);
    expect(classes).toContain("standalone");
    expect(classes).toContain("utility");
    for (const row of exemptRows) {
      expect(row.requirement).toBe("exempt");
    }
  });

  it("states that missing required confidence is BLOCKING, with no warn-only contradiction", () => {
    // The paragraph that defines FINDING_MISSING_CONFIDENCE must declare it
    // blocking and must not carry the old warn-only language.
    const paragraph = doc
      .split(/\n\n/)
      .find((p) => p.includes("FINDING_MISSING_CONFIDENCE"));
    expect(paragraph).toBeDefined();
    expect(paragraph!).toMatch(/BLOCKING/);
    expect(paragraph!).toMatch(/MUST NOT downgrade/i);
    expect(paragraph!.toLowerCase()).not.toMatch(/non-blocking/);
    expect(paragraph!.toLowerCase()).not.toMatch(/warn-only diagnostic for missing/);
  });

  it("declares integer 1..10 as the canonical confidence scale and flags lib/types.ts 0.0-1.0 as distinct", () => {
    expect(doc).toMatch(/canonical confidence scale/i);
    expect(doc).toMatch(/1\.\.10/);
    expect(doc).toMatch(/lib\/types\.ts/);
    expect(doc).toMatch(/0\.0.1\.0/); // the distinct float form is called out
    expect(doc).toMatch(/DISTINCT/);
  });
});

describe("C-08 confidence enforcement (real validator, sample envelopes)", () => {
  it("accepts a participant envelope with integer confidence in 1..10", () => {
    for (const c of ["1", "5", "7", "10"]) {
      expect(validateAgentResultToon(participantEnvelope(c))).toEqual([]);
    }
  });

  it("rejects confidence 0 (below range) with FINDING_MISSING_CONFIDENCE", () => {
    const errors = validateAgentResultToon(participantEnvelope("0"));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).toContain("FINDING_MISSING_CONFIDENCE");
  });

  it("rejects confidence 11 (above range) with FINDING_MISSING_CONFIDENCE", () => {
    const errors = validateAgentResultToon(participantEnvelope("11"));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).toContain("FINDING_MISSING_CONFIDENCE");
  });

  it("rejects a non-integer confidence with FINDING_MISSING_CONFIDENCE", () => {
    const errors = validateAgentResultToon(participantEnvelope("0.7"));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).toContain("FINDING_MISSING_CONFIDENCE");
  });

  it("rejects a row with a missing confidence value (empty cell)", () => {
    const errors = validateAgentResultToon(participantEnvelope(""));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).toContain("FINDING_MISSING_CONFIDENCE");
  });

  it("rejects a findings[] header that omits the confidence column entirely", () => {
    const envelope = participantEnvelope("7").replace(
      "findings[N]{id,category,severity,confidence,message}:",
      "findings[N]{id,category,severity,message}:",
    );
    const errors = validateAgentResultToon(envelope);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).toContain("FINDING_MISSING_CONFIDENCE");
  });
});

describe("exempt utility-agent output (no envelope)", () => {
  it("accepts free-form utility output carrying no AgentResult envelope", () => {
    const utilityOutput = [
      "Refined prompt brief:",
      "",
      "The user wants a statusline segment showing the active loom profile.",
      "Relevant files: scripts/statusline.ts, .claude/orchestration.toml.",
    ].join("\n");
    expect(validateAgentResultToon(utilityOutput)).toEqual([]);
  });
});
