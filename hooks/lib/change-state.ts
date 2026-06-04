/**
 * Typed read/write of ChangeState TOON runtime files.
 *
 * Schema:        agents/protocols/change-state.schema.md
 * Path:          .plan-execution/ephemeral/changes/{changeId}.toon
 *                (via `hooks/lib/change-paths.ts`)
 * Atomic write:  write `{path}.tmp`, then `fs.renameSync({path}.tmp, {path})`
 *                per agents/protocols/execution-conventions.md.
 *
 * The proposal.md is the durable, authoritative record of intent (see
 * change-proposal.schema.md). This file is the **runtime mirror**: it is
 * rewritten in full on every status transition. The transitions[] array is
 * append-only at the application layer; the file itself is atomically
 * rewritten on each transition. When proposal and ChangeState disagree, the
 * proposal wins.
 *
 * This module deliberately ships a hand-rolled TOON serializer for the small,
 * fixed shape of a ChangeState. The project's general TOON parser
 * (`toon-reader.ts`) is read-only and would need extending to cover this
 * file's typed-array writes; rather than couple Phase 5/6 to that work, we
 * format the file here using the field set this schema locks.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  CHANGE_ID_PATTERN,
  changeStateDir,
  changeStatePath,
  isValidChangeId,
  tmpPathFor,
} from "./change-paths.js";

// ---------------------------------------------------------------------------
// Types — field names match change-state.schema.md exactly. DO NOT rename.
// ---------------------------------------------------------------------------

/** Lifecycle status — mirrors ChangeProposal.status. */
export type ChangeStatus =
  | "proposed"
  | "reviewed"
  | "approved"
  | "in-progress"
  | "archived"
  | "rejected"
  | "superseded";

/** All seven legal statuses, exported for downstream guard checks. */
export const CHANGE_STATUSES: readonly ChangeStatus[] = [
  "proposed",
  "reviewed",
  "approved",
  "in-progress",
  "archived",
  "rejected",
  "superseded",
];

/** One entry in the append-only transitions log. */
export interface TransitionEntry {
  /** Previous status. Empty string for the initial `(none) → proposed` entry. */
  from: ChangeStatus | "";
  /** Status after this transition. */
  to: ChangeStatus;
  /** ISO 8601 timestamp; strictly increasing across the array. */
  at: string;
  /** Actor identity: `human:{name}`, `agent:{name}`, or `loom-quick`. */
  by: string;
  /** Free-text reason; min 5 chars per validation rules. */
  reason: string;
}

/** One detected conflict against another in-flight change. */
export interface ConflictEntry {
  /** ID of the other in-flight change that overlaps. */
  otherChangeId: string;
  /** R-NN and/or S-NN IDs both changes target on shared contract pages. */
  conflictingIds: string[];
  /** ISO 8601 timestamp when the conflict scan ran. */
  detectedAt: string;
}

/** Runtime ChangeState — see change-state.schema.md. */
export interface ChangeState {
  changeId: string;
  status: ChangeStatus;
  transitions: TransitionEntry[];
  conflicts: ConflictEntry[];
  /** Set when an archived change invalidates this one. Null otherwise. */
  supersededBy: string | null;
  /** ISO 8601, monotonic — strictly increasing across writes. */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read a ChangeState from disk. Returns `null` when the file does not exist
 * (legitimate: not every proposal has been initialized yet).
 *
 * Throws when the file exists but is malformed or fails minimal structural
 * validation — callers should surface the error rather than silently treat a
 * corrupt file as "missing".
 */
export function readChangeState(
  rootDir: string | undefined,
  changeId: string
): ChangeState | null {
  if (!isValidChangeId(changeId)) {
    throw new Error(
      `Invalid changeId '${changeId}': expected format chg-{YYYYMMDD}-{kebab-slug} (${CHANGE_ID_PATTERN}).`
    );
  }
  const filePath = changeStatePath(rootDir, changeId);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = parseChangeStateToon(raw, filePath);

  if (parsed.changeId !== changeId) {
    throw new Error(
      `ChangeState file at ${filePath} declares changeId='${parsed.changeId}' but expected '${changeId}'.`
    );
  }
  return parsed;
}

/**
 * Write a ChangeState atomically.
 *
 *  1. Ensure the parent directory exists.
 *  2. Encode to TOON.
 *  3. Write `{path}.tmp`.
 *  4. `fs.renameSync` to `{path}`.
 *
 * If an existing file is present, enforce `updatedAt` monotonicity: writes
 * with a timestamp older than the stored value are rejected (matches the
 * blocking validation rule in change-state.schema.md).
 */
export function writeChangeState(
  rootDir: string | undefined,
  state: ChangeState
): void {
  if (!isValidChangeId(state.changeId)) {
    throw new Error(
      `Invalid changeId '${state.changeId}': expected format chg-{YYYYMMDD}-{kebab-slug}.`
    );
  }
  assertStateShape(state);

  const filePath = changeStatePath(rootDir, state.changeId);
  const dirPath = path.dirname(filePath);
  fs.mkdirSync(dirPath, { recursive: true });

  if (fs.existsSync(filePath)) {
    const prev = readChangeState(rootDir, state.changeId);
    if (prev !== null && state.updatedAt <= prev.updatedAt) {
      throw new Error(
        `ChangeState write rejected for ${state.changeId}: updatedAt '${state.updatedAt}' must be strictly greater than stored '${prev.updatedAt}'.`
      );
    }
  }

  const body = encodeChangeStateToon(state);
  const tmp = tmpPathFor(filePath);
  fs.writeFileSync(tmp, body, "utf8");
  fs.renameSync(tmp, filePath);
}

/**
 * Enumerate every on-disk ChangeState under the runtime directory.
 *
 * Returns an empty array when the directory does not exist (no changes have
 * been initialized yet). Files that fail to parse are surfaced as errors via
 * the result object rather than thrown — `/loom-change list` must keep going
 * even if one file is corrupt.
 */
export function listChangeStates(rootDir: string | undefined): ListChangeStatesResult {
  const dirPath = changeStateDir(rootDir);
  if (!fs.existsSync(dirPath)) {
    return { states: [], errors: [] };
  }

  const states: ChangeState[] = [];
  const errors: ListChangeStatesError[] = [];

  for (const entry of fs.readdirSync(dirPath)) {
    if (!entry.endsWith(".toon")) continue;
    if (entry.endsWith("-rollback.toon")) continue; // companion files, not state
    const changeId = entry.slice(0, -".toon".length);
    if (!isValidChangeId(changeId)) {
      errors.push({
        file: path.join(dirPath, entry),
        message: `filename '${entry}' does not match a valid changeId`,
      });
      continue;
    }
    try {
      const state = readChangeState(rootDir, changeId);
      if (state !== null) states.push(state);
    } catch (err) {
      errors.push({
        file: path.join(dirPath, entry),
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  states.sort((a, b) => a.changeId.localeCompare(b.changeId));
  return { states, errors };
}

export interface ListChangeStatesError {
  file: string;
  message: string;
}

export interface ListChangeStatesResult {
  states: ChangeState[];
  errors: ListChangeStatesError[];
}

// ---------------------------------------------------------------------------
// TOON serialization (hand-rolled for this fixed shape)
// ---------------------------------------------------------------------------

/**
 * Encode a ChangeState to TOON matching the format in
 * change-state.schema.md → File Format.
 *
 * Round-trippable with `parseChangeStateToon`.
 */
export function encodeChangeStateToon(state: ChangeState): string {
  const lines: string[] = [];
  lines.push(`changeId: ${state.changeId}`);
  lines.push(`status: ${state.status}`);

  // transitions[] — typed array.
  lines.push(`transitions[${state.transitions.length}]{from,to,at,by,reason}:`);
  for (const t of state.transitions) {
    lines.push(`  ${csvField(t.from)},${csvField(t.to)},${csvField(t.at)},${csvField(t.by)},${csvField(t.reason)}`);
  }

  // conflicts[] — typed array. conflictingIds is a `;`-joined inner list to
  // keep the per-row CSV shape flat (TOON typed arrays do not nest).
  lines.push(`conflicts[${state.conflicts.length}]{otherChangeId,conflictingIds,detectedAt}:`);
  for (const c of state.conflicts) {
    lines.push(
      `  ${csvField(c.otherChangeId)},${csvField(c.conflictingIds.join(";"))},${csvField(c.detectedAt)}`
    );
  }

  lines.push(`supersededBy: ${state.supersededBy ?? ""}`);
  lines.push(`updatedAt: ${state.updatedAt}`);

  return lines.join("\n") + "\n";
}

/**
 * Parse a ChangeState from TOON. Mirror of `encodeChangeStateToon`.
 *
 * `filePath` is used only for error messages.
 */
export function parseChangeStateToon(raw: string, filePath: string): ChangeState {
  const lines = raw.split("\n");
  let changeId = "";
  let status: string | null = null;
  let supersededBy: string | null = null;
  let updatedAt = "";
  const transitions: TransitionEntry[] = [];
  const conflicts: ConflictEntry[] = [];

  let arrayContext: ArrayContext | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Indented row inside an active typed-array.
    if (arrayContext !== null && line.startsWith("  ")) {
      const cells = splitCsvRow(trimmed);
      if (arrayContext.kind === "transitions") {
        if (cells.length < 5) {
          throw new Error(
            `Malformed transitions row at line ${i + 1} of ${filePath}: expected 5 fields, got ${cells.length}`
          );
        }
        const from = decodeCell(cells[0]);
        const to = decodeCell(cells[1]);
        const at = decodeCell(cells[2]);
        const by = decodeCell(cells[3]);
        const reason = decodeCell(cells[4]);
        if (!isChangeStatus(to) && to !== "") {
          // `to` must be a real status; transitions array forbids empty `to`.
          throw new Error(
            `Invalid transition 'to' value '${to}' at line ${i + 1} of ${filePath}`
          );
        }
        if (from !== "" && !isChangeStatus(from)) {
          throw new Error(
            `Invalid transition 'from' value '${from}' at line ${i + 1} of ${filePath}`
          );
        }
        transitions.push({
          from: from === "" ? "" : (from as ChangeStatus),
          to: to as ChangeStatus,
          at,
          by,
          reason,
        });
      } else {
        // conflicts row
        if (cells.length < 3) {
          throw new Error(
            `Malformed conflicts row at line ${i + 1} of ${filePath}: expected 3 fields, got ${cells.length}`
          );
        }
        const otherChangeId = decodeCell(cells[0]);
        const conflictingIdsBlob = decodeCell(cells[1]);
        const detectedAt = decodeCell(cells[2]);
        const conflictingIds = conflictingIdsBlob === ""
          ? []
          : conflictingIdsBlob.split(";").map((s) => s.trim()).filter((s) => s.length > 0);
        conflicts.push({ otherChangeId, conflictingIds, detectedAt });
      }
      continue;
    }

    // Non-indented line ends the array context.
    arrayContext = null;

    // Detect array headers.
    const transitionsHeader = /^transitions\[(\d+)\]\{from,to,at,by,reason\}:\s*$/.exec(trimmed);
    if (transitionsHeader) {
      arrayContext = { kind: "transitions", declared: Number(transitionsHeader[1]) };
      continue;
    }
    const conflictsHeader = /^conflicts\[(\d+)\]\{otherChangeId,conflictingIds,detectedAt\}:\s*$/.exec(trimmed);
    if (conflictsHeader) {
      arrayContext = { kind: "conflicts", declared: Number(conflictsHeader[1]) };
      continue;
    }

    // Flat scalars.
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();
    switch (key) {
      case "changeId":
        changeId = value;
        break;
      case "status":
        status = value;
        break;
      case "supersededBy":
        supersededBy = value === "" ? null : value;
        break;
      case "updatedAt":
        updatedAt = value;
        break;
      default:
        // Unknown keys are tolerated forward-compat — change-state.schema.md
        // is the spec, not a strict whitelist.
        break;
    }
  }

  if (!changeId) {
    throw new Error(`ChangeState at ${filePath} missing required field 'changeId'.`);
  }
  if (status === null || !isChangeStatus(status)) {
    throw new Error(
      `ChangeState at ${filePath} has missing or invalid 'status' (got '${status ?? ""}').`
    );
  }
  if (!updatedAt) {
    throw new Error(`ChangeState at ${filePath} missing required field 'updatedAt'.`);
  }

  return {
    changeId,
    status,
    transitions,
    conflicts,
    supersededBy,
    updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ArrayContext {
  kind: "transitions" | "conflicts";
  declared: number;
}

function isChangeStatus(value: string): value is ChangeStatus {
  return (CHANGE_STATUSES as readonly string[]).includes(value);
}

function assertStateShape(state: ChangeState): void {
  if (!isChangeStatus(state.status)) {
    throw new Error(`Invalid ChangeState.status '${state.status}'.`);
  }
  if (!Array.isArray(state.transitions) || state.transitions.length === 0) {
    throw new Error(
      `ChangeState.transitions must be a non-empty array; the initial '(none) → proposed' entry is required.`
    );
  }
  // Monotonicity of transitions[].at — blocking per schema.
  for (let i = 1; i < state.transitions.length; i++) {
    if (state.transitions[i].at <= state.transitions[i - 1].at) {
      throw new Error(
        `ChangeState.transitions[${i}].at ('${state.transitions[i].at}') must be strictly after transitions[${i - 1}].at ('${state.transitions[i - 1].at}').`
      );
    }
  }
  const last = state.transitions[state.transitions.length - 1];
  if (last.to !== state.status) {
    throw new Error(
      `ChangeState final transition 'to' ('${last.to}') must equal status ('${state.status}').`
    );
  }
  if (state.supersededBy !== null && state.status !== "superseded") {
    throw new Error(
      `ChangeState.supersededBy is set but status is not 'superseded' (got '${state.status}').`
    );
  }
  if (state.supersededBy === null && state.status === "superseded") {
    throw new Error(
      `ChangeState.status is 'superseded' but supersededBy is null.`
    );
  }
  if (!state.updatedAt) {
    throw new Error("ChangeState.updatedAt is required.");
  }
}

/** Quote a CSV cell when it contains characters that would break the row format. */
function csvField(value: string): string {
  if (value === "") return "";
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function decodeCell(cell: string): string {
  const trimmed = cell.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"');
  }
  return trimmed;
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
