/**
 * Unit tests for the F-04 Gemini PR-review adapter
 * (`scripts/lib/pr-review-adapters/gemini.ts`).
 *
 * Covers the three acceptance scenarios from PLAN-convergence-applications
 * Phase 5:
 *   S-01: severity tag parsing across all three levels + missing-tag default
 *   S-02: dedup against prior iteration's findings.toon
 *   S-03: empty Gemini review returns an empty findings[] array
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  fetchFindings,
  geminiAdapter,
  parseBodyParts,
  parseSeverity,
  readPriorTriples,
} from "../../scripts/lib/pr-review-adapters/gemini.js";
import type {
  BotComment,
  BotCommentFetcher,
  ConvergenceFindings,
} from "../../scripts/lib/pr-review-adapters/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXTURES = path.join(
  __dirname,
  "..",
  "fixtures",
  "pr-review",
  "gemini",
);

function loadJsonFixture(name: string): BotComment[] {
  const raw = fs.readFileSync(path.join(FIXTURES, name), "utf8");
  return JSON.parse(raw) as BotComment[];
}

function makeFetcher(comments: BotComment[]): BotCommentFetcher {
  return async () => comments;
}

const FIXED_NOW = () => new Date("2026-06-15T12:00:00.000Z");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseSeverity", () => {
  it("maps ![high] to blocking", () => {
    expect(parseSeverity("![high] something bad")).toBe("blocking");
  });

  it("maps ![medium] to warning", () => {
    expect(parseSeverity("![medium] hmm")).toBe("warning");
  });

  it("maps ![low] to info", () => {
    expect(parseSeverity("![low] nit")).toBe("info");
  });

  it("defaults to info when no severity tag is present", () => {
    expect(parseSeverity("plain comment with no marker")).toBe("info");
  });

  it("is case-insensitive on the tag", () => {
    expect(parseSeverity("![HIGH] yelling")).toBe("blocking");
  });
});

describe("parseBodyParts", () => {
  it("strips the severity tag and returns the first line as summary", () => {
    const { summary, suggestion } = parseBodyParts(
      "![high] missing null check\nUse optional chaining",
    );
    expect(summary).toBe("missing null check");
    expect(suggestion).toBe("Use optional chaining");
  });

  it("returns empty suggestion when body has only a single line", () => {
    const { summary, suggestion } = parseBodyParts("![low] typo");
    expect(summary).toBe("typo");
    expect(suggestion).toBe("");
  });

  it("tolerates a body with no tag", () => {
    const { summary, suggestion } = parseBodyParts("plain note");
    expect(summary).toBe("plain note");
    expect(suggestion).toBe("");
  });
});

// S-01
describe("S-01: severity tag parsing across all three levels + default", () => {
  it("maps each canned round-1 comment to the expected severity", async () => {
    const comments = loadJsonFixture("round-1-comments.json");
    const findings: ConvergenceFindings = await fetchFindings({
      prNumber: 1234,
      iteration: 1,
      fetcher: makeFetcher(comments),
      now: FIXED_NOW,
    });

    expect(findings.findings).toHaveLength(4);
    expect(findings.findings.map((f) => f.severity)).toEqual([
      "blocking",
      "warning",
      "info",
      "info",
    ]);

    // Schema invariants 1, 2, 3
    expect(findings.blockingCount).toBe(1);
    expect(findings.advisoryCount).toBe(3);
    expect(findings.findings.length).toBe(
      findings.blockingCount + findings.advisoryCount,
    );

    // Sequential ids
    expect(findings.findings.map((f) => f.id)).toEqual([
      "F-01",
      "F-02",
      "F-03",
      "F-04",
    ]);

    // Reviewer attribution
    for (const f of findings.findings) {
      expect(f.reviewerAgent).toBe("gemini");
      expect(f.dimension).toBe("pr-review");
    }

    // Severity tag is stripped from summary
    expect(findings.findings[0].summary).toBe(
      "Potential null dereference on `session.user`",
    );
    expect(findings.findings[0].locationPath).toBe("src/auth/session.ts");
    expect(findings.findings[0].locationAnchor).toBe(":17");

    // Envelope shape
    expect(findings.subject).toBe(
      ".plan-execution/pr-review/pr-state.toon",
    );
    expect(findings.harnessName).toBe("pr-review");
    expect(findings.iteration).toBe(1);
    expect(findings.producedAt).toBe("2026-06-15T12:00:00.000Z");
  });
});

// S-02
describe("S-02: dedup against prior iteration findings.toon", () => {
  it("reads the (path, anchor, summary) triples from iter-0", () => {
    const triples = readPriorTriples(
      path.join(FIXTURES, "iter-0-findings.toon"),
    );
    expect(triples.size).toBe(1);
  });

  it("returns an empty triples set when prior file is missing", () => {
    const triples = readPriorTriples(
      path.join(FIXTURES, "does-not-exist.toon"),
    );
    expect(triples.size).toBe(0);
  });

  it("suppresses round-2 comments that match a prior triple", async () => {
    const comments = loadJsonFixture("round-2-comments.json");
    const findings: ConvergenceFindings = await fetchFindings({
      prNumber: 1234,
      iteration: 2,
      priorFindingsPath: path.join(FIXTURES, "iter-0-findings.toon"),
      fetcher: makeFetcher(comments),
      now: FIXED_NOW,
    });

    // Round 2 has 2 comments; one matches the prior iter row and is dropped.
    expect(findings.findings).toHaveLength(1);
    expect(findings.findings[0].summary).toBe(
      "Newly flagged: thread-unsafe access to module-level cache",
    );
    expect(findings.findings[0].id).toBe("F-01");
    expect(findings.findings[0].locationAnchor).toBe(":73");

    expect(findings.blockingCount).toBe(0);
    expect(findings.advisoryCount).toBe(1);
  });

  it("does NOT dedup when priorFindingsPath is omitted (iteration 1)", async () => {
    const comments = loadJsonFixture("round-2-comments.json");
    const findings = await fetchFindings({
      prNumber: 1234,
      iteration: 1,
      fetcher: makeFetcher(comments),
      now: FIXED_NOW,
    });
    expect(findings.findings).toHaveLength(2);
  });
});

// S-03
describe("S-03: empty Gemini review", () => {
  it("returns an empty findings[] when the bot has no comments", async () => {
    const findings = await fetchFindings({
      prNumber: 1234,
      iteration: 1,
      fetcher: makeFetcher([]),
      now: FIXED_NOW,
    });

    expect(findings.findings).toEqual([]);
    expect(findings.blockingCount).toBe(0);
    expect(findings.advisoryCount).toBe(0);
    expect(findings.harnessName).toBe("pr-review");
    expect(findings.iteration).toBe(1);
  });
});

// Adapter object
describe("geminiAdapter", () => {
  it("exposes name=gemini and a fetchFindings function", () => {
    expect(geminiAdapter.name).toBe("gemini");
    expect(typeof geminiAdapter.fetchFindings).toBe("function");
  });

  it("matches the standalone fetchFindings export", async () => {
    const direct = await fetchFindings({
      prNumber: 1234,
      iteration: 1,
      fetcher: makeFetcher([]),
      now: FIXED_NOW,
    });
    const viaAdapter = await geminiAdapter.fetchFindings({
      prNumber: 1234,
      iteration: 1,
      fetcher: makeFetcher([]),
      now: FIXED_NOW,
    });
    expect(viaAdapter).toEqual(direct);
  });
});

// Defensive coverage
describe("input validation", () => {
  it("rejects non-positive iteration", async () => {
    await expect(
      fetchFindings({
        prNumber: 1,
        iteration: 0,
        fetcher: makeFetcher([]),
      }),
    ).rejects.toThrow(/FINDINGS_SCHEMA_INVALID/);
  });

  it("rejects non-positive prNumber", async () => {
    await expect(
      fetchFindings({
        prNumber: 0,
        iteration: 1,
        fetcher: makeFetcher([]),
      }),
    ).rejects.toThrow(/prNumber/);
  });
});
