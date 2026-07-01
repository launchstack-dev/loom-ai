#!/usr/bin/env bunx tsx
/**
 * scripts/loom-worktree-scan.ts
 *
 * Cross-worktree ownership scanner for the M-09 Phase 10 F-01 preflight.
 *
 * What it does (advisory only — no enforcement):
 *   1. Enumerates sibling worktrees at `../*` relative to the current worktree
 *      and at `$HOME/.worktrees/*` (or the path configured in
 *      `.claude/orchestration.toml [worktree] rootPath`).
 *   2. For each sibling, derives an owned-glob set:
 *        - If the sibling has a PLAN.md with a "File Ownership" section, uses
 *          those globs.
 *        - Otherwise, falls back to `git diff --name-only base...HEAD` on the
 *          sibling's checkout (using `main` as the base if it exists,
 *          otherwise `origin/main`, otherwise the merge-base).
 *   3. Writes a lease row per sibling to `~/.loom/leases/{repo}.toon` per
 *      `protocols/worktree-lease.schema.toon`. Writes are atomic (.tmp + rename).
 *   4. Prints a TOON report of overlaps between the current worktree's
 *      ownership and each sibling's ownership.
 *
 * Subcommands:
 *   scan                 (default) — scan siblings, refresh lease file, print overlaps
 *   leases               — print the current lease file for this repo
 *   release <id>         — mark a lease `released`
 *   preflight            — same as `scan` but exit non-zero on any overlap
 *                          (used by the PreToolUse hook and CI)
 *
 * Contract: protocols/worktree-lease.schema.toon
 *
 * Exit codes:
 *   0 — clean scan (no overlaps) OR non-preflight subcommand
 *   0 — preflight with no overlaps
 *   1 — preflight with at least one overlap (advisory, but CI-visible)
 *
 * NOTE: This is the 80/20 first step. Full fan-in coordination (enforced
 * acquire/release, semantic AST pre-conflict scan, rebase-storm coordinator)
 * is documented as future work in skills/loom-worktree/SKILL.md.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

interface Lease {
  id: string;
  workspacePath: string;
  branch: string;
  ownedGlobs: string; // semicolon-separated
  claimedAt: string;
  expiresAt: string;
  status: "active" | "released" | "expired";
}

interface OverlapFinding {
  siblingId: string;
  siblingPath: string;
  siblingBranch: string;
  overlappingPaths: string[]; // current worktree paths matched by sibling globs
  confidence: number; // 1..10
  suggestedAction: string;
}

const HOME = process.env.HOME ?? os.homedir();
const LEASE_ROOT = path.join(HOME, ".loom", "leases");
const DEFAULT_TTL_DAYS = 14;

function sh(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function isGitWorktree(p: string): boolean {
  try {
    const s = fs.statSync(path.join(p, ".git"));
    return s.isDirectory() || s.isFile();
  } catch {
    return false;
  }
}

function currentBranch(cwd: string): string {
  return sh("git rev-parse --abbrev-ref HEAD", cwd) || "HEAD";
}

function repoBasename(cwd: string): string {
  // Prefer the toplevel of the primary worktree (git common dir parent).
  const top = sh("git rev-parse --show-toplevel", cwd);
  if (!top) return path.basename(cwd);
  // If this is a worktree, the primary repo is elsewhere; walk up if we can.
  const common = sh("git rev-parse --git-common-dir", cwd);
  if (common && common !== ".git") {
    // common is typically /path/to/repo/.git; parent is repo root.
    const abs = path.isAbsolute(common) ? common : path.resolve(cwd, common);
    return path.basename(path.dirname(abs));
  }
  return path.basename(top);
}

function baseBranch(cwd: string): string {
  for (const cand of ["main", "master", "origin/main", "origin/master"]) {
    if (sh(`git rev-parse --verify --quiet ${cand}`, cwd)) return cand;
  }
  return "";
}

/**
 * Read PLAN.md and extract "File Ownership" globs. Returns [] if no PLAN.md
 * or no such section.
 */
function readPlanOwnership(cwd: string): string[] {
  const candidates = [
    "PLAN.md",
    "planning/PLAN.md",
    ...safeGlob(cwd, "planning/plans/PLAN-*.md"),
  ];
  const globs = new Set<string>();
  for (const rel of candidates) {
    const p = path.join(cwd, rel);
    if (!fileExists(p)) continue;
    const txt = fs.readFileSync(p, "utf-8");
    // Match lines like "File Ownership: a, b, c". We ignore bulleted narrative
    // lists to keep the signal high — a glob is only accepted if it looks like
    // a plausible file path (no spaces, no backticks, no parens, and either
    // contains "/" or "*" or ends in a common extension).
    const inline = txt.match(/File Ownership:\s*(.+)/gi);
    if (inline) {
      for (const line of inline) {
        const parts = line.replace(/File Ownership:\s*/i, "").split(/[,;]/);
        for (const part of parts) {
          const g = part.trim().replace(/^`|`$/g, "");
          if (looksLikeGlob(g)) globs.add(g);
        }
      }
    }
  }
  return [...globs];
}

/**
 * Return true when the given fragment looks like a plausible file glob.
 * Filters out narrative prose that leaks from bulleted PLAN.md sections.
 */
export function looksLikeGlob(s: string): boolean {
  if (!s) return false;
  if (s.length > 200) return false;
  if (/[\s()<>"'`|]/.test(s)) return false;
  if (s.startsWith("#") || s.startsWith("*") || s.startsWith("-")) return false;
  // Must have a path-like character OR a common source extension.
  if (s.includes("/") || s.includes("*")) return true;
  return /\.(ts|tsx|js|jsx|md|toon|json|yaml|yml|sh|py|rs|go|css|html|schema)$/i.test(s);
}

function safeGlob(cwd: string, pattern: string): string[] {
  // Tiny glob for `dir/PLAN-*.md` only — no shelling out.
  const [dir, filePat] = [path.dirname(pattern), path.basename(pattern)];
  const abs = path.join(cwd, dir);
  if (!fileExists(abs)) return [];
  const rx = new RegExp("^" + filePat.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
  try {
    return fs.readdirSync(abs).filter((f) => rx.test(f)).map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function fileExists(p: string): boolean {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Derive owned paths from git diff. Returns file paths (not globs).
 */
function derivedFromDiff(cwd: string): string[] {
  const base = baseBranch(cwd);
  if (!base) return [];
  const out = sh(`git diff --name-only ${base}...HEAD`, cwd);
  if (!out) return [];
  return out.split(/\r?\n/).filter(Boolean);
}

function enumerateSiblings(cwd: string): string[] {
  const siblings = new Set<string>();

  // 1. `../` — siblings of the current worktree.
  const parent = path.dirname(cwd);
  if (fileExists(parent)) {
    for (const name of readdirSafe(parent)) {
      const p = path.join(parent, name);
      if (p === cwd) continue;
      if (isGitWorktree(p)) siblings.add(p);
    }
  }

  // 2. `$HOME/.worktrees/*` and configured rootPath.
  const roots = [path.join(HOME, ".worktrees"), configuredRootPath(cwd)].filter(
    (r): r is string => !!r
  );
  for (const root of roots) {
    if (!fileExists(root)) continue;
    for (const name of readdirSafe(root)) {
      const p = path.join(root, name);
      if (p === cwd) continue;
      if (isGitWorktree(p)) siblings.add(p);
    }
  }

  return [...siblings];
}

function readdirSafe(p: string): string[] {
  try {
    return fs.readdirSync(p);
  } catch {
    return [];
  }
}

function configuredRootPath(cwd: string): string | undefined {
  const cfg = path.join(cwd, ".claude", "orchestration.toml");
  if (!fileExists(cfg)) return;
  try {
    const txt = fs.readFileSync(cfg, "utf-8");
    // naive TOML scrape: [worktree]\nrootPath = "..."
    const m = txt.match(/\[worktree\][\s\S]*?rootPath\s*=\s*"([^"]+)"/);
    if (m) return expandHome(m[1]);
  } catch {
    /* ignore */
  }
}

function expandHome(p: string): string {
  return p.startsWith("~") ? path.join(HOME, p.slice(1)) : p;
}

function ownershipFor(cwd: string): string[] {
  const planGlobs = readPlanOwnership(cwd);
  if (planGlobs.length > 0) return planGlobs;
  return derivedFromDiff(cwd);
}

/**
 * Glob-match — supports `*` and `**` only.
 */
function matches(glob: string, filepath: string): boolean {
  const rx = new RegExp(
    "^" +
      glob
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "§§DOUBLESTAR§§")
        .replace(/\*/g, "[^/]*")
        .replace(/§§DOUBLESTAR§§/g, ".*") +
      "$"
  );
  return rx.test(filepath);
}

function computeOverlap(currentPaths: string[], siblingGlobs: string[]): string[] {
  const hits: string[] = [];
  for (const p of currentPaths) {
    for (const g of siblingGlobs) {
      if (matches(g, p) || matches(g + "/**", p) || p === g) {
        hits.push(p);
        break;
      }
    }
  }
  return hits;
}

function toIso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function buildLease(worktreePath: string, repoName: string): Lease {
  const branch = currentBranch(worktreePath);
  const globs = ownershipFor(worktreePath);
  const now = new Date();
  const exp = new Date(now.getTime() + DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000);
  return {
    id: `${repoName}:${branch}`,
    workspacePath: worktreePath,
    branch,
    ownedGlobs: globs.join(";"),
    claimedAt: toIso(now),
    expiresAt: toIso(exp),
    status: "active",
  };
}

function leaseFileFor(repoName: string): string {
  return path.join(LEASE_ROOT, `${repoName}.toon`);
}

function ensureLeaseDir(): void {
  fs.mkdirSync(LEASE_ROOT, { recursive: true });
}

function readLeases(repoName: string): Lease[] {
  const p = leaseFileFor(repoName);
  if (!fileExists(p)) return [];
  const txt = fs.readFileSync(p, "utf-8");
  return parseLeasesToon(txt);
}

function parseLeasesToon(txt: string): Lease[] {
  const lines = txt.split(/\r?\n/);
  const out: Lease[] = [];
  let inBlock = false;
  for (const line of lines) {
    if (/^leases\[/.test(line)) {
      inBlock = true;
      continue;
    }
    if (!inBlock) continue;
    if (!/^\s{2,}\S/.test(line)) {
      if (line.trim() === "") continue;
      inBlock = false;
      continue;
    }
    const cells = splitCsv(line.trim());
    if (cells.length < 7) continue;
    const [id, workspacePath, branch, ownedGlobs, claimedAt, expiresAt, status] = cells;
    out.push({
      id,
      workspacePath,
      branch,
      ownedGlobs,
      claimedAt,
      expiresAt,
      status: (status as Lease["status"]) ?? "active",
    });
  }
  return out;
}

function splitCsv(row: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (const ch of row) {
    if (ch === '"') {
      inQ = !inQ;
      continue;
    }
    if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0 || row.endsWith(",")) out.push(cur);
  return out.map((s) => s.trim());
}

function writeLeases(repoName: string, leases: Lease[]): void {
  ensureLeaseDir();
  const p = leaseFileFor(repoName);
  const tmp = `${p}.tmp`;
  const rows = leases
    .map(
      (l) =>
        `  ${l.id},${l.workspacePath},${l.branch},${l.ownedGlobs},${l.claimedAt},${l.expiresAt},${l.status}`
    )
    .join("\n");
  const body =
    `schemaVersion: 1\n` +
    `# Written by scripts/loom-worktree-scan.ts. Advisory only.\n` +
    `# Contract: protocols/worktree-lease.schema.toon\n\n` +
    `leases[${leases.length}]{id,workspacePath,branch,ownedGlobs,claimedAt,expiresAt,status}:\n` +
    (rows ? rows + "\n" : "");
  fs.writeFileSync(tmp, body, "utf-8");
  fs.renameSync(tmp, p);
}

function mergeLease(prior: Lease[], next: Lease): Lease[] {
  const now = new Date();
  const carried: Lease[] = [];
  for (const l of prior) {
    if (l.id === next.id) continue; // will be replaced
    // Auto-expire stale leases.
    if (l.status === "active" && new Date(l.expiresAt) < now) {
      carried.push({ ...l, status: "expired" });
    } else {
      carried.push(l);
    }
  }
  carried.push(next);
  return carried;
}

function scan(cwd: string, preflight: boolean): number {
  const repoName = repoBasename(cwd);
  const currentBranchName = currentBranch(cwd);
  const currentPaths = ownershipFor(cwd);

  const siblings = enumerateSiblings(cwd);
  const findings: OverlapFinding[] = [];
  const leases = readLeases(repoName);
  let merged: Lease[] = leases;

  // Refresh our own lease.
  const selfLease = buildLease(cwd, repoName);
  merged = mergeLease(merged, selfLease);

  for (const sib of siblings) {
    const sibRepo = repoBasename(sib);
    if (sibRepo !== repoName) continue; // only siblings of the same repo
    const sibLease = buildLease(sib, repoName);
    merged = mergeLease(merged, sibLease);

    if (sibLease.branch === currentBranchName) continue;

    const sibGlobs = sibLease.ownedGlobs.split(";").filter(Boolean);
    const overlap = computeOverlap(currentPaths, sibGlobs);
    if (overlap.length === 0) continue;

    // Confidence heuristic:
    //   base 6, +2 if sibling had a PLAN.md, +1 per overlapping path (cap 10).
    const hadPlan = readPlanOwnership(sib).length > 0;
    let conf = 6 + (hadPlan ? 2 : 0) + Math.min(overlap.length, 2);
    if (conf > 10) conf = 10;
    findings.push({
      siblingId: sibLease.id,
      siblingPath: sib,
      siblingBranch: sibLease.branch,
      overlappingPaths: overlap,
      confidence: conf,
      suggestedAction: "Run rebase-from-main and re-verify before merging",
    });
  }

  writeLeases(repoName, merged);
  printReport(repoName, currentBranchName, findings);

  if (preflight && findings.length > 0) return 1;
  return 0;
}

function printReport(repoName: string, branch: string, findings: OverlapFinding[]): void {
  process.stdout.write(`# loom-worktree scan report\n`);
  process.stdout.write(`repo: ${repoName}\n`);
  process.stdout.write(`branch: ${branch}\n`);
  process.stdout.write(`overlapCount: ${findings.length}\n`);
  process.stdout.write(
    `\nfindings[${findings.length}]{siblingId,siblingBranch,overlappingPaths,confidence,suggestedAction}:\n`
  );
  for (const f of findings) {
    process.stdout.write(
      `  ${f.siblingId},${f.siblingBranch},${f.overlappingPaths.join(";")},${f.confidence},"${f.suggestedAction}"\n`
    );
  }
}

function leasesSubcommand(cwd: string): number {
  const repoName = repoBasename(cwd);
  const p = leaseFileFor(repoName);
  if (!fileExists(p)) {
    process.stdout.write(`# no lease file yet at ${p}\n`);
    process.stdout.write(`# run: bunx tsx scripts/loom-worktree-scan.ts scan\n`);
    return 0;
  }
  process.stdout.write(fs.readFileSync(p, "utf-8"));
  return 0;
}

function releaseSubcommand(cwd: string, id: string | undefined): number {
  if (!id) {
    process.stderr.write("usage: loom-worktree-scan release <lease-id>\n");
    return 1;
  }
  const repoName = repoBasename(cwd);
  const leases = readLeases(repoName);
  let changed = false;
  const next: Lease[] = leases.map((l) => {
    if (l.id === id && l.status !== "released") {
      changed = true;
      return { ...l, status: "released" as const };
    }
    return l;
  });
  if (!changed) {
    process.stderr.write(`no active lease found with id '${id}'\n`);
    return 1;
  }
  writeLeases(repoName, next);
  process.stdout.write(`released: ${id}\n`);
  return 0;
}

function main(argv: string[]): void {
  const sub = argv[0] ?? "scan";
  const cwd = process.cwd();
  let code = 0;
  switch (sub) {
    case "scan":
      code = scan(cwd, false);
      break;
    case "preflight":
      code = scan(cwd, true);
      break;
    case "leases":
      code = leasesSubcommand(cwd);
      break;
    case "release":
      code = releaseSubcommand(cwd, argv[1]);
      break;
    case "-h":
    case "--help":
    case "help":
      process.stdout.write(
        "loom-worktree-scan — cross-worktree ownership preflight (advisory)\n\n" +
          "usage:\n" +
          "  scan          Refresh lease registry and print overlaps (exit 0)\n" +
          "  preflight     Same as scan, but exit 1 on any overlap\n" +
          "  leases        Print the lease file for this repo\n" +
          "  release <id>  Mark a lease as released\n"
      );
      code = 0;
      break;
    default:
      process.stderr.write(`unknown subcommand: ${sub}\n`);
      code = 2;
  }
  process.exit(code);
}

// Only run when invoked as a script.
if (typeof require !== "undefined" && require.main === module) {
  main(process.argv.slice(2));
}

export {
  buildLease,
  computeOverlap,
  enumerateSiblings,
  matches,
  mergeLease,
  parseLeasesToon,
  readPlanOwnership,
  scan,
};
