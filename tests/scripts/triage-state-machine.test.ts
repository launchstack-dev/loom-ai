/**
 * tests/scripts/triage-state-machine.test.ts
 *
 * Tests for scripts/triage/state-machine.ts and the 30-day sweep.
 *
 * Covers:
 *   S-02: 30-day timeout transitions to wontfix with reason "timeout-30d"
 *   S-03: wontfix→needs-triage without reopen fails with WONTFIX_REOPEN_REQUIRED
 *
 * Run: bunx vitest run tests/scripts/triage-state-machine.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import {
  transition,
  type TriageEntry,
  type TriageStateValue,
} from "../../scripts/triage/state-machine.js";
import { runSweep } from "../../scripts/triage/30day-sweep.js";

// ── Fixture factory ───────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<TriageEntry> = {}): TriageEntry {
  return {
    id: "NOTE-001",
    category: "enhancement",
    state: "needs-triage",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    transitions: [],
    ...overrides,
  };
}

// ── Valid transition tests ───────────────────────────────────────────────────

describe("transition() — valid transitions", () => {
  it("needs-triage → needs-info", () => {
    const entry = makeEntry({ state: "needs-triage" });
    const result = transition(entry, "needs-info", { actor: "agent" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.entry.state).toBe("needs-info");
    expect(result.row.from).toBe("needs-triage");
    expect(result.row.to).toBe("needs-info");
  });

  it("needs-triage → ready-for-agent", () => {
    const entry = makeEntry({ state: "needs-triage" });
    const result = transition(entry, "ready-for-agent", { actor: "agent" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.entry.state).toBe("ready-for-agent");
  });

  it("needs-triage → ready-for-human", () => {
    const entry = makeEntry({ state: "needs-triage" });
    const result = transition(entry, "ready-for-human", { actor: "agent" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.entry.state).toBe("ready-for-human");
  });

  it("needs-triage → wontfix (with reason — FC-B1)", () => {
    const entry = makeEntry({ state: "needs-triage" });
    const result = transition(entry, "wontfix", {
      actor: "human",
      reason: "out of scope for v1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.entry.state).toBe("wontfix");
    expect(result.row.reason).toBe("out of scope for v1");
  });

  it("needs-info → needs-triage (reporter activity)", () => {
    const entry = makeEntry({ state: "needs-info" });
    const result = transition(entry, "needs-triage", { actor: "human" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.entry.state).toBe("needs-triage");
  });

  it("needs-info → wontfix (with reason — FC-B1)", () => {
    const entry = makeEntry({ state: "needs-info" });
    const result = transition(entry, "wontfix", {
      actor: "agent",
      reason: "timeout-30d",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.entry.state).toBe("wontfix");
    expect(result.row.reason).toBe("timeout-30d");
  });

  it("ready-for-agent → ready-for-human (escalation)", () => {
    const entry = makeEntry({ state: "ready-for-agent" });
    const result = transition(entry, "ready-for-human", { actor: "agent" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.entry.state).toBe("ready-for-human");
  });

  it("ready-for-human → ready-for-agent (re-route)", () => {
    const entry = makeEntry({ state: "ready-for-human" });
    const result = transition(entry, "ready-for-agent", { actor: "human" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.entry.state).toBe("ready-for-agent");
  });

  it("wontfix → needs-triage with explicit reopen and reason (FC-B1)", () => {
    const entry = makeEntry({ state: "wontfix" });
    const result = transition(entry, "needs-triage", {
      actor: "human",
      reason: "new evidence found",
      explicitReopen: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.entry.state).toBe("needs-triage");
    expect(result.row.actor).toBe("human");
    expect(result.row.reason).toBe("new evidence found");
  });

  it("transition appends row to transitions[] and updates updatedAt", () => {
    const entry = makeEntry({
      state: "needs-triage",
      transitions: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const at = "2026-06-25T12:00:00.000Z";
    const result = transition(entry, "needs-info", { actor: "agent", at });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.entry.transitions).toHaveLength(1);
    expect(result.entry.updatedAt).toBe(at);
  });

  it("original entry is NOT mutated", () => {
    const entry = makeEntry({ state: "needs-triage" });
    const originalState = entry.state;
    transition(entry, "needs-info", { actor: "agent" });
    expect(entry.state).toBe(originalState);
    expect(entry.transitions).toHaveLength(0);
  });
});

// ── Invalid transition tests ─────────────────────────────────────────────────

describe("transition() — invalid transitions (undocumented)", () => {
  const undocumentedCases: Array<[TriageStateValue, TriageStateValue]> = [
    ["ready-for-agent", "needs-triage"],
    ["ready-for-human", "needs-triage"],
    ["ready-for-agent", "needs-info"],
    ["ready-for-human", "needs-info"],
    ["ready-for-human", "wontfix"],
    ["ready-for-agent", "wontfix"],
  ];

  for (const [from, to] of undocumentedCases) {
    it(`${from} → ${to} returns INVALID_TRANSITION`, () => {
      const entry = makeEntry({ state: from });
      const result = transition(entry, to, { actor: "agent", reason: "test" });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.errorCode).toBe("INVALID_TRANSITION");
    });
  }
});

// ── S-03: wontfix requires explicit reopen ───────────────────────────────────

describe("S-03: wontfix → * without explicit reopen fails with WONTFIX_REOPEN_REQUIRED", () => {
  it("wontfix → needs-triage without explicitReopen flag returns WONTFIX_REOPEN_REQUIRED", () => {
    const entry = makeEntry({ state: "wontfix" });
    const result = transition(entry, "needs-triage", {
      actor: "human",
      reason: "I have a reason",
      // explicitReopen NOT set — this is the S-03 scenario
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.errorCode).toBe("WONTFIX_REOPEN_REQUIRED");
  });

  it("transitions[] is unchanged after a rejected wontfix transition", () => {
    const initialTransitions = [
      {
        from: "needs-triage" as TriageStateValue,
        to: "wontfix" as TriageStateValue,
        at: "2026-01-01T00:00:00.000Z",
        actor: "human" as const,
        reason: "out of scope",
      },
    ];
    const entry = makeEntry({
      state: "wontfix",
      transitions: initialTransitions,
    });
    const result = transition(entry, "needs-triage", { actor: "human" });
    expect(result.ok).toBe(false);
    // The original entry's transitions should be unchanged
    expect(entry.transitions).toHaveLength(1);
  });

  it("wontfix → needs-info without explicitReopen returns WONTFIX_REOPEN_REQUIRED", () => {
    const entry = makeEntry({ state: "wontfix" });
    const result = transition(entry, "needs-info", { actor: "agent" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.errorCode).toBe("WONTFIX_REOPEN_REQUIRED");
  });
});

// ── FC-B1: reason required on specific transitions ────────────────────────────

describe("FC-B1: reason required on mandatory transitions", () => {
  it("needs-triage → wontfix without reason returns REASON_REQUIRED", () => {
    const entry = makeEntry({ state: "needs-triage" });
    const result = transition(entry, "wontfix", { actor: "human" }); // no reason
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.errorCode).toBe("REASON_REQUIRED");
  });

  it("needs-info → wontfix without reason returns REASON_REQUIRED", () => {
    const entry = makeEntry({ state: "needs-info" });
    const result = transition(entry, "wontfix", { actor: "agent" }); // no reason
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.errorCode).toBe("REASON_REQUIRED");
  });

  it("wontfix reopen without reason returns REASON_REQUIRED", () => {
    const entry = makeEntry({ state: "wontfix" });
    const result = transition(entry, "needs-triage", {
      actor: "human",
      explicitReopen: true,
      // no reason
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.errorCode).toBe("REASON_REQUIRED");
  });
});

// ── S-02: 30-day sweep ────────────────────────────────────────────────────────

describe("S-02: 30-day sweep — needs-info ages out to wontfix", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "loom-triage-test-"));
    mkdirSync(join(tmpDir, "inbox"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeInboxEntry(id: string, state: string, updatedAt: string): string {
    const filePath = join(tmpDir, "inbox", `${id}.md`);
    const content = [
      "---",
      `id: ${id}`,
      `category: enhancement`,
      `state: ${state}`,
      `createdAt: 2026-01-01T00:00:00.000Z`,
      `updatedAt: ${updatedAt}`,
      `transitions[0]{from,to,at,actor,reason}:`,
      "---",
      "Some idea description.",
    ].join("\n");
    writeFileSync(filePath, content, "utf8");
    return filePath;
  }

  it("transitions needs-info entry older than 30 days to wontfix", () => {
    // Entry was updated 31 days ago
    const thirtyOneDaysAgo = new Date("2026-06-26T00:00:00.000Z");
    thirtyOneDaysAgo.setDate(thirtyOneDaysAgo.getDate() - 31);
    writeInboxEntry("NOTE-001", "needs-info", thirtyOneDaysAgo.toISOString());

    const now = "2026-06-26T00:00:00.000Z";
    const result = runSweep(join(tmpDir, "inbox"), now);

    expect(result.sweptCount).toBe(1);
    expect(result.swept[0]?.id).toBe("NOTE-001");

    const updatedContent = readFileSync(
      join(tmpDir, "inbox", "NOTE-001.md"),
      "utf8",
    );
    expect(updatedContent).toContain("state: wontfix");
    expect(updatedContent).toContain("timeout-30d");
  });

  it("transitions[] contains row with reason 'timeout-30d'", () => {
    const thirtyOneDaysAgo = new Date("2026-06-26T00:00:00.000Z");
    thirtyOneDaysAgo.setDate(thirtyOneDaysAgo.getDate() - 31);
    writeInboxEntry("NOTE-001", "needs-info", thirtyOneDaysAgo.toISOString());

    const now = "2026-06-26T00:00:00.000Z";
    runSweep(join(tmpDir, "inbox"), now);

    const updatedContent = readFileSync(
      join(tmpDir, "inbox", "NOTE-001.md"),
      "utf8",
    );
    expect(updatedContent).toContain("timeout-30d");
    // Verify the transitions block was written
    expect(updatedContent).toMatch(/transitions\[1\]/);
  });

  it("does NOT transition needs-info entry that is only 29 days old", () => {
    const twentyNineDaysAgo = new Date("2026-06-26T00:00:00.000Z");
    twentyNineDaysAgo.setDate(twentyNineDaysAgo.getDate() - 29);
    writeInboxEntry("NOTE-002", "needs-info", twentyNineDaysAgo.toISOString());

    const now = "2026-06-26T00:00:00.000Z";
    const result = runSweep(join(tmpDir, "inbox"), now);

    expect(result.sweptCount).toBe(0);
    expect(result.skippedCount).toBe(1);

    const content = readFileSync(join(tmpDir, "inbox", "NOTE-002.md"), "utf8");
    expect(content).toContain("state: needs-info"); // unchanged
  });

  it("skips entries NOT in needs-info state", () => {
    const thirtyOneDaysAgo = new Date("2026-06-26T00:00:00.000Z");
    thirtyOneDaysAgo.setDate(thirtyOneDaysAgo.getDate() - 31);
    writeInboxEntry("NOTE-003", "needs-triage", thirtyOneDaysAgo.toISOString());

    const result = runSweep(join(tmpDir, "inbox"), "2026-06-26T00:00:00.000Z");
    expect(result.sweptCount).toBe(0);
  });

  it("returns empty result when inbox dir does not exist", () => {
    const result = runSweep(join(tmpDir, "nonexistent-inbox"), "2026-06-26T00:00:00.000Z");
    expect(result.sweptCount).toBe(0);
    expect(result.skippedCount).toBe(0);
  });

  it("accepts Date object as now argument", () => {
    const thirtyOneDaysAgo = new Date("2026-06-26T00:00:00.000Z");
    thirtyOneDaysAgo.setDate(thirtyOneDaysAgo.getDate() - 31);
    writeInboxEntry("NOTE-004", "needs-info", thirtyOneDaysAgo.toISOString());

    const nowDate = new Date("2026-06-26T00:00:00.000Z");
    const result = runSweep(join(tmpDir, "inbox"), nowDate);
    expect(result.sweptCount).toBe(1);
  });
});
