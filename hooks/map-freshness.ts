/**
 * Hook: map-freshness (PreToolUse — Write/Edit) — roadmap C-08 / CT6 B3.
 * Core layer: fail-closed precondition on planning/convergence artifacts when
 * standing codebase maps are stale past a touched-file threshold.
 *
 * DORMANT-UNTIL-MAPS-EXIST (D-M2-05): `.loom/wiki/maps/*.toon` don't ship
 * until Track B lands `/loom-map`; with no maps present this hook allows
 * everything (absence != stale). The gate is built and tested now so it
 * activates the day maps exist.
 *
 * Staleness: each map records `lastMappedCommit: <sha>`. If more than
 * `[wiki].mapFreshnessThreshold` files (default 25) changed between that
 * commit and HEAD — or the recorded commit is unknown to git — the map is
 * stale and writes to planning entry points are blocked with the remedy.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { runHook, allow, block } from "./lib/run-hook.js";
import { hookActive } from "./lib/discipline.js";

const DEFAULT_THRESHOLD = 25;

/** Canonicalize the deepest existing ancestor (macOS /var → /private/var). */
function canonicalize(p: string): string {
  let abs = path.resolve(p);
  try {
    let current = abs;
    let tail = "";
    while (!fs.existsSync(current) && current !== path.dirname(current)) {
      tail = tail ? path.join(path.basename(current), tail) : path.basename(current);
      current = path.dirname(current);
    }
    if (fs.existsSync(current)) {
      abs = tail ? path.join(fs.realpathSync(current), tail) : fs.realpathSync(current);
    }
  } catch {
    // fall back to path.resolve
  }
  return abs;
}

/** Planning/convergence entry-point artifacts this gate protects. */
export function isPlanningArtifact(absPath: string, root: string): boolean {
  const rel = path.relative(canonicalize(root), canonicalize(absPath));
  if (rel.startsWith("..")) return false;
  return (
    /^planning\/plans\/[^/]+\.md$/.test(rel) ||
    rel === "PLAN.md" ||
    /(^|\/)converge\.config$/.test(rel)
  );
}

function readThreshold(root: string): number {
  try {
    const content = fs.readFileSync(
      path.join(root, ".claude", "orchestration.toml"),
      "utf-8"
    );
    const section = content.match(/\[wiki\]([\s\S]*?)(?=\n\s*\[|\s*$)/);
    const m = section?.[1].match(/mapFreshnessThreshold\s*=\s*(\d+)/);
    return m ? parseInt(m[1], 10) : DEFAULT_THRESHOLD;
  } catch {
    return DEFAULT_THRESHOLD;
  }
}

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd: root, timeout: 10000, encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

export interface StaleMap {
  map: string;
  reason: string;
}

/** Check every map under .loom/wiki/maps/. Returns stale maps (fail-closed on unknown commits). */
export function findStaleMaps(root: string, threshold: number): StaleMap[] {
  const mapsDir = path.join(root, ".loom", "wiki", "maps");
  let entries: string[];
  try {
    entries = fs.readdirSync(mapsDir).filter((f) => f.endsWith(".toon"));
  } catch {
    return []; // no maps — dormant
  }
  const stale: StaleMap[] = [];
  for (const file of entries) {
    let content: string;
    try {
      content = fs.readFileSync(path.join(mapsDir, file), "utf-8");
    } catch {
      continue;
    }
    const m = content.match(/^lastMappedCommit:\s*([0-9a-f]{7,40})\s*$/m);
    if (!m) {
      stale.push({ map: file, reason: "no lastMappedCommit recorded (invalidated)" });
      continue;
    }
    const touched = git(root, ["diff", "--name-only", `${m[1]}..HEAD`]);
    if (touched === null) {
      stale.push({ map: file, reason: `lastMappedCommit ${m[1].slice(0, 12)} unknown to git` });
      continue;
    }
    const count = touched ? touched.split("\n").filter(Boolean).length : 0;
    if (count > threshold) {
      stale.push({
        map: file,
        reason: `${count} files changed since lastMappedCommit ${m[1].slice(0, 12)} (> ${threshold})`,
      });
    }
  }
  return stale;
}

runHook("map-freshness", async (input) => {
  const filePath: string | undefined = input.tool_input?.file_path;
  if (!filePath) return allow();
  if (!hookActive("map-freshness")) return allow();

  const root = process.cwd();
  if (!isPlanningArtifact(path.resolve(filePath), root)) return allow();

  // Only meaningful inside a git repo with maps present.
  if (git(root, ["rev-parse", "HEAD"]) === null) return allow();

  const stale = findStaleMaps(root, readThreshold(root));
  if (stale.length === 0) return allow();

  return block(
    `Codebase maps are stale — planning against them risks plausible-but-ungrounded plans (C-08):\n` +
      stale.map((s) => `  - ${s.map}: ${s.reason}`).join("\n") +
      `\nRun /loom-map to refresh the maps (or update lastMappedCommit after a manual re-map), then retry.`
  );
});
// e2e: distribution guard exercised 2026-07-09 (see scripts/check-install-manifest-drift.sh)
