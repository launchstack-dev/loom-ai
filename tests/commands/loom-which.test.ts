/**
 * tests/commands/loom-which.test.ts
 *
 * Unit tests for the /loom-which decision tree specification.
 *
 * S-01: /loom-which recommends a command from a one-line description
 * S-02: /loom-which falls back to /loom-reference on no-match
 *
 * These tests validate the decision tree structure defined in
 * commands/loom-which.md and the routing logic contracts.
 *
 * Run: bunx vitest run tests/commands/loom-which.test.ts
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

// ── Helpers ────────────────────────────────────────────────────────────────

const REPO_ROOT = resolve(__dirname, "../..");
const LOOM_WHICH_PATH = join(REPO_ROOT, "commands/loom-which.md");
const GRILLING_PATH = join(REPO_ROOT, "protocols/grilling.md");

function readCommand(path: string): string {
  return readFileSync(path, "utf8");
}

// ── Decision tree structure extracted from the command spec ────────────────

interface DecisionNode {
  id: string;
  question: string | null;
  branches: string[];
  leafRecommendation: string | null;
}

interface DecisionEdge {
  fromNode: string;
  branch: string;
  toNode: string;
}

/**
 * Parse nodes[N]{...}: table from TOON content.
 * Returns an array of parsed node objects.
 */
function parseNodeTable(content: string): DecisionNode[] {
  // Find the nodes[N]{...}: block.
  const nodeBlockMatch = /nodes\[\d+\]\{[^}]+\}:\s*\n((?:  .+\n?)+)/m.exec(content);
  if (!nodeBlockMatch) return [];

  return nodeBlockMatch[1]
    .split(/\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => {
      // Each row: id,"question","[branches]",leafRecommendation
      // Parse by splitting on commas with quoted field awareness.
      const parts = parseCsvRow(line.trim());
      const branchesRaw = parts[2] ?? "[]";
      const branches = branchesRaw
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map((b) => b.trim())
        .filter((b) => b.length > 0);

      return {
        id: parts[0] ?? "",
        question: parts[1] === "null" ? null : (parts[1] ?? "").replace(/^"|"$/g, ""),
        branches,
        leafRecommendation:
          parts[3] === "null"
            ? null
            : (parts[3] ?? "").replace(/^"|"$/g, ""),
      };
    });
}

/**
 * Minimal CSV row parser that handles quoted fields (including commas inside quotes).
 */
function parseCsvRow(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Parse edges[N]{...}: table from TOON content.
 */
function parseEdgeTable(content: string): DecisionEdge[] {
  const edgeBlockMatch = /edges\[\d+\]\{[^}]+\}:\s*\n((?:  .+\n?)+)/m.exec(content);
  if (!edgeBlockMatch) return [];

  return edgeBlockMatch[1]
    .split(/\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const parts = line.trim().split(",");
      return {
        fromNode: parts[0]?.trim() ?? "",
        branch: parts[1]?.trim() ?? "",
        toNode: parts[2]?.trim() ?? "",
      };
    });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("/loom-which command spec", () => {
  it("commands/loom-which.md exists", () => {
    expect(existsSync(LOOM_WHICH_PATH)).toBe(true);
  });

  describe("decision tree structure", () => {
    let content: string;
    let nodes: DecisionNode[];
    let edges: DecisionEdge[];

    beforeAll(() => {
      content = readCommand(LOOM_WHICH_PATH);
      nodes = parseNodeTable(content);
      edges = parseEdgeTable(content);
    });

    it("has ≥6 branch (internal) nodes", () => {
      // Internal nodes have a question (non-null) and no leafRecommendation.
      const internalNodes = nodes.filter(
        (n) => n.question !== null && n.leafRecommendation === null,
      );
      expect(internalNodes.length).toBeGreaterThanOrEqual(6);
    });

    it("root node N-01 exists with the correct question", () => {
      const n01 = nodes.find((n) => n.id === "N-01");
      expect(n01).toBeDefined();
      expect(n01?.question).toMatch(/what kind of task/i);
    });

    it("N-01 has all 6 expected branches", () => {
      const n01 = nodes.find((n) => n.id === "N-01");
      expect(n01?.branches).toContain("bug");
      expect(n01?.branches).toContain("feature");
      expect(n01?.branches).toContain("design");
      expect(n01?.branches).toContain("planning");
      expect(n01?.branches).toContain("audit");
      expect(n01?.branches).toContain("unclear");
    });

    it("leaf L-bugfix-tight recommends /loom-bugfix --autoconverge", () => {
      const leaf = nodes.find((n) => n.id === "L-bugfix-tight");
      expect(leaf?.leafRecommendation).toMatch(/loom-bugfix.*--autoconverge/i);
    });

    it("leaf L-unclear-fallback recommends /loom-reference", () => {
      const leaf = nodes.find((n) => n.id === "L-unclear-fallback");
      expect(leaf?.leafRecommendation).toMatch(/loom-reference/i);
    });

    it("all edges reference valid node IDs", () => {
      const nodeIds = new Set(nodes.map((n) => n.id));
      for (const edge of edges) {
        expect(nodeIds).toContain(edge.fromNode);
        expect(nodeIds).toContain(edge.toNode);
      }
    });

    it("has ≥18 edges (full tree coverage)", () => {
      expect(edges.length).toBeGreaterThanOrEqual(18);
    });
  });

  // S-01: /loom-which recommends a command from a one-line description
  describe("S-01: route 'bug fix needs a reproduction' → /loom-bugfix", () => {
    it("the spec routes N-01→bug→N-02→yes→L-bugfix-tight", () => {
      const content = readCommand(LOOM_WHICH_PATH);
      const edges = parseEdgeTable(content);

      // N-01 --bug--> N-02
      const bugEdge = edges.find(
        (e) => e.fromNode === "N-01" && e.branch === "bug",
      );
      expect(bugEdge?.toNode).toBe("N-02");

      // N-02 --yes--> L-bugfix-tight
      const tightEdge = edges.find(
        (e) => e.fromNode === "N-02" && e.branch === "yes",
      );
      expect(tightEdge?.toNode).toBe("L-bugfix-tight");

      // L-bugfix-tight recommends /loom-bugfix --autoconverge
      const nodes = parseNodeTable(content);
      const leaf = nodes.find((n) => n.id === "L-bugfix-tight");
      expect(leaf?.leafRecommendation).toMatch(/loom-bugfix/);
    });

    it("the spec mentions the 10-rung ladder", () => {
      const content = readCommand(LOOM_WHICH_PATH);
      // The plan AC says recommendation MUST cite a leading rung from the 10-rung ladder.
      // The command spec mentions rung in bugfix recommendation context.
      expect(content).toMatch(/rung/i);
    });
  });

  // S-02: /loom-which falls back to /loom-reference on no-match
  describe("S-02: no-match falls back to /loom-reference", () => {
    it("the spec routes N-01→unclear→L-unclear-fallback", () => {
      const content = readCommand(LOOM_WHICH_PATH);
      const edges = parseEdgeTable(content);

      const unclearEdge = edges.find(
        (e) => e.fromNode === "N-01" && e.branch === "unclear",
      );
      expect(unclearEdge?.toNode).toBe("L-unclear-fallback");
    });

    it("the spec emits NO_MATCH diagnostic on fallback", () => {
      const content = readCommand(LOOM_WHICH_PATH);
      // The command spec must mention NO_MATCH for S-02 compliance.
      expect(content).toMatch(/NO_MATCH/);
    });

    it("L-unclear-fallback recommends /loom-reference", () => {
      const content = readCommand(LOOM_WHICH_PATH);
      const nodes = parseNodeTable(content);
      const leaf = nodes.find((n) => n.id === "L-unclear-fallback");
      expect(leaf?.leafRecommendation).toMatch(/loom-reference/);
    });
  });

  describe("grilling discipline compliance (GR-01..GR-05)", () => {
    let content: string;

    beforeAll(() => {
      content = readCommand(LOOM_WHICH_PATH);
    });

    it("references GR-01 (one question per turn)", () => {
      expect(content).toMatch(/GR-01/);
    });

    it("references GR-02 (recommend default)", () => {
      expect(content).toMatch(/GR-02/);
    });

    it("references GR-03 (walk every branch)", () => {
      expect(content).toMatch(/GR-03/);
    });

    it("references GR-04 (prefer codebase exploration)", () => {
      expect(content).toMatch(/GR-04/);
    });

    it("references GR-05 (session cap)", () => {
      expect(content).toMatch(/GR-05/);
    });

    it("mentions STUCK_AT_GRILL_CAP error code", () => {
      expect(content).toMatch(/STUCK_AT_GRILL_CAP/);
    });

    it("specifies one-question-at-a-time behavior verbatim", () => {
      expect(content).toMatch(/one question per/i);
    });
  });
});
