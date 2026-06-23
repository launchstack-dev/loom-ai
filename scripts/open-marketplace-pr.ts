#!/usr/bin/env tsx
/**
 * open-marketplace-pr — gate-checks sigstore attestation, then opens the
 * marketplace registry PR for a Loom release.
 *
 * Workflow:
 *   1. Verify the sigstore-attest workflow has a successful run on the current
 *      commit SHA. If not → exit non-zero with code SIGSTORE_NOT_VERIFIED.
 *   2. Clone the marketplace repo (LOOM_MARKETPLACE_REPO env, default
 *      launchstack-dev/loom-marketplace).
 *   3. Branch off main, append a TOON entry to `marketplace-registry.toon`,
 *      commit, push.
 *   4. Open a PR titled `Loom <tag>`.
 *
 * Dry-run (`--dry-run` or LOOM_DRY_RUN=true) skips the actual sigstore check,
 * clone, and PR open — it logs the planned actions to stdout so `act`-driven
 * local runs can exercise the workflow without GitHub side effects.
 *
 * Usage:
 *   bunx tsx scripts/open-marketplace-pr.ts --tag v0.1.0 --manifest dist/manifest.toon --sha <commit>
 *   bunx tsx scripts/open-marketplace-pr.ts --tag v0.1.0-test --manifest dist/manifest.toon --sha <commit> --dry-run
 *
 * The marketplace registry filename (`marketplace-registry.toon`) is a CONTRACT
 * shared with Phase 7 (sigstore-attest workflow naming) and Phase 12
 * (marketplace submission). Do not rename without coordinating both phases.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";

export const MARKETPLACE_REGISTRY_FILENAME = "marketplace-registry.toon";
export const SIGSTORE_WORKFLOW_NAME = "sigstore-attest";
export const SIGSTORE_NOT_VERIFIED_CODE = "SIGSTORE_NOT_VERIFIED";

export interface OpenPrArgs {
  tag: string;
  manifestPath: string;
  commitSha: string;
  dryRun: boolean;
  marketplaceRepo: string;
  loomRepo: string;
}

interface Manifest {
  releaseTag: string;
  tarballName: string;
  sha256: string;
  sizeBytes: number;
  producedAt: string;
}

export function parseManifestToon(toon: string): Manifest {
  const lines = toon.split("\n");
  const get = (k: string): string => {
    for (const line of lines) {
      const m = new RegExp(`^${k}:\\s*(.+)$`).exec(line);
      if (m) return m[1].trim();
    }
    throw new Error(`manifest missing key: ${k}`);
  };
  return {
    releaseTag: get("releaseTag"),
    tarballName: get("tarballName"),
    sha256: get("sha256"),
    sizeBytes: parseInt(get("sizeBytes"), 10),
    producedAt: get("producedAt"),
  };
}

export function buildRegistryEntry(args: { manifest: Manifest; loomRepo: string }): string {
  const { manifest, loomRepo } = args;
  // TOON registry entry block. Phase 12 finalizes the schema; this layout is
  // designed to be append-only so the marketplace repo PR is a clean diff.
  return [
    "",
    `# Loom ${manifest.releaseTag}`,
    `releases[1]{tag,tarball,sha256,sizeBytes,producedAt,source}:`,
    `  ${manifest.releaseTag},${manifest.tarballName},${manifest.sha256},${manifest.sizeBytes},${manifest.producedAt},https://github.com/${loomRepo}/releases/download/${manifest.releaseTag}/${manifest.tarballName}`,
    "",
  ].join("\n");
}

function run(cmd: string, args: string[], opts: { cwd?: string; allowFail?: boolean } = {}): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(cmd, args, { cwd: opts.cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    if (opts.allowFail) {
      return {
        code: typeof e.status === "number" ? e.status : 1,
        stdout: typeof e.stdout === "string" ? e.stdout : (e.stdout?.toString() ?? ""),
        stderr: typeof e.stderr === "string" ? e.stderr : (e.stderr?.toString() ?? ""),
      };
    }
    throw err;
  }
}

export function verifySigstoreRun(args: {
  loomRepo: string;
  commitSha: string;
  workflow?: string;
}): { passed: boolean; runId?: string; reason?: string } {
  const workflow = args.workflow ?? SIGSTORE_WORKFLOW_NAME;
  const res = run(
    "gh",
    [
      "run",
      "list",
      "--repo", args.loomRepo,
      "--workflow", workflow,
      "--commit", args.commitSha,
      "--limit", "10",
      "--json", "databaseId,conclusion,status,headSha",
    ],
    { allowFail: true },
  );
  if (res.code !== 0) {
    return { passed: false, reason: `gh run list failed: ${res.stderr.trim() || "unknown error"}` };
  }
  let runs: Array<{ databaseId: number; conclusion: string; status: string; headSha: string }>;
  try {
    runs = JSON.parse(res.stdout || "[]");
  } catch {
    return { passed: false, reason: "gh run list returned non-JSON output" };
  }
  const match = runs.find(
    (r) => r.headSha === args.commitSha && r.status === "completed" && r.conclusion === "success",
  );
  if (!match) {
    return {
      passed: false,
      reason: `no successful ${workflow} run found for commit ${args.commitSha}`,
    };
  }
  return { passed: true, runId: String(match.databaseId) };
}

export function openMarketplacePr(args: OpenPrArgs): { opened: boolean; reason?: string; prUrl?: string } {
  const { tag, manifestPath, commitSha, dryRun, marketplaceRepo, loomRepo } = args;
  if (!fs.existsSync(manifestPath)) throw new Error(`manifest not found: ${manifestPath}`);
  const manifest = parseManifestToon(fs.readFileSync(manifestPath, "utf8"));
  const registryEntry = buildRegistryEntry({ manifest, loomRepo });

  if (dryRun) {
    process.stdout.write(
      [
        `# open-marketplace-pr: dry-run`,
        `tag: ${tag}`,
        `commitSha: ${commitSha}`,
        `marketplaceRepo: ${marketplaceRepo}`,
        `registryFile: ${MARKETPLACE_REGISTRY_FILENAME}`,
        `sigstoreCheck: skipped (dry-run)`,
        `--- registry entry ---`,
        registryEntry,
        "---",
        "",
      ].join("\n"),
    );
    return { opened: false, reason: "dry-run" };
  }

  // 1. Sigstore gate.
  const sig = verifySigstoreRun({ loomRepo, commitSha });
  if (!sig.passed) {
    process.stderr.write(`open-marketplace-pr: ${SIGSTORE_NOT_VERIFIED_CODE} — ${sig.reason}\n`);
    process.exit(2);
  }

  // 2. Clone marketplace repo to a tmpdir.
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-marketplace-"));
  const repoDir = path.join(workDir, "marketplace");
  run("gh", ["repo", "clone", marketplaceRepo, repoDir]);

  // 3. Branch + append.
  const branch = `loom-${tag}`;
  run("git", ["checkout", "-b", branch], { cwd: repoDir });
  const registryPath = path.join(repoDir, MARKETPLACE_REGISTRY_FILENAME);
  // Append-only update: create file if absent, otherwise append entry.
  const prev = fs.existsSync(registryPath) ? fs.readFileSync(registryPath, "utf8") : "# Loom marketplace registry\n";
  fs.writeFileSync(registryPath, prev + registryEntry, "utf8");
  run("git", ["add", MARKETPLACE_REGISTRY_FILENAME], { cwd: repoDir });
  run("git", ["commit", "-m", `chore: register Loom ${tag}`], { cwd: repoDir });
  run("git", ["push", "-u", "origin", branch], { cwd: repoDir });

  // 4. Open the PR.
  const prBody = [
    `Loom ${tag}`,
    "",
    `- tarball: ${manifest.tarballName}`,
    `- sha256: ${manifest.sha256}`,
    `- size: ${manifest.sizeBytes} bytes`,
    `- sigstore: verified (run ${sig.runId})`,
    `- source: https://github.com/${loomRepo}/releases/tag/${tag}`,
  ].join("\n");
  const prRes = run("gh", [
    "pr", "create",
    "--repo", marketplaceRepo,
    "--title", `Loom ${tag}`,
    "--body", prBody,
    "--head", branch,
    "--base", "main",
  ]);
  const prUrl = prRes.stdout.trim().split("\n").pop();
  return { opened: true, prUrl };
}

function parseArgs(argv: string[]) {
  let tag: string | undefined;
  let manifest: string | undefined;
  let sha: string | undefined;
  let dryRun = process.env.LOOM_DRY_RUN === "true";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tag") tag = argv[++i];
    else if (a === "--manifest") manifest = argv[++i];
    else if (a === "--sha") sha = argv[++i];
    else if (a === "--dry-run") dryRun = true;
  }
  return { tag, manifest, sha, dryRun };
}

function main() {
  const { tag, manifest, sha, dryRun } = parseArgs(process.argv.slice(2));
  if (!tag) throw new Error("--tag <vX.Y.Z> is required");
  if (!manifest) throw new Error("--manifest <path> is required");
  if (!sha) throw new Error("--sha <commit> is required");
  const marketplaceRepo = process.env.LOOM_MARKETPLACE_REPO ?? "launchstack-dev/loom-marketplace";
  const loomRepo = process.env.LOOM_REPO ?? "launchstack-dev/loom-ai";

  // Dry-run is implied by a `-test` tag suffix as well (workflow contract).
  const dr = dryRun || /-test$/.test(tag);

  const result = openMarketplacePr({
    tag,
    manifestPath: manifest,
    commitSha: sha,
    dryRun: dr,
    marketplaceRepo,
    loomRepo,
  });
  if (result.opened) {
    process.stdout.write(`opened: ${result.prUrl}\n`);
  } else {
    process.stdout.write(`skipped: ${result.reason}\n`);
  }
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
    process.stderr.write(`open-marketplace-pr: ${(err as Error).message}\n`);
    process.exit(1);
  }
}
