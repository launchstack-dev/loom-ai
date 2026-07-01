#!/usr/bin/env bunx tsx
/**
 * scripts/loom-learnings-search.ts
 *
 * Search .loom/learnings.toon by keyword match on key/description/tags,
 * sort by confidence descending, and print top-N as a TOON typed array.
 *
 * Usage:
 *   bunx tsx scripts/loom-learnings-search.ts --query <keyword> [--limit N] [--min-confidence N]
 *
 * Contract:
 *   Input file: .loom/learnings.toon per protocols/learnings.schema.toon
 *   Output: TOON typed-array on stdout; always exits 0.
 */

import * as fs from "node:fs";
import * as path from "node:path";

interface Learning {
  id: string;
  key: string;
  description: string;
  confidence: number;
  sourcePlan: string;
  sourceDate: string;
  domain: string;
  tags: string;
}

interface Args {
  query: string;
  limit: number;
  minConfidence: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { query: "", limit: 20, minConfidence: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--query" && argv[i + 1] !== undefined) {
      args.query = argv[++i];
    } else if (a === "--limit" && argv[i + 1] !== undefined) {
      args.limit = Math.max(1, parseInt(argv[++i], 10) || 20);
    } else if (a === "--min-confidence" && argv[i + 1] !== undefined) {
      args.minConfidence = Math.max(1, Math.min(10, parseInt(argv[++i], 10) || 1));
    }
  }
  return args;
}

/**
 * Split a TOON typed-array row, respecting double-quoted cells.
 */
function splitCsvRow(row: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') {
      inQuote = !inQuote;
      cur += ch;
      continue;
    }
    if (ch === "," && !inQuote) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function unquote(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\"/g, '"');
  }
  return s;
}

function parseLearningsFile(filePath: string): Learning[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split(/\r?\n/);
  const out: Learning[] = [];
  let headerCols: string[] | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^\s*learnings\[[^\]]*\]\{([^}]*)\}:\s*$/);
    if (m) {
      headerCols = m[1].split(",").map((c) => c.trim());
      continue;
    }
    if (!headerCols) continue;
    if (!/^\s{2,}\S/.test(line)) continue;
    const cells = splitCsvRow(line.trim()).map(unquote);
    if (cells.length < headerCols.length) continue;
    const row: Record<string, string> = {};
    headerCols.forEach((col, idx) => (row[col] = cells[idx] ?? ""));
    const confidence = Number(row.confidence);
    if (!Number.isFinite(confidence)) continue;
    out.push({
      id: row.id ?? "",
      key: row.key ?? "",
      description: row.description ?? "",
      confidence,
      sourcePlan: row.sourcePlan ?? "",
      sourceDate: row.sourceDate ?? "",
      domain: row.domain ?? "",
      tags: row.tags ?? "",
    });
  }
  return out;
}

function matches(l: Learning, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    l.key.toLowerCase().includes(q) ||
    l.description.toLowerCase().includes(q) ||
    l.tags.toLowerCase().includes(q)
  );
}

function quoteIfNeeded(s: string): string {
  if (s.includes(",") || s.includes('"')) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();
  const learningsPath = path.join(repoRoot, ".loom", "learnings.toon");

  const all = parseLearningsFile(learningsPath);
  const filtered = all
    .filter((l) => l.confidence >= args.minConfidence)
    .filter((l) => matches(l, args.query))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, args.limit);

  const cols = "id,key,description,confidence,sourcePlan,sourceDate,domain,tags";
  process.stdout.write(`schemaVersion: 1\n`);
  process.stdout.write(`query: ${quoteIfNeeded(args.query)}\n`);
  process.stdout.write(`resultCount: ${filtered.length}\n`);
  process.stdout.write(`results[${filtered.length}]{${cols}}:\n`);
  for (const l of filtered) {
    process.stdout.write(
      `  ${l.id},${quoteIfNeeded(l.key)},${quoteIfNeeded(l.description)},${l.confidence},${quoteIfNeeded(l.sourcePlan)},${l.sourceDate},${quoteIfNeeded(l.domain)},${quoteIfNeeded(l.tags)}\n`
    );
  }
  process.exit(0);
}

main();
