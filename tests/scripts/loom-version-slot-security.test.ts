/**
 * tests/scripts/loom-version-slot-security.test.ts
 *
 * F-04 (site 2) — command-injection hardening in scripts/loom-version-slot.ts.
 *
 * Attack surface: `branchExists()` receives branch names parsed from the
 * on-disk registry (~/.loom/version-slots.toon). Git refnames may legally
 * contain `;`, `$()`, and backticks, and the registry file itself is
 * plain-text writable, so these values are attacker-influenced. The old code
 * interpolated them into an `execSync` shell string; the fix passes them as
 * `execFileSync` argv elements (no shell).
 *
 * Proof strategy (subprocess-spawned, adversarial fixtures, no tautologies):
 *   1. Canary tests — seed the registry with branch names embedding shell
 *      metacharacters that would `touch` a canary file if a shell ever parsed
 *      them. After a real `scan` run, the canary MUST NOT exist.
 *   2. Argv-semantics test — create a REAL branch whose name contains `;`.
 *      Under shell interpolation the name would be split at `;` and the
 *      lookup would fail (row dropped); under argv the name is literal and
 *      the row is preserved. Old code fails this test; new code passes.
 *
 * The script is spawned with HOME pointed at a temp dir so the registry under
 * test is fully isolated from the developer's real ~/.loom.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "loom-version-slot.ts");

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 15_000 });
  if (r.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (${r.status}): ${r.stderr ?? ""}`,
    );
  }
  return (r.stdout ?? "").trim();
}

/** git init + identity + one commit so refs exist. */
function initRepo(dir: string, version: string): void {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "fixture@test.invalid");
  git(dir, "config", "user.name", "fixture");
  git(dir, "config", "commit.gpgsign", "false");
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: path.basename(dir), version }, null, 2),
  );
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
}

/** Spawn the real script as a subprocess with an isolated fake HOME. */
function runSlot(
  cwd: string,
  home: string,
  args: string[] = ["scan"],
): ReturnType<typeof spawnSync<string>> {
  return spawnSync("bun", [SCRIPT, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
    env: {
      ...process.env,
      HOME: home,
      // Force gh (if installed) to fail fast/anonymously in the fixture repo
      // rather than consult real credentials.
      GH_TOKEN: "",
      GITHUB_TOKEN: "",
    },
  });
}

/** Seed ~/.loom/version-slots.toon under the fake HOME. */
function seedRegistry(home: string, rows: string[]): string {
  const loomDir = path.join(home, ".loom");
  fs.mkdirSync(loomDir, { recursive: true });
  const registryPath = path.join(loomDir, "version-slots.toon");
  const body = [
    "# seeded by loom-version-slot-security.test.ts",
    "schemaVersion: 1",
    "",
    `updatedAt: 2026-01-01T00:00:00.000Z`,
    `slots[${rows.length}]{repo,version,branch,worktreePath,prNumber,prState,claimedAt,lastSeenAt}:`,
    ...rows.map((r) => `  ${r}`),
    "",
  ].join("\n");
  fs.writeFileSync(registryPath, body, "utf8");
  return registryPath;
}

function slotRow(repo: string, version: string, branch: string): string {
  return [
    repo,
    version,
    branch,
    "/nonexistent/worktree",
    "0",
    "none",
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:00:00.000Z",
  ].join(",");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("loom-version-slot — branch names from the registry never reach a shell", () => {
  let tmp: string;
  let home: string;
  let repoDir: string;
  let repoName: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loom-vslot-sec-"));
    home = path.join(tmp, "home");
    fs.mkdirSync(home, { recursive: true });
    // Repo lives one level down so its parent dir (scanned for sibling
    // worktrees) is empty and under our control.
    repoDir = path.join(tmp, "parent", "fixture-repo");
    initRepo(repoDir, "0.1.0");
    repoName = path.basename(repoDir);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("a registry branch name with $(...) does not execute (canary survives untouched)", () => {
    const canary = path.join(tmp, "canary-subst");
    seedRegistry(home, [
      slotRow(repoName, "1.0.0", `$(touch ${canary})`),
    ]);
    expect(fs.existsSync(canary)).toBe(false);

    const r = runSlot(repoDir, home);

    expect(r.status).toBe(0);
    // The injection payload MUST NOT have run.
    expect(fs.existsSync(canary)).toBe(false);
    // And the bogus branch doesn't exist, so its row is ejected as stale.
    const registry = fs.readFileSync(
      path.join(home, ".loom", "version-slots.toon"),
      "utf8",
    );
    expect(registry).not.toContain("$(touch");
  });

  it("a registry branch name with ; does not chain a second command (canary survives)", () => {
    const canary = path.join(tmp, "canary-semicolon");
    seedRegistry(home, [
      slotRow(repoName, "1.1.0", `x;touch ${canary}`),
      slotRow(repoName, "1.2.0", `y; touch ${canary}`),
    ]);

    const r = runSlot(repoDir, home);

    expect(r.status).toBe(0);
    expect(fs.existsSync(canary)).toBe(false);
  });

  it("a registry branch name with backticks does not execute (canary survives)", () => {
    const canary = path.join(tmp, "canary-backtick");
    seedRegistry(home, [
      slotRow(repoName, "1.3.0", "`touch " + canary + "`"),
    ]);

    const r = runSlot(repoDir, home);

    expect(r.status).toBe(0);
    expect(fs.existsSync(canary)).toBe(false);
  });

  it("a REAL branch legally named with ; is treated literally — row preserved (argv semantics)", () => {
    // `evil;name` is a valid git refname (no spaces, no forbidden chars).
    // Shell interpolation would split at `;`, look up `refs/heads/evil`
    // (missing) and drop the row. execFileSync argv looks up the literal
    // refname, finds it, and preserves the reservation.
    const branch = "evil;name";
    git(repoDir, "branch", branch);
    seedRegistry(home, [slotRow(repoName, "2.0.0", branch)]);

    const r = runSlot(repoDir, home);

    expect(r.status).toBe(0);
    const registry = fs.readFileSync(
      path.join(home, ".loom", "version-slots.toon"),
      "utf8",
    );
    // Row for the metacharacter branch survives because the ref genuinely
    // exists and was matched as a single literal argv element.
    expect(registry).toContain(`${repoName},2.0.0,${branch},`);
  });

  it("stale-row ejection still works for ordinary missing branches (behavior preserved)", () => {
    seedRegistry(home, [slotRow(repoName, "3.0.0", "gone-branch")]);

    const r = runSlot(repoDir, home);

    expect(r.status).toBe(0);
    const registry = fs.readFileSync(
      path.join(home, ".loom", "version-slots.toon"),
      "utf8",
    );
    expect(registry).not.toContain("gone-branch");
    expect(registry).toContain("slots[0]");
  });

  it("static analysis: the script never calls execSync (argv-only exec discipline)", () => {
    // Belt-and-braces: guard against a future edit reintroducing shell
    // interpolation anywhere in this file. execFileSync does not match
    // the /\bexecSync\b/ word boundary.
    const src = fs.readFileSync(SCRIPT, "utf8");
    expect(src).not.toMatch(/\bexecSync\b/);
    expect(src).toMatch(/\bexecFileSync\b/);
  });
});
