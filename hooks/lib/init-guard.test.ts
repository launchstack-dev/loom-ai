/**
 * Tests for hooks/lib/init-guard.ts.
 *
 * Covers the four scenarios from PLAN-plugin-marketplace-merged Phase 3:
 *   - S-01: First /loom-* in uninitialized repo prints exact prompt + writes marker.
 *   - S-02: Repeat within 24h is silent.
 *   - S-03: /loom-init idempotency lives in loom-init.md, not here, but we
 *           assert the initialized branch returns immediately with no stdout.
 *   - S-04: Worktree first-open behaves like a fresh project (initialized
 *           lookup is cwd-local, so a freshly-opened worktree without a
 *           plugin-root pointer prompts identically to S-01).
 */

import { describe, it, expect } from "vitest";
import * as path from "node:path";

import {
  INIT_GUARD_PROMPT,
  assertInitialized,
  runInitGuard,
} from "./init-guard.js";

interface InMemoryFs {
  files: Record<string, string>;
}

function makeFs(initial: Record<string, string> = {}): InMemoryFs {
  return { files: { ...initial } };
}

interface Harness {
  fs: InMemoryFs;
  stdoutLines: string[];
  now: Date;
  deps: Parameters<typeof assertInitialized>[2];
}

function makeHarness(opts: {
  files?: Record<string, string>;
  now?: Date;
} = {}): Harness {
  const fs = makeFs(opts.files);
  const stdoutLines: string[] = [];
  const now = opts.now ?? new Date("2026-06-17T12:00:00.000Z");

  const deps = {
    now: () => now,
    fileExists: (p: string) => p in fs.files,
    readFile: (p: string) => {
      if (!(p in fs.files)) throw new Error(`ENOENT: ${p}`);
      return fs.files[p];
    },
    writeFile: (p: string, contents: string) => {
      fs.files[p] = contents;
    },
    rename: (from: string, to: string) => {
      fs.files[to] = fs.files[from];
      delete fs.files[from];
    },
    mkdir: () => {
      /* no-op */
    },
    stdout: (line: string) => {
      stdoutLines.push(line);
    },
  };

  return { fs, stdoutLines, now, deps };
}

const CWD = "/projects/uninit-app";
const PLUGIN_ROOT = path.join(CWD, ".loom", "plugin-root");
const MARKER = path.join(CWD, ".loom", "dismissed-init-prompt");

describe("assertInitialized — S-01 first invocation", () => {
  it("emits exact prompt and writes a dismissal marker", () => {
    const h = makeHarness();
    const outcome = assertInitialized(CWD, {}, h.deps);

    expect(outcome).toEqual({ kind: "prompted" });
    expect(h.stdoutLines).toEqual([INIT_GUARD_PROMPT]);
    expect(h.fs.files[MARKER]).toBe(
      "dismissedAt: 2026-06-17T12:00:00.000Z\n"
    );
  });

  it("does not write a marker (or prompt) when stdout sink throws but write succeeds", () => {
    // Sanity: prompt is always sent before marker write; the marker write
    // failure is swallowed so users see the prompt next time.
    const h = makeHarness();
    const deps = {
      ...h.deps,
      writeFile: () => {
        throw new Error("EROFS");
      },
    };
    const outcome = assertInitialized(CWD, {}, deps);
    expect(outcome.kind).toBe("prompted");
    expect(h.stdoutLines).toEqual([INIT_GUARD_PROMPT]);
    // Marker write failed → no marker on disk
    expect(MARKER in h.fs.files).toBe(false);
  });
});

describe("assertInitialized — S-02 repeat within 24h", () => {
  it("is silent when a fresh marker exists", () => {
    const writeTime = new Date("2026-06-17T06:00:00.000Z");
    const checkTime = new Date("2026-06-17T12:00:00.000Z"); // 6h later
    const h = makeHarness({
      files: { [MARKER]: `dismissedAt: ${writeTime.toISOString()}\n` },
      now: checkTime,
    });

    const outcome = assertInitialized(CWD, {}, h.deps);
    expect(outcome).toEqual({ kind: "dismissed-silent" });
    expect(h.stdoutLines).toEqual([]);
  });

  it("re-prompts when the marker is older than 24h", () => {
    const writeTime = new Date("2026-06-16T11:00:00.000Z");
    const checkTime = new Date("2026-06-17T12:00:00.000Z"); // 25h later
    const h = makeHarness({
      files: { [MARKER]: `dismissedAt: ${writeTime.toISOString()}\n` },
      now: checkTime,
    });

    const outcome = assertInitialized(CWD, {}, h.deps);
    expect(outcome).toEqual({ kind: "prompted" });
    expect(h.stdoutLines).toEqual([INIT_GUARD_PROMPT]);
    // Marker refreshed to checkTime
    expect(h.fs.files[MARKER]).toContain(checkTime.toISOString());
  });
});

describe("assertInitialized — initialized branch", () => {
  it("returns immediately when .loom/plugin-root exists, no stdout, no marker write", () => {
    const h = makeHarness({
      files: { [PLUGIN_ROOT]: "pluginRoot: ~/.claude/plugins/loom\n" },
    });

    const outcome = assertInitialized(CWD, {}, h.deps);
    expect(outcome).toEqual({ kind: "initialized" });
    expect(h.stdoutLines).toEqual([]);
    expect(MARKER in h.fs.files).toBe(false);
  });
});

describe("assertInitialized — S-04 fresh worktree", () => {
  it("treats a worktree without plugin-root identically to a fresh project", () => {
    // Simulate a brand-new worktree directory: nothing under .loom/ exists.
    const worktreeCwd = "/projects/loom-ai/.worktrees/feature-x";
    const h = makeHarness();

    const outcome = assertInitialized(worktreeCwd, {}, h.deps);
    expect(outcome).toEqual({ kind: "prompted" });
    expect(h.stdoutLines).toEqual([INIT_GUARD_PROMPT]);
    expect(
      h.fs.files[path.join(worktreeCwd, ".loom", "dismissed-init-prompt")]
    ).toBeDefined();
  });
});

describe("runInitGuard CLI wrapper", () => {
  it("returns exitCode 0 in all branches", () => {
    const fresh = makeHarness();
    expect(runInitGuard(CWD, fresh.deps).exitCode).toBe(0);

    const initialized = makeHarness({
      files: { [PLUGIN_ROOT]: "pluginRoot: /opt/loom\n" },
    });
    expect(runInitGuard(CWD, initialized.deps).exitCode).toBe(0);

    const dismissed = makeHarness({
      files: {
        [MARKER]: `dismissedAt: ${new Date("2026-06-17T11:00:00.000Z").toISOString()}\n`,
      },
    });
    expect(runInitGuard(CWD, dismissed.deps).exitCode).toBe(0);
  });

  it("propagates the outcome kind for telemetry", () => {
    const h = makeHarness();
    const result = runInitGuard(CWD, h.deps);
    expect(result.outcome.kind).toBe("prompted");
  });
});

describe("custom ttlMs", () => {
  it("honors a shorter TTL for testing", () => {
    const writeTime = new Date("2026-06-17T11:50:00.000Z");
    const checkTime = new Date("2026-06-17T12:00:00.000Z"); // 10min later
    const h = makeHarness({
      files: { [MARKER]: `dismissedAt: ${writeTime.toISOString()}\n` },
      now: checkTime,
    });

    // 5min TTL → stale → re-prompt
    const outcome = assertInitialized(CWD, { ttlMs: 5 * 60 * 1000 }, h.deps);
    expect(outcome.kind).toBe("prompted");
  });
});
