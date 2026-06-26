/**
 * scripts/triage/30day-sweep.ts
 *
 * Scans `inbox/*.md` for entries in `needs-info` state whose `updatedAt` is
 * older than 30 days and transitions them to `wontfix` with
 * `reason: "timeout-30d"`.
 *
 * Design:
 * - Pure date-mocked: accepts a `now` argument (ISO 8601 string or Date) for
 *   testability — no implicit new Date() in the comparison path.
 * - File writes are atomic: write to `{path}.tmp`, then rename.
 * - Returns a SweepResult describing each entry processed.
 */

import { readFileSync, writeFileSync, renameSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { transition, type TriageEntry, type TransitionRow } from "./state-machine.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SweptEntry {
  id: string;
  file: string;
  updatedAt: string;
  transitionedAt: string;
}

export interface SweepResult {
  sweptCount: number;
  skippedCount: number;
  swept: SweptEntry[];
}

// ── TOON frontmatter parser (minimal, inbox-only) ────────────────────────────

/**
 * Parse the TOON frontmatter block from an inbox .md file.
 * Frontmatter is delimited by `---` lines.
 */
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

/**
 * Serialize a TriageEntry back to TOON frontmatter + body.
 * Minimal serializer: writes only the fields relevant to the sweep output.
 */
function serializeEntry(entry: TriageEntry, body: string): string {
  const transitionLines = entry.transitions
    .map(
      (t) =>
        `  ${t.from},${t.to},${t.at},${t.actor},${t.reason ?? "null"}`,
    )
    .join("\n");

  const transitionBlock =
    entry.transitions.length > 0
      ? `transitions[${entry.transitions.length}]{from,to,at,actor,reason}:\n${transitionLines}`
      : `transitions[0]{from,to,at,actor,reason}:`;

  return [
    "---",
    `id: ${entry.id}`,
    `category: ${entry.category}`,
    `state: ${entry.state}`,
    `createdAt: ${entry.createdAt}`,
    `updatedAt: ${entry.updatedAt}`,
    transitionBlock,
    "---",
    body,
  ].join("\n");
}

/**
 * Parse a transitions table from TOON frontmatter content.
 * Format: `transitions[N]{from,to,at,actor,reason}:` followed by indented rows.
 */
function parseTransitions(raw: Record<string, string>, fullContent: string): TransitionRow[] {
  // The minimal parser above only captures scalar key:value pairs.
  // Extract the transitions block from the raw content separately.
  const blockMatch = /transitions\[\d+\]\{[^}]+\}:\n((?:  .+\n?)*)/m.exec(fullContent);
  if (!blockMatch || !blockMatch[1].trim()) return [];

  return blockMatch[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const parts = line.split(",");
      return {
        from: parts[0]?.trim() as TriageEntry["state"],
        to: parts[1]?.trim() as TriageEntry["state"],
        at: parts[2]?.trim() ?? "",
        actor: (parts[3]?.trim() ?? "agent") as "human" | "agent",
        reason: parts[4]?.trim() === "null" ? null : (parts[4]?.trim() ?? null),
      };
    });
}

/**
 * Parse a full TriageEntry from a Markdown file's content.
 */
function parseTriageEntry(content: string): TriageEntry | null {
  const fm = parseFrontmatter(content);
  if (!fm["id"] || !fm["state"]) return null;

  return {
    id: fm["id"],
    category: (fm["category"] ?? "bug") as "bug" | "enhancement",
    state: fm["state"] as TriageEntry["state"],
    createdAt: fm["createdAt"] ?? "",
    updatedAt: fm["updatedAt"] ?? "",
    transitions: parseTransitions(fm, content),
  };
}

// ── 30-day constant ──────────────────────────────────────────────────────────

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Run the 30-day sweep.
 *
 * @param inboxDir  Absolute path to the `inbox/` directory.
 * @param now       Reference timestamp for age calculation (ISO 8601 string or
 *                  Date). Pass a fixed value in tests for determinism.
 * @returns         SweepResult describing swept and skipped entries.
 */
export function runSweep(
  inboxDir: string,
  now: string | Date = new Date(),
): SweepResult {
  const nowMs = typeof now === "string" ? new Date(now).getTime() : now.getTime();
  const swept: SweptEntry[] = [];
  let skippedCount = 0;

  const dir = resolve(inboxDir);
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    // inbox dir does not exist yet — nothing to sweep
    return { sweptCount: 0, skippedCount: 0, swept: [] };
  }

  for (const file of files) {
    const filePath = join(dir, file);
    let content: string;
    try {
      content = readFileSync(filePath, "utf8");
    } catch {
      skippedCount++;
      continue;
    }

    const entry = parseTriageEntry(content);
    if (!entry) {
      skippedCount++;
      continue;
    }

    // Only sweep needs-info entries
    if (entry.state !== "needs-info") {
      skippedCount++;
      continue;
    }

    const updatedAtMs = new Date(entry.updatedAt).getTime();
    const ageMs = nowMs - updatedAtMs;

    if (ageMs < THIRTY_DAYS_MS) {
      skippedCount++;
      continue;
    }

    // Transition to wontfix with reason: timeout-30d
    const transitionedAt = typeof now === "string" ? now : now.toISOString();
    const result = transition(entry, "wontfix", {
      actor: "agent",
      reason: "timeout-30d",
      at: transitionedAt,
    });

    if (!result.ok) {
      // Should never happen for needs-info→wontfix, but skip rather than crash
      skippedCount++;
      continue;
    }

    // Extract body (everything after closing ---)
    const bodyMatch = /^---\n[\s\S]*?\n---([\s\S]*)$/.exec(content);
    const body = bodyMatch ? bodyMatch[1] : "";

    const newContent = serializeEntry(result.entry, body);
    const tmpPath = `${filePath}.tmp`;

    writeFileSync(tmpPath, newContent, "utf8");
    renameSync(tmpPath, filePath);

    swept.push({
      id: entry.id,
      file: filePath,
      updatedAt: entry.updatedAt,
      transitionedAt,
    });
  }

  return { sweptCount: swept.length, skippedCount, swept };
}
