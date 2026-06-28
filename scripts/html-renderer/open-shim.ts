/**
 * scripts/html-renderer/open-shim.ts
 *
 * Shared utility: attempt to open a file in the OS default browser.
 * Extracted from loom-status.ts and loom-roadmap-status.ts to eliminate
 * the byte-identical tryOpen() duplication (F-06).
 *
 * Uses execFileSync(opener, [filePath]) instead of execSync template-string
 * interpolation so paths with double-quotes or spaces are handled safely.
 *
 * Headless behaviour: if LOOM_HEADLESS=1 is set, returns false immediately
 * without attempting to open anything. Tests rely on this env var.
 */

import { execFileSync } from "node:child_process";

/**
 * Attempt to open `filePath` in the OS default browser.
 * Returns true on success, false on failure (headless / command not found).
 */
export function tryOpen(filePath: string): boolean {
  if (process.env.LOOM_HEADLESS === "1") return false;
  if (process.platform === "win32") {
    try {
      execFileSync("cmd.exe", ["/c", "start", "", filePath], { stdio: "ignore", timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
  const openers = ["open", "xdg-open"];
  for (const opener of openers) {
    try {
      execFileSync(opener, [filePath], { stdio: "ignore", timeout: 5000 });
      return true;
    } catch {
      // try next opener
    }
  }
  return false;
}
