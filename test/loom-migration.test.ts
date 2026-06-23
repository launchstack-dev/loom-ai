/**
 * Integration tests for hooks/loom-migration.ts.
 *
 * Drives the hook via its exported `main()` function (rather than spawning
 * a subprocess) so we can capture stderr deterministically. Covers:
 *   - idempotency across 3 invocations,
 *   - ownership-guard refusal,
 *   - MigrationEvidence emission,
 *   - resetEvidence recovery.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { main } from "../hooks/loom-migration";
import { MigrationRunnerImpl, BARE_ANCHOR_CHECK_ID } from "../scripts/lib/migration-runner";
import {
  defaultLogPath,
  encodeLog,
  readLog,
} from "../scripts/lib/ownership-evidence";

function mkScratch(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-mig-it-"));
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  return dir;
}

function writeSettings(scratch: string, name: string, value: unknown): string {
  const p = path.join(scratch, ".claude", name);
  fs.writeFileSync(p, JSON.stringify(value, null, 2));
  return p;
}

function captureStderr() {
  const chunks: string[] = [];
  return {
    write: (chunk: string) => {
      chunks.push(chunk);
    },
    get text() {
      return chunks.join("");
    },
  };
}

const SETTINGS_FIXTURE = {
  hooks: {
    SessionStart: [
      {
        hooks: [
          { type: "command", command: "hooks/run-hook.sh loom-migration" },
        ],
      },
    ],
  },
};

describe("hooks/loom-migration main()", () => {
  let scratch: string;
  beforeEach(() => {
    scratch = mkScratch();
  });
  afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it("prints the user-visible notice on outcome=applied", async () => {
    const filePath = writeSettings(scratch, "settings.local.json", SETTINGS_FIXTURE);
    const stderr = captureStderr();
    const code = await main({ cwd: scratch, env: {}, stderr });
    expect(code).toBe(0);
    expect(stderr.text).toContain(
      `Loom: applied hook migration to ${filePath}. Run /loom-doctor to review.`
    );
  });

  it("is silent on outcome=not-needed", async () => {
    writeSettings(scratch, "settings.local.json", {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: "${CLAUDE_PROJECT_DIR}/hooks/run-hook.sh loom-migration",
              },
            ],
          },
        ],
      },
    });
    const stderr = captureStderr();
    const code = await main({ cwd: scratch, env: {}, stderr });
    expect(code).toBe(0);
    expect(stderr.text).toBe("");
  });

  it("idempotency across 3 consecutive invocations — file byte-identical", async () => {
    const filePath = writeSettings(scratch, "settings.local.json", SETTINGS_FIXTURE);
    const stderr = captureStderr();
    await main({ cwd: scratch, env: {}, stderr });
    const snapshot = fs.readFileSync(filePath);
    await main({ cwd: scratch, env: {}, stderr });
    await main({ cwd: scratch, env: {}, stderr });
    expect(fs.readFileSync(filePath).equals(snapshot)).toBe(true);
  });

  it("emits a MigrationEvidence record in the TOON log", async () => {
    writeSettings(scratch, "settings.local.json", SETTINGS_FIXTURE);
    const stderr = captureStderr();
    await main({ cwd: scratch, env: {}, stderr });
    const log = readLog(defaultLogPath(scratch));
    expect(log).toHaveLength(1);
    expect(log[0].checkId).toBe(BARE_ANCHOR_CHECK_ID);
    expect(log[0].outcome).toBe("applied");
    expect(log[0].beforeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(log[0].afterHash).toMatch(/^[0-9a-f]{64}$/);
    // ISO8601
    expect(log[0].appliedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("refuses to rewrite when ownership-evidence hash diverges", async () => {
    const filePath = writeSettings(scratch, "settings.local.json", SETTINGS_FIXTURE);
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
          afterHash: "f".repeat(64), // does not match disk
          reason: "seeded",
        },
      ])
    );
    const before = fs.readFileSync(filePath);
    const stderr = captureStderr();
    await main({ cwd: scratch, env: {}, stderr });
    // File untouched.
    expect(fs.readFileSync(filePath).equals(before)).toBe(true);
    const log = readLog(logPath);
    expect(log).toHaveLength(2);
    expect(log[1].outcome).toBe("refused-ownership-guard");
    expect(stderr.text).toContain("ownership guard");
  });

  it("resetEvidence clears the named record; subsequent run() succeeds", async () => {
    const filePath = writeSettings(scratch, "settings.local.json", SETTINGS_FIXTURE);
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
    // First run refuses.
    await main({ cwd: scratch, env: {}, stderr: captureStderr() });
    let log = readLog(logPath);
    expect(log[log.length - 1].outcome).toBe("refused-ownership-guard");

    // Operator runs --reset-evidence.
    const runner = new MigrationRunnerImpl({
      cwd: scratch,
      resolveChannel: () => "curl",
    });
    await runner.resetEvidence(BARE_ANCHOR_CHECK_ID);
    log = readLog(logPath);
    expect(log).toHaveLength(0);

    // Subsequent run succeeds.
    const stderr = captureStderr();
    await main({ cwd: scratch, env: {}, stderr });
    log = readLog(logPath);
    expect(log).toHaveLength(1);
    expect(log[0].outcome).toBe("applied");
    expect(stderr.text).toContain("applied hook migration");
  });

  it("selects ${CLAUDE_PLUGIN_ROOT} when CLAUDE_PLUGIN_ROOT is set", async () => {
    const filePath = writeSettings(scratch, "settings.local.json", SETTINGS_FIXTURE);
    const stderr = captureStderr();
    await main({
      cwd: scratch,
      env: { CLAUDE_PLUGIN_ROOT: "/fake/plugin/root" },
      stderr,
    });
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(parsed.hooks.SessionStart[0].hooks[0].command).toBe(
      "${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.sh loom-migration"
    );
  });

  it("never blocks session start — returns 0 even when settings unparseable", async () => {
    const filePath = path.join(scratch, ".claude", "settings.local.json");
    fs.writeFileSync(filePath, "{ not json");
    const stderr = captureStderr();
    const code = await main({ cwd: scratch, env: {}, stderr });
    expect(code).toBe(0);
  });
});
