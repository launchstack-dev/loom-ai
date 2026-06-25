/**
 * Sole writer of `IterationSnapshot` files for document-mode convergence runs.
 *
 * Schema:     `protocols/iteration-snapshot.schema.md`
 * Called from: `agents/convergence-driver.md § Document Mode Safeguards § Auto-Snapshot Writer`
 * Error mode: warn-and-continue. The helper performs a single retry with 1s
 *             backoff on transient failure; if the retry also fails it throws
 *             a `SnapshotWriteFailed` error whose message starts
 *             `"SNAPSHOT_WRITE_FAILED: "`. The driver (caller) is responsible
 *             for the warn-and-continue posture — the helper itself does not
 *             swallow the error.
 *
 * Atomic write order:
 *   1. Write snapshot copy   — `{path}.{ext}.tmp` -> rename to `{path}.{ext}`
 *   2. Write metadata        — `{path}.toon.tmp`  -> rename to `{path}.toon`
 *   3. Verify checksum       — recompute sha256 over the on-disk copy and
 *                              compare it to the value embedded in metadata.
 *
 * Rollback intent: if step (2) or (3) fails after step (1) succeeded, the
 * copy is still on disk and represents a valid snapshot per schema rule 3
 * (snapshotPath exists after write). Leaving it in place is intentional.
 *
 * Async vs sync: chose `async` so the 1-second retry backoff is a
 * `setTimeout`-based promise rather than a busy-wait or `Atomics.wait`. The
 * driver doc cites `writeIterationSnapshot(...)` generically and does not
 * pin the sync/async dimension.
 *
 * Locked decisions wired:
 *   - W-01 — ISO 8601 with millisecond precision (`new Date().toISOString()`).
 *   - W-02 — slug = basename minus FINAL extension only (see `deriveSlug`).
 *   - C-07 — keep all snapshots forever; no overwrite of an existing
 *            `{slug}-pass-{N}` file (collision throws SNAPSHOT_WRITE_FAILED).
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { CHECKSUM_PREFIX } from "./checksum.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** On-disk metadata record per `iteration-snapshot.schema.md`. */
export interface IterationSnapshotRecord {
  sourcePath: string;
  snapshotPath: string;
  /** Format: `sha256:{64-char-lowercase-hex}` */
  snapshotChecksum: string;
  iteration: number;
  /** ISO 8601 with millisecond precision (locked W-01). */
  timestamp: string;
  slug: string;
}

/** Options accepted by {@link writeIterationSnapshot}. */
export interface WriteIterationSnapshotOptions {
  /** Path to the subject file (relative to `repoRoot` or absolute). */
  subject: string;
  /** 1-indexed pass number; MUST equal the driver's `currentIteration`. */
  iteration: number;
  /** Directory the snapshot files are written into. */
  snapshotDir: string;
  /** Optional repo root used to resolve relative paths. Defaults to `process.cwd()`. */
  repoRoot?: string;
  /** Optional injected clock for testability. Defaults to `() => new Date()`. */
  now?: () => Date;
  /** Optional sleep override for testability. Defaults to a Promise-based 1s sleep. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Test-only seam: replace the inner copy+metadata write sequence with a
   * stub. The stub receives the absolute paths the helper would have written
   * to and the encoded TOON body; production code should never pass this.
   * The helper still derives the slug, computes the checksum, and runs the
   * retry loop around the stub — only the actual filesystem mutation is
   * overridden.
   */
  _writeFileImpl?: WriteFileImpl;
}

/** Function signature for the optional `_writeFileImpl` test seam. */
export type WriteFileImpl = (args: {
  /** Absolute destination path for the verbatim copy. */
  copyAbsPath: string;
  /** Bytes to write to `copyAbsPath`. */
  copyBytes: Buffer;
  /** Absolute destination path for the TOON metadata. */
  metaAbsPath: string;
  /** Bytes to write to `metaAbsPath`. */
  metaBytes: Buffer;
}) => void;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Derive the slug and trailing extension for a subject path per the locked
 * W-02 rule: take the basename, find the LAST `.` character, take everything
 * before it. If there is no `.`, slug equals basename and ext is empty.
 *
 * @returns `{ basename, slug, ext }` where `ext` includes the leading dot
 *          (`.md`, `.txt`, `.json`, ...) or is the empty string.
 */
export function deriveSlug(sourcePath: string): {
  slug: string;
  ext: string;
  basename: string;
} {
  const basename = path.basename(sourcePath);
  const lastDot = basename.lastIndexOf(".");
  if (lastDot <= 0) {
    // No dot at all, or basename starts with a dot (treat dotfiles as ext-less).
    return { basename, slug: basename, ext: "" };
  }
  return {
    basename,
    slug: basename.slice(0, lastDot),
    ext: basename.slice(lastDot),
  };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown when the helper exhausts its single retry. */
export class SnapshotWriteFailed extends Error {
  constructor(detail: string, options?: { cause?: unknown }) {
    super(`SNAPSHOT_WRITE_FAILED: ${detail}`, options);
    this.name = "SnapshotWriteFailed";
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Default sleep: Promise-wrapped `setTimeout`. */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Compute the sha256 checksum of a Buffer, returned as `sha256:{hex}`. */
function sha256(bytes: Buffer): string {
  return `${CHECKSUM_PREFIX}${createHash("sha256").update(bytes).digest("hex")}`;
}

/**
 * Encode an {@link IterationSnapshotRecord} as TOON. The schema is a flat
 * set of six scalar key/value pairs — no nesting required.
 */
function encodeRecord(record: IterationSnapshotRecord): string {
  return [
    `sourcePath: ${record.sourcePath}`,
    `snapshotPath: ${record.snapshotPath}`,
    `snapshotChecksum: ${record.snapshotChecksum}`,
    `iteration: ${record.iteration}`,
    `timestamp: ${record.timestamp}`,
    `slug: ${record.slug}`,
    "",
  ].join("\n");
}

/**
 * Production atomic-write implementation: write to `.tmp`, then rename.
 * The rename is atomic on POSIX filesystems for files on the same volume.
 */
const defaultWriteFile: WriteFileImpl = ({ copyAbsPath, copyBytes, metaAbsPath, metaBytes }) => {
  // 1. snapshot copy
  const copyTmp = `${copyAbsPath}.tmp`;
  fs.writeFileSync(copyTmp, copyBytes);
  fs.renameSync(copyTmp, copyAbsPath);

  // 2. metadata
  const metaTmp = `${metaAbsPath}.tmp`;
  fs.writeFileSync(metaTmp, metaBytes);
  fs.renameSync(metaTmp, metaAbsPath);
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Write a pre-integrator snapshot of the subject file and its sibling
 * `IterationSnapshot` metadata record.
 *
 * Performs ONE retry with a 1-second backoff on any transient write failure
 * before throwing {@link SnapshotWriteFailed}. The caller (the convergence
 * driver) treats the throw as warn-and-continue per the schema's
 * `SNAPSHOT_WRITE_FAILED` Error Codes section.
 *
 * @throws {SnapshotWriteFailed} when both write attempts fail, or when the
 *   destination snapshot file already exists for the same iteration (the
 *   helper refuses to overwrite per locked decision C-07).
 */
export async function writeIterationSnapshot(
  options: WriteIterationSnapshotOptions,
): Promise<IterationSnapshotRecord> {
  const {
    subject,
    iteration,
    snapshotDir,
    repoRoot = process.cwd(),
    now = () => new Date(),
    sleep = defaultSleep,
    _writeFileImpl = defaultWriteFile,
  } = options;

  // Validate iteration up front — schema constraint: 1-indexed integer.
  if (!Number.isInteger(iteration) || iteration < 1) {
    throw new SnapshotWriteFailed(
      `iteration must be a positive integer (got ${iteration})`,
    );
  }

  // Resolve subject relative to repoRoot so the on-disk `sourcePath` field
  // is consistent with the caller's relative-to-repo convention.
  const subjectAbs = path.isAbsolute(subject) ? subject : path.resolve(repoRoot, subject);
  const subjectRel = path.relative(repoRoot, subjectAbs);
  const snapshotDirAbs = path.isAbsolute(snapshotDir)
    ? snapshotDir
    : path.resolve(repoRoot, snapshotDir);

  // Validation rule 2 — sourcePath must exist at write time.
  let subjectBytes: Buffer;
  try {
    subjectBytes = fs.readFileSync(subjectAbs);
  } catch (err) {
    throw new SnapshotWriteFailed(
      `source file not readable: ${subjectAbs}`,
      { cause: err },
    );
  }

  // Slug derivation (W-02) drives the on-disk filenames.
  const { slug, ext } = deriveSlug(subjectAbs);
  const copyFilename = `${slug}-pass-${iteration}${ext}`;
  const metaFilename = `${slug}-pass-${iteration}.toon`;
  const copyAbsPath = path.join(snapshotDirAbs, copyFilename);
  const metaAbsPath = path.join(snapshotDirAbs, metaFilename);
  const copyRelPath = path.relative(repoRoot, copyAbsPath);

  // Locked decision C-07: never overwrite an existing snapshot.
  if (fs.existsSync(copyAbsPath) || fs.existsSync(metaAbsPath)) {
    throw new SnapshotWriteFailed(
      `snapshot already exists at ${copyAbsPath}`,
    );
  }

  // Ensure the snapshot directory exists (mkdir -p is idempotent).
  try {
    fs.mkdirSync(snapshotDirAbs, { recursive: true });
  } catch (err) {
    throw new SnapshotWriteFailed(
      `snapshot directory not creatable: ${snapshotDirAbs}`,
      { cause: err },
    );
  }

  // Compose the metadata record. Checksum is computed from the source bytes
  // we just read; the post-write verify step re-reads the copy from disk
  // and confirms the on-disk bytes hash to the same value.
  const checksum = sha256(subjectBytes);
  const record: IterationSnapshotRecord = {
    sourcePath: subjectRel,
    snapshotPath: copyRelPath,
    snapshotChecksum: checksum,
    iteration,
    timestamp: now().toISOString(),
    slug,
  };
  const metaBytes = Buffer.from(encodeRecord(record), "utf8");

  // Single try/catch covering the full write+verify sequence. On failure,
  // sleep 1s and re-run the whole sequence exactly once before surfacing
  // SNAPSHOT_WRITE_FAILED. This matches the "best-effort warn-and-continue"
  // contract — per-phase retry would add complexity without changing the
  // observable outcome.
  const attempt = (): void => {
    _writeFileImpl({ copyAbsPath, copyBytes: subjectBytes, metaAbsPath, metaBytes });

    // Verify checksum (validation rule 4): recompute over the on-disk copy.
    const writtenBytes = fs.readFileSync(copyAbsPath);
    const writtenChecksum = sha256(writtenBytes);
    if (writtenChecksum !== checksum) {
      throw new Error(
        `checksum mismatch after write: expected ${checksum}, got ${writtenChecksum}`,
      );
    }
  };

  try {
    attempt();
    return record;
  } catch (firstErr) {
    await sleep(1000);
    try {
      // Clean up any partial files from the failed first attempt so the
      // C-07 collision guard inside `attempt()` doesn't fire on retry.
      // `attempt()` itself doesn't re-check existence, but a half-written
      // `.tmp` from attempt 1 could collide with attempt 2's rename target.
      for (const p of [`${copyAbsPath}.tmp`, `${metaAbsPath}.tmp`, copyAbsPath, metaAbsPath]) {
        try {
          fs.unlinkSync(p);
        } catch {
          // Ignore — file may not exist, which is the happy path here.
        }
      }
      attempt();
      return record;
    } catch (secondErr) {
      throw new SnapshotWriteFailed(
        `write failed twice for ${copyAbsPath}: ${(secondErr as Error).message}`,
        { cause: secondErr },
      );
    }
  }
}
