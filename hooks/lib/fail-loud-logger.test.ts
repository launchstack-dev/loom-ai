import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { logHookFailure, defaultLogPath } from "./fail-loud-logger.js";

let tmpDir: string;
let logPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-fail-loud-"));
  logPath = path.join(tmpDir, "hook-failures.log");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("logHookFailure", () => {
  it("writes a timestamped entry with the absolute hookScriptPath populated", () => {
    const ok = logHookFailure(
      {
        hookScriptPath: "/abs/path/to/hooks/deploy-guard.ts",
        reason: "no-runtime",
        detail: "PATH=/usr/bin:/bin",
        timestamp: "2026-06-17T12:00:00.000Z",
      },
      { logPath },
    );
    expect(ok).toBe(true);
    const contents = fs.readFileSync(logPath, "utf8");
    expect(contents).toMatch(/^2026-06-17T12:00:00\.000Z,/);
    expect(contents).toContain("/abs/path/to/hooks/deploy-guard.ts");
    expect(contents).toContain("no-runtime");
    expect(contents).toContain("PATH=/usr/bin:/bin");
    expect(contents.endsWith("\n")).toBe(true);
  });

  it("appends multiple entries without overwriting", () => {
    logHookFailure(
      { hookScriptPath: "/a.ts", reason: "x", timestamp: "2026-01-01T00:00:00.000Z" },
      { logPath },
    );
    logHookFailure(
      { hookScriptPath: "/b.ts", reason: "y", timestamp: "2026-01-02T00:00:00.000Z" },
      { logPath },
    );
    const lines = fs.readFileSync(logPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("/a.ts");
    expect(lines[1]).toContain("/b.ts");
  });

  it("creates the parent cache directory if missing", () => {
    const nested = path.join(tmpDir, "deep", "loom", "hook-failures.log");
    const ok = logHookFailure(
      { hookScriptPath: "/c.ts", reason: "no-runtime" },
      { logPath: nested },
    );
    expect(ok).toBe(true);
    expect(fs.existsSync(nested)).toBe(true);
  });

  it("escapes embedded commas and newlines so each entry stays one line", () => {
    logHookFailure(
      {
        hookScriptPath: "/d.ts",
        reason: "hook-crashed",
        detail: "stderr line one,with comma\nand newline",
        timestamp: "2026-01-03T00:00:00.000Z",
      },
      { logPath },
    );
    const contents = fs.readFileSync(logPath, "utf8");
    const lines = contents.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("\\,");
    expect(lines[0]).not.toContain("\n");
  });

  it("never throws even if the log path is unwritable", () => {
    // Write to a path under a regular file — guaranteed ENOTDIR.
    const blockingFile = path.join(tmpDir, "block");
    fs.writeFileSync(blockingFile, "x");
    const ok = logHookFailure(
      { hookScriptPath: "/e.ts", reason: "no-runtime" },
      { logPath: path.join(blockingFile, "child.log") },
    );
    expect(ok).toBe(false);
  });

  it("defaultLogPath resolves under the user cache dir", () => {
    const resolved = defaultLogPath(() => "/home/u");
    expect(resolved).toBe("/home/u/.cache/loom/hook-failures.log");
  });
});
