/**
 * `--bundle` packager (Phase 9A1).
 *
 * Produces a redacted diagnostic tarball at
 * `~/.cache/loom/bundles/loom-doctor-{version}-{ISO8601}.tar.gz`.
 *
 * Redaction rules (per Phase 9A1 spec):
 *   - strip `installSourceUrl` (every depth)
 *   - strip `doNotTrack` (every depth)
 *   - keep `channel`, `source`, and all version fields
 *
 * Pure helpers (`redact`, `bundleFilename`) are exported for unit tests; the
 * `createBundle` entry-point shells out to `tar` via `execFileSync`.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

import type { RenderableReport } from "./render.js";

const REDACTED_KEYS = new Set(["installSourceUrl", "doNotTrack"]);

/**
 * Deep-clone-and-strip. Removes any key in REDACTED_KEYS at every depth.
 * Pure: never mutates the input.
 */
export function redact<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => redact(v)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (REDACTED_KEYS.has(k)) continue;
      out[k] = redact(v);
    }
    return out as T;
  }
  return value;
}

/** Compute the canonical bundle filename. ISO timestamp uses Z + no colons. */
export function bundleFilename(version: string, now: Date): string {
  const iso = now.toISOString().replace(/[:.]/g, "-");
  return `loom-doctor-${version}-${iso}.tar.gz`;
}

export interface CreateBundleOptions {
  report: RenderableReport;
  /** Additional diagnostic files to include (absolute paths). */
  extraFiles?: string[];
  /** Loom version string (for filename). */
  version: string;
  /** Clock injection. */
  now?: () => Date;
  /** Override bundle directory (defaults to `~/.cache/loom/bundles`). */
  bundleDir?: string;
}

export interface CreateBundleResult {
  /** Absolute path to the resulting tarball. */
  tarball: string;
  /** Absolute path to the redacted report staged inside the bundle. */
  reportPath: string;
}

/**
 * Stage a redacted `report.json` plus any `extraFiles` into a temp directory,
 * then call `tar -czf` to produce the bundle. The temp staging directory is
 * removed on success.
 */
export function createBundle(opts: CreateBundleOptions): CreateBundleResult {
  const now = (opts.now ?? (() => new Date()))();
  const bundleDir =
    opts.bundleDir ?? path.join(os.homedir(), ".cache", "loom", "bundles");
  fs.mkdirSync(bundleDir, { recursive: true });

  const filename = bundleFilename(opts.version, now);
  const tarball = path.join(bundleDir, filename);

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "loom-doctor-"));
  try {
    const redacted = redact(opts.report);
    const reportPath = path.join(staging, "report.json");
    // Atomic-ish write: tmp then rename.
    fs.writeFileSync(reportPath + ".tmp", JSON.stringify(redacted, null, 2));
    fs.renameSync(reportPath + ".tmp", reportPath);

    const include: string[] = ["report.json"];
    for (const src of opts.extraFiles ?? []) {
      if (!fs.existsSync(src)) continue;
      const base = path.basename(src);
      const dest = path.join(staging, base);
      fs.copyFileSync(src, dest);
      include.push(base);
    }

    execFileSync("tar", ["-czf", tarball, "-C", staging, ...include], {
      stdio: ["ignore", "ignore", "pipe"],
    });

    return { tarball, reportPath };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
