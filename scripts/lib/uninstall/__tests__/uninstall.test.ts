/**
 * Unit tests for `scripts/lib/uninstall/index.ts` and
 * `scripts/lib/uninstall/confirm.ts`.
 *
 * All filesystem and time concerns are mocked. The 60-second timeout in
 * `confirmBase` is exercised via an injected `setTimeout` shim that fires
 * synchronously when its handle is triggered — no real waiting.
 */

import { describe, it, expect, vi } from "vitest";
import { PassThrough } from "node:stream";

import {
  buildPlan,
  renderPlan,
  executePlan,
  runUninstall,
  purgeLoomFromSettings,
  countLoomEntries,
  commandReferencesHook,
  LOOM_HOOK_NAMES,
  type FsLike,
  type OsLike,
} from "../index.js";
import { confirmBase, confirmTypedLiteral } from "../confirm.js";

// ---------------------------------------------------------------------------
// In-memory fs double
// ---------------------------------------------------------------------------

function makeFs(initial: Record<string, string>): FsLike & {
  files: Map<string, string>;
  removed: Set<string>;
} {
  const files = new Map<string, string>(Object.entries(initial));
  const removed = new Set<string>();
  const fs: FsLike & { files: Map<string, string>; removed: Set<string> } = {
    files,
    removed,
    existsSync: (p: string) => {
      if (files.has(p)) return true;
      // Also exists if any file lives under `p/`.
      for (const k of files.keys()) {
        if (k.startsWith(p + "/")) return true;
      }
      return false;
    },
    readFileSync: (p: string) => {
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT: ${p}`);
      return v;
    },
    writeFileSync: (p: string, data: string) => {
      files.set(p, data);
    },
    renameSync: (from: string, to: string) => {
      const v = files.get(from);
      if (v === undefined) throw new Error(`ENOENT: ${from}`);
      files.delete(from);
      files.set(to, v);
    },
    rmSync: (p: string) => {
      removed.add(p);
      for (const k of Array.from(files.keys())) {
        if (k === p || k.startsWith(p + "/")) files.delete(k);
      }
    },
    statSync: (p: string) => ({
      isDirectory: () => {
        if (!files.has(p)) return true;
        return false;
      },
    }),
  };
  return fs;
}

const os: OsLike = { homedir: () => "/home/u" };

// ---------------------------------------------------------------------------
// commandReferencesHook + countLoomEntries
// ---------------------------------------------------------------------------

describe("commandReferencesHook", () => {
  it("matches direct hooks/<name>.ts references", () => {
    expect(commandReferencesHook("bunx tsx hooks/file-ownership.ts", "file-ownership")).toBe(true);
    expect(commandReferencesHook("${CLAUDE_PLUGIN_ROOT}/hooks/contract-lock.ts", "contract-lock")).toBe(true);
    expect(commandReferencesHook("${CLAUDE_PROJECT_DIR}/hooks/quality-gate.ts arg", "quality-gate")).toBe(true);
  });
  it("rejects non-loom hooks and lookalikes", () => {
    expect(commandReferencesHook("my-hooks/file-ownership.ts", "file-ownership")).toBe(false);
    expect(commandReferencesHook("custom-hooks/contract-lock.ts", "contract-lock")).toBe(false);
    expect(commandReferencesHook("bunx tsx other.ts", "file-ownership")).toBe(false);
  });
});

describe("countLoomEntries", () => {
  it("returns 0 for missing/empty/unparseable files", () => {
    const fs = makeFs({});
    expect(countLoomEntries(fs, "/missing.json")).toBe(0);
    fs.writeFileSync("/empty.json", "");
    expect(countLoomEntries(fs, "/empty.json")).toBe(0);
    fs.writeFileSync("/bad.json", "{not json");
    expect(countLoomEntries(fs, "/bad.json")).toBe(0);
  });
  it("counts only loom-referencing hook entries", () => {
    const fs = makeFs({
      "/s.json": JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Write|Edit",
              hooks: [
                { type: "command", command: "bunx tsx hooks/file-ownership.ts" },
                { type: "command", command: "bunx tsx hooks/contract-lock.ts" },
                { type: "command", command: "bunx tsx my-hooks/unrelated.ts" },
              ],
            },
          ],
          PostToolUse: [
            { matcher: "", hooks: [{ command: "${CLAUDE_PLUGIN_ROOT}/hooks/context-monitor.ts" }] },
          ],
        },
      }),
    });
    expect(countLoomEntries(fs, "/s.json")).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// purgeLoomFromSettings
// ---------------------------------------------------------------------------

describe("purgeLoomFromSettings", () => {
  it("preserves unrelated entries and removes loom ones", () => {
    const settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Write|Edit",
            hooks: [
              { type: "command", command: "bunx tsx hooks/file-ownership.ts" },
              { type: "command", command: "bunx tsx my-hooks/keep-me.ts" },
            ],
          },
        ],
      },
      otherTopLevel: { keep: true },
    };
    const { cleaned, removed } = purgeLoomFromSettings(settings);
    expect(removed).toBe(1);
    expect(cleaned.hooks.PreToolUse[0].hooks).toHaveLength(1);
    expect(cleaned.hooks.PreToolUse[0].hooks[0].command).toContain("keep-me");
    expect(cleaned.otherTopLevel).toEqual({ keep: true });
  });
  it("drops the hooks key entirely when fully purged", () => {
    const settings = {
      hooks: {
        PreToolUse: [
          { matcher: "Write|Edit", hooks: [{ command: "hooks/file-ownership.ts" }] },
        ],
      },
    };
    const { cleaned, removed } = purgeLoomFromSettings(settings);
    expect(removed).toBe(1);
    expect(cleaned.hooks).toBeUndefined();
  });
  it("covers every LOOM_HOOK_NAMES entry", () => {
    expect(LOOM_HOOK_NAMES.length).toBeGreaterThan(10);
    for (const n of LOOM_HOOK_NAMES) {
      expect(commandReferencesHook(`hooks/${n}.ts`, n)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// buildPlan + renderPlan
// ---------------------------------------------------------------------------

describe("buildPlan", () => {
  it("respects LOOM_HOME env override", () => {
    const fs = makeFs({});
    const plan = buildPlan(
      { purgeProjectState: false },
      { fs, os, env: { LOOM_HOME: "/tmp/custom-loom" }, cwd: "/proj" }
    );
    expect(plan.loomHome).toBe("/tmp/custom-loom");
    expect(plan.pluginDir).toBe("/home/u/.claude/plugins/loom");
  });
  it("discovers loom entries in both settings tiers (tier-ambiguous)", () => {
    const loomEntry = JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: "Write|Edit",
            hooks: [{ command: "bunx tsx hooks/file-ownership.ts" }],
          },
        ],
      },
    });
    const fs = makeFs({
      "/proj/.claude/settings.json": loomEntry,
      "/proj/.claude/settings.local.json": loomEntry,
    });
    const plan = buildPlan(
      { purgeProjectState: false },
      { fs, os, env: {}, cwd: "/proj" }
    );
    expect(plan.settingsFiles).toHaveLength(2);
    expect(plan.settingsFiles.map((s) => s.path).sort()).toEqual([
      "/proj/.claude/settings.json",
      "/proj/.claude/settings.local.json",
    ]);
  });
});

describe("renderPlan", () => {
  it("renders both-tier list for ambiguous state", () => {
    const plan = buildPlan(
      { purgeProjectState: false },
      {
        fs: makeFs({
          "/proj/.claude/settings.json": JSON.stringify({
            hooks: { Stop: [{ matcher: "", hooks: [{ command: "hooks/quality-gate.ts" }] }] },
          }),
          "/proj/.claude/settings.local.json": JSON.stringify({
            hooks: { Stop: [{ matcher: "", hooks: [{ command: "hooks/quality-gate.ts" }] }] },
          }),
        }),
        os,
        env: {},
        cwd: "/proj",
      }
    );
    const out = renderPlan(plan);
    expect(out).toContain("BOTH settings tiers");
    expect(out).toContain("/proj/.claude/settings.json");
    expect(out).toContain("/proj/.claude/settings.local.json");
  });
  it("renders preserved-state section by default", () => {
    const plan = buildPlan(
      { purgeProjectState: false },
      { fs: makeFs({}), os, env: {}, cwd: "/proj" }
    );
    const out = renderPlan(plan);
    expect(out).toContain("Project state preserved");
    expect(out).not.toContain("--purge-project-state will ALSO");
  });
  it("renders purge-state section when requested", () => {
    const plan = buildPlan(
      { purgeProjectState: true },
      { fs: makeFs({}), os, env: {}, cwd: "/proj" }
    );
    const out = renderPlan(plan);
    expect(out).toContain("--purge-project-state will ALSO remove");
    expect(out).toContain("/proj/.loom/wiki");
    expect(out).toContain("/proj/orchestration.toml");
    expect(out).toContain("/proj/.plan-execution");
  });
});

// ---------------------------------------------------------------------------
// executePlan
// ---------------------------------------------------------------------------

describe("executePlan", () => {
  it("removes plugin dir and ~/.loom; purges settings", () => {
    const settingsContent = JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: "Write|Edit",
            hooks: [
              { command: "hooks/file-ownership.ts" },
              { command: "my-hooks/keep.ts" },
            ],
          },
        ],
      },
    });
    const fs = makeFs({
      "/home/u/.claude/plugins/loom/manifest.json": "{}",
      "/home/u/.loom/state.toon": "x",
      "/proj/.claude/settings.json": settingsContent,
    });
    const plan = buildPlan(
      { purgeProjectState: false },
      { fs, os, env: {}, cwd: "/proj" }
    );
    const result = executePlan(plan, { fs, os, env: {}, cwd: "/proj" });

    expect(result.removed.pluginDir).toBe(true);
    expect(result.removed.loomHome).toBe(true);
    expect(fs.removed.has("/home/u/.claude/plugins/loom")).toBe(true);
    expect(fs.removed.has("/home/u/.loom")).toBe(true);
    expect(result.removed.projectState).toBeUndefined();

    const purged = JSON.parse(fs.files.get("/proj/.claude/settings.json")!);
    expect(purged.hooks.PreToolUse[0].hooks).toHaveLength(1);
    expect(purged.hooks.PreToolUse[0].hooks[0].command).toContain("keep.ts");
  });

  it("removes project state only when purgeProjectState is set", () => {
    const fs = makeFs({
      "/proj/.loom/wiki/README.md": "x",
      "/proj/orchestration.toml": "x",
      "/proj/.plan-execution/state.toon": "x",
    });
    const plan = buildPlan(
      { purgeProjectState: true },
      { fs, os, env: {}, cwd: "/proj" }
    );
    const result = executePlan(plan, { fs, os, env: {}, cwd: "/proj" });
    expect(result.removed.projectState?.wikiDir).toBe(true);
    expect(result.removed.projectState?.orchestrationToml).toBe(true);
    expect(result.removed.projectState?.planExecutionDir).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// confirm helpers
// ---------------------------------------------------------------------------

function fakeScheduler() {
  let nextHandle = 1;
  const timeouts = new Map<number, () => void>();
  const intervals = new Map<number, () => void>();
  return {
    fireTimeout: (h: number) => {
      const cb = timeouts.get(h);
      if (cb) cb();
    },
    setTimeout: (cb: () => void) => {
      const h = nextHandle++;
      timeouts.set(h, cb);
      return h;
    },
    clearTimeout: (h: number) => {
      timeouts.delete(h);
    },
    setInterval: (cb: () => void) => {
      const h = nextHandle++;
      intervals.set(h, cb);
      return h;
    },
    clearInterval: (h: number) => {
      intervals.delete(h);
    },
  };
}

describe("confirmBase", () => {
  it("accepts 'y' + newline", async () => {
    const sched = fakeScheduler();
    const stdin = new PassThrough();
    const stderr = new PassThrough();
    const p = confirmBase({
      stdin,
      stderr,
      setTimeout: sched.setTimeout as any,
      clearTimeout: sched.clearTimeout as any,
      setInterval: sched.setInterval as any,
      clearInterval: sched.clearInterval as any,
    });
    stdin.write("y\n");
    expect(await p).toEqual({ accepted: true });
  });

  it("rejects any non-y input", async () => {
    const sched = fakeScheduler();
    const stdin = new PassThrough();
    const stderr = new PassThrough();
    const p = confirmBase({
      stdin,
      stderr,
      setTimeout: sched.setTimeout as any,
      clearTimeout: sched.clearTimeout as any,
      setInterval: sched.setInterval as any,
      clearInterval: sched.clearInterval as any,
    });
    stdin.write("yes\n");
    expect(await p).toEqual({ accepted: false, reason: "rejected" });
  });

  it("times out via injected scheduler", async () => {
    const sched = fakeScheduler();
    const stdin = new PassThrough();
    const stderr = new PassThrough();
    const p = confirmBase({
      stdin,
      stderr,
      setTimeout: sched.setTimeout as any,
      clearTimeout: sched.clearTimeout as any,
      setInterval: sched.setInterval as any,
      clearInterval: sched.clearInterval as any,
    });
    // Fire the timeout handle (handle 1 is the setTimeout in this test).
    // confirmBase registered the timeout AFTER the setInterval tick, so
    // handle 2 is the setTimeout. We probe both to find which is the
    // timeout — fire handle 2.
    sched.fireTimeout(2);
    expect(await p).toEqual({ accepted: false, reason: "timeout" });
  });
});

describe("confirmTypedLiteral", () => {
  it("accepts the exact literal", async () => {
    const stdin = new PassThrough();
    const p = confirmTypedLiteral("uninstall", { stdin });
    stdin.write("uninstall\n");
    expect(await p).toEqual({ accepted: true });
  });
  it("rejects case variants and substrings", async () => {
    const stdin = new PassThrough();
    const p = confirmTypedLiteral("uninstall", { stdin });
    stdin.write("Uninstall\n");
    expect(await p).toEqual({ accepted: false, reason: "rejected" });
  });
  it("rejects empty input", async () => {
    const stdin = new PassThrough();
    const p = confirmTypedLiteral("uninstall", { stdin });
    stdin.write("\n");
    expect(await p).toEqual({ accepted: false, reason: "rejected" });
  });
});

// ---------------------------------------------------------------------------
// runUninstall (orchestrator)
// ---------------------------------------------------------------------------

describe("runUninstall", () => {
  it("dry-run prints plan and exits 0 with no mutation", async () => {
    const fs = makeFs({
      "/home/u/.loom/state.toon": "x",
    });
    const stdout = new PassThrough();
    let captured = "";
    stdout.on("data", (c) => (captured += c.toString()));
    const outcome = await runUninstall(
      { purgeProjectState: false, dryRun: true, yes: false },
      { fs, os, env: {}, cwd: "/proj", stdout, stderr: new PassThrough() }
    );
    expect(outcome.exitCode).toBe(0);
    expect(outcome.kind).toBe("dry-run");
    expect(fs.removed.size).toBe(0);
    expect(captured).toContain("This will remove Loom");
  });

  it("--yes bypasses prompts and mutates", async () => {
    const fs = makeFs({
      "/home/u/.loom/state.toon": "x",
      "/home/u/.claude/plugins/loom/manifest.json": "{}",
    });
    const outcome = await runUninstall(
      { purgeProjectState: false, dryRun: false, yes: true },
      {
        fs,
        os,
        env: {},
        cwd: "/proj",
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      }
    );
    expect(outcome.exitCode).toBe(0);
    expect(outcome.kind).toBe("completed");
    expect(fs.removed.has("/home/u/.loom")).toBe(true);
    expect(fs.removed.has("/home/u/.claude/plugins/loom")).toBe(true);
  });

  it("--yes with --purge-project-state mutates project state too", async () => {
    const fs = makeFs({
      "/proj/.loom/wiki/README.md": "x",
      "/proj/orchestration.toml": "x",
      "/proj/.plan-execution/s.toon": "x",
    });
    const outcome = await runUninstall(
      { purgeProjectState: true, dryRun: false, yes: true },
      {
        fs,
        os,
        env: {},
        cwd: "/proj",
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      }
    );
    expect(outcome.exitCode).toBe(0);
    expect(fs.removed.has("/proj/.loom/wiki")).toBe(true);
    expect(fs.removed.has("/proj/orchestration.toml")).toBe(true);
    expect(fs.removed.has("/proj/.plan-execution")).toBe(true);
  });
});
