import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync, spawnSync } from "node:child_process";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "register-wiki-hooks.ts");

const TSX_RUNNER: [string, string[]] = (() => {
  try {
    execSync("bun --version", { stdio: "ignore" });
    return ["bunx", ["tsx"]];
  } catch {
    return ["npx", ["--yes", "tsx"]];
  }
})();

let tmpDir: string;
let hooksRoot: string;
let settingsPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "register-wiki-hooks-"));
  // Build a fake hooks dir with all three .ts source files present.
  hooksRoot = path.join(tmpDir, "hooks");
  fs.mkdirSync(hooksRoot, { recursive: true });
  for (const name of [
    "wiki-session-status",
    "wiki-impact-warner",
    "wiki-commit-ledger",
  ]) {
    fs.writeFileSync(path.join(hooksRoot, `${name}.ts`), "// stub\n", "utf-8");
  }
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

describe("scripts/register-wiki-hooks.ts", () => {
  it("creates settings.json with all three hook entries when file is absent", () => {
    const result = runScript(baseArgs());
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.ok).toBe(true);
    expect(report.changes).toBe(3);
    expect(report.settingsExisted).toBe(false);

    const settings = readSettings();
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.PreToolUse).toHaveLength(1);
    expect(settings.hooks.PostToolUse).toHaveLength(1);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain(
      "wiki-session-status.ts"
    );
    expect(settings.hooks.PreToolUse[0].matcher).toBe("Write|Edit");
    expect(settings.hooks.PostToolUse[0].matcher).toBe("Bash");
  });

  it("is idempotent on re-run: no duplicates when entries already present", () => {
    runScript(baseArgs());
    const second = runScript(baseArgs());
    expect(second.exitCode).toBe(0);
    const report = JSON.parse(second.stdout);
    expect(report.changes).toBe(0);
    expect(report.plan.every((p: any) => p.status === "skipped:already-present")).toBe(
      true
    );
    const settings = readSettings();
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.PreToolUse).toHaveLength(1);
    expect(settings.hooks.PostToolUse).toHaveLength(1);
  });

  it("preserves pre-existing unrelated hook entries when merging", () => {
    // Pre-seed settings.json with an unrelated PreToolUse entry.
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
    // Original permissions untouched.
    expect(settings.permissions.allow).toEqual(["Bash(git status:*)"]);
    // Original typecheck PreToolUse entry preserved.
    const preToolUse = settings.hooks.PreToolUse;
    expect(preToolUse).toHaveLength(2);
    expect(preToolUse[0].hooks[0].command).toContain("typecheck.ts");
    // New wiki-impact-warner entry appended.
    expect(preToolUse[1].hooks[0].command).toContain("wiki-impact-warner.ts");
    // Other events added cleanly.
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.PostToolUse).toHaveLength(1);
  });

  it("skips a hook when its source .ts file is missing (per-hook guard)", () => {
    // Remove wiki-commit-ledger.ts; expect the other two to register and ledger
    // to be skipped with reason missing-source.
    fs.unlinkSync(path.join(hooksRoot, "wiki-commit-ledger.ts"));

    const result = runScript(baseArgs());
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.changes).toBe(2);

    const ledgerPlan = report.plan.find(
      (p: any) => p.hookName === "wiki-commit-ledger"
    );
    expect(ledgerPlan.status).toBe("skipped:missing-source");

    const settings = readSettings();
    expect(settings.hooks.PostToolUse ?? []).toHaveLength(0);
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.PreToolUse).toHaveLength(1);
  });

  it("exits 1 when no wiki hook source files exist at all", () => {
    fs.rmSync(hooksRoot, { recursive: true, force: true });
    fs.mkdirSync(hooksRoot);

    const result = runScript(baseArgs());
    expect(result.exitCode).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.ok).toBe(false);
    expect(report.error).toContain("No wiki hook source files");
    expect(fs.existsSync(settingsPath)).toBe(false);
  });

  it("--dry-run reports plan without writing settings.json", () => {
    const result = runScript([...baseArgs(), "--dry-run"]);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.dryRun).toBe(true);
    expect(report.plan.every((p: any) => p.status === "would-register")).toBe(true);
    expect(fs.existsSync(settingsPath)).toBe(false);
  });

  it("exits 1 with informative error when settings.json is unparseable", () => {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, "{ not-json", "utf-8");

    const result = runScript(baseArgs());
    expect(result.exitCode).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.ok).toBe(false);
    expect(report.error).toContain("Cannot parse");
    // Settings file untouched.
    expect(fs.readFileSync(settingsPath, "utf-8")).toBe("{ not-json");
  });

  describe("mode + runner detection", () => {
    // Pin --runner to bunx for determinism (real users get detection at register
    // time; tests need a stable expected value across machines with/without bun).
    const modeArgs = (mode?: string, runner = "bunx") => {
      const args = [
        "--settings", settingsPath,
        "--hooks-root", hooksRoot,
        "--runner", runner,
        "--json",
      ];
      if (mode) args.push("--mode", mode);
      return args;
    };

    it("--mode plugin uses ${CLAUDE_PLUGIN_ROOT}/hooks/<name>.ts paths", () => {
      const result = runScript(modeArgs("plugin"));
      expect(result.exitCode).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.mode).toBe("plugin");
      expect(report.runner).toBe("bunx");
      expect(report.commandPrefix).toBe("bunx tsx ${CLAUDE_PLUGIN_ROOT}");

      const settings = readSettings();
      expect(settings.hooks.SessionStart[0].hooks[0].command).toBe(
        "bunx tsx ${CLAUDE_PLUGIN_ROOT}/hooks/wiki-session-status.ts"
      );
    });

    it("--mode local uses project-relative `hooks/<name>.ts` paths (no leading slash)", () => {
      const result = runScript(modeArgs("local"));
      expect(result.exitCode).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.mode).toBe("local");
      expect(report.commandPrefix).toBe("bunx tsx");

      const settings = readSettings();
      // local mode emits relative paths so settings.json is portable across clones.
      expect(settings.hooks.SessionStart[0].hooks[0].command).toBe(
        "bunx tsx hooks/wiki-session-status.ts"
      );
      expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe(
        "bunx tsx hooks/wiki-impact-warner.ts"
      );
      expect(settings.hooks.PostToolUse[0].hooks[0].command).toBe(
        "bunx tsx hooks/wiki-commit-ledger.ts"
      );
    });

    it("--runner npx emits `npx --yes tsx` prefix so unattended invocations don't prompt", () => {
      const result = runScript(modeArgs("local", "npx"));
      expect(result.exitCode).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.runner).toBe("npx");
      expect(report.commandPrefix).toBe("npx --yes tsx");

      const settings = readSettings();
      expect(settings.hooks.SessionStart[0].hooks[0].command).toBe(
        "npx --yes tsx hooks/wiki-session-status.ts"
      );
    });

    it("--mode auto picks 'local' when settings file lives in a loom dev checkout", () => {
      // Simulate loom-checkout shape: project root has both hooks/wiki-session-status.ts
      // AND scripts/register-wiki-hooks.ts.
      const projectRoot = path.dirname(path.dirname(settingsPath));
      fs.mkdirSync(path.join(projectRoot, "scripts"), { recursive: true });
      fs.writeFileSync(
        path.join(projectRoot, "scripts", "register-wiki-hooks.ts"),
        "// stub\n"
      );
      // hooksRoot already has wiki-session-status.ts. But auto-detect looks at the
      // PROJECT root, not --hooks-root. So copy stubs there too.
      fs.mkdirSync(path.join(projectRoot, "hooks"), { recursive: true });
      fs.writeFileSync(
        path.join(projectRoot, "hooks", "wiki-session-status.ts"),
        "// stub\n"
      );

      const result = runScript(modeArgs("auto"));
      expect(result.exitCode).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.mode).toBe("local");
    });

    it("--mode auto picks 'plugin' when settings file lives outside a loom dev checkout", () => {
      // tmpDir has no hooks/ or scripts/ at project root — only hooksRoot under
      // tmpDir/hooks (which IS the project root in this test, so auto-detect
      // would falsely flip to local). Use a sibling project dir instead.
      const otherProject = fs.mkdtempSync(path.join(os.tmpdir(), "rwh-plugin-"));
      try {
        const otherSettings = path.join(otherProject, ".claude", "settings.json");
        const result = runScript([
          "--settings",
          otherSettings,
          "--hooks-root",
          hooksRoot,
          "--mode",
          "auto",
          "--runner",
          "bunx",
          "--json",
        ]);
        expect(result.exitCode).toBe(0);
        const report = JSON.parse(result.stdout);
        expect(report.mode).toBe("plugin");
      } finally {
        fs.rmSync(otherProject, { recursive: true, force: true });
      }
    });
  });

  describe("--replace", () => {
    it("removes stale wiki hook entries with any prefix before registering new ones", () => {
      // Seed settings.json with broken entries using ${CLAUDE_PLUGIN_ROOT} (the
      // wrong prefix for a dev checkout).
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      fs.writeFileSync(
        settingsPath,
        JSON.stringify({
          hooks: {
            SessionStart: [
              {
                hooks: [
                  {
                    type: "command",
                    command: "bunx tsx ${CLAUDE_PLUGIN_ROOT}/hooks/wiki-session-status.ts",
                    timeout: 5000,
                  },
                ],
              },
            ],
            PreToolUse: [
              // unrelated entry — must survive
              {
                matcher: "Write|Edit",
                hooks: [
                  { type: "command", command: "bunx tsx ~/other/hooks/typecheck.ts", timeout: 5000 },
                ],
              },
              // stale wiki entry — must be purged
              {
                matcher: "Write|Edit",
                hooks: [
                  {
                    type: "command",
                    command: "bunx tsx ${CLAUDE_PLUGIN_ROOT}/hooks/wiki-impact-warner.ts",
                    timeout: 3000,
                  },
                ],
              },
            ],
          },
        }, null, 2),
        "utf-8"
      );

      const result = runScript([
        ...baseArgs().slice(0, -1), // drop --json briefly to swap prefix
        "--command-prefix",
        "bunx tsx",
        "--replace",
        "--json",
      ]);
      expect(result.exitCode).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.purged).toBe(2);
      expect(report.changes).toBe(3);

      const settings = readSettings();
      // Unrelated PreToolUse entry preserved.
      expect(settings.hooks.PreToolUse).toContainEqual(
        expect.objectContaining({ matcher: "Write|Edit" })
      );
      const preCommands = settings.hooks.PreToolUse.flatMap((e: any) =>
        e.hooks.map((h: any) => h.command)
      );
      expect(preCommands).toContain("bunx tsx ~/other/hooks/typecheck.ts");
      expect(preCommands).toContain("bunx tsx hooks/wiki-impact-warner.ts");
      // Old ${CLAUDE_PLUGIN_ROOT} version is gone.
      expect(preCommands).not.toContain(
        "bunx tsx ${CLAUDE_PLUGIN_ROOT}/hooks/wiki-impact-warner.ts"
      );
      // SessionStart was replaced cleanly.
      expect(settings.hooks.SessionStart).toHaveLength(1);
      expect(settings.hooks.SessionStart[0].hooks[0].command).toBe(
        "bunx tsx hooks/wiki-session-status.ts"
      );
    });

    it("--replace --dry-run reports purge count without writing", () => {
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      const original = JSON.stringify({
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "command",
                  command: "bunx tsx ${CLAUDE_PLUGIN_ROOT}/hooks/wiki-session-status.ts",
                  timeout: 5000,
                },
              ],
            },
          ],
        },
      }, null, 2);
      fs.writeFileSync(settingsPath, original, "utf-8");

      const result = runScript([...baseArgs(), "--replace", "--dry-run"]);
      expect(result.exitCode).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.purged).toBe(1);
      expect(report.dryRun).toBe(true);
      // File untouched.
      expect(fs.readFileSync(settingsPath, "utf-8")).toBe(original);
    });
  });
});
