/**
 * Hook: agent-result-validator (PostToolUse — Write/Edit)
 *
 * Scans files written by agents for AgentResult TOON envelopes and validates
 * that every `findings[]` row carries a `confidence:1-10` field per
 * `protocols/agent-result.schema.md`.
 *
 * Emits FINDING_MISSING_CONFIDENCE as a NON-BLOCKING warning to stderr when
 * a finding row is missing the confidence column. Fail-open on parse errors.
 *
 * Registration:
 *   NOTE: register via scripts/register-loom-hooks.ts on next run.
 *   This hook is declared in skills/library.yaml under library.infrastructure.
 *
 * Related contract: protocols/agent-result.schema.md § Findings Row Schema.
 */

import * as fs from "node:fs";
import { runHook, allow } from "./lib/run-hook.js";

interface HookInput {
  tool_name?: string;
  tool_input?: {
    file_path?: string;
    content?: string;
    new_string?: string;
  };
}

const CONFIDENCE_ERROR_CODE = "FINDING_MISSING_CONFIDENCE";

/**
 * Detects a findings[] typed-array header line and returns the column
 * ordering declared inside {…}. Returns null when line is not a findings
 * header.
 *
 * Example match:
 *   findings[N]{id,category,severity,confidence,message}:
 */
function parseFindingsHeader(line: string): string[] | null {
  const m = line.match(/^\s*findings\[[^\]]*\]\{([^}]*)\}:\s*$/);
  if (!m) return null;
  return m[1].split(",").map((c) => c.trim());
}

/**
 * Validate a TOON blob. Returns an array of warning messages (one per
 * malformed findings block). Empty array means clean.
 */
export function validateAgentResultToon(content: string): string[] {
  const warnings: string[] = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const cols = parseFindingsHeader(lines[i]);
    if (!cols) continue;

    // Column-level check
    if (!cols.includes("confidence")) {
      warnings.push(
        `${CONFIDENCE_ERROR_CODE}: findings[] header at line ${i + 1} is missing the 'confidence' column. Contract: protocols/agent-result.schema.md.`
      );
      continue;
    }

    const confidenceIdx = cols.indexOf("confidence");

    // Row-level check: any following indented, non-empty row must have a
    // non-empty value at the confidence column and it must be 1..10.
    for (let j = i + 1; j < lines.length; j++) {
      const row = lines[j];
      if (!/^\s{2,}\S/.test(row)) break; // end of block
      // Skip TOON comment rows (indented `#` lines) so they don't fail the
      // confidence check as if they were data rows.
      if (row.trim().startsWith("#")) continue;
      const rawCells = splitCsvRow(row.trim());
      const cell = rawCells[confidenceIdx];
      if (cell === undefined || cell === "") {
        warnings.push(
          `${CONFIDENCE_ERROR_CODE}: findings[] row at line ${j + 1} is missing a confidence value.`
        );
        continue;
      }
      const n = Number(cell);
      if (!Number.isInteger(n) || n < 1 || n > 10) {
        warnings.push(
          `${CONFIDENCE_ERROR_CODE}: findings[] row at line ${j + 1} has invalid confidence '${cell}' (must be integer 1..10).`
        );
      }
    }
  }

  return warnings;
}

/**
 * Split a TOON typed-array row, respecting double-quoted cells so commas
 * inside quotes do not split.
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
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0 || row.endsWith(",")) out.push(cur.trim());
  return out;
}

function shouldInspect(filePath: string | undefined): boolean {
  if (!filePath) return false;
  // AgentResult envelopes commonly land under .plan-execution/, or in *.toon
  // files. Inspect any .toon file to be safe.
  return filePath.endsWith(".toon") || filePath.includes(".plan-execution/");
}

function main(input: HookInput): void {
  const filePath = input.tool_input?.file_path;
  if (!shouldInspect(filePath)) return allow();

  let content = input.tool_input?.content ?? input.tool_input?.new_string;
  if (!content) {
    try {
      content = fs.readFileSync(filePath as string, "utf-8");
    } catch {
      return allow(); // fail-open on read error
    }
  }

  try {
    const warnings = validateAgentResultToon(content);
    if (warnings.length > 0) {
      for (const w of warnings) {
        process.stderr.write(`[agent-result-validator] warning: ${w}\n`);
      }
    }
  } catch {
    // fail-open on parse error
  }
  return allow();
}

runHook(main);
