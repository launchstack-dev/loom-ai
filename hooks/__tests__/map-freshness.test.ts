/**
 * Map-freshness gate (roadmap C-08 / CT6 B3): fail-closed precondition on
 * planning artifacts when standing maps are stale; dormant when no maps
 * exist (D-M2-05 — Track B ships /loom-map separately).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";
import { runHook, parseDecision } from "./helpers/hook-runner.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-map-freshness-"));
  git("init", "-q");
  git("config", "user.email", "test@test");
  git("config", "user.name", "test");
  fs.writeFileSync(path.join(tmpDir, "README.md"), "seed\n", "utf-8");
  git("add", "-A");
  git("commit", "-qm", "seed");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: tmpDir, encoding: "utf-8" }).trim();
}

function head(): string {
  return git("rev-parse", "HEAD");
}

function writeMap(lastMappedCommit: string | null) {
  const mapsDir = path.join(tmpDir, ".loom", "wiki", "maps");
  fs.mkdirSync(mapsDir, { recursive: true });
  fs.writeFileSync(
    path.join(mapsDir, "codebase-map.toon"),
    (lastMappedCommit ? `lastMappedCommit: ${lastMappedCommit}\n` : "") +
      `generatedAt: 2026-07-09T00:00:00Z\ncomponents[0]:\n`,
    "utf-8"
  );
}

function touchFiles(n: number) {
  for (let i = 0; i < n; i += 1) {
    fs.writeFileSync(path.join(tmpDir, `file-${i}.txt`), String(i), "utf-8");
  }
  git("add", "-A");
  git("commit", "-qm", `touch ${n}`);
}

function planWrite() {
  return {
    tool_name: "Write",
    tool_input: { file_path: path.join(tmpDir, "planning", "plans", "PLAN-x.md") },
  };
}

describe("map-freshness hook", () => {
  it("is dormant when no maps exist", async () => {
    const result = await runHook("map-freshness.ts", planWrite(), { cwd: tmpDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("allows planning writes when maps are fresh (HEAD-mapped)", async () => {
    writeMap(head());
    const result = await runHook("map-freshness.ts", planWrite(), { cwd: tmpDir });
    expect(result.exitCode).toBe(0);
  });

  it("blocks planning writes when the map is stale past the threshold", async () => {
    writeMap(head());
    fs.mkdirSync(path.join(tmpDir, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".claude", "orchestration.toml"),
      `[wiki]\nmapFreshnessThreshold = 3\n`,
      "utf-8"
    );
    touchFiles(5); // 5 > 3
    const result = await runHook("map-freshness.ts", planWrite(), { cwd: tmpDir });
    expect(result.exitCode).toBe(2);
    const decision = parseDecision(result.stdout);
    expect(decision?.reason).toContain("codebase-map.toon");
    expect(decision?.reason).toContain("/loom-map");
  });

  it("fails closed when lastMappedCommit is missing or unknown", async () => {
    writeMap(null);
    const missing = await runHook("map-freshness.ts", planWrite(), { cwd: tmpDir });
    expect(missing.exitCode).toBe(2);

    writeMap("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
    const unknown = await runHook("map-freshness.ts", planWrite(), { cwd: tmpDir });
    expect(unknown.exitCode).toBe(2);
    expect(parseDecision(unknown.stdout)?.reason).toContain("unknown to git");
  });

  it("never gates non-planning writes, even with stale maps", async () => {
    writeMap(null); // maximally stale
    const result = await runHook(
      "map-freshness.ts",
      { tool_name: "Write", tool_input: { file_path: path.join(tmpDir, "src", "app.ts") } },
      { cwd: tmpDir }
    );
    expect(result.exitCode).toBe(0);
  });

  it("stays under the small-change threshold (default 25)", async () => {
    writeMap(head());
    touchFiles(4); // well under default 25
    const result = await runHook("map-freshness.ts", planWrite(), { cwd: tmpDir });
    expect(result.exitCode).toBe(0);
  });
});
