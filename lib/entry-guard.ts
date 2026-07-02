/**
 * lib/entry-guard.ts — SharedCoreModule "entry-guard" (PLAN-exceed-gstack Phase 2b, C-02).
 *
 * `isMain(import.meta)` — true only when the calling module is the process
 * entry point. Replaces the ad-hoc top-level guards scattered across
 * scripts/ (`import.meta.main`, `require.main === module`, argv comparisons)
 * and is what Phase 14a uses to guard the top-level `main()` calls in
 * scripts/loom-version-slot.ts and scripts/loom-browser-daemon.ts.
 *
 * Runtime matrix (all supported):
 *   - bun            — `import.meta.main` is a native boolean.
 *   - plain node     — `.ts` via type stripping (≥23) or `.js`; node ≥24
 *                      provides `import.meta.main`, older versions fall back
 *                      to the argv comparison.
 *   - node + tsx     — tsx dynamically imports the user script, so the
 *                      NATIVE `import.meta.main` is false/undefined for the
 *                      real entry. The argv[1] path comparison (checked
 *                      FIRST) covers this: tsx rewrites `process.argv[1]` to
 *                      the user script.
 *
 * Contract: protocols/shared-core.schema.md (signature FROZEN).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Returns true only when `importMeta` belongs to the module the process was
 * started with. Call as `isMain(import.meta)`.
 */
export function isMain(importMeta: ImportMeta): boolean {
  // 1. argv comparison first — correct under bun, plain node, AND node+tsx
  //    (where the native flag would be wrong for the loader-imported entry).
  const entryArg = process.argv[1];
  if (entryArg) {
    let modulePath: string | null = null;
    try {
      modulePath = fileURLToPath(importMeta.url);
    } catch {
      // Non-file URL (data:, http:, bun virtual) — never a CLI entry path.
      modulePath = null;
    }
    if (modulePath !== null && samePath(modulePath, path.resolve(entryArg))) {
      return true;
    }
  }

  // 2. Native flag (bun always; node ≥24). For imported modules this is
  //    false — exactly what we want after the argv check found no match.
  const nativeMain = (importMeta as ImportMeta & { main?: unknown }).main;
  if (typeof nativeMain === "boolean") {
    return nativeMain;
  }

  // 3. No signal at all (e.g. embedded runtime without argv or the flag):
  //    fail closed — never auto-run main() when we cannot prove entry-ness.
  return false;
}

/** Path equality tolerant of symlinks (e.g. macOS /tmp → /private/tmp). */
function samePath(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return false;
  }
}
