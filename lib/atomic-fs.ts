/**
 * lib/atomic-fs.ts — SharedCoreModule "atomic-fs" (PLAN-exceed-gstack Phase 2b, C-02).
 *
 * The single sanctioned atomic file writer. Reimplementing these exports
 * outside lib/ is banned by lint (eslint.config.js, wired in Phase 2b).
 * This module consolidates four copy-pasted implementations (defect 8):
 *
 *   1. scripts/loom-browser-daemon.ts:32  (`atomicWrite`)   — mkdir -p parent,
 *      write `{path}.tmp`, renameSync; no explicit encoding (utf8 default).
 *   2. scripts/loom-install.ts:80         (`atomicWrite`)   — same, explicit utf8.
 *   3. scripts/loom-version-slot.ts:216   (`writeAtomic`)   — same, explicit utf8.
 *   4. scripts/loom-change/init.ts:318    (`atomicWriteText`) — same shape via
 *      `tmpPathFor` (`${path}.tmp`), explicit utf8.
 *
 * Behavioral union honored here:
 *   - parent directory is created recursively (all four callers rely on it)
 *   - temp file is `{path}{tmpSuffix}` (default ".tmp"), then `fs.renameSync`
 *   - utf8 default encoding for string data
 *
 * Additive over the legacy copies (Wave-0 note): `AtomicWriteOptions.fsync`
 * flushes the temp file to disk before the rename for durability, and a
 * failed write cleans up the temp file so a crash never strands partial
 * state next to the target.
 *
 * The callers above are NOT migrated here — Phase 11b owns that (strangler
 * order, one caller group per commit).
 *
 * Contract: protocols/shared-core.schema.md (signatures FROZEN).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { AtomicWriteOptions } from "./types.js";

/**
 * Atomically write `data` to `targetPath`.
 *
 * Writes `{targetPath}{tmpSuffix}` then `fs.renameSync` — on POSIX the rename
 * is atomic, so a concurrent reader (or a killed process) observes either the
 * old file or the new file, never a partial write. The parent directory is
 * created recursively. On failure the temp file is removed and the original
 * target (if any) is left untouched.
 */
export function atomicWrite(
  targetPath: string,
  data: string | Buffer,
  opts: AtomicWriteOptions = {},
): void {
  const { encoding = "utf8", mode, tmpSuffix = ".tmp", fsync = false } = opts;

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}${tmpSuffix}`;

  try {
    if (typeof data === "string") {
      fs.writeFileSync(tmpPath, data, { encoding });
    } else {
      fs.writeFileSync(tmpPath, data);
    }

    if (mode !== undefined) {
      // chmod (not writeFileSync's umask-masked `mode` option) so the exact
      // mode lands on the final path via the rename.
      fs.chmodSync(tmpPath, mode);
    }

    if (fsync) {
      const fd = fs.openSync(tmpPath, "r+");
      try {
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    }

    fs.renameSync(tmpPath, targetPath);
  } catch (err) {
    // Never strand a partial temp file next to the target.
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      // Cleanup is best-effort; the original error is the one that matters.
    }
    throw err;
  }
}

/**
 * String convenience wrapper over `atomicWrite` (the stranded
 * scripts/loom-change/init.ts `atomicWriteText` shape).
 */
export function atomicWriteText(
  targetPath: string,
  text: string,
  opts?: AtomicWriteOptions,
): void {
  atomicWrite(targetPath, text, opts);
}
