/**
 * scripts/out-of-scope/suppress.ts
 *
 * Given a proposal id or text, scans `.out-of-scope/*.md` and returns
 * matching entries with their id, rejectedAt, and rationale.
 *
 * Also emits a one-line callout string (never silent suppression) that
 * `loom-roadmap converge` can embed in its output.
 *
 * Callout format (per protocols/out-of-scope.schema.md):
 *   "> [OOS-suppressed] OOS-07 was rejected on 2026-06-25 — Rationale: <rationale excerpt>"
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

// ── Types ────────────────────────────────────────────────────────────────────

export interface OosEntry {
  id: string;
  idea: string;
  rejectedAt: string;
  rejectedBy: "human" | "agent";
  rationale: string;
  sourceProposalId: string | null;
}

export interface SuppressMatch {
  id: string;
  rejectedAt: string;
  rationale: string;
  callout: string;
}

export interface SuppressResult {
  matched: boolean;
  matches: SuppressMatch[];
}

// ── Frontmatter parser ────────────────────────────────────────────────────────

function parseFrontmatter(content: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!match) return {};

  const result: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim().replace(/^["']|["']$/g, "");
    result[key] = value;
  }
  return result;
}

function parseOosEntry(content: string): OosEntry | null {
  const fm = parseFrontmatter(content);
  if (!fm["id"] || !fm["idea"]) return null;

  return {
    id: fm["id"],
    idea: fm["idea"],
    rejectedAt: fm["rejectedAt"] ?? "",
    rejectedBy: (fm["rejectedBy"] ?? "agent") as "human" | "agent",
    rationale: fm["rationale"] ?? "",
    sourceProposalId: fm["sourceProposalId"] ?? null,
  };
}

// ── Matching logic ────────────────────────────────────────────────────────────

/**
 * Simple text similarity: does the `query` overlap with the `idea` text?
 * Uses a token-overlap heuristic: any shared word ≥4 chars is a match.
 */
function textMatches(query: string, idea: string): boolean {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4);

  const queryTokens = new Set(normalize(query));
  const ideaTokens = normalize(idea);
  return ideaTokens.some((t) => queryTokens.has(t));
}

/**
 * Format the rejection date as YYYY-MM-DD for the callout.
 */
function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Build a one-line callout string for the matched entry.
 * Format: "> [OOS-suppressed] {id} was rejected on {date} — Rationale: {rationale excerpt}"
 */
function buildCallout(entry: OosEntry): string {
  const date = formatDate(entry.rejectedAt);
  const rationaleExcerpt =
    entry.rationale.length > 120
      ? entry.rationale.slice(0, 117) + "..."
      : entry.rationale;
  return `> [OOS-suppressed] ${entry.id} was rejected on ${date} — Rationale: ${rationaleExcerpt}`;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Scan `.out-of-scope/` for entries matching the given proposal.
 *
 * Matching uses two strategies:
 *   1. Exact id match — `proposalId` matches `entry.id` or `entry.sourceProposalId`
 *   2. Text match     — `proposalText` overlaps with `entry.idea` (token heuristic)
 *
 * @param oosDir        Absolute path to the `.out-of-scope/` directory.
 * @param proposalId    Optional proposal id to match exactly.
 * @param proposalText  Optional freeform text to match against idea field.
 * @returns             SuppressResult with all matches and their callout strings.
 */
export function checkSuppressed(
  oosDir: string,
  proposalId?: string | null,
  proposalText?: string | null,
): SuppressResult {
  const dir = resolve(oosDir);
  let files: string[];

  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    // Directory does not exist — no suppressions
    return { matched: false, matches: [] };
  }

  const matches: SuppressMatch[] = [];

  for (const file of files) {
    const filePath = join(dir, file);
    let content: string;
    try {
      content = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    const entry = parseOosEntry(content);
    if (!entry) continue;

    const idMatch =
      proposalId != null &&
      (entry.id === proposalId || entry.sourceProposalId === proposalId);

    const textMatch =
      proposalText != null && textMatches(proposalText, entry.idea);

    if (!idMatch && !textMatch) continue;

    matches.push({
      id: entry.id,
      rejectedAt: entry.rejectedAt,
      rationale: entry.rationale,
      callout: buildCallout(entry),
    });
  }

  return { matched: matches.length > 0, matches };
}
