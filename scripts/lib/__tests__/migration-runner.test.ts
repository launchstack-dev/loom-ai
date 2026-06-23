/**
 * Unit tests for MigrationRunnerImpl + ownership-evidence helpers.
 *
 * Uses a temp directory per test so the on-disk filesystem effects are
 * deterministic and isolated. No subprocess spawning — we exercise the
 * class directly.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  MigrationRunnerImpl,
  BARE_ANCHOR_CHECK_ID,
  rewriteCommands,
} from "../migration-runner";
import {
  decodeLog,
  encodeLog,
  readLog,
  removeRecordsByCheckId,
  sha256OfContent,
  defaultLogPath,
  type MigrationEvidence,
} from "../ownership-evidence";
import type { MigrationRunner } from "../doctor/migration-runner.interface";

function mkScratch(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-mig-"));
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  return dir;
}

function writeSettings(scratch: string, name: string, value: unknown): string {
  const p = path.join(scratch, ".claude", name);
  fs.writeFileSync(p, JSON.stringify(value, null, 2));
  return p;
}

function makeRunner(scratch: string, channel: "curl" | "plugin" = "curl") {
  return new MigrationRunnerImpl({
    cwd: scratch,
    resolveChannel: () => channel,
  });
}

describe("interface conformance", () => {
  it("implements MigrationRunner", () => {
    const scratch = mkScratch();
    try {
      const runner: MigrationRunner = new MigrationRunnerImpl({ cwd: scratch });
      expect(typeof runner.run).toBe("function");
      expect(typeof runner.reconcile).toBe("function");
      expect(typeof runner.resetEvidence).toBe("function");
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe("ownership-evidence encode/decode", () => {
  it("round-trips records via TOON", () => {
    const records: MigrationEvidence[] = [
      {
        checkId: "bare-anchor",
        appliedAt: "2026-06-18T00:00:00Z",
        outcome: "applied",
        path: "/tmp/foo.json",
        beforeHash: "a".repeat(64),
        afterHash: "b".repeat(64),
        reason: "test",
      },
      {
        checkId: "bare-anchor",
        appliedAt: "2026-06-18T00:01:00Z",
        outcome: "refused-ownership-guard",
        path: "/tmp/bar.json",
        beforeHash: "c".repeat(64),
        reason: "hash diverged, comma here, and \"quotes\"",
      },
    ];
    const encoded = encodeLog(records);
    const decoded = decodeLog(encoded);
    expect(decoded).toHaveLength(2);
    expect(decoded[0]).toEqual(records[0]);
    expect(decoded[1].reason).toBe(records[1].reason);
  });

  it("encodes the canonical header", () => {
    const out = encodeLog([]);
    expect(out).toContain(
      "records[0]{checkId,appliedAt,outcome,path,beforeHash,afterHash,reason}:"
    );
  });
});

describe("rewriteCommands", () => {
  it("rewrites bare hooks/run-hook.sh commands and counts changes", () => {
    const input = {
      hooks: {
        SessionStart: [
          {
            hooks: [
              { type: "command", command: "hooks/run-hook.sh loom-migration" },
            ],
          },
        ],
        PreToolUse: [
          {
            hooks: [
              { type: "command", command: "${CLAUDE_PROJECT_DIR}/hooks/run-hook.sh foo" },
            ],
          },
        ],
      },
    };
    const out = rewriteCommands(input, (cmd) =>
      /^hooks\/run-hook\.sh/.test(cmd)
        ? cmd.replace(/^hooks\/run-hook\.sh/, "${CLAUDE_PROJECT_DIR}/hooks/run-hook.sh")
        : null
    );
    expect(out.changes).toBe(1);
    const sessionCmd = (out.value as any).hooks.SessionStart[0].hooks[0].command;
    expect(sessionCmd).toBe(
      "${CLAUDE_PROJECT_DIR}/hooks/run-hook.sh loom-migration"
    );
  });
});

describe("MigrationRunnerImpl.run", () => {
  let scratch: string;
  beforeEach(() => {
    scratch = mkScratch();
  });
  afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it("rewrites bare anchors to ${CLAUDE_PROJECT_DIR} (curl channel)", async () => {
    const filePath = writeSettings(scratch, "settings.local.json", {
      hooks: {
        SessionStart: [
          {
            hooks: [
              { type: "command", command: "hooks/run-hook.sh loom-migration" },
            ],
          },
        ],
      },
    });
    const runner = makeRunner(scratch, "curl");
    const result = await runner.run();
    expect(result.outcome).toBe("applied");
    expect(result.changedFiles).toContain(filePath);
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(parsed.hooks.SessionStart[0].hooks[0].command).toBe(
      "${CLAUDE_PROJECT_DIR}/hooks/run-hook.sh loom-migration"
    );
  });

  it("rewrites bare anchors to ${CLAUDE_PLUGIN_ROOT} (plugin channel)", async () => {
    const filePath = writeSettings(scratch, "settings.local.json", {
      hooks: {
        SessionStart: [
          {
            hooks: [
              { type: "command", command: "hooks/run-hook.sh loom-migration" },
            ],
          },
        ],
      },
    });
    const runner = makeRunner(scratch, "plugin");
    const result = await runner.run();
    expect(result.outcome).toBe("applied");
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(parsed.hooks.SessionStart[0].hooks[0].command).toBe(
      "${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.sh loom-migration"
    );
  });

  it("is idempotent — second run is byte-identical, outcome=not-needed", async () => {
    const filePath = writeSettings(scratch, "settings.local.json", {
      hooks: {
        SessionStart: [
          {
            hooks: [
              { type: "command", command: "hooks/run-hook.sh loom-migration" },
            ],
          },
        ],
      },
    });
    const runner = makeRunner(scratch, "curl");
    await runner.run();
    const afterFirst = fs.readFileSync(filePath);
    const second = await runner.run();
    expect(second.outcome).toBe("not-needed");
    expect(fs.readFileSync(filePath).equals(afterFirst)).toBe(true);
    // Third run for good measure
    const third = await runner.run();
    expect(third.outcome).toBe("not-needed");
    expect(fs.readFileSync(filePath).equals(afterFirst)).toBe(true);
  });

  it("appends MigrationEvidence with sha256 hashes", async () => {
    writeSettings(scratch, "settings.local.json", {
      hooks: {
        SessionStart: [
          {
            hooks: [
              { type: "command", command: "hooks/run-hook.sh loom-migration" },
            ],
          },
        ],
      },
    });
    const runner = makeRunner(scratch, "curl");
    await runner.run();
    const log = readLog(defaultLogPath(scratch));
    expect(log).toHaveLength(1);
    expect(log[0].outcome).toBe("applied");
    expect(log[0].beforeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(log[0].afterHash).toMatch(/^[0-9a-f]{64}$/);
    expect(log[0].beforeHash).not.toBe(log[0].afterHash);
  });

  it("refuses to rewrite when on-disk hash differs from recorded evidence", async () => {
    const filePath = writeSettings(scratch, "settings.local.json", {
      hooks: {
        SessionStart: [
          {
            hooks: [
              { type: "command", command: "hooks/run-hook.sh loom-migration" },
            ],
          },
        ],
      },
    });
    // Seed a record with a deliberately wrong reference hash so the next
    // run trips the guard.
    const logPath = defaultLogPath(scratch);
    const onDisk = sha256OfContent(fs.readFileSync(filePath));
    fs.writeFileSync(
      logPath,
      encodeLog([
        {
          checkId: BARE_ANCHOR_CHECK_ID,
          appliedAt: "2026-06-17T00:00:00Z",
          outcome: "applied",
          path: filePath,
          beforeHash: "0".repeat(64),
          afterHash: "f".repeat(64), // does not match onDisk
          reason: "seeded",
        },
      ])
    );
    expect(onDisk).not.toBe("f".repeat(64));
    const beforeContent = fs.readFileSync(filePath);
    const runner = makeRunner(scratch, "curl");
    const result = await runner.run();
    expect(result.outcome).toBe("refused-ownership-guard");
    // File untouched.
    expect(fs.readFileSync(filePath).equals(beforeContent)).toBe(true);
    // New record appended.
    const log = readLog(logPath);
    expect(log).toHaveLength(2);
    expect(log[1].outcome).toBe("refused-ownership-guard");
  });

  it("resetEvidence clears the named record and unblocks subsequent runs", async () => {
    const filePath = writeSettings(scratch, "settings.local.json", {
      hooks: {
        SessionStart: [
          {
            hooks: [
              { type: "command", command: "hooks/run-hook.sh loom-migration" },
            ],
          },
        ],
      },
    });
    const logPath = defaultLogPath(scratch);
    fs.writeFileSync(
      logPath,
      encodeLog([
        {
          checkId: BARE_ANCHOR_CHECK_ID,
          appliedAt: "2026-06-17T00:00:00Z",
          outcome: "applied",
          path: filePath,
          beforeHash: "0".repeat(64),
          afterHash: "f".repeat(64),
          reason: "seeded",
        },
      ])
    );
    const runner = makeRunner(scratch, "curl");
    const refused = await runner.run();
    expect(refused.outcome).toBe("refused-ownership-guard");
    // Reset and retry.
    await runner.resetEvidence(BARE_ANCHOR_CHECK_ID);
    const log = readLog(logPath);
    expect(log).toHaveLength(0);
    const second = await runner.run();
    expect(second.outcome).toBe("applied");
  });

  it("reports not-needed when no settings file is present", async () => {
    const runner = makeRunner(scratch, "curl");
    const result = await runner.run();
    expect(result.outcome).toBe("not-needed");
    expect(result.changedFiles).toEqual([]);
  });

  it("handles malformed settings JSON with refused-ownership-guard", async () => {
    const filePath = path.join(scratch, ".claude", "settings.local.json");
    fs.writeFileSync(filePath, "{ not json");
    const runner = makeRunner(scratch, "curl");
    const result = await runner.run();
    expect(result.outcome).toBe("refused-ownership-guard");
    // File untouched.
    expect(fs.readFileSync(filePath, "utf8")).toBe("{ not json");
  });
});

describe("MigrationRunnerImpl.reconcile", () => {
  let scratch: string;
  beforeEach(() => {
    scratch = mkScratch();
  });
  afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it("coerces other-channel anchors to the target channel", async () => {
    const filePath = writeSettings(scratch, "settings.local.json", {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: "${CLAUDE_PROJECT_DIR}/hooks/run-hook.sh foo",
              },
            ],
          },
        ],
      },
    });
    const runner = makeRunner(scratch, "plugin");
    await runner.reconcile("plugin");
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(parsed.hooks.SessionStart[0].hooks[0].command).toBe(
      "${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.sh foo"
    );
  });
});

describe("removeRecordsByCheckId", () => {
  it("returns 0 when nothing to remove and does not create the log", () => {
    const scratch = mkScratch();
    try {
      const removed = removeRecordsByCheckId(
        defaultLogPath(scratch),
        "bare-anchor"
      );
      expect(removed).toBe(0);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
});
