/**
 * Ownership evidence — hash-based file-divergence detector.
 *
 * Maintains an append-only TOON log at `.claude/loom-migration.log.toon`.
 * Each record (a `MigrationEvidence`) carries the sha256 of the target
 * settings file at the moment we touched it. On a subsequent run, the
 * migration runner re-hashes the file: if the on-disk hash differs from
 * the last recorded `afterHash` (or the seeded `beforeHash` for a
 * `not-needed` / `refused-ownership-guard` outcome) we refuse to rewrite
 * and append a fresh `refused-ownership-guard` record instead.
 *
 * Pure module — all I/O is injected via `EvidenceDeps` for testability.
 * Writes are atomic (`.tmp` + rename) per project convention.
 */
import * as fsDefault from "node:fs";
import * as crypto from "node:crypto";
import * as path from "node:path";

export type MigrationOutcome =
  | "applied"
  | "not-needed"
  | "refused-ownership-guard";

export interface MigrationEvidence {
  /** Stable kebab-case check identifier, e.g. `bare-anchor`. */
  checkId: string;
  /** ISO8601 UTC timestamp. */
  appliedAt: string;
  outcome: MigrationOutcome;
  /** Absolute path to the settings file the evidence targets. */
  path: string;
  /** sha256 of the on-disk file BEFORE this attempt (present on applied/not-needed/refused). */
  beforeHash?: string;
  /** sha256 of the on-disk file AFTER this attempt (present on applied/not-needed). */
  afterHash?: string;
  /** Human-readable explanation; surfaces in doctor output and stderr. */
  reason?: string;
}

export interface EvidenceDeps {
  fs?: Pick<
    typeof fsDefault,
    "existsSync" | "readFileSync" | "writeFileSync" | "renameSync" | "mkdirSync"
  >;
  /** Allow tests to pin time. */
  now?: () => Date;
}

/** Compute the sha256 of a file's bytes. Returns `null` if the file is missing. */
export function sha256OfFile(
  filePath: string,
  deps: EvidenceDeps = {}
): string | null {
  const fs = deps.fs ?? fsDefault;
  if (!fs.existsSync(filePath)) return null;
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/** Compute the sha256 of an arbitrary buffer or string. */
export function sha256OfContent(content: Buffer | string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

// ---------------------------------------------------------------------------
// TOON log encoding/decoding
// ---------------------------------------------------------------------------

const FIELDS = [
  "checkId",
  "appliedAt",
  "outcome",
  "path",
  "beforeHash",
  "afterHash",
  "reason",
] as const;

/**
 * Escape a CSV-ish field for TOON: wrap in double quotes if it contains a
 * comma, double-quote, or newline. Escapes embedded quotes by doubling.
 */
function escapeField(value: string | undefined): string {
  if (value === undefined || value === null) return "";
  const s = String(value);
  if (s === "") return "";
  if (/[,"\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Split a CSV row honoring quoted fields with embedded commas / escaped quotes. */
function splitCsv(row: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (inQuotes) {
      if (ch === '"') {
        if (row[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Encode a list of records as the canonical TOON log body. */
export function encodeLog(records: MigrationEvidence[]): string {
  const header = `records[${records.length}]{${FIELDS.join(",")}}:`;
  if (records.length === 0) {
    return `# Loom migration evidence log. Append-only; managed by hooks/loom-migration.ts and /loom-doctor --fix.\n${header}\n`;
  }
  const rows = records.map((r) => {
    return (
      "  " +
      FIELDS.map((f) =>
        escapeField((r as unknown as Record<string, string | undefined>)[f])
      ).join(",")
    );
  });
  return [
    "# Loom migration evidence log. Append-only; managed by hooks/loom-migration.ts and /loom-doctor --fix.",
    header,
    ...rows,
    "",
  ].join("\n");
}

/** Decode the TOON log body into records. Returns `[]` for missing / malformed input. */
export function decodeLog(content: string): MigrationEvidence[] {
  if (!content || !content.trim()) return [];
  const lines = content.split("\n");
  let inArray = false;
  const records: MigrationEvidence[] = [];
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (!inArray) {
      // Match records[N]{...}: header.
      if (/^records\[\d+\]\{[^}]+\}:$/.test(trimmed)) {
        inArray = true;
      }
      continue;
    }
    // Row must be indented; bail on dedent.
    if (!raw.startsWith("  ")) break;
    const values = splitCsv(trimmed);
    const rec: Record<string, string | undefined> = {};
    for (let i = 0; i < FIELDS.length; i++) {
      const v = values[i];
      rec[FIELDS[i]] = v === undefined || v === "" ? undefined : v;
    }
    if (!rec.checkId || !rec.appliedAt || !rec.outcome || !rec.path) continue;
    records.push({
      checkId: rec.checkId,
      appliedAt: rec.appliedAt,
      outcome: rec.outcome as MigrationOutcome,
      path: rec.path,
      beforeHash: rec.beforeHash,
      afterHash: rec.afterHash,
      reason: rec.reason,
    });
  }
  return records;
}

// ---------------------------------------------------------------------------
// Log read / write helpers
// ---------------------------------------------------------------------------

/** Read the migration log; returns `[]` if the file does not yet exist. */
export function readLog(logPath: string, deps: EvidenceDeps = {}): MigrationEvidence[] {
  const fs = deps.fs ?? fsDefault;
  if (!fs.existsSync(logPath)) return [];
  return decodeLog(fs.readFileSync(logPath, "utf8"));
}

/** Atomically write the log file (`.tmp` + rename). Creates parent dirs as needed. */
export function writeLogAtomic(
  logPath: string,
  records: MigrationEvidence[],
  deps: EvidenceDeps = {}
): void {
  const fs = deps.fs ?? fsDefault;
  const dir = path.dirname(logPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = `${logPath}.tmp`;
  fs.writeFileSync(tmp, encodeLog(records));
  fs.renameSync(tmp, logPath);
}

/**
 * Append a single record to the log atomically. Preserves chronological order.
 */
export function appendRecord(
  logPath: string,
  record: MigrationEvidence,
  deps: EvidenceDeps = {}
): void {
  const existing = readLog(logPath, deps);
  existing.push(record);
  writeLogAtomic(logPath, existing, deps);
}

/**
 * Remove every record whose `checkId` matches. Atomic. Returns the number
 * of records removed.
 */
export function removeRecordsByCheckId(
  logPath: string,
  checkId: string,
  deps: EvidenceDeps = {}
): number {
  const existing = readLog(logPath, deps);
  const kept = existing.filter((r) => r.checkId !== checkId);
  const removed = existing.length - kept.length;
  if (removed > 0) {
    writeLogAtomic(logPath, kept, deps);
  }
  return removed;
}

/**
 * Return the most recent record for the given `(checkId, path)` pair, or
 * `undefined` if none. Recency is positional — last entry wins.
 */
export function latestRecordFor(
  records: MigrationEvidence[],
  checkId: string,
  targetPath: string
): MigrationEvidence | undefined {
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    if (r.checkId === checkId && r.path === targetPath) return r;
  }
  return undefined;
}

/**
 * Ownership-guard verdict. Compares the recorded hash against the on-disk
 * hash. Returns `null` (guard passes) when:
 *  - no prior record exists for `(checkId, path)`; OR
 *  - the prior record's reference hash matches on-disk.
 *
 * Returns a structured `Divergence` when on-disk drift is detected — caller
 * MUST refuse to rewrite and append a `refused-ownership-guard` record.
 *
 * The reference hash is the prior record's `afterHash` (post-write state),
 * falling back to `beforeHash` for `not-needed` / `refused` outcomes that
 * never produced an after-state.
 */
export interface Divergence {
  recordedHash: string;
  onDiskHash: string | null;
  priorRecord: MigrationEvidence;
}

export function checkOwnership(
  records: MigrationEvidence[],
  checkId: string,
  targetPath: string,
  onDiskHash: string | null
): Divergence | null {
  const prior = latestRecordFor(records, checkId, targetPath);
  if (!prior) return null;
  const reference = prior.afterHash ?? prior.beforeHash;
  if (!reference) return null;
  if (reference === onDiskHash) return null;
  return { recordedHash: reference, onDiskHash, priorRecord: prior };
}

/** Default log path: `.claude/loom-migration.log.toon` resolved against CWD. */
export function defaultLogPath(cwd: string = process.cwd()): string {
  return path.join(cwd, ".claude", "loom-migration.log.toon");
}
