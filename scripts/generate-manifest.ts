#!/usr/bin/env tsx
/**
 * generate-manifest — emit `manifest.toon` describing a release tarball.
 *
 * Reads the tarball, computes sha256 + size, writes a TOON manifest with the
 * shape required by Phase 7's manifest-drift CI check:
 *
 *   manifestVersion: 1
 *   releaseTag: v0.1.0
 *   tarballName: loom-0.1.0.tar.gz
 *   sha256: <hex>
 *   sizeBytes: <int>
 *   producedAt: <ISO8601>
 *
 * Usage:
 *   bunx tsx scripts/generate-manifest.ts --tarball dist/loom-0.1.0.tar.gz --tag v0.1.0
 *   bunx tsx scripts/generate-manifest.ts --tarball dist/loom-local-test.tar.gz --tag v0.1.0-test --out manifest.toon
 *
 * Atomic write: writes to <out>.tmp then renames.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

export interface Manifest {
  manifestVersion: 1;
  releaseTag: string;
  tarballName: string;
  sha256: string;
  sizeBytes: number;
  producedAt: string;
}

export function sha256OfFile(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

export function buildManifest(args: {
  tarballPath: string;
  releaseTag: string;
  now?: () => Date;
}): Manifest {
  const { tarballPath, releaseTag } = args;
  const now = args.now ?? (() => new Date());
  const stat = fs.statSync(tarballPath);
  return {
    manifestVersion: 1,
    releaseTag,
    tarballName: path.basename(tarballPath),
    sha256: sha256OfFile(tarballPath),
    sizeBytes: stat.size,
    producedAt: now().toISOString(),
  };
}

export function manifestToToon(m: Manifest): string {
  return [
    `manifestVersion: ${m.manifestVersion}`,
    `releaseTag: ${m.releaseTag}`,
    `tarballName: ${m.tarballName}`,
    `sha256: ${m.sha256}`,
    `sizeBytes: ${m.sizeBytes}`,
    `producedAt: ${m.producedAt}`,
    "",
  ].join("\n");
}

export function writeManifestAtomic(outPath: string, m: Manifest): void {
  const tmp = `${outPath}.tmp`;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(tmp, manifestToToon(m), "utf8");
  fs.renameSync(tmp, outPath);
}

function parseArgs(argv: string[]) {
  let tarball: string | undefined;
  let tag: string | undefined;
  let out: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tarball") tarball = argv[++i];
    else if (a === "--tag") tag = argv[++i];
    else if (a === "--out") out = argv[++i];
    else if (a?.startsWith("--tarball=")) tarball = a.slice("--tarball=".length);
    else if (a?.startsWith("--tag=")) tag = a.slice("--tag=".length);
    else if (a?.startsWith("--out=")) out = a.slice("--out=".length);
  }
  return { tarball, tag, out };
}

function main() {
  const { tarball, tag, out } = parseArgs(process.argv.slice(2));
  if (!tarball) throw new Error("--tarball <path> is required");
  if (!tag) throw new Error("--tag <vX.Y.Z> is required");
  if (!fs.existsSync(tarball)) throw new Error(`Tarball not found: ${tarball}`);

  const manifest = buildManifest({ tarballPath: tarball, releaseTag: tag });
  const outPath = out ?? path.join(path.dirname(tarball), "manifest.toon");
  writeManifestAtomic(outPath, manifest);
  process.stdout.write(`${manifestToToon(manifest)}wrote: ${outPath}\n`);
}

const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();
if (isMain) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`generate-manifest: ${(err as Error).message}\n`);
    process.exit(1);
  }
}
