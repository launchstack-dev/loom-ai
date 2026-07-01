#!/usr/bin/env bunx tsx
/**
 * scripts/loom-version-slot.ts
 *
 * VERSION-slot reservation runtime for M-10 F-30 (/loom-ship).
 *
 * What it does:
 *   1. Reads ~/.loom/version-slots.toon (creates on first run).
 *   2. Refreshes the "seen" set by scanning:
 *        - sibling worktrees at ../*  and $HOME/.worktrees/*
 *          (extracts the version claimed in each worktree's package.json /
 *           pyproject.toml / Cargo.toml / VERSION file)
 *        - open PRs via `gh pr list --state open --json number,headRefName,files`
 *          (best-effort — silently skipped if gh is missing or unauthenticated).
 *   3. Ejects stale rows (branch gone AND no open PR).
 *   4. Prints the next-free slot as TOON.
 *
 * Subcommands:
 *   scan                  (default) refresh registry, print all live slots
 *   next [--bump patch|minor|major]  print next-free slot given current version
 *   reserve <version>     add a reservation row for the current repo + branch
 *   release <version>     drop the reservation row for current repo + branch + version
 *
 * Contract: protocols/version-slot.schema.toon
 *
 * Exit codes:
 *   0 — success
 *   1 — arg error, or reserve/next collision that requires human input
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

interface Slot {
  repo: string;
  version: string;
  branch: string;
  worktreePath: string;
  prNumber: number;
  prState: "open" | "draft" | "closed" | "merged" | "none";
  claimedAt: string;
  lastSeenAt: string;
}

const REGISTRY_DIR = path.join(os.homedir(), ".loom");
const REGISTRY_PATH = path.join(REGISTRY_DIR, "version-slots.toon");
const SCHEMA_VERSION = 1;

function nowIso(): string {
  return new Date().toISOString();
}

function safeExec(cmd: string, cwd?: string): string {
  try {
    return execSync(cmd, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      cwd,
    }).trim();
  } catch {
    return "";
  }
}

function currentRepo(): string {
  const top = safeExec("git rev-parse --show-toplevel");
  return top ? path.basename(top) : path.basename(process.cwd());
}

function currentBranch(cwd?: string): string {
  return safeExec("git branch --show-current", cwd);
}

function readVersionFromWorktree(worktreePath: string): string {
  // Try package.json first
  const pkg = path.join(worktreePath, "package.json");
  if (fs.existsSync(pkg)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(pkg, "utf8"));
      if (typeof parsed.version === "string") return parsed.version;
    } catch {}
  }
  const pyproject = path.join(worktreePath, "pyproject.toml");
  if (fs.existsSync(pyproject)) {
    const raw = fs.readFileSync(pyproject, "utf8");
    const m = raw.match(/^\s*version\s*=\s*"([^"]+)"/m);
    if (m) return m[1];
  }
  const cargo = path.join(worktreePath, "Cargo.toml");
  if (fs.existsSync(cargo)) {
    const raw = fs.readFileSync(cargo, "utf8");
    const m = raw.match(/^\s*version\s*=\s*"([^"]+)"/m);
    if (m) return m[1];
  }
  const versionFile = path.join(worktreePath, "VERSION");
  if (fs.existsSync(versionFile)) {
    return fs.readFileSync(versionFile, "utf8").trim();
  }
  return "";
}

function enumerateSiblingWorktrees(): string[] {
  const out: string[] = [];
  const cwd = process.cwd();
  const parent = path.dirname(cwd);
  for (const dir of [parent, path.join(os.homedir(), ".worktrees")]) {
    if (!fs.existsSync(dir)) continue;
    try {
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (!fs.statSync(full).isDirectory()) continue;
        if (full === cwd) continue;
        if (fs.existsSync(path.join(full, ".git"))) out.push(full);
      }
    } catch {}
  }
  return out;
}

interface PrRow {
  number: number;
  headRefName: string;
  state: string;
  isDraft: boolean;
}

function fetchOpenPrs(): PrRow[] {
  const raw = safeExec(
    "gh pr list --state open --json number,headRefName,state,isDraft --limit 200",
  );
  if (!raw) return [];
  try {
    return JSON.parse(raw) as PrRow[];
  } catch {
    return [];
  }
}

function branchExists(branch: string): boolean {
  if (!branch) return false;
  const out = safeExec(`git rev-parse --verify --quiet refs/heads/${branch}`);
  return out !== "";
}

// TOON parse/emit — minimal, tailored to this schema.
function parseRegistry(): { updatedAt: string; slots: Slot[] } {
  if (!fs.existsSync(REGISTRY_PATH)) {
    return { updatedAt: nowIso(), slots: [] };
  }
  const raw = fs.readFileSync(REGISTRY_PATH, "utf8");
  const lines = raw.split(/\r?\n/);
  let updatedAt = nowIso();
  const slots: Slot[] = [];
  let inTable = false;
  for (const line of lines) {
    if (line.startsWith("updatedAt:")) {
      updatedAt = line.slice("updatedAt:".length).trim();
      continue;
    }
    if (line.startsWith("slots[")) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (!line.startsWith("  ")) continue;
    const row = line.trim();
    if (!row || row.startsWith("#")) continue;
    const cols = row.split(",");
    if (cols.length < 8) continue;
    slots.push({
      repo: cols[0],
      version: cols[1],
      branch: cols[2],
      worktreePath: cols[3],
      prNumber: Number(cols[4]) || 0,
      prState: (cols[5] as Slot["prState"]) || "none",
      claimedAt: cols[6],
      lastSeenAt: cols[7],
    });
  }
  return { updatedAt, slots };
}

function emitRegistry(reg: { updatedAt: string; slots: Slot[] }): string {
  const header = [
    "# ~/.loom/version-slots.toon — see protocols/version-slot.schema.toon",
    `schemaVersion: ${SCHEMA_VERSION}`,
    "",
    `updatedAt: ${reg.updatedAt}`,
    `slots[${reg.slots.length}]{repo,version,branch,worktreePath,prNumber,prState,claimedAt,lastSeenAt}:`,
  ];
  const rows = reg.slots.map((s) =>
    [
      "  ",
      [
        s.repo,
        s.version,
        s.branch,
        s.worktreePath,
        String(s.prNumber),
        s.prState,
        s.claimedAt,
        s.lastSeenAt,
      ].join(","),
    ].join(""),
  );
  return [...header, ...rows, ""].join("\n");
}

function writeAtomic(target: string, content: string) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, target);
}

function refresh(reg: { updatedAt: string; slots: Slot[] }): {
  updatedAt: string;
  slots: Slot[];
} {
  const repo = currentRepo();
  const now = nowIso();
  const seen = new Map<string, Slot>(); // key repo|version
  // Bring forward siblings.
  for (const wt of enumerateSiblingWorktrees()) {
    const v = readVersionFromWorktree(wt);
    if (!v) continue;
    const branch = currentBranch(wt);
    if (!branch) continue;
    const key = `${repo}|${v}`;
    seen.set(key, {
      repo,
      version: v,
      branch,
      worktreePath: wt,
      prNumber: 0,
      prState: "none",
      claimedAt: now,
      lastSeenAt: now,
    });
  }
  // Layer PR data.
  for (const pr of fetchOpenPrs()) {
    // We only know branch, not version, from PR. Try to match by branch.
    for (const [key, slot] of seen) {
      if (slot.branch === pr.headRefName) {
        slot.prNumber = pr.number;
        slot.prState = pr.isDraft ? "draft" : "open";
        seen.set(key, slot);
      }
    }
  }
  // Preserve rows whose branch still exists (even if no worktree scanned it this run).
  for (const s of reg.slots) {
    const key = `${s.repo}|${s.version}`;
    if (seen.has(key)) continue;
    if (branchExists(s.branch)) {
      seen.set(key, { ...s, lastSeenAt: now });
    }
    // else: drop stale row
  }
  return { updatedAt: now, slots: [...seen.values()] };
}

function parseSemver(v: string): [number, number, number] | null {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function bump(v: string, kind: "patch" | "minor" | "major"): string {
  const p = parseSemver(v);
  if (!p) return v;
  let [maj, min, pat] = p;
  if (kind === "patch") pat += 1;
  else if (kind === "minor") {
    min += 1;
    pat = 0;
  } else if (kind === "major") {
    maj += 1;
    min = 0;
    pat = 0;
  }
  return `${maj}.${min}.${pat}`;
}

function currentVersion(): string {
  return readVersionFromWorktree(process.cwd()) || "0.0.0";
}

function isClaimed(reg: { slots: Slot[] }, repo: string, v: string): boolean {
  return reg.slots.some((s) => s.repo === repo && s.version === v);
}

function nextFree(
  reg: { slots: Slot[] },
  repo: string,
  from: string,
  kind: "patch" | "minor" | "major",
): string {
  let candidate = bump(from, kind);
  let guard = 0;
  while (isClaimed(reg, repo, candidate) && guard < 1000) {
    candidate = bump(candidate, "patch");
    guard += 1;
  }
  return candidate;
}

function emitToonReport(obj: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    lines.push(`${k}: ${v}`);
  }
  return lines.join("\n");
}

function main() {
  const [, , subcmd = "scan", ...rest] = process.argv;
  const reg = refresh(parseRegistry());
  writeAtomic(REGISTRY_PATH, emitRegistry(reg));

  if (subcmd === "scan") {
    process.stdout.write(emitRegistry(reg));
    return;
  }
  const repo = currentRepo();
  if (subcmd === "next") {
    let kind: "patch" | "minor" | "major" = "patch";
    const bumpIdx = rest.indexOf("--bump");
    if (bumpIdx >= 0 && rest[bumpIdx + 1]) {
      const k = rest[bumpIdx + 1];
      if (k === "patch" || k === "minor" || k === "major") kind = k;
    }
    const from = currentVersion();
    const slot = nextFree(reg, repo, from, kind);
    process.stdout.write(
      emitToonReport({
        repo,
        fromVersion: from,
        bump: kind,
        nextFreeSlot: slot,
      }) + "\n",
    );
    return;
  }
  if (subcmd === "reserve") {
    const v = rest[0];
    if (!v) {
      process.stderr.write("reserve: version arg required\n");
      process.exit(1);
    }
    if (isClaimed(reg, repo, v)) {
      process.stderr.write(`reserve: ${repo}@${v} already claimed\n`);
      process.exit(1);
    }
    const now = nowIso();
    reg.slots.push({
      repo,
      version: v,
      branch: currentBranch() || "unknown",
      worktreePath: process.cwd(),
      prNumber: 0,
      prState: "none",
      claimedAt: now,
      lastSeenAt: now,
    });
    reg.updatedAt = now;
    writeAtomic(REGISTRY_PATH, emitRegistry(reg));
    process.stdout.write(
      emitToonReport({ status: "reserved", repo, version: v }) + "\n",
    );
    return;
  }
  if (subcmd === "release") {
    const v = rest[0];
    if (!v) {
      process.stderr.write("release: version arg required\n");
      process.exit(1);
    }
    const before = reg.slots.length;
    reg.slots = reg.slots.filter(
      (s) => !(s.repo === repo && s.version === v),
    );
    reg.updatedAt = nowIso();
    writeAtomic(REGISTRY_PATH, emitRegistry(reg));
    process.stdout.write(
      emitToonReport({
        status: "released",
        repo,
        version: v,
        removed: before - reg.slots.length,
      }) + "\n",
    );
    return;
  }
  process.stderr.write(`unknown subcommand: ${subcmd}\n`);
  process.exit(1);
}

main();
