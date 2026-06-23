#!/usr/bin/env tsx
/**
 * verify-manifest-drift — compare sha256 of a release asset against the
 * sha256 recorded in the on-repo manifest.toon. Exits non-zero with the exact
 * error code `MANIFEST_DRIFT` on stderr when the digests diverge.
 *
 * Consumed by .github/workflows/manifest-drift.yml.
 *
 * Usage:
 *   bunx tsx scripts/verify-manifest-drift.ts \
 *     --release-asset dist/loom-0.1.0.tar.gz \
 *     --manifest manifest.toon
 *
 * Exit codes:
 *   0   sha256(release-asset) === manifest.toon `sha256:` field
 *   1   MANIFEST_DRIFT — digests diverge (stderr contains literal "MANIFEST_DRIFT")
 *   2   usage / I/O error
 *
 * Notes:
 *   - The manifest is consumed as TOON (Phase 6 contract). We extract the
 *     single `sha256: <hex>` line via line-oriented parse — sufficient for the
 *     flat manifest schema and resilient to ordering changes.
 *   - Bootstrap-friendly: callers (the workflow) handle the no-release case;
 *     this script assumes both inputs exist when invoked.
 */
import * as fs from "node:fs";
import { createHash } from "node:crypto";

export const DRIFT_CODE = "MANIFEST_DRIFT";

export function sha256OfFile(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Parse the `sha256: <hex>` field out of a flat TOON manifest. Throws when the
 * field is absent or malformed.
 */
export function readManifestSha256(manifestPath: string): string {
  const text = fs.readFileSync(manifestPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^sha256:\s*([0-9a-fA-F]{64})\s*$/.exec(line);
    if (m) return m[1].toLowerCase();
  }
  throw new Error(
    `manifest missing valid "sha256: <64-hex>" field: ${manifestPath}`,
  );
}

interface Args {
  releaseAsset: string;
  manifest: string;
}

function parseArgs(argv: string[]): Args {
  let releaseAsset: string | undefined;
  let manifest: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--release-asset") releaseAsset = argv[++i];
    else if (a === "--manifest") manifest = argv[++i];
    else if (a?.startsWith("--release-asset=")) releaseAsset = a.slice("--release-asset=".length);
    else if (a?.startsWith("--manifest=")) manifest = a.slice("--manifest=".length);
  }
  if (!releaseAsset) throw new Error("--release-asset <path> is required");
  if (!manifest) throw new Error("--manifest <path> is required");
  return { releaseAsset, manifest };
}

function main(): void {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`verify-manifest-drift: ${(err as Error).message}\n`);
    process.exit(2);
  }

  if (!fs.existsSync(args.releaseAsset)) {
    process.stderr.write(
      `verify-manifest-drift: release asset not found: ${args.releaseAsset}\n`,
    );
    process.exit(2);
  }
  if (!fs.existsSync(args.manifest)) {
    process.stderr.write(
      `verify-manifest-drift: manifest not found: ${args.manifest}\n`,
    );
    process.exit(2);
  }

  let manifestDigest: string;
  try {
    manifestDigest = readManifestSha256(args.manifest);
  } catch (err) {
    process.stderr.write(`verify-manifest-drift: ${(err as Error).message}\n`);
    process.exit(2);
  }

  const assetDigest = sha256OfFile(args.releaseAsset).toLowerCase();

  if (assetDigest === manifestDigest) {
    process.stdout.write(
      `OK  manifest matches asset sha256=${assetDigest}\n`,
    );
    process.exit(0);
  }

  process.stderr.write(
    [
      `${DRIFT_CODE}: release asset sha256 does not match manifest`,
      `  asset:    ${args.releaseAsset}`,
      `  manifest: ${args.manifest}`,
      `  expected: ${manifestDigest}`,
      `  actual:   ${assetDigest}`,
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();
if (isMain) main();
