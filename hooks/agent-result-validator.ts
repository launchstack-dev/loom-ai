/**
 * Hook: agent-result-validator (SubagentStop; also accepts PostToolUse Write/Edit payloads)
 *
 * Validates AgentResult TOON envelopes against
 * `protocols/agent-result.schema.md` § Findings Row Schema.
 *
 * Enforcement tiers (C-08, PLAN-exceed-gstack Phase 3):
 *   - REQUIRED findings[] fields — id, category, severity, confidence —
 *     missing or invalid values are BLOCKING: the hook writes the offending
 *     field name to stderr and exits 2 with a `{"decision":"block"}` payload
 *     per the Claude Code hook protocol.
 *   - OPTIONAL findings[] fields — message — missing values emit a
 *     NON-BLOCKING stderr warning and exit 0.
 *
 * Input shapes (stdin JSON):
 *   - SubagentStop: `{hook_event_name:"SubagentStop", transcript_path}` —
 *     the validator reads the transcript JSONL and validates the LAST
 *     assistant message (agents return their envelope as the final block).
 *   - PostToolUse Write/Edit: `{tool_input:{file_path, content|new_string}}`
 *     — validates `.toon` files and anything under `.plan-execution/`.
 *
 * Fail-open ONLY on infrastructure errors (unreadable transcript/file,
 * malformed stdin JSON — handled by the runHook harness). Content that does
 * not contain a findings[] block is not an envelope and is allowed. A
 * findings[] block whose rows cannot supply required cells IS a broken
 * envelope and blocks.
 *
 * Registration: `.claude/settings.json` → hooks.SubagentStop (matcher "").
 *
 * Parsing note: row cells are split with the canonical `splitCsvLine` from
 * the lib/ barrel (single source of truth for CSV/TOON cell rules). This
 * replaced a legacy local `splitCsvRow` implementation.
 *
 * Related contract: protocols/agent-result.schema.md § Findings Row Schema,
 * § Confidence Semantics.
 */

import * as fs from "node:fs";
import { runHook, allow, block, type HookResult } from "./lib/run-hook.js";
import { splitCsvLine, isMain } from "../lib/index.js";

interface HookInput {
  hook_event_name?: string;
  transcript_path?: string;
  tool_name?: string;
  tool_input?: {
    file_path?: string;
    content?: string;
    new_string?: string;
  };
}

const MISSING_CONFIDENCE_CODE = "FINDING_MISSING_CONFIDENCE";
const MISSING_REQUIRED_CODE = "FINDING_MISSING_REQUIRED_FIELD";
const MISSING_OPTIONAL_CODE = "FINDING_MISSING_OPTIONAL_FIELD";

/** Required findings[] columns — absence is BLOCKING (plan Phase 3 AC). */
const REQUIRED_COLUMNS = ["id", "category", "severity", "confidence"] as const;

/** Optional findings[] columns — absence is a warning only. */
const OPTIONAL_COLUMNS = ["message"] as const;

export interface ValidationReport {
  /** Required-field failures — blocking (exit 2). */
  violations: string[];
  /** Optional-field gaps — stderr warning, exit 0. */
  warnings: string[];
}

/**
 * Canonical return contract (Phase 6 reconciliation, w2-p6-reconcile):
 * `validateAgentResultToon` returns a BARE ARRAY of blocking violation
 * message strings — `[]` means the content is valid (or is not an envelope).
 * Callers that also need the non-blocking optional-field warnings (the hook
 * handler) use `validateAgentResultToonWithWarnings`, which returns the full
 * `ValidationReport`.
 */

/** Error code for a missing required column/cell, naming the field. */
function missingCode(field: string): string {
  return field === "confidence" ? MISSING_CONFIDENCE_CODE : MISSING_REQUIRED_CODE;
}

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
 * Validate every findings[] block in a TOON blob.
 *
 * Returns violations (required fields: id, category, severity, confidence —
 * missing column, missing cell, or invalid confidence value) and warnings
 * (optional fields: message). Each violation names the offending field.
 */
export function validateAgentResultToonWithWarnings(content: string): ValidationReport {
  const violations: string[] = [];
  const warnings: string[] = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const cols = parseFindingsHeader(lines[i]);
    if (!cols) continue;

    // Column-level checks: required columns block, optional columns warn.
    for (const req of REQUIRED_COLUMNS) {
      if (!cols.includes(req)) {
        violations.push(
          `${missingCode(req)}: findings[] header at line ${i + 1} is missing the required '${req}' column. Contract: protocols/agent-result.schema.md.`
        );
      }
    }
    for (const opt of OPTIONAL_COLUMNS) {
      if (!cols.includes(opt)) {
        warnings.push(
          `${MISSING_OPTIONAL_CODE}: findings[] header at line ${i + 1} is missing the optional '${opt}' column.`
        );
      }
    }

    // Row-level checks: any following indented, non-empty row must carry a
    // non-empty value for every required column declared in the header.
    for (let j = i + 1; j < lines.length; j++) {
      const row = lines[j];
      if (!/^\s{2,}\S/.test(row)) break; // end of block
      // Skip TOON comment rows (indented `#` lines) so they don't fail the
      // required-field checks as if they were data rows.
      if (row.trim().startsWith("#")) continue;
      const cells = splitCsvLine(row.trim(), { preserveQuotes: false, trim: true });

      for (const req of REQUIRED_COLUMNS) {
        const idx = cols.indexOf(req);
        if (idx === -1) continue; // already reported at column level
        const cell = cells[idx];
        if (cell === undefined || cell === "") {
          violations.push(
            `${missingCode(req)}: findings[] row at line ${j + 1} is missing a '${req}' value.`
          );
          continue;
        }
        if (req === "confidence") {
          const n = Number(cell);
          if (!Number.isInteger(n) || n < 1 || n > 10) {
            // Out-of-range/non-integer confidence is the SAME error code as a
            // missing confidence (schema: "rejected with error code
            // FINDING_MISSING_CONFIDENCE") — the row fails to supply a valid
            // required confidence either way.
            violations.push(
              `${MISSING_CONFIDENCE_CODE}: findings[] row at line ${j + 1} has invalid 'confidence' value '${cell}' (must be integer 1..10).`
            );
          }
        }
      }

      for (const opt of OPTIONAL_COLUMNS) {
        const idx = cols.indexOf(opt);
        if (idx === -1) continue; // already warned at column level
        const cell = cells[idx];
        if (cell === undefined || cell === "") {
          warnings.push(
            `${MISSING_OPTIONAL_CODE}: findings[] row at line ${j + 1} is missing an optional '${opt}' value.`
          );
        }
      }
    }
  }

  return { violations, warnings };
}

/**
 * Canonical validator entry point: returns the bare array of BLOCKING
 * violation messages. `[]` ⇒ valid envelope or non-envelope content.
 * Non-blocking optional-field warnings are intentionally excluded — use
 * `validateAgentResultToonWithWarnings` when they matter.
 */
export function validateAgentResultToon(content: string): string[] {
  return validateAgentResultToonWithWarnings(content).violations;
}

function shouldInspect(filePath: string | undefined): boolean {
  if (!filePath) return false;
  // AgentResult envelopes commonly land under .plan-execution/, or in *.toon
  // files. Inspect any .toon file to be safe.
  return filePath.endsWith(".toon") || filePath.includes(".plan-execution/");
}

/**
 * Extract the text of the LAST assistant message from a Claude Code
 * transcript JSONL file. Returns null when nothing is extractable
 * (fail-open on infrastructure errors).
 */
export function extractLastAssistantText(transcriptPath: string): string | null {
  let raw: string;
  try {
    raw = fs.readFileSync(transcriptPath, "utf-8");
  } catch {
    return null;
  }

  let lastText: string | null = null;
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // skip unparseable transcript lines
    }
    if (entry?.type !== "assistant") continue;
    const parts = entry?.message?.content;
    if (typeof parts === "string") {
      lastText = parts;
      continue;
    }
    if (!Array.isArray(parts)) continue;
    const text = parts
      .filter((p: any) => p?.type === "text" && typeof p.text === "string")
      .map((p: any) => p.text)
      .join("\n");
    if (text !== "") lastText = text;
  }
  return lastText;
}

/** Resolve the content to validate from either supported input shape, or null to skip. */
function resolveContent(input: HookInput): string | null {
  // PostToolUse Write/Edit shape.
  const filePath = input.tool_input?.file_path;
  if (filePath !== undefined) {
    if (!shouldInspect(filePath)) return null;
    const inline = input.tool_input?.content ?? input.tool_input?.new_string;
    if (inline) return inline;
    try {
      return fs.readFileSync(filePath, "utf-8");
    } catch {
      return null; // fail-open on read error
    }
  }

  // SubagentStop shape.
  if (input.transcript_path) {
    return extractLastAssistantText(input.transcript_path);
  }

  return null;
}

async function handler(input: HookInput): Promise<HookResult> {
  const content = resolveContent(input);
  if (content === null) return allow();

  const { violations, warnings } = validateAgentResultToonWithWarnings(content);

  for (const w of warnings) {
    process.stderr.write(`[agent-result-validator] warning: ${w}\n`);
  }

  if (violations.length > 0) {
    for (const v of violations) {
      process.stderr.write(`[agent-result-validator] blocking: ${v}\n`);
    }
    return block(
      `AgentResult envelope failed validation (${violations.length} required-field violation${violations.length === 1 ? "" : "s"}):\n` +
        violations.join("\n") +
        `\nContract: protocols/agent-result.schema.md § Findings Row Schema.`
    );
  }

  return allow();
}

if (isMain(import.meta)) {
  runHook("agent-result-validator", handler);
}
