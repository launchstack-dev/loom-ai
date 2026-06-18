/**
 * State I/O for the roadmap-converge driver.
 *
 * Reads `.roadmap-converge/{slug}/state.toon` via the F-13 migrator
 * entrypoint (detect → migrate-to-latest), writes the same path atomically
 * (`.tmp` + `fs.renameSync`).
 *
 * The on-disk shape conforms to the field catalogue in
 * agents/protocols/roadmap-converge-state.schema.toon. This module is the
 * single allowed reader/writer of that file at runtime; the migrator is the
 * single allowed shape-translator. Together they keep all schema knowledge
 * out of the driver's hot path.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  CURRENT_VERSION,
  migrateToLatest,
  type AnyRoadmapConvergeState,
  type ArchivedDimensionV1,
  type DimensionSnapshotV1,
  type FindingSeverity,
  type MigrationOptions,
  type OpenQuestionV1,
  type RoadmapConvergeStateV1,
  type RoadmapDeltaSinceLast,
  type RoadmapDimensionStatus,
  type RoadmapDimensionV1,
  type SignOffState,
  type SuppressedFindingV1,
} from "../migrators/roadmap-converge-state/index.js";
import { detectRoadmapConvergeStateVersion } from "../migrators/roadmap-converge-state/detect.js";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Compute the canonical state path for a given roadmap slug. */
export function stateDirFor(slug: string): string {
  return `.roadmap-converge/${slug}`;
}

/** Compute the canonical state.toon path for a given roadmap slug. */
export function stateFileFor(slug: string): string {
  return `${stateDirFor(slug)}/state.toon`;
}

/** Compute the canonical lock path for a given roadmap slug. */
export function lockFileFor(slug: string): string {
  return `${stateDirFor(slug)}/.lock`;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export interface ReadStateResult {
  /** Migrated, current-version state — or null when no state file exists. */
  state: RoadmapConvergeStateV1 | null;
  /** Detected version on disk (0 when missing/no marker). */
  detectedVersion: number;
  /** Current schema version per the migrator. */
  currentVersion: number;
  /** True when the file was migrated forward by this read. */
  migrated: boolean;
}

/**
 * Read state.toon for a slug. Missing file → state=null (cold start).
 *
 * Reads via the F-13 migrator entrypoint:
 *   1. detectRoadmapConvergeStateVersion(content) — surface fwd-version errors
 *   2. parse the TOON into a shape compatible with the detected version
 *   3. migrateToLatest(parsed, detected) — walks the migration chain
 *
 * Throws MigrationDowngradeError when the file is from a future version
 * (detect rejects forward versions). Callers should treat that as halt.
 */
export function readState(
  slug: string,
  opts: MigrationOptions = {}
): ReadStateResult {
  const path = stateFileFor(slug);
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      return {
        state: null,
        detectedVersion: 0,
        currentVersion: CURRENT_VERSION,
        migrated: false,
      };
    }
    throw err;
  }

  const detection = detectRoadmapConvergeStateVersion(raw);
  // detected=0 means no marker — treat as a corrupted/legacy file. Parse
  // into v1 shape best-effort; migrator no-op walker accepts it.
  const parsed = parseRoadmapConvergeStateToon(raw);
  const detectedVersion = detection.detected || CURRENT_VERSION;
  const migrated = detectedVersion !== CURRENT_VERSION;
  const state = migrateToLatest(parsed, detectedVersion, opts) as RoadmapConvergeStateV1;

  return {
    state,
    detectedVersion: detection.detected,
    currentVersion: CURRENT_VERSION,
    migrated,
  };
}

// ---------------------------------------------------------------------------
// Write — atomic
// ---------------------------------------------------------------------------

/**
 * Write state.toon atomically. Ensures the parent directory exists. Writes
 * to `{path}.tmp` first, then `fs.renameSync` — never publishes a partial
 * file.
 */
export function writeState(slug: string, state: RoadmapConvergeStateV1): void {
  const path = stateFileFor(slug);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, encodeRoadmapConvergeStateToon(state), "utf-8");
  renameSync(tmp, path);
}

// ---------------------------------------------------------------------------
// Cold-start factory
// ---------------------------------------------------------------------------

export interface InitialStateInput {
  roadmapPath: string;
  roadmapSlug: string;
  archetype: string;
  passLimit: number;
  contentHash: string;
}

/**
 * Construct a fresh v1 state instance for a slug that has never converged.
 * round=0 (no pass has completed), sign_off_state=not-eligible, all arrays
 * empty. The driver upgrades this to round=1 after the first reviewer fan-out.
 */
export function freshState(input: InitialStateInput): RoadmapConvergeStateV1 {
  return {
    schemaVersion: 1,
    roadmapPath: input.roadmapPath,
    roadmapSlug: input.roadmapSlug,
    archetype: input.archetype,
    round: 0,
    passLimit: input.passLimit,
    dimensions: [],
    dimensionSnapshot: [],
    open_questions: [],
    archivedDimensions: [],
    suppressedFindings: [],
    roadmap_diff_summary: "",
    paused_at: "",
    last_reviewer: "",
    next_action_hint: "",
    content_hash: input.contentHash,
    sign_off_state: "not-eligible",
  };
}

// ---------------------------------------------------------------------------
// TOON encoder — RoadmapConvergeStateV1 → string
// ---------------------------------------------------------------------------

/**
 * Encode v1 state to TOON. Hand-rolled (mirroring scripts/apply-v3-migration.ts)
 * so the runtime does not depend on the @toon-format package in the project
 * root. Field order mirrors the schema file for grep-friendliness.
 *
 * String values are escaped for newlines and tabs so multi-line free text
 * survives roundtrip without corrupting the line-based TOON parser.
 */
export function encodeRoadmapConvergeStateToon(s: RoadmapConvergeStateV1): string {
  const lines: string[] = [];
  lines.push(`schemaVersion: ${s.schemaVersion}`);
  lines.push(`roadmapPath: ${escapeScalar(s.roadmapPath)}`);
  lines.push(`roadmapSlug: ${escapeScalar(s.roadmapSlug)}`);
  lines.push(`archetype: ${escapeScalar(s.archetype)}`);
  lines.push(`round: ${s.round}`);
  lines.push(`passLimit: ${s.passLimit}`);
  lines.push(`roadmap_diff_summary: ${escapeScalar(s.roadmap_diff_summary)}`);
  lines.push(`paused_at: ${escapeScalar(s.paused_at)}`);
  lines.push(`last_reviewer: ${escapeScalar(s.last_reviewer)}`);
  lines.push(`next_action_hint: ${escapeScalar(s.next_action_hint)}`);
  lines.push(`content_hash: ${escapeScalar(s.content_hash)}`);
  lines.push(`sign_off_state: ${s.sign_off_state}`);
  if (s.sign_off_at !== undefined) {
    lines.push(`sign_off_at: ${escapeScalar(s.sign_off_at)}`);
  }
  if (s.sign_off_diff_hash !== undefined) {
    lines.push(`sign_off_diff_hash: ${escapeScalar(s.sign_off_diff_hash)}`);
  }

  lines.push("");
  lines.push(
    `dimensions[${s.dimensions.length}]{name,status,evidence,blockers,evidenceRef,delta_since_last}:`
  );
  for (const d of s.dimensions) {
    lines.push(
      `  ${csv([
        d.name,
        d.status,
        d.evidence ?? "",
        joinList(d.blockers ?? []),
        joinList(d.evidenceRef ?? []),
        d.delta_since_last,
      ])}`
    );
  }

  lines.push("");
  lines.push(`dimensionSnapshot[${s.dimensionSnapshot.length}]{name,status}:`);
  for (const ds of s.dimensionSnapshot) {
    lines.push(`  ${csv([ds.name, ds.status])}`);
  }

  lines.push("");
  lines.push(
    `open_questions[${s.open_questions.length}]{id,dimension,text,asked_at,resolved_at,resolution}:`
  );
  for (const q of s.open_questions) {
    lines.push(
      `  ${csv([
        q.id,
        q.dimension,
        q.text,
        q.asked_at,
        q.resolved_at ?? "",
        q.resolution ?? "",
      ])}`
    );
  }

  lines.push("");
  lines.push(`archivedDimensions[${s.archivedDimensions.length}]{name,reason,timestamp}:`);
  for (const a of s.archivedDimensions) {
    lines.push(`  ${csv([a.name, a.reason, a.timestamp])}`);
  }

  lines.push("");
  lines.push(
    `suppressedFindings[${s.suppressedFindings.length}]{id,dimension,severity,text,suppressed_at}:`
  );
  for (const f of s.suppressedFindings) {
    lines.push(`  ${csv([f.id, f.dimension, f.severity, f.text, f.suppressed_at])}`);
  }

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// TOON decoder — string → RoadmapConvergeStateV1-shape
// ---------------------------------------------------------------------------

/**
 * Parse a state.toon body into a v1-shape object. Forgiving on missing
 * optional fields; strict on type tags (status, severity, sign_off_state)
 * — invalid enum values are passed through and the migrator/caller decides
 * whether to halt.
 */
export function parseRoadmapConvergeStateToon(content: string): RoadmapConvergeStateV1 {
  const scalars = parseScalars(content);

  const dimensions = parseTypedArray(content, "dimensions").map((row): RoadmapDimensionV1 => ({
    name: row.name ?? "",
    status: (row.status as RoadmapDimensionStatus) ?? "yellow",
    evidence: row.evidence || undefined,
    blockers: splitList(row.blockers ?? ""),
    evidenceRef: splitList(row.evidenceRef ?? ""),
    delta_since_last: (row.delta_since_last as RoadmapDeltaSinceLast) ?? "new",
  }));

  const dimensionSnapshot = parseTypedArray(content, "dimensionSnapshot").map(
    (row): DimensionSnapshotV1 => ({
      name: row.name ?? "",
      status: (row.status as RoadmapDimensionStatus) ?? "yellow",
    })
  );

  const open_questions = parseTypedArray(content, "open_questions").map(
    (row): OpenQuestionV1 => ({
      id: row.id ?? "",
      dimension: row.dimension ?? "",
      text: row.text ?? "",
      asked_at: row.asked_at ?? "",
      resolved_at: row.resolved_at || undefined,
      resolution: row.resolution || undefined,
    })
  );

  const archivedDimensions = parseTypedArray(content, "archivedDimensions").map(
    (row): ArchivedDimensionV1 => ({
      name: row.name ?? "",
      reason: row.reason ?? "",
      timestamp: row.timestamp ?? "",
    })
  );

  const suppressedFindings = parseTypedArray(content, "suppressedFindings").map(
    (row): SuppressedFindingV1 => ({
      id: row.id ?? "",
      dimension: row.dimension ?? "",
      severity: (row.severity as FindingSeverity) ?? "warning",
      text: row.text ?? "",
      suppressed_at: row.suppressed_at ?? "",
    })
  );

  return {
    schemaVersion: 1,
    roadmapPath: scalars.roadmapPath ?? "",
    roadmapSlug: scalars.roadmapSlug ?? "",
    archetype: scalars.archetype ?? "default",
    round: toInt(scalars.round, 0),
    passLimit: toInt(scalars.passLimit, 3),
    dimensions,
    dimensionSnapshot,
    open_questions,
    archivedDimensions,
    suppressedFindings,
    roadmap_diff_summary: scalars.roadmap_diff_summary ?? "",
    paused_at: scalars.paused_at ?? "",
    last_reviewer: scalars.last_reviewer ?? "",
    next_action_hint: scalars.next_action_hint ?? "",
    content_hash: scalars.content_hash ?? "",
    sign_off_state: (scalars.sign_off_state as SignOffState) ?? "not-eligible",
    sign_off_at: scalars.sign_off_at || undefined,
    sign_off_diff_hash: scalars.sign_off_diff_hash || undefined,
  };
}

// ---------------------------------------------------------------------------
// Internal: tiny line-based TOON helpers
// ---------------------------------------------------------------------------

/** Parse flat `key: value` lines (top-level scalars only). */
function parseScalars(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    if (!line || line.startsWith("#") || line.startsWith(" ") || line.startsWith("\t")) continue;
    if (/^\w+\[/.test(line)) continue;
    const idx = line.indexOf(":");
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    result[key] = unescapeScalar(value);
  }
  return result;
}

/**
 * Parse a typed-array block `name[N]{f1,f2,...}:` and the indented rows that
 * follow. Returns one record per row keyed by field name. Stops at the next
 * non-indented non-blank line.
 */
function parseTypedArray(content: string, arrayName: string): Record<string, string>[] {
  const lines = content.split("\n");
  const results: Record<string, string>[] = [];
  let fields: string[] | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fields === null) {
      const m = line.match(
        new RegExp(`^${escapeRegExp(arrayName)}\\[\\d+\\]\\{([^}]+)\\}:\\s*$`)
      );
      if (m) {
        fields = m[1].split(",").map((s) => s.trim());
      }
      continue;
    }
    // Row lines are 2-space-indented and contain field count - 1 commas
    // (unless field values contain escaped commas).
    if (line.startsWith("  ")) {
      const row = line.slice(2);
      const cells = splitCsvRow(row, fields.length);
      const rec: Record<string, string> = {};
      for (let j = 0; j < fields.length; j++) {
        rec[fields[j]] = unescapeCell(cells[j] ?? "");
      }
      results.push(rec);
      continue;
    }
    // Blank line within the block is fine — continue searching for more rows
    if (line.trim() === "") continue;
    // Anything else terminates the block.
    break;
  }
  return results;
}

// ---------------------------------------------------------------------------
// Internal: scalar/cell escape primitives
// ---------------------------------------------------------------------------

function escapeScalar(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

function unescapeScalar(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\");
}

function escapeCell(value: string): string {
  return escapeScalar(value).replace(/,/g, "\\c").replace(/\|/g, "\\p");
}

function unescapeCell(value: string): string {
  return unescapeScalar(value.replace(/\\c/g, ",").replace(/\\p/g, "|"));
}

function csv(values: string[]): string {
  return values.map(escapeCell).join(",");
}

function splitCsvRow(row: string, expectedFields: number): string[] {
  // Simple split on `,` — escaped commas were rewritten to `\c` at encode time.
  const cells = row.split(",");
  while (cells.length < expectedFields) cells.push("");
  return cells;
}

/**
 * Pipe-delimited inner list (used for blockers[] / evidenceRef[]).
 *
 * Inner-list escapes are distinct from cell escapes to avoid collision:
 *   - `\` is doubled to `\\` (must happen first so we don't double-process)
 *   - `|` inside a value becomes `\v` (the outer-cell layer is unaware)
 *
 * The outer cell layer adds its own escapes for `,` and `|` on top of
 * whatever we produce here — they pass through unchanged on decode because
 * the cell layer unescapes first, then we split on `|`.
 */
function joinList(values: string[]): string {
  return values
    .map((v) => v.replace(/\\/g, "\\\\").replace(/\|/g, "\\v"))
    .join("|");
}

function splitList(joined: string): string[] {
  if (!joined) return [];
  // First split on raw `|`, then restore `\v → |` and `\\ → \`.
  return joined
    .split("|")
    .map((v) => v.replace(/\\v/g, "|").replace(/\\\\/g, "\\"));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}
