import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync, spawnSync } from "node:child_process";
import { LOOM_HOOKS } from "../../scripts/register-loom-hooks";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "register-loom-hooks.ts");

const TSX_RUNNER: [string, string[]] = (() => {
  try {
    execSync("bun --version", { stdio: "ignore" });
    // Bun executes TypeScript natively — skip the bunx tsx round-trip.
    return ["bun", []];
  } catch {
    return ["npx", ["--yes", "tsx"]];
  }
})();

// Derived from LOOM_HOOKS at import time — do NOT hardcode. Note 047:
// this list drifted twice during M-13 (once when 3 hooks were added,
// again when the test failed to reflect the manifest). Derivation
// keeps the test in lockstep with the manifest by construction.
const LOOM_HOOK_NAMES = Array.from(
  new Set(LOOM_HOOKS.map((e) => e.hookName))
);
const EXPECTED_CHANGES = LOOM_HOOKS.length;

let tmpDir: string;
let hooksRoot: string;
let settingsPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "register-loom-hooks-"));
  hooksRoot = path.join(tmpDir, "hooks");
  fs.mkdirSync(hooksRoot, { recursive: true });
  for (const name of LOOM_HOOK_NAMES) {
    fs.writeFileSync(path.join(hooksRoot, `${name}.ts`), "// stub\n", "utf-8");
  }
  // run-hook.sh stub satisfies the wrapper-runner existence check.
  fs.writeFileSync(path.join(hooksRoot, "run-hook.sh"), "#!/bin/sh\nexit 0\n", "utf-8");
  settingsPath = path.join(tmpDir, ".claude", "settings.json");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function runScript(args: string[]): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(TSX_RUNNER[0], [...TSX_RUNNER[1], SCRIPT, ...args], {
    encoding: "utf-8",
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function readSettings(): any {
  return JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
}

const baseArgs = () => [
  "--settings",
  settingsPath,
  "--hooks-root",
  hooksRoot,
  "--command-prefix",
  "bunx tsx ${CLAUDE_PLUGIN_ROOT}",
  "--json",
];

describe("scripts/register-loom-hooks.ts", () => {
  it("creates settings.json with a registration per LOOM_HOOKS entry (count derived, not hardcoded — note 047)", () => {
    const result = runScript(baseArgs());
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.ok).toBe(true);
    // Derived from LOOM_HOOKS at import time. context-monitor appears
    // twice by design (PostToolUse ambient telemetry + Stop end-of-session
    // snapshot) — LOOM_HOOKS.length counts both.
    expect(report.changes).toBe(EXPECTED_CHANGES);
    expect(report.settingsExisted).toBe(false);

    const settings = readSettings();
    expect(settings.hooks.PreToolUse.length).toBeGreaterThanOrEqual(5);
    expect(settings.hooks.PostToolUse.length).toBeGreaterThanOrEqual(5);
    expect(settings.hooks.Stop.length).toBe(2);
    expect(settings.hooks.SessionStart).toHaveLength(2);

    // Sanity: each hook name appears at least once in the rendered commands.
    const allCmds = JSON.stringify(settings.hooks);
    for (const name of LOOM_HOOK_NAMES) {
      expect(allCmds).toContain(`hooks/${name}.ts`);
    }
  });

  it("is idempotent on re-run: no duplicates when entries already present", () => {
    runScript(baseArgs());
    const second = runScript(baseArgs());
    expect(second.exitCode).toBe(0);
    const report = JSON.parse(second.stdout);
    expect(report.changes).toBe(0);
    expect(
      report.plan.every((p: any) => p.status === "skipped:already-present")
    ).toBe(true);
  });

  it("preserves pre-existing unrelated hook entries when merging", () => {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          permissions: { allow: ["Bash(git status:*)"] },
          hooks: {
            PreToolUse: [
              {
                matcher: "Write|Edit",
                hooks: [
                  {
                    type: "command",
                    command: "bunx tsx ~/Projects/other/hooks/typecheck.ts",
                    timeout: 5000,
                  },
                ],
              },
            ],
          },
        },
        null,
        2
      )
    );

    const result = runScript(baseArgs());
    expect(result.exitCode).toBe(0);

    const settings = readSettings();
    // Unrelated permissions untouched.
    expect(settings.permissions.allow).toEqual(["Bash(git status:*)"]);
    // Original typecheck entry preserved.
    const preCommands = settings.hooks.PreToolUse.flatMap((e: any) =>
      e.hooks.map((h: any) => h.command)
    );
    expect(preCommands).toContain("bunx tsx ~/Projects/other/hooks/typecheck.ts");
    // Loom hooks added.
    expect(preCommands.some((c: string) => c.includes("file-ownership.ts"))).toBe(true);
    expect(preCommands.some((c: string) => c.includes("contract-lock.ts"))).toBe(true);
  });

  it("--dry-run reports plan without writing settings.json", () => {
    const result = runScript([...baseArgs(), "--dry-run"]);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.dryRun).toBe(true);
    expect(report.plan.every((p: any) => p.status === "would-register")).toBe(true);
    expect(fs.existsSync(settingsPath)).toBe(false);
  });

  it("skips a hook when its source .ts file is missing", () => {
    fs.unlinkSync(path.join(hooksRoot, "deploy-guard.ts"));
    const result = runScript(baseArgs());
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    const dg = report.plan.find((p: any) => p.hookName === "deploy-guard");
    expect(dg.status).toBe("skipped:missing-source");
  });

  it("exits 1 when no hook source files exist", () => {
    fs.rmSync(hooksRoot, { recursive: true, force: true });
    fs.mkdirSync(hooksRoot);
    const result = runScript(baseArgs());
    expect(result.exitCode).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.ok).toBe(false);
  });

  describe("--replace", () => {
    it("purges stale Loom hook entries (any prefix) and re-registers fresh ones", () => {
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      fs.writeFileSync(
        settingsPath,
        JSON.stringify(
          {
            hooks: {
              PreToolUse: [
                // Unrelated — must survive
                {
                  matcher: "Write|Edit",
                  hooks: [
                    {
                      type: "command",
                      command: "bunx tsx ~/other/typecheck.ts",
                      timeout: 5000,
                    },
                  ],
                },
                // Stale Loom hook with wrong prefix — must be purged
                {
                  matcher: "Write|Edit",
                  hooks: [
                    {
                      type: "command",
                      command:
                        "bunx tsx ${CLAUDE_PLUGIN_ROOT}/hooks/file-ownership.ts",
                      timeout: 5000,
                    },
                  ],
                },
              ],
            },
          },
          null,
          2
        ),
        "utf-8"
      );

      const result = runScript([
        "--settings",
        settingsPath,
        "--hooks-root",
        hooksRoot,
        "--command-prefix",
        "bunx tsx",
        "--replace",
        "--json",
      ]);
      expect(result.exitCode).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.purged).toBeGreaterThanOrEqual(1);
      expect(report.changes).toBe(EXPECTED_CHANGES);

      const settings = readSettings();
      const preCommands = settings.hooks.PreToolUse.flatMap((e: any) =>
        e.hooks.map((h: any) => h.command)
      );
      // Unrelated survived.
      expect(preCommands).toContain("bunx tsx ~/other/typecheck.ts");
      // Stale CLAUDE_PLUGIN_ROOT version gone.
      expect(preCommands).not.toContain(
        "bunx tsx ${CLAUDE_PLUGIN_ROOT}/hooks/file-ownership.ts"
      );
      // Fresh project-anchored version present (explicit --command-prefix
      // overrides the default ${CLAUDE_PROJECT_DIR} anchoring, so this test
      // exercises the bare-path path that is reachable only via the override).
      expect(preCommands).toContain("bunx tsx hooks/file-ownership.ts");
    });

    it("--replace --dry-run reports purge count without writing", () => {
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      const original = JSON.stringify(
        {
          hooks: {
            PreToolUse: [
              {
                matcher: "Write|Edit",
                hooks: [
                  {
                    type: "command",
                    command:
                      "bunx tsx ${CLAUDE_PLUGIN_ROOT}/hooks/file-ownership.ts",
                    timeout: 5000,
                  },
                ],
              },
            ],
          },
        },
        null,
        2
      );
      fs.writeFileSync(settingsPath, original, "utf-8");

      const result = runScript([...baseArgs(), "--replace", "--dry-run"]);
      expect(result.exitCode).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.purged).toBeGreaterThanOrEqual(1);
      expect(report.dryRun).toBe(true);
      // File untouched.
      expect(fs.readFileSync(settingsPath, "utf-8")).toBe(original);
    });
  });

  describe("mode + runner", () => {
    it("--mode local emits ${CLAUDE_PROJECT_DIR}-anchored hooks/<name>.ts paths", () => {
      const result = runScript([
        "--settings",
        settingsPath,
        "--hooks-root",
        hooksRoot,
        "--mode",
        "local",
        "--runner",
        "bunx",
        "--json",
      ]);
      expect(result.exitCode).toBe(0);
      const settings = readSettings();
      const allCmds = JSON.stringify(settings.hooks);
      // Anchored, not bare — required so the persistent Bash shell can cd
      // into subdirs without breaking hook resolution (exit 127).
      expect(allCmds).toContain(
        "bunx tsx ${CLAUDE_PROJECT_DIR}/hooks/file-ownership.ts"
      );
      expect(allCmds).not.toContain("${CLAUDE_PLUGIN_ROOT}");
    });

    it("--mode plugin emits ${CLAUDE_PLUGIN_ROOT}/hooks/<name>.ts paths", () => {
      const result = runScript([
        "--settings",
        settingsPath,
        "--hooks-root",
        hooksRoot,
        "--mode",
        "plugin",
        "--runner",
        "bunx",
        "--json",
      ]);
      expect(result.exitCode).toBe(0);
      const settings = readSettings();
      const allCmds = JSON.stringify(settings.hooks);
      expect(allCmds).toContain(
        "bunx tsx ${CLAUDE_PLUGIN_ROOT}/hooks/file-ownership.ts"
      );
    });

    it("default --runner auto emits the run-hook.sh wrapper prefix (local mode)", () => {
      const result = runScript([
        "--settings",
        settingsPath,
        "--hooks-root",
        hooksRoot,
        "--mode",
        "local",
        "--json",
      ]);
      expect(result.exitCode).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.runner).toBe("wrapper");
      const settings = readSettings();
      const allCmds = JSON.stringify(settings.hooks);
      expect(allCmds).toContain(
        "sh ${CLAUDE_PROJECT_DIR}/hooks/run-hook.sh ${CLAUDE_PROJECT_DIR}/hooks/file-ownership.ts"
      );
      expect(allCmds).not.toContain("${CLAUDE_PLUGIN_ROOT}");
    });

    it("default --runner auto emits the run-hook.sh wrapper prefix (plugin mode)", () => {
      const result = runScript([
        "--settings",
        settingsPath,
        "--hooks-root",
        hooksRoot,
        "--mode",
        "plugin",
        "--json",
      ]);
      expect(result.exitCode).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.runner).toBe("wrapper");
      const settings = readSettings();
      const allCmds = JSON.stringify(settings.hooks);
      expect(allCmds).toContain(
        "sh ${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.sh ${CLAUDE_PLUGIN_ROOT}/hooks/file-ownership.ts"
      );
    });
  });
});
