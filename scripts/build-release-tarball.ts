#!/usr/bin/env tsx
/**
 * build-release-tarball — bundle the Loom release artifacts into a tarball.
 *
 * Production mode: emits `dist/loom-${version}.tar.gz` (version from --tag or
 * package.json). Dry-run mode (`--dry-run` or `LOOM_DRY_RUN=true`): emits
 * `dist/loom-local-test.tar.gz` — this is the artifact Phase 8's Docker
 * harness consumes.
 *
 * Usage:
 *   bunx tsx scripts/build-release-tarball.ts --tag v0.1.0
 *   bunx tsx scripts/build-release-tarball.ts --dry-run
 *
 * The bundled paths are stable across releases (see RELEASE_PATHS). If a
 * required path is missing the script exits non-zero with a clear error so the
 * release workflow fails loudly rather than shipping a partial archive.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

const RELEASE_PATHS = [
  "commands",
  "agents",
  "hooks",
  "scripts",
  "marketplace",
  ".claude-plugin",
  "README.md",
  "install.sh",
  "LICENSE",
] as const;

interface BuildOptions {
  tag?: string;
  dryRun: boolean;
  repoRoot: string;
  outDir: string;
}

function parseArgs(argv: string[]): { tag?: string; dryRun: boolean } {
  let tag: string | undefined;
  let dryRun = process.env.LOOM_DRY_RUN === "true";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--tag") tag = argv[++i];
    else if (a?.startsWith("--tag=")) tag = a.slice("--tag=".length);
  }
  return { tag, dryRun };
}

export function resolveVersion(tag: string | undefined, repoRoot: string): string {
  if (tag) return tag.replace(/^v/, "");
  const pkgPath = path.join(repoRoot, "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    if (typeof pkg.version === "string") return pkg.version;
  }
  throw new Error("Cannot resolve version: pass --tag vX.Y.Z or ensure package.json has version");
}

export function resolveTarballName(opts: { tag?: string; dryRun: boolean; repoRoot: string }): string {
  if (opts.dryRun) return "loom-local-test.tar.gz";
  const version = resolveVersion(opts.tag, opts.repoRoot);
  return `loom-${version}.tar.gz`;
}

export function build(opts: BuildOptions): { tarballPath: string; included: string[] } {
  const { repoRoot, outDir, dryRun } = opts;
  fs.mkdirSync(outDir, { recursive: true });
  const tarballName = resolveTarballName({ tag: opts.tag, dryRun, repoRoot });
  const tarballPath = path.join(outDir, tarballName);
  const tmpPath = `${tarballPath}.tmp`;

  const included: string[] = [];
  const missing: string[] = [];
  for (const rel of RELEASE_PATHS) {
    const abs = path.join(repoRoot, rel);
    if (fs.existsSync(abs)) included.push(rel);
    else missing.push(rel);
  }

  // LICENSE is optional per spec ("LICENSE if present").
  const hardMissing = missing.filter((m) => m !== "LICENSE");
  if (hardMissing.length > 0) {
    throw new Error(`Missing required release paths: ${hardMissing.join(", ")}`);
  }

  // Use BSD/GNU tar — both accept these flags.
  const args = ["-czf", tmpPath, "-C", repoRoot, ...included];
  execFileSync("tar", args, { stdio: "inherit" });
  fs.renameSync(tmpPath, tarballPath);

  return { tarballPath, included };
}

function main() {
  const { tag, dryRun } = parseArgs(process.argv.slice(2));
  const repoRoot = process.env.LOOM_REPO_ROOT || process.cwd();
  const outDir = path.join(repoRoot, "dist");
  const { tarballPath, included } = build({ tag, dryRun, repoRoot, outDir });
  const sizeBytes = fs.statSync(tarballPath).size;
  process.stdout.write(
    [
      `tarball: ${tarballPath}`,
      `sizeBytes: ${sizeBytes}`,
      `included: ${included.join(",")}`,
      `mode: ${dryRun ? "dry-run" : "release"}`,
      "",
    ].join("\n"),
  );
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
    process.stderr.write(`build-release-tarball: ${(err as Error).message}\n`);
    process.exit(1);
  }
}
