#!/usr/bin/env tsx
/**
 * /loom-change diff {id} — show the deltas a change WILL apply on archive.
 *
 * Reads `.loom/changes/{id}/proposal.md` and parses every per-domain DeltaBlock
 * from the body's `## Deltas` section. Renders a human-readable diff per
 * affected spec, grouped by added / modified / removed for Requirements and
 * Scenarios.
 *
 * This is a query subcommand — it never writes. Phase 5 deliverable.
 *
 * Output sections (per affected domain):
 *   Domain: {domain}                                  (breakingChange flag)
 *   + R-NN  added requirement text
 *   ~ R-NN  before  →  after
 *   - R-NN  removed
 *   + S-NN  "title"  added scenario
 *   ~ S-NN  modified scenario summary
 *   - S-NN  removed
 *   Rationale: ...
 *   Migration: ... (when breaking)
 *
 * Exit codes:
 *   0  success
 *   1  unknown changeId (no proposal directory)
 *   2  IO or parse error
 *
 * Phase 6 mutation commands MAY reuse `parseDeltasFromProposal` to validate
 * the proposal body matches the proposal.md TOON frontmatter (per the
 * `deltas.toon matches proposal.md` blocking rule in change-proposal.schema.md).
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  CHANGE_ID_PATTERN,
  changeDir,
  isValidChangeId,
  proposalPath,
} from "../../hooks/lib/change-paths.js";

export interface DiffOptions {
  changeId: string;
  rootDir?: string;
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
  format?: "human" | "json";
}

export interface ModifiedRequirementEntry {
  id: string;
  before: string;
  after: string;
}

export interface ModifiedScenarioEntry {
  id: string;
  beforeRaw: string;
  afterRaw: string;
}

export interface ScenarioSummary {
  id: string;
  title: string;
  /** Full TOON block, useful for tooling that wants the raw body. */
  raw: string;
}

export interface DeltaBlockSummary {
  domain: string;
  addedRequirements: string[];
  modifiedRequirements: ModifiedRequirementEntry[];
  removedRequirements: string[];
  addedScenarios: ScenarioSummary[];
  modifiedScenarios: ModifiedScenarioEntry[];
  removedScenarios: string[];
  breakingChange: boolean;
  migrationNote: string | null;
  rationale: string;
  /** 1-indexed line where the `### {domain}` heading appears. */
  sourceLine: number;
}

export interface DiffResult {
  changeId: string;
  deltas: DeltaBlockSummary[];
  parseErrors: string[];
  exitCode: number;
}

export function runDiff(options: DiffOptions): DiffResult {
  const rootDir = options.rootDir ?? process.cwd();
  const out = options.out ?? process.stdout;
  const err = options.err ?? process.stderr;
  const format = options.format ?? "human";

  const result: DiffResult = {
    changeId: options.changeId,
    deltas: [],
    parseErrors: [],
    exitCode: 0,
  };

  if (!isValidChangeId(options.changeId)) {
    err.write(
      `Invalid changeId '${options.changeId}': expected ${CHANGE_ID_PATTERN}\n`
    );
    result.exitCode = 2;
    return result;
  }

  const dir = changeDir(rootDir, options.changeId);
  if (!fs.existsSync(dir)) {
    err.write(
      `No change found: ${path.relative(rootDir, dir) || dir} does not exist\n`
    );
    result.exitCode = 1;
    return result;
  }

  const propPath = proposalPath(rootDir, options.changeId);
  if (!fs.existsSync(propPath)) {
    err.write(
      `Proposal missing: ${path.relative(rootDir, propPath)}\n`
    );
    result.exitCode = 1;
    return result;
  }

  let raw: string;
  try {
    raw = fs.readFileSync(propPath, "utf8");
  } catch (e) {
    err.write(
      `Failed to read ${path.relative(rootDir, propPath)}: ${e instanceof Error ? e.message : String(e)}\n`
    );
    result.exitCode = 2;
    return result;
  }

  try {
    result.deltas = parseDeltasFromProposal(raw);
  } catch (e) {
    result.parseErrors.push(e instanceof Error ? e.message : String(e));
    result.exitCode = 2;
  }

  if (format === "json") {
    out.write(JSON.stringify(result, null, 2) + "\n");
    return result;
  }

  renderHuman(options.changeId, result.deltas, out);
  for (const message of result.parseErrors) {
    err.write(`parse error: ${message}\n`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public parser — exported so Phase 6 can reuse it for archive pre-flight
// validation. Returns one DeltaBlockSummary per `### {domain}` subsection
// under `## Deltas`.
// ---------------------------------------------------------------------------

export function parseDeltasFromProposal(markdown: string): DeltaBlockSummary[] {
  const lines = markdown.split("\n");

  // Locate the `## Deltas` section. End at the next H2.
  let deltasStart = -1;
  let deltasEnd = lines.length - 1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Deltas\s*$/.test(lines[i])) {
      deltasStart = i;
      for (let j = i + 1; j < lines.length; j++) {
        if (/^##\s+\S/.test(lines[j])) {
          deltasEnd = j - 1;
          break;
        }
      }
      break;
    }
  }
  if (deltasStart === -1) return [];

  // Within the Deltas section, find each `### {domain}` and its body.
  const summaries: DeltaBlockSummary[] = [];
  let i = deltasStart + 1;
  while (i <= deltasEnd) {
    const headingMatch = /^###\s+(.+?)\s*$/.exec(lines[i]);
    if (!headingMatch) {
      i++;
      continue;
    }
    const domainHeading = headingMatch[1].trim();
    const headingLine = i;

    // Body runs until the next `### ` or `## ` or section end.
    let bodyEnd = deltasEnd;
    for (let j = i + 1; j <= deltasEnd; j++) {
      if (/^###\s+\S/.test(lines[j]) || /^##\s+\S/.test(lines[j])) {
        bodyEnd = j - 1;
        break;
      }
    }

    const body = lines.slice(i + 1, bodyEnd + 1).join("\n");
    const summary = parseSingleDeltaBlock(domainHeading, body, headingLine);
    summaries.push(summary);
    i = bodyEnd + 1;
  }
  return summaries;
}

function parseSingleDeltaBlock(
  domainHeading: string,
  body: string,
  sourceLine: number
): DeltaBlockSummary {
  // The body contains one TOON code fence. Inside that fence we have:
  //   domain: ...
  //   addedRequirements[N]: a, b, c
  //   modifiedRequirements[N]{id,before,after}:
  //     <rows>
  //   removedRequirements[N]: ...
  //   addedScenarios[N]:
  //     <one nested ```toon block per scenario>
  //   modifiedScenarios[N]{id,before,after}:
  //     <rows>
  //   removedScenarios[N]: ...
  //   breakingChange: bool
  //   migrationNote: ...
  //   rationale: ...

  const fence = extractFirstToonFence(body);
  if (fence === null) {
    return {
      domain: domainHeading,
      addedRequirements: [],
      modifiedRequirements: [],
      removedRequirements: [],
      addedScenarios: [],
      modifiedScenarios: [],
      removedScenarios: [],
      breakingChange: false,
      migrationNote: null,
      rationale: "",
      sourceLine,
    };
  }

  const fenceBody = fence;

  // Scalars: domain, breakingChange, migrationNote, rationale.
  const scalars = scanFlatScalars(fenceBody, [
    "domain",
    "breakingChange",
    "migrationNote",
    "rationale",
  ]);

  // Simple arrays: addedRequirements, removedRequirements, removedScenarios.
  const addedRequirements = readSimpleArray(fenceBody, "addedRequirements");
  const removedRequirements = readSimpleArray(fenceBody, "removedRequirements");
  const removedScenarios = readSimpleArray(fenceBody, "removedScenarios");

  // Typed arrays: modifiedRequirements{id,before,after}, modifiedScenarios{id,before,after}.
  const modifiedRequirements = readTypedArray(fenceBody, "modifiedRequirements", [
    "id",
    "before",
    "after",
  ]).map<ModifiedRequirementEntry>((row) => ({
    id: row.id ?? "",
    before: row.before ?? "",
    after: row.after ?? "",
  }));
  const modifiedScenarios = readTypedArray(fenceBody, "modifiedScenarios", [
    "id",
    "before",
    "after",
  ]).map<ModifiedScenarioEntry>((row) => ({
    id: row.id ?? "",
    beforeRaw: row.before ?? "",
    afterRaw: row.after ?? "",
  }));

  // addedScenarios is the tricky one: it's a simple-array header with N items,
  // each item being a nested ```toon block. We extract nested fences from the
  // region between `addedScenarios[N]:` and the next non-indented sibling key.
  const addedScenarios = extractAddedScenarios(fenceBody);

  const domain = (scalars.domain ?? domainHeading).trim();
  const breakingChange = parseBoolean(scalars.breakingChange);
  const migrationNote =
    scalars.migrationNote && scalars.migrationNote.length > 0
      ? scalars.migrationNote
      : null;
  const rationale = scalars.rationale ?? "";

  return {
    domain,
    addedRequirements,
    modifiedRequirements,
    removedRequirements,
    addedScenarios,
    modifiedScenarios,
    removedScenarios,
    breakingChange,
    migrationNote,
    rationale,
    sourceLine,
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderHuman(
  changeId: string,
  deltas: DeltaBlockSummary[],
  out: NodeJS.WritableStream
): void {
  if (deltas.length === 0) {
    out.write(`Change ${changeId}: no deltas parsed from proposal body.\n`);
    return;
  }

  out.write(`Change ${changeId} — pending deltas (${deltas.length} domain${deltas.length === 1 ? "" : "s"}):\n\n`);

  for (const d of deltas) {
    out.write(`Domain: ${d.domain}${d.breakingChange ? "  [BREAKING]" : ""}\n`);

    if (d.addedRequirements.length === 0
      && d.modifiedRequirements.length === 0
      && d.removedRequirements.length === 0
      && d.addedScenarios.length === 0
      && d.modifiedScenarios.length === 0
      && d.removedScenarios.length === 0) {
      out.write("  (no mutations)\n\n");
      continue;
    }

    // Requirements.
    for (const r of d.addedRequirements) {
      out.write(`  + req   ${truncateOneLine(r, 100)}\n`);
    }
    for (const r of d.modifiedRequirements) {
      out.write(`  ~ req   ${r.id}\n`);
      out.write(`           before: ${truncateOneLine(r.before, 90)}\n`);
      out.write(`            after: ${truncateOneLine(r.after, 90)}\n`);
    }
    for (const r of d.removedRequirements) {
      out.write(`  - req   ${r}\n`);
    }

    // Scenarios.
    for (const s of d.addedScenarios) {
      const t = s.title ? ` "${truncateOneLine(s.title, 60)}"` : "";
      out.write(`  + scen  ${s.id}${t}\n`);
    }
    for (const s of d.modifiedScenarios) {
      out.write(`  ~ scen  ${s.id}  (see proposal for full before/after)\n`);
    }
    for (const s of d.removedScenarios) {
      out.write(`  - scen  ${s}\n`);
    }

    if (d.rationale) {
      out.write(`  rationale: ${truncateOneLine(d.rationale, 100)}\n`);
    }
    if (d.breakingChange) {
      out.write(`  migration: ${d.migrationNote ?? "(missing — schema violation)"}\n`);
    }
    out.write("\n");
  }
}

function truncateOneLine(text: string, width: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= width) return flat;
  return flat.slice(0, Math.max(0, width - 1)) + "…";
}

// ---------------------------------------------------------------------------
// TOON helpers tuned to the DeltaBlock shape
// ---------------------------------------------------------------------------

/** Return the body of the first fenced ```toon block in `text`, or null. */
function extractFirstToonFence(text: string): string | null {
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    if (/^```\s*toon\s*$/.test(lines[i])) {
      const bodyLines: string[] = [];
      i++;
      while (i < lines.length) {
        if (/^```\s*$/.test(lines[i])) {
          return bodyLines.join("\n");
        }
        bodyLines.push(lines[i]);
        i++;
      }
      return null; // unclosed fence
    }
    i++;
  }
  return null;
}

function scanFlatScalars(body: string, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const want = new Set(keys);
  for (const line of body.split("\n")) {
    if (line.startsWith("  ")) continue; // skip indented (array contents)
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*\[\d+\]/.test(trimmed)) continue; // array header
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    if (!want.has(key)) continue;
    out[key] = trimmed.slice(colonIdx + 1).trim();
  }
  return out;
}

function readSimpleArray(body: string, fieldName: string): string[] {
  const re = new RegExp(`^${escape(fieldName)}\\[(\\d+)\\]\\s*:\\s*(.*)$`);
  for (const line of body.split("\n")) {
    if (line.startsWith("  ")) continue;
    const trimmed = line.trim();
    const m = re.exec(trimmed);
    if (!m) continue;
    const declared = Number(m[1]);
    if (declared === 0) return [];
    return splitInlineList(m[2]);
  }
  return [];
}

function readTypedArray(
  body: string,
  fieldName: string,
  fields: string[]
): Record<string, string>[] {
  const lines = body.split("\n");
  const headerRe = new RegExp(
    `^${escape(fieldName)}\\[(\\d+)\\]\\{${fields.join(",")}\\}\\s*:\\s*$`
  );
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const m = headerRe.exec(trimmed);
    if (!m) continue;
    const declared = Number(m[1]);
    if (declared === 0) return [];
    const rows: Record<string, string>[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      if (!next.startsWith("  ")) break;
      const cells = splitCsvRow(next.trim());
      const obj: Record<string, string> = {};
      for (let k = 0; k < fields.length; k++) {
        obj[fields[k]] = decodeCell(cells[k] ?? "");
      }
      rows.push(obj);
      j++;
    }
    return rows;
  }
  return [];
}

function extractAddedScenarios(body: string): ScenarioSummary[] {
  const lines = body.split("\n");
  const headerRe = /^addedScenarios\[(\d+)\]\s*:\s*$/;
  let start = -1;
  let declared = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = headerRe.exec(lines[i].trim());
    if (m) {
      start = i + 1;
      declared = Number(m[1]);
      break;
    }
  }
  if (start === -1 || declared === 0) return [];

  // Determine the region: continue while lines are indented (children of the
  // addedScenarios block) OR are inner ```toon fences.
  const region: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("  ") && line.trim() !== "") {
      // The DeltaBlock TOON is itself fenced; sibling keys at the same level
      // (e.g., `modifiedScenarios[...]:`) terminate the addedScenarios region.
      // Sibling keys are non-indented inside the outer fence body.
      break;
    }
    region.push(line);
  }
  const regionText = region.join("\n");

  // Now extract every nested ```toon block inside the region.
  const scenarios: ScenarioSummary[] = [];
  const regionLines = regionText.split("\n");
  let i = 0;
  while (i < regionLines.length) {
    if (/^\s*```\s*toon\s*$/.test(regionLines[i])) {
      const bodyLines: string[] = [];
      i++;
      while (i < regionLines.length) {
        if (/^\s*```\s*$/.test(regionLines[i])) {
          i++;
          break;
        }
        bodyLines.push(regionLines[i]);
        i++;
      }
      const inner = bodyLines.join("\n");
      const id = scanFlatScalars(stripIndent(inner), ["id"]).id ?? "";
      const title = scanFlatScalars(stripIndent(inner), ["title"]).title ?? "";
      scenarios.push({ id, title, raw: inner });
      continue;
    }
    i++;
  }
  return scenarios;
}

function stripIndent(text: string): string {
  return text
    .split("\n")
    .map((l) => (l.startsWith("    ") ? l.slice(4) : l.startsWith("  ") ? l.slice(2) : l))
    .join("\n");
}

function parseBoolean(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  return raw.trim().toLowerCase() === "true";
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitInlineList(rest: string): string[] {
  const trimmed = rest.trim();
  if (trimmed.length === 0) return [];
  return splitCsvRow(trimmed).map((s) => decodeCell(s));
}

function splitCsvRow(row: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') {
      const next = row[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
        current += ch;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

function decodeCell(cell: string): string {
  const trimmed = cell.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"');
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// CLI entry-point
// ---------------------------------------------------------------------------

function parseCliArgs(argv: string[]): DiffOptions | { error: string } {
  let changeId: string | null = null;
  let format: "human" | "json" = "human";
  let rootDir: string | undefined;

  for (const arg of argv) {
    if (arg === "--json") format = "json";
    else if (arg.startsWith("--root=")) rootDir = arg.slice("--root=".length);
    else if (!arg.startsWith("--")) {
      if (changeId !== null) {
        return { error: `Multiple changeId arguments: '${changeId}', '${arg}'` };
      }
      changeId = arg;
    }
  }
  if (changeId === null) {
    return { error: "Usage: /loom-change diff <changeId> [--json]" };
  }
  return { changeId, format, rootDir };
}

const isMain =
  (process.argv[1] ?? "").endsWith("diff.ts") ||
  (process.argv[1] ?? "").endsWith("diff.js");

if (isMain) {
  const parsed = parseCliArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(parsed.error + "\n");
    process.exit(2);
  }
  const result = runDiff(parsed);
  process.exit(result.exitCode);
}
