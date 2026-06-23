/**
 * Integration tests for the --tier flag in scripts/register-loom-hooks.ts.
 *
 * Invokes the script in a sandboxed tmp cwd so settings file mutation is
 * fully isolated. Uses --dry-run + --json wherever possible to observe
 * decisions without writing files, and uses real writes only for the cases
 * that need to verify which file got created.
 *
 * Spawns `bunx tsx <script>` when bun is available, falling back to
 * `npx --yes tsx`. Per repo convention (CLAUDE.md): prefer bun.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "register-loom-hooks.ts");
const HOOKS_ROOT = path.join(REPO_ROOT, "hooks");

function pickRunner(): { cmd: string; baseArgs: string[] } {
  // bunx preferred. If bun is missing, fall back to npx tsx.
  const bun = spawnSync("bun", ["--version"], { stdio: "ignore" });
  if (bun.status === 0) return { cmd: "bunx", baseArgs: ["tsx"] };
  return { cmd: "npx", baseArgs: ["--yes", "tsx"] };
}

const RUNNER = pickRunner();

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  json: any | undefined;
}

function runScript(cwd: string, args: string[]): RunResult {
  const r = spawnSync(
    RUNNER.cmd,
    [...RUNNER.baseArgs, SCRIPT, "--hooks-root", HOOKS_ROOT, ...args],
    {
      cwd,
      encoding: "utf-8",
      // Inherit env so PATH / NPM are intact; explicitly drop CLAUDE_*
      // anchors that could leak from the host harness.
      env: {
        ...process.env,
        CLAUDE_PLUGIN_ROOT: undefined as unknown as string,
        CLAUDE_PROJECT_DIR: undefined as unknown as string,
      },
    }
  );
  let parsed: any | undefined;
  if (args.includes("--json")) {
    try {
      parsed = JSON.parse(r.stdout.trim().split("\n").pop() ?? "");
    } catch {
      parsed = undefined;
    }
  }
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    json: parsed,
  };
}

let tmp: string;

beforeEach(() => {
  // realpathSync resolves macOS /var → /private/var so equality checks
  // against the subprocess-reported path don't fail on symlink-prefix drift.
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tier-test-")));
  fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Seed a settings file with one fake Loom hook entry so it gets detected. */
function seedLoomEntry(file: string, hookName = "file-ownership"): void {
  const content = {
    hooks: {
      PreToolUse: [
        {
          matcher: "Write|Edit",
          hooks: [
            {
              type: "command",
              command: `bunx tsx \${CLAUDE_PROJECT_DIR}/hooks/${hookName}.ts`,
              timeout: 10000,
            },
          ],
        },
      ],
    },
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(content, null, 2), "utf-8");
}

describe("register-loom-hooks --tier — default behavior", () => {
  it("default invocation writes to .claude/settings.local.json (greenfield)", () => {
    const r = runScript(tmp, ["--json"]);
    expect(r.status).toBe(0);
    expect(r.json?.ok).toBe(true);
    expect(r.json?.settingsPath).toBe(path.join(tmp, ".claude", "settings.local.json"));
    expect(r.json?.tier).toBe("local");
    expect(r.json?.tierReason).toBe("default-local");
    // Verify file actually got created at local tier.
    expect(fs.existsSync(path.join(tmp, ".claude", "settings.local.json"))).toBe(true);
    // And settings.json was NOT touched.
    expect(fs.existsSync(path.join(tmp, ".claude", "settings.json"))).toBe(false);
  });

  it("--tier auto with no prior entries → local (default-local)", () => {
    const r = runScript(tmp, ["--tier", "auto", "--dry-run", "--json"]);
    expect(r.status).toBe(0);
    expect(r.json?.tier).toBe("local");
    expect(r.json?.tierReason).toBe("default-local");
  });
});

describe("register-loom-hooks --tier project — opt-in to committed tier", () => {
  it("--tier project writes to .claude/settings.json", () => {
    const r = runScript(tmp, ["--tier", "project", "--json"]);
    expect(r.status).toBe(0);
    expect(r.json?.tier).toBe("project");
    expect(r.json?.tierReason).toBe("explicit");
    expect(r.json?.settingsPath).toBe(path.join(tmp, ".claude", "settings.json"));
    expect(fs.existsSync(path.join(tmp, ".claude", "settings.json"))).toBe(true);
  });

  it("--tier project emits a git-commit notice on stderr", () => {
    const r = runScript(tmp, ["--tier", "project", "--dry-run"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/will be committed to git/i);
    expect(r.stderr).toMatch(/\.claude\/settings\.json/);
  });

  it("--tier local does NOT emit the git-commit notice", () => {
    const r = runScript(tmp, ["--tier", "local", "--dry-run"]);
    expect(r.status).toBe(0);
    expect(r.stderr).not.toMatch(/committed to git/i);
  });
});

describe("register-loom-hooks --tier auto — preservation", () => {
  it("preserves project tier when settings.json already has Loom entries", () => {
    seedLoomEntry(path.join(tmp, ".claude", "settings.json"));
    const r = runScript(tmp, ["--tier", "auto", "--dry-run", "--json"]);
    expect(r.status).toBe(0);
    expect(r.json?.tier).toBe("project");
    expect(r.json?.tierReason).toBe("preserve");
  });

  it("preserves local tier when settings.local.json already has Loom entries", () => {
    seedLoomEntry(path.join(tmp, ".claude", "settings.local.json"));
    const r = runScript(tmp, ["--tier", "auto", "--dry-run", "--json"]);
    expect(r.status).toBe(0);
    expect(r.json?.tier).toBe("local");
    expect(r.json?.tierReason).toBe("preserve");
  });
});

describe("register-loom-hooks — MIGRATION_TIER_AMBIGUOUS conflict", () => {
  it("refuses to write when both tiers have Loom entries (no --tier flag)", () => {
    seedLoomEntry(path.join(tmp, ".claude", "settings.json"));
    seedLoomEntry(path.join(tmp, ".claude", "settings.local.json"));
    const r = runScript(tmp, ["--json"]);
    expect(r.status).toBe(2);
    expect(r.json?.ok).toBe(false);
    expect(r.json?.error).toBe("MIGRATION_TIER_AMBIGUOUS");
    expect(r.json?.existingTiers).toEqual(["local", "project"]);
  });

  it("conflict message names both existing tiers on stderr (no --json)", () => {
    seedLoomEntry(path.join(tmp, ".claude", "settings.json"));
    seedLoomEntry(path.join(tmp, ".claude", "settings.local.json"));
    const r = runScript(tmp, []);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/MIGRATION_TIER_AMBIGUOUS/);
    expect(r.stderr).toMatch(/--tier/);
  });

  it("explicit --tier local bypasses the conflict check", () => {
    seedLoomEntry(path.join(tmp, ".claude", "settings.json"));
    seedLoomEntry(path.join(tmp, ".claude", "settings.local.json"));
    const r = runScript(tmp, ["--tier", "local", "--dry-run", "--json"]);
    expect(r.status).toBe(0);
    expect(r.json?.tier).toBe("local");
  });

  it("explicit --tier project bypasses the conflict check", () => {
    seedLoomEntry(path.join(tmp, ".claude", "settings.json"));
    seedLoomEntry(path.join(tmp, ".claude", "settings.local.json"));
    const r = runScript(tmp, ["--tier", "project", "--dry-run", "--json"]);
    expect(r.status).toBe(0);
    expect(r.json?.tier).toBe("project");
  });
});

describe("register-loom-hooks — --settings bypasses tier resolution", () => {
  it("explicit --settings <path> writes there regardless of tier signals", () => {
    seedLoomEntry(path.join(tmp, ".claude", "settings.json"));
    seedLoomEntry(path.join(tmp, ".claude", "settings.local.json"));
    const custom = path.join(tmp, "custom.json");
    const r = runScript(tmp, ["--settings", custom, "--dry-run", "--json"]);
    // The ambiguous-both-tiers state should NOT block us when --settings
    // was explicit: the user pointed at a specific file.
    expect(r.status).toBe(0);
    expect(r.json?.settingsPath).toBe(custom);
    expect(r.json?.tier).toBeNull();
  });
});

describe("register-loom-hooks — loom-migration SessionStart entry", () => {
  it("registers loom-migration as a SessionStart hook", () => {
    const r = runScript(tmp, ["--tier", "local", "--json"]);
    expect(r.status).toBe(0);
    const settings = JSON.parse(
      fs.readFileSync(path.join(tmp, ".claude", "settings.local.json"), "utf-8")
    );
    const sessionStart = settings.hooks?.SessionStart ?? [];
    const found = sessionStart.some((entry: any) =>
      (entry.hooks ?? []).some((h: any) =>
        String(h.command ?? "").includes("hooks/loom-migration.ts")
      )
    );
    expect(found).toBe(true);
  });
});
