/**
 * tests/agents/roadmap-converge-reviewer-oos.test.ts
 *
 * Asserts that agents/roadmap-converge-reviewer.md reads `.out-of-scope/` and
 * contains visible-suppression callout instruction (not silent suppression).
 *
 * Run: bunx vitest run tests/agents/roadmap-converge-reviewer-oos.test.ts
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const REVIEWER_PATH = join(REPO_ROOT, "agents/roadmap-converge-reviewer.md");

let content: string;

beforeAll(() => {
  content = readFileSync(REVIEWER_PATH, "utf8");
});

describe("agents/roadmap-converge-reviewer.md — out-of-scope suppression", () => {
  it("agents/roadmap-converge-reviewer.md exists", () => {
    expect(existsSync(REVIEWER_PATH)).toBe(true);
  });

  it("reads .out-of-scope/ directory", () => {
    expect(content).toContain(".out-of-scope/");
  });

  it("references scripts/out-of-scope/suppress.ts", () => {
    expect(content).toContain("scripts/out-of-scope/suppress");
  });

  it("emits a visible suppression callout (not silent suppression)", () => {
    // The agent must document visible callout output — not silent dropping
    expect(content).toMatch(/visible suppression callout|visible.suppression/i);
  });

  it("never silently suppresses a matched entry", () => {
    // The spec must explicitly state that matched entries are not silently dropped
    expect(content).toMatch(/[Nn]ever silently|not silently/i);
  });

  it("callout format includes OOS-id", () => {
    // The callout format documentation must include the OOS marker
    expect(content).toContain("[OOS-suppressed]");
  });

  it("callout format includes rejection date placeholder", () => {
    // The format documentation should show a date field
    expect(content).toMatch(/\{date\}|rejection date|rejected on/i);
  });

  it("callout format includes rationale", () => {
    // The format documentation should reference the rationale field
    expect(content).toMatch(/rationale/i);
  });

  it("documents that the proposal is flagged for operator decision (not auto-rejected)", () => {
    expect(content).toMatch(/operator decision|operator.*decide|flagged for operator/i);
  });

  it("contains the one-line callout format verbatim", () => {
    // The documented format string
    expect(content).toContain(
      "> [OOS-suppressed] {id} was rejected on {date} — Rationale: {rationale excerpt}",
    );
  });
});

// ── ADR cross-check in roadmap-converge-reviewer ─────────────────────────────

describe("agents/roadmap-converge-reviewer.md — ADR cross-check", () => {
  it("contains an ADR Cross-Check section", () => {
    expect(content).toMatch(/## ADR Cross-Check/i);
  });

  it("contains the verbatim framing string", () => {
    expect(content).toContain("contradicts ADR-NNNN but worth reopening because");
  });

  it("cross-check section references docs/adr/", () => {
    expect(content).toContain("docs/adr/");
  });

  it("states the full sentence including 'worth reopening because' is required", () => {
    expect(content).toContain("worth reopening because");
  });
});
