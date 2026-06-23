/**
 * Lock-file concurrency guard for the roadmap-converge driver.
 *
 * Writes `{pid, started_at}` to `.roadmap-converge/{slug}/.lock` at pass
 * start (atomic O_EXCL create per AW-08 risk note — `fs.openSync(path, 'wx')`
 * fails when the file already exists, preventing two parallel drivers from
 * both believing they own the lock).
 *
 * A second `/loom-roadmap converge` invocation while the lock exists and is
 * < `STALE_AFTER_MS` (10 min) old aborts with exit code 1 and a
 * `LOCK_CONFLICT` stderr line, unless `--force` was passed. Locks older than
 * the stale window are auto-cleared (with a stderr advisory) and the new
 * pass proceeds — this handles the common crash-during-pass case.
 *
 * Lock contents are TOON: two flat fields, no array. Kept small so the
 * orchestrator can read it with grep if the runtime is unavailable.
 */

import { linkSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";

/** Time after which a held lock is considered stale and auto-cleared. */
export const STALE_AFTER_MS = 10 * 60 * 1000;

export interface LockInfo {
  pid: number;
  startedAt: string;
}

export interface LockAcquireOptions {
  /** Override Date.now() for deterministic tests. Returns epoch ms. */
  now?: () => number;
  /** Override process.pid for deterministic tests. */
  pid?: number;
  /** When true, force-clear any existing lock (including non-stale). */
  force?: boolean;
  /** Receives stderr advisories ("stale lock auto-cleared", etc.). */
  onAdvisory?: (msg: string) => void;
}

export interface LockAcquireSuccess {
  acquired: true;
  info: LockInfo;
}

export interface LockAcquireConflict {
  acquired: false;
  conflict: LockInfo;
  ageMs: number;
  reason: "LOCK_CONFLICT";
}

export type LockAcquireResult = LockAcquireSuccess | LockAcquireConflict;

/**
 * Acquire the lock at `lockPath`. Atomic; safe against concurrent callers.
 *
 * Behaviour:
 *   1. If no lock exists, create one (atomic O_EXCL) and return success.
 *   2. If a lock exists and is older than STALE_AFTER_MS, clear it, emit a
 *      stderr advisory, then retry the create. Returns success.
 *   3. If a lock exists, is fresh, and `force` is false → returns
 *      LockAcquireConflict ({reason: LOCK_CONFLICT}) without modifying the
 *      existing file.
 *   4. If `force` is true and a lock exists, clear it unconditionally and
 *      create the new lock.
 *
 * Throws only on I/O errors unrelated to existence-race (e.g. EACCES on
 * the containing directory). Callers should wrap in a try/catch and treat
 * such errors as halt-the-pass.
 */
export function acquireLock(
  lockPath: string,
  opts: LockAcquireOptions = {}
): LockAcquireResult {
  const now = opts.now ?? Date.now;
  const pid = opts.pid ?? process.pid;
  const startedAt = new Date(now()).toISOString();
  const force = opts.force === true;

  // Up to two attempts: first attempt may race a stale-lock clear.
  for (let attempt = 0; attempt < 2; attempt++) {
    // Write the full lock body to a pid-suffixed tmp file first (no zero-byte
    // window), then link() it into lockPath. link() fails with EEXIST on POSIX
    // when the target already exists — giving us the same O_EXCL semantics as
    // openSync("wx") but with the body already committed before we "publish".
    const tmpLock = `${lockPath}.tmp.${pid}`;
    const body = `pid: ${pid}\nstarted_at: ${startedAt}\n`;
    writeFileSync(tmpLock, body, { flag: "w" });

    let linkOk = false;
    try {
      linkSync(tmpLock, lockPath);
      linkOk = true;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== "EEXIST") {
        safeUnlink(tmpLock);
        throw err;
      }
      // Lock already exists — fall through to conflict handling below.
    } finally {
      // tmpLock is no longer needed (lockPath now has its own inode via link).
      safeUnlink(tmpLock);
    }

    if (linkOk) {
      return { acquired: true, info: { pid, startedAt } };
    }

    // Lock exists — inspect it.
    const existing = readLockFile(lockPath);
    const existingMs = existing ? Date.parse(existing.startedAt) : NaN;
    const ageMs = Number.isFinite(existingMs) ? now() - existingMs : Infinity;

    if (force) {
      // Caller asked to steal the lock.
      // Rename the existing lock to a temp path first (atomic on POSIX) to
      // prevent TOCTOU: another process can't steal a lock we've already moved.
      const staleTmp = `${lockPath}.stale.${pid}`;
      try {
        renameSync(lockPath, staleTmp);
        safeUnlink(staleTmp);
      } catch (renameErr) {
        const re = renameErr as NodeJS.ErrnoException;
        if (re.code === "ENOENT") {
          // Another process already cleared it — retry from the top.
          continue;
        }
        throw renameErr;
      }
      opts.onAdvisory?.(
        `force-clearing lock at ${lockPath} (was pid=${existing?.pid ?? "?"}, age=${formatAge(ageMs)})`
      );
      continue;
    }

    if (ageMs > STALE_AFTER_MS) {
      // Stale — rename to temp (atomic) then unlink, then retry.
      const staleTmp = `${lockPath}.stale.${pid}`;
      try {
        renameSync(lockPath, staleTmp);
        safeUnlink(staleTmp);
      } catch (renameErr) {
        const re = renameErr as NodeJS.ErrnoException;
        if (re.code === "ENOENT") {
          // Another process already cleared it — retry from the top.
          continue;
        }
        throw renameErr;
      }
      opts.onAdvisory?.(
        `stale lock auto-cleared at ${lockPath} (was pid=${existing?.pid ?? "?"}, age=${formatAge(ageMs)})`
      );
      continue;
    }

    // Fresh lock — conflict.
    return {
      acquired: false,
      conflict: existing ?? { pid: -1, startedAt: "" },
      ageMs: Number.isFinite(ageMs) ? ageMs : 0,
      reason: "LOCK_CONFLICT",
    };
  }

  // Unreachable in practice (loop exits via return). Surface as conflict for safety.
  return {
    acquired: false,
    conflict: { pid: -1, startedAt: "" },
    ageMs: 0,
    reason: "LOCK_CONFLICT",
  };
}

/** Remove the lock file. Idempotent — missing file is not an error. */
export function releaseLock(lockPath: string): void {
  safeUnlink(lockPath);
}

/** Read and parse a lock file. Returns null if missing or unparseable. */
export function readLockFile(lockPath: string): LockInfo | null {
  let raw: string;
  try {
    raw = readFileSync(lockPath, "utf-8");
  } catch {
    return null;
  }
  const pidMatch = /^pid:\s*(\d+)\s*$/m.exec(raw);
  const startedMatch = /^started_at:\s*(\S+)\s*$/m.exec(raw);
  if (!pidMatch || !startedMatch) return null;
  return {
    pid: parseInt(pidMatch[1], 10),
    startedAt: startedMatch[1],
  };
}

/** Returns true when a lock file currently exists. */
export function lockExists(lockPath: string): boolean {
  try {
    return statSync(lockPath).isFile();
  } catch {
    return false;
  }
}

function safeUnlink(path: string): void {
  try {
    unlinkSync(path);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== "ENOENT") throw err;
  }
}

function formatAge(ms: number): string {
  if (!Number.isFinite(ms)) return "unknown";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  return `${hr}h${min % 60}m`;
}
