/**
 * Shared utilities for write-time hooks. All three quality-gate hooks
 * (shellcheck-on-write, bash-portability-on-write, pylint-on-write) call
 * these helpers — keeping them in one place avoids the gem-flagged efficiency
 * pattern of re-reading whole files for a 64-byte shebang check and
 * re-probing tool availability on every Write|Edit.
 *
 * Performance budget per hook invocation:
 *   - readShebang(path): one fs.openSync + fs.readSync, 64 bytes (~50 µs)
 *   - commandAvailable(bin): cached after first probe per process (~0 µs warm)
 */

import * as fsSync from "node:fs";
import { execFileSync } from "node:child_process";

const SHEBANG_BYTES = 64;

/**
 * Read the first 64 bytes of a file and return them as a string. Returns
 * undefined when the file cannot be opened (caller should treat the file as
 * unclassifiable). Does NOT use fs.readFileSync — reading 64 bytes of a 100 MB
 * binary that happens to share a Write|Edit invocation should not cost 100 MB.
 */
export function readShebang(filePath: string): string | undefined {
  let fd: number | undefined;
  try {
    fd = fsSync.openSync(filePath, "r");
    const buf = Buffer.alloc(SHEBANG_BYTES);
    const bytes = fsSync.readSync(fd, buf, 0, SHEBANG_BYTES, 0);
    return buf.toString("utf-8", 0, bytes);
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        fsSync.closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Classify a file as a shell script via extension OR shebang. Cheap path
 * (extension match) avoids the read entirely; expensive path (shebang sniff)
 * uses readShebang for bounded I/O.
 */
export function isShellScript(filePath: string): boolean {
  if (/\.(sh|bash)$/i.test(filePath)) return true;
  const head = readShebang(filePath);
  if (!head) return false;
  return /^#!\s*\/(usr\/)?bin\/(env\s+)?(ba)?sh\b/.test(head);
}

/**
 * Classify a file as Python via extension OR shebang.
 */
export function isPython(filePath: string): boolean {
  if (/\.pyi?$/i.test(filePath)) return true;
  const head = readShebang(filePath);
  if (!head) return false;
  return /^#!\s*\/(usr\/)?bin\/(env\s+)?python[23]?\b/.test(head);
}

/**
 * Return "sh" when the shebang declares POSIX sh; "bash" otherwise. Used by
 * shellcheck-on-write to pick the correct -s flag. Falls back to "bash" when
 * the file can't be read — better to over-strict-check than to skip silently.
 */
export function detectShellFlavor(filePath: string): "sh" | "bash" {
  const head = readShebang(filePath);
  if (head && /^#!\s*\/(usr\/)?bin\/sh\b/.test(head)) return "sh";
  return "bash";
}

// ---------------------------------------------------------------------------
// Tool availability cache
// ---------------------------------------------------------------------------

const PROBE_TIMEOUT_MS = 5_000;
const availabilityCache: Map<string, boolean> = new Map();

/**
 * Probe whether a binary is on PATH and runnable. Cached per process — every
 * subsequent call returns the same answer without re-spawning the binary.
 *
 * The gem-flagged anti-pattern was probing `<tool> --version` on every
 * Write|Edit. With ~5 PostToolUse hooks each probing 1+ tool, a single edit
 * could fire 10+ unnecessary spawns. The cache reduces that to 1 spawn per
 * tool per process lifetime.
 */
export function commandAvailable(bin: string): boolean {
  const cached = availabilityCache.get(bin);
  if (cached !== undefined) return cached;
  let ok = false;
  try {
    execFileSync(bin, ["--version"], {
      timeout: PROBE_TIMEOUT_MS,
      stdio: ["ignore", "ignore", "ignore"],
    });
    ok = true;
  } catch {
    ok = false;
  }
  availabilityCache.set(bin, ok);
  return ok;
}

/**
 * Reset the availability cache. Test-only — production code never calls this.
 */
export function _resetAvailabilityCache(): void {
  availabilityCache.clear();
}
