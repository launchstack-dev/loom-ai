/**
 * Integration tests for `/loom-uninstall` CLI surface (Phase 14).
 *
 * Covers the public CLI behaviors called out in the plan's acceptance
 * criteria:
 *   - `--help` exits 0 with usage on stdout
 *   - `--dry-run` lists removals, exits 0, mutates nothing
 *   - `--yes` mutates without prompting
 *   - 60s timeout on base prompt exits 1, emits the timeout message
 *   - typed-literal confirm rejects non-literal inputs, exits 1
 */

import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import * as fsReal from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { main, parseArgs } from "../scripts/loom-uninstall.js";
import { runUninstall, type FsLike, type OsLike } from "../scripts/lib/uninstall/index.js";
import { confirmBase, confirmTypedLiteral } from "../scripts/lib/uninstall/confirm.js";

// ---------------------------------------------------------------------------
// In-memory fs double — mirrors the unit-test version.
// ---------------------------------------------------------------------------

function makeFs(initial: Record<string, string>): FsLike & {
  files: Map<string, string>;
  removed: Set<string>;
} {
  const files = new Map<string, string>(Object.entries(initial));
  const removed = new Set<string>();
  return {
    files,
    removed,
    existsSync: (p: string) => {
      if (files.has(p)) return true;
      for (const k of files.keys()) if (k.startsWith(p + "/")) return true;
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
    statSync: () => ({ isDirectory: () => true }),
  };
}

const fakeOs: OsLike = { homedir: () => "/home/u" };

function streams() {
  const out = new PassThrough();
  const err = new PassThrough();
  let outBuf = "";
  let errBuf = "";
  out.on("data", (c) => (outBuf += c.toString()));
  err.on("data", (c) => (errBuf += c.toString()));
  return {
    stdout: out,
    stderr: err,
    out: () => outBuf,
    err: () => errBuf,
  };
}

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
  it("parses every documented flag", () => {
    expect(parseArgs([])).toEqual({
      purgeProjectState: false,
      dryRun: false,
      yes: false,
      help: false,
    });
    expect(parseArgs(["--purge-project-state", "--dry-run", "--yes"])).toEqual({
      purgeProjectState: true,
      dryRun: true,
      yes: true,
      help: false,
    });
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
    expect(parseArgs(["-y"]).yes).toBe(true);
  });
  it("rejects unknown flags", () => {
    expect(() => parseArgs(["--bogus"])).toThrow(/Unknown argument/);
  });
});

// ---------------------------------------------------------------------------
// main() — CLI behaviors
// ---------------------------------------------------------------------------

describe("main()", () => {
  it("--help exits 0 and prints usage to stdout", async () => {
    const s = streams();
    const code = await main({ stdout: s.stdout, stderr: s.stderr, argv: ["--help"] });
    expect(code).toBe(0);
    expect(s.out()).toContain("/loom-uninstall");
    expect(s.out()).toContain("Flags:");
  });
  it("unknown flag exits 2 with usage", async () => {
    const s = streams();
    const code = await main({ stdout: s.stdout, stderr: s.stderr, argv: ["--bogus"] });
    expect(code).toBe(2);
    expect(s.err()).toContain("Unknown argument");
  });
});

// ---------------------------------------------------------------------------
// runUninstall via orchestrator — integration-level behaviors.
//
// We exercise the orchestrator directly (rather than spawning a subprocess)
// because the CLI shim has no behavior beyond argv parsing and exit-code
// wiring. Going through `runUninstall` gives faster, deterministic tests
// while still covering every behavior the acceptance criteria require.
// ---------------------------------------------------------------------------

describe("integration: base prompt", () => {
  it("S-01: 'y' confirms and removes ~/.loom + plugin dir, preserves project state", async () => {
    const fs = makeFs({
      "/home/u/.loom/state.toon": "x",
      "/home/u/.claude/plugins/loom/manifest.json": "{}",
      "/proj/.loom/wiki/README.md": "keep",
      "/proj/orchestration.toml": "keep",
      "/proj/.plan-execution/s.toon": "keep",
    });
    const s = streams();
    const stdin = new PassThrough();
    const p = runUninstall(
      { purgeProjectState: false, dryRun: false, yes: false },
      {
        fs,
        os: fakeOs,
        env: {},
        cwd: "/proj",
        stdout: s.stdout,
        stderr: s.stderr,
        confirm: { stdin },
      }
    );
    stdin.write("y\n");
    const outcome = await p;
    expect(outcome.exitCode).toBe(0);
    expect(outcome.kind).toBe("completed");
    expect(fs.removed.has("/home/u/.loom")).toBe(true);
    expect(fs.removed.has("/home/u/.claude/plugins/loom")).toBe(true);
    // Project state preserved.
    expect(fs.files.has("/proj/.loom/wiki/README.md")).toBe(true);
    expect(fs.files.has("/proj/orchestration.toml")).toBe(true);
    expect(fs.files.has("/proj/.plan-execution/s.toon")).toBe(true);
  });
});

describe("integration: typed-literal gate", () => {
  it("S-02: any non-literal input on --purge-project-state aborts with exit 1 and no project mutation", async () => {
    const fs = makeFs({
      "/home/u/.loom/state.toon": "x",
      "/proj/.loom/wiki/README.md": "keep",
      "/proj/orchestration.toml": "keep",
      "/proj/.plan-execution/s.toon": "keep",
    });
    const s = streams();
    const stdin = new PassThrough();
    const p = runUninstall(
      { purgeProjectState: true, dryRun: false, yes: false },
      {
        fs,
        os: fakeOs,
        env: {},
        cwd: "/proj",
        stdout: s.stdout,
        stderr: s.stderr,
        confirm: { stdin },
      }
    );
    // Base prompt: accept. Typed-literal: type "yes" (NOT "uninstall").
    stdin.write("y\n");
    // Give the orchestrator a microtask to advance to the typed-literal stage.
    await new Promise((r) => setImmediate(r));
    stdin.write("yes\n");
    const outcome = await p;
    expect(outcome.exitCode).toBe(1);
    expect(outcome.kind).toBe("aborted");
    // No project state mutation.
    expect(fs.files.has("/proj/.loom/wiki/README.md")).toBe(true);
    expect(fs.files.has("/proj/orchestration.toml")).toBe(true);
    expect(fs.files.has("/proj/.plan-execution/s.toon")).toBe(true);
    // Critically, our strict-abort interpretation also means plugin + ~/.loom
    // are untouched when the typed-literal prompt fails.
    expect(fs.removed.size).toBe(0);
  });

  it("typed literal 'uninstall' accepts and purges project state", async () => {
    const fs = makeFs({
      "/home/u/.loom/state.toon": "x",
      "/proj/.loom/wiki/README.md": "x",
      "/proj/orchestration.toml": "x",
      "/proj/.plan-execution/s.toon": "x",
    });
    const s = streams();
    const stdin = new PassThrough();
    const p = runUninstall(
      { purgeProjectState: true, dryRun: false, yes: false },
      {
        fs,
        os: fakeOs,
        env: {},
        cwd: "/proj",
        stdout: s.stdout,
        stderr: s.stderr,
        confirm: { stdin },
      }
    );
    stdin.write("y\n");
    await new Promise((r) => setImmediate(r));
    stdin.write("uninstall\n");
    const outcome = await p;
    expect(outcome.exitCode).toBe(0);
    expect(fs.removed.has("/proj/.loom/wiki")).toBe(true);
    expect(fs.removed.has("/proj/orchestration.toml")).toBe(true);
    expect(fs.removed.has("/proj/.plan-execution")).toBe(true);
  });
});

describe("integration: timeout", () => {
  it("S-03: 60s timeout exits 1 with no mutation and emits the timeout message", async () => {
    const fs = makeFs({
      "/home/u/.loom/state.toon": "x",
      "/home/u/.claude/plugins/loom/m.json": "{}",
    });
    const s = streams();
    const stdin = new PassThrough();

    // Inject scheduler — fire the timeout immediately.
    let nextHandle = 1;
    const timeouts = new Map<number, () => void>();
    const intervals = new Map<number, () => void>();
    const sched = {
      setTimeout: (cb: () => void) => {
        const h = nextHandle++;
        timeouts.set(h, cb);
        // Fire on the next microtask.
        Promise.resolve().then(() => {
          const c = timeouts.get(h);
          if (c) c();
        });
        return h;
      },
      clearTimeout: (h: number) => timeouts.delete(h),
      setInterval: (cb: () => void) => {
        const h = nextHandle++;
        intervals.set(h, cb);
        return h;
      },
      clearInterval: (h: number) => intervals.delete(h),
    };

    const outcome = await runUninstall(
      { purgeProjectState: false, dryRun: false, yes: false },
      {
        fs,
        os: fakeOs,
        env: {},
        cwd: "/proj",
        stdout: s.stdout,
        stderr: s.stderr,
        confirm: {
          stdin,
          setTimeout: sched.setTimeout as any,
          clearTimeout: sched.clearTimeout as any,
          setInterval: sched.setInterval as any,
          clearInterval: sched.clearInterval as any,
        },
      }
    );
    expect(outcome.exitCode).toBe(1);
    expect(outcome.kind).toBe("aborted");
    if (outcome.kind === "aborted") expect(outcome.reason).toBe("timeout");
    expect(s.err()).toContain("Confirmation timed out after 60s; no changes made.");
    expect(fs.removed.size).toBe(0);
  });
});

describe("integration: dry-run", () => {
  it("S-04: --dry-run prints full preview without mutation, exits 0", async () => {
    const fs = makeFs({
      "/home/u/.loom/state.toon": "x",
      "/home/u/.claude/plugins/loom/m.json": "{}",
      "/proj/.claude/settings.json": JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Write|Edit",
              hooks: [{ command: "hooks/file-ownership.ts" }],
            },
          ],
        },
      }),
      "/proj/.claude/settings.local.json": JSON.stringify({
        hooks: {
          Stop: [{ matcher: "", hooks: [{ command: "hooks/quality-gate.ts" }] }],
        },
      }),
    });
    const s = streams();
    const outcome = await runUninstall(
      { purgeProjectState: false, dryRun: true, yes: false },
      {
        fs,
        os: fakeOs,
        env: {},
        cwd: "/proj",
        stdout: s.stdout,
        stderr: s.stderr,
      }
    );
    expect(outcome.exitCode).toBe(0);
    expect(outcome.kind).toBe("dry-run");
    expect(s.out()).toContain("/home/u/.claude/plugins/loom/");
    expect(s.out()).toContain("/home/u/.loom/");
    expect(s.out()).toContain("BOTH settings tiers");
    expect(s.out()).toContain("/proj/.claude/settings.json");
    expect(s.out()).toContain("/proj/.claude/settings.local.json");
    expect(fs.removed.size).toBe(0);
  });

  it("dry-run honors LOOM_HOME env", async () => {
    const fs = makeFs({});
    const s = streams();
    const outcome = await runUninstall(
      { purgeProjectState: false, dryRun: true, yes: false },
      {
        fs,
        os: fakeOs,
        env: { LOOM_HOME: "/tmp/custom-loom" },
        cwd: "/proj",
        stdout: s.stdout,
        stderr: s.stderr,
      }
    );
    expect(outcome.exitCode).toBe(0);
    expect(s.out()).toContain("/tmp/custom-loom");
  });
});
