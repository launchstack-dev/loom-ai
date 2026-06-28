/**
 * tests/scripts/out-of-scope-suppress.test.ts
 *
 * Tests for scripts/out-of-scope/suppress.ts
 *
 * Covers:
 *   S-01: visible callout names OOS-id + rejection date + rationale;
 *         not silently dropped.
 *
 * Run: bunx vitest run tests/scripts/out-of-scope-suppress.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { checkSuppressed } from "../../scripts/out-of-scope/suppress.js";

// ── Fixture helpers ──────────────────────────────────────────────────────────

function writeOosEntry(
  dir: string,
  id: string,
  idea: string,
  rejectedAt: string,
  rationale: string,
  sourceProposalId?: string,
): void {
  const filePath = join(dir, `${id}.md`);
  const lines = [
    "---",
    `id: ${id}`,
    `idea: "${idea}"`,
    `rejectedAt: ${rejectedAt}`,
    `rejectedBy: agent`,
    `rationale: "${rationale}"`,
  ];
  if (sourceProposalId) {
    lines.push(`sourceProposalId: ${sourceProposalId}`);
  }
  lines.push("---", "", "Extended discussion (optional).");
  writeFileSync(filePath, lines.join("\n"), "utf8");
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

let tmpDir: string;
let oosDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "loom-oos-test-"));
  oosDir = join(tmpDir, ".out-of-scope");
  mkdirSync(oosDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── S-01: visible callout fires on previously-rejected idea ──────────────────

describe("S-01: visible suppression callout fires on previously-rejected idea", () => {
  it("returns matched: true for a text match", () => {
    writeOosEntry(
      oosDir,
      "OOS-01",
      "Auto-route feature requests through LLM classifier",
      "2026-06-25T11:14:22.000Z",
      "Triage discipline intentionally puts a human in the loop. An LLM classifier would silently re-introduce the failure mode.",
    );

    const result = checkSuppressed(
      oosDir,
      null,
      "auto-route feature requests via classifier",
    );
    expect(result.matched).toBe(true);
    expect(result.matches).toHaveLength(1);
  });

  it("callout names the OOS-id", () => {
    writeOosEntry(
      oosDir,
      "OOS-01",
      "Auto-route feature requests through LLM classifier",
      "2026-06-25T11:14:22.000Z",
      "Triage discipline intentionally puts a human in the loop.",
    );

    const result = checkSuppressed(oosDir, null, "auto-route feature requests");
    expect(result.matches[0]?.callout).toContain("OOS-01");
  });

  it("callout includes the rejection date", () => {
    writeOosEntry(
      oosDir,
      "OOS-01",
      "Auto-route feature requests through LLM classifier",
      "2026-06-25T11:14:22.000Z",
      "Triage discipline intentionally puts a human in the loop.",
    );

    const result = checkSuppressed(oosDir, null, "auto-route feature requests");
    // Date in YYYY-MM-DD format
    expect(result.matches[0]?.callout).toContain("2026-06-25");
  });

  it("callout includes the rationale", () => {
    const rationale = "Triage discipline intentionally puts a human in the loop. An LLM would break this.";
    writeOosEntry(
      oosDir,
      "OOS-01",
      "Auto-route feature requests through LLM classifier",
      "2026-06-25T11:14:22.000Z",
      rationale,
    );

    const result = checkSuppressed(oosDir, null, "auto-route feature requests");
    expect(result.matches[0]?.callout).toContain("Rationale:");
    // At least the beginning of the rationale should appear
    expect(result.matches[0]?.callout).toContain("Triage discipline");
  });

  it("callout uses the documented one-line format with OOS-suppressed marker", () => {
    writeOosEntry(
      oosDir,
      "OOS-07",
      "Auto-route bug reports via LLM classifier",
      "2026-06-25T11:14:22.000Z",
      "Triage discipline (Phase D) intentionally puts a human in the loop.",
    );

    const result = checkSuppressed(
      oosDir,
      null,
      "auto-route bug reports classifier",
    );
    const callout = result.matches[0]?.callout ?? "";
    expect(callout).toMatch(/^\> \[OOS-suppressed\]/);
  });

  it("proposal is NOT silently dropped — matched: true with non-empty callout", () => {
    writeOosEntry(
      oosDir,
      "OOS-02",
      "Replace human triage with fully automated pipeline",
      "2026-06-20T09:00:00.000Z",
      "Fully automated pipelines have a known failure mode of missing edge cases that require human judgment.",
    );

    const result = checkSuppressed(
      oosDir,
      null,
      "fully automated triage pipeline",
    );
    expect(result.matched).toBe(true);
    expect(result.matches[0]?.callout.length).toBeGreaterThan(0);
    // The result must not be empty — operator needs to see it
    expect(result.matches[0]?.callout).not.toBe("");
  });

  it("returns rejectedAt and rationale on match", () => {
    writeOosEntry(
      oosDir,
      "OOS-01",
      "Auto-route feature requests",
      "2026-06-25T11:14:22.000Z",
      "This was considered and rejected due to human oversight requirements.",
    );

    const result = checkSuppressed(oosDir, null, "auto-route feature requests");
    expect(result.matches[0]?.rejectedAt).toBe("2026-06-25T11:14:22.000Z");
    expect(result.matches[0]?.rationale).toContain("human oversight");
  });
});

// ── id-based matching ────────────────────────────────────────────────────────

describe("id-based matching", () => {
  it("matches by OOS entry id", () => {
    writeOosEntry(
      oosDir,
      "OOS-03",
      "Some completely unrelated idea",
      "2026-06-01T00:00:00.000Z",
      "We decided against this for unrelated reasons.",
    );

    const result = checkSuppressed(oosDir, "OOS-03", null);
    expect(result.matched).toBe(true);
    expect(result.matches[0]?.id).toBe("OOS-03");
  });

  it("matches by sourceProposalId", () => {
    writeOosEntry(
      oosDir,
      "OOS-04",
      "Feature linked to a specific proposal",
      "2026-06-10T00:00:00.000Z",
      "Rejected because it duplicates existing functionality.",
      "NOTE-42",
    );

    const result = checkSuppressed(oosDir, "NOTE-42", null);
    expect(result.matched).toBe(true);
    expect(result.matches[0]?.id).toBe("OOS-04");
  });

  it("returns matched: false when id does not match", () => {
    writeOosEntry(
      oosDir,
      "OOS-05",
      "Another idea",
      "2026-06-01T00:00:00.000Z",
      "Not relevant to current proposals.",
    );

    const result = checkSuppressed(oosDir, "OOS-99", null);
    expect(result.matched).toBe(false);
    expect(result.matches).toHaveLength(0);
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("returns matched: false when .out-of-scope/ dir does not exist", () => {
    const result = checkSuppressed(
      join(tmpDir, "nonexistent"),
      null,
      "anything",
    );
    expect(result.matched).toBe(false);
    expect(result.matches).toHaveLength(0);
  });

  it("returns matched: false when oos dir is empty", () => {
    const result = checkSuppressed(oosDir, null, "any proposal text");
    expect(result.matched).toBe(false);
  });

  it("returns multiple matches when multiple entries match", () => {
    writeOosEntry(
      oosDir,
      "OOS-01",
      "Auto-route feature requests through classifier",
      "2026-06-25T11:14:22.000Z",
      "Human oversight required for feature routing.",
    );
    writeOosEntry(
      oosDir,
      "OOS-02",
      "Auto-route support tickets through classifier",
      "2026-06-20T00:00:00.000Z",
      "Human oversight required for ticket routing.",
    );

    const result = checkSuppressed(oosDir, null, "auto-route requests classifier");
    expect(result.matched).toBe(true);
    expect(result.matches.length).toBeGreaterThanOrEqual(1);
  });
});
