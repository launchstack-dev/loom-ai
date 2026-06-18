/**
 * Integration tests for the `/loom-doctor` CLI surface (Phase 9A1).
 *
 * Scope: surface only — argv parsing, dispatcher dynamic-discovery seam,
 * rendering, exit codes, output-file redirection, reconcile confirmation
 * gating, MigrationRunner delegation.
 *
 * IMPORTANT: this test file MUST NOT statically import any
 * `scripts/lib/doctor/checks/*` module — those land in Phase 9A2 and the
 * surface has to compile + test cleanly with an empty `checks/` directory.
 * Fake checks are injected through the dispatcher's `discovery` deps seam.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";

import { main, parseArgs } from "../scripts/loom-doctor.js";
import type {
  Check,
  CheckCategory,
} from "../scripts/lib/doctor/check.interface.js";
import type { MigrationRunner } from "../scripts/lib/doctor/migration-runner.interface.js";
import {
  renderCheckLine,
  renderText,
  type RenderableReport,
} from "../scripts/lib/doctor/render.js";
import { bundleFilename, redact } from "../scripts/lib/doctor/bundle.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FROZEN_NOW = new Date("2026-06-18T12:00:00.000Z");

function makeStreams(): {
  stdout: PassThrough;
  stderr: PassThrough;
  out: () => string;
  err: () => string;
} {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const outChunks: Buffer[] = [];
  const errChunks: Buffer[] = [];
  stdout.on("data", (c) => outChunks.push(c as Buffer));
  stderr.on("data", (c) => errChunks.push(c as Buffer));
  return {
    stdout,
    stderr,
    out: () => Buffer.concat(outChunks).toString(),
    err: () => Buffer.concat(errChunks).toString(),
  };
}

interface FakeChecksOptions {
  includeFail?: boolean;
  includeWarn?: boolean;
  includePass?: boolean;
}

function fakeChecks(opts: FakeChecksOptions = {}): Check[] {
  const list: Check[] = [];
  if (opts.includePass !== false) {
    list.push({
      id: "fake-pass",
      category: "hook-wiring" satisfies CheckCategory,
      run: async () => ({
        id: "fake-pass",
        category: "hook-wiring",
        status: "pass",
        message: "everything is fine",
      }),
    });
  }
  if (opts.includeWarn) {
    list.push({
      id: "fake-warn",
      category: "settings" satisfies CheckCategory,
      run: async () => ({
        id: "fake-warn",
        category: "settings",
        status: "warn",
        message: "minor wiring drift",
      }),
    });
  }
  if (opts.includeFail) {
    list.push({
      id: "fake-fail",
      category: "channel" satisfies CheckCategory,
      run: async () => ({
        id: "fake-fail",
        category: "channel",
        status: "fail",
        message: "channel disagreement",
      }),
    });
  }
  return list;
}

function discoveryFor(checks: Check[]) {
  return {
    readdir: () => checks.map((c) => `${c.id}.ts`),
    importModule: async (spec: string) => {
      const base = path.basename(spec).replace(/\.ts$/, "");
      const check = checks.find((c) => c.id === base);
      return { check };
    },
    checksDir: "/virtual/checks",
  };
}

const stubMigrationRunner = (): { runner: MigrationRunner; calls: string[] } => {
  const calls: string[] = [];
  const runner: MigrationRunner = {
    async run() {
      calls.push("run");
      return {};
    },
    async reconcile(channel) {
      calls.push(`reconcile:${channel}`);
    },
    async resetEvidence(checkId) {
      calls.push(`resetEvidence:${checkId}`);
    },
  };
  return { runner, calls };
};

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
  it("recognizes every CLI flag", () => {
    const p = parseArgs([
      "--json",
      "--quiet",
      "--output-file",
      "out.txt",
      "--only",
      "fake-pass",
      "--reconcile",
      "--reset-evidence",
      "fake-fail",
      "--fix",
      "--bundle",
      "--yes",
    ]);
    expect(p.json).toBe(true);
    expect(p.quiet).toBe(true);
    expect(p.outputFile).toBe("out.txt");
    expect(p.only).toBe("fake-pass");
    expect(p.reconcile).toBe(true);
    expect(p.resetEvidence).toBe("fake-fail");
    expect(p.fix).toBe(true);
    expect(p.bundle).toBe(true);
    expect(p.yes).toBe(true);
    expect(p.help).toBe(false);
    expect(p.error).toBeUndefined();
  });

  it("flags --help", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  it("reports unknown flags", () => {
    expect(parseArgs(["--nope"]).error).toMatch(/Unknown flag/);
  });

  it("rejects missing values", () => {
    expect(parseArgs(["--output-file"]).error).toMatch(/--output-file/);
    expect(parseArgs(["--only"]).error).toMatch(/--only/);
    expect(parseArgs(["--reset-evidence"]).error).toMatch(/--reset-evidence/);
  });
});

// ---------------------------------------------------------------------------
// --help
// ---------------------------------------------------------------------------

describe("--help", () => {
  it("prints usage and exits 0", async () => {
    const { stdout, stderr, out } = makeStreams();
    const code = await main({
      argv: ["--help"],
      stdout,
      stderr,
      now: () => FROZEN_NOW,
    });
    expect(code).toBe(0);
    const text = out();
    expect(text).toMatch(/\/loom-doctor \[flags\]/);
    expect(text).toMatch(/--json/);
    expect(text).toMatch(/--quiet/);
    expect(text).toMatch(/--output-file/);
    expect(text).toMatch(/--only/);
    expect(text).toMatch(/--reconcile/);
    expect(text).toMatch(/--reset-evidence/);
    expect(text).toMatch(/--fix/);
    expect(text).toMatch(/--bundle/);
    expect(text).toMatch(/--yes/);
  });
});

// ---------------------------------------------------------------------------
// --json
// ---------------------------------------------------------------------------

describe("--json", () => {
  it("emits a DoctorReport with schemaVersion=1", async () => {
    const { stdout, stderr, out } = makeStreams();
    const code = await main({
      argv: ["--json"],
      stdout,
      stderr,
      now: () => FROZEN_NOW,
      installSource: "plugin",
      tier: "project",
      discovery: discoveryFor(fakeChecks({ includePass: true })),
    });
    expect(code).toBe(0);
    const payload = JSON.parse(out());
    expect(payload.schemaVersion).toBe(1);
    expect(payload.installSource).toBe("plugin");
    expect(payload.overallStatus).toBe("clean");
    expect(payload.exitCode).toBe(0);
    expect(payload.checks).toHaveLength(1);
    expect(payload.checks[0].id).toBe("fake-pass");
  });

  it("returns exit 1 when any check warns or fails", async () => {
    const { stdout, stderr } = makeStreams();
    const code = await main({
      argv: ["--json"],
      stdout,
      stderr,
      now: () => FROZEN_NOW,
      discovery: discoveryFor(
        fakeChecks({ includePass: true, includeFail: true }),
      ),
    });
    expect(code).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// --quiet
// ---------------------------------------------------------------------------

describe("--quiet", () => {
  it("filters pass lines but keeps warn/fail and summary", async () => {
    const { stdout, stderr, out } = makeStreams();
    await main({
      argv: ["--quiet"],
      stdout,
      stderr,
      now: () => FROZEN_NOW,
      isTTY: false,
      discovery: discoveryFor(
        fakeChecks({
          includePass: true,
          includeWarn: true,
          includeFail: true,
        }),
      ),
    });
    const text = out();
    expect(text).not.toMatch(/fake-pass/);
    expect(text).toMatch(/WARN fake-warn/);
    expect(text).toMatch(/FAIL fake-fail/);
    expect(text).toMatch(/Summary: 1 checks passed, 1 warnings, 1 errors/);
  });

  it("does not change exit code", async () => {
    const { stdout, stderr } = makeStreams();
    const code = await main({
      argv: ["--quiet"],
      stdout,
      stderr,
      isTTY: false,
      discovery: discoveryFor(fakeChecks({ includePass: true })),
    });
    expect(code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// --output-file
// ---------------------------------------------------------------------------

describe("--output-file", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loom-doctor-test-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("writes the report to disk and stderr keeps progress", async () => {
    const target = path.join(tmp, "report.txt");
    const { stdout, stderr, out, err } = makeStreams();
    const code = await main({
      argv: ["--output-file", target],
      stdout,
      stderr,
      isTTY: false,
      now: () => FROZEN_NOW,
      discovery: discoveryFor(fakeChecks({ includePass: true })),
    });
    expect(code).toBe(0);
    expect(fs.existsSync(target)).toBe(true);
    const written = fs.readFileSync(target, "utf8");
    expect(written).toMatch(/PASS fake-pass/);
    // Stdout did not receive the report (it went to file).
    expect(out()).not.toMatch(/fake-pass/);
    // Stderr received progress.
    expect(err()).toMatch(/Wrote doctor report/);
  });
});

// ---------------------------------------------------------------------------
// --only
// ---------------------------------------------------------------------------

describe("--only", () => {
  it("runs only the named check", async () => {
    const { stdout, stderr, out } = makeStreams();
    await main({
      argv: ["--json", "--only", "fake-warn"],
      stdout,
      stderr,
      now: () => FROZEN_NOW,
      discovery: discoveryFor(
        fakeChecks({ includePass: true, includeWarn: true }),
      ),
    });
    const payload = JSON.parse(out());
    expect(payload.checks).toHaveLength(1);
    expect(payload.checks[0].id).toBe("fake-warn");
  });
});

// ---------------------------------------------------------------------------
// --reconcile
// ---------------------------------------------------------------------------

describe("--reconcile", () => {
  it("requires confirmation when --yes is absent", async () => {
    const { stdout, stderr, err } = makeStreams();
    const { runner, calls } = stubMigrationRunner();
    const code = await main({
      argv: ["--reconcile"],
      stdout,
      stderr,
      confirm: async () => false,
      loadMigrationRunner: async () => runner,
    });
    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(err()).toMatch(/Reconcile aborted/);
  });

  it("skips confirmation when --yes is passed", async () => {
    const { stdout, stderr } = makeStreams();
    const { runner, calls } = stubMigrationRunner();
    const confirmFn = vi.fn(async () => true);
    const code = await main({
      argv: ["--reconcile", "--yes"],
      stdout,
      stderr,
      installSource: "plugin",
      confirm: confirmFn,
      loadMigrationRunner: async () => runner,
    });
    expect(code).toBe(0);
    expect(confirmFn).not.toHaveBeenCalled();
    expect(calls).toEqual(["reconcile:plugin"]);
  });
});

// ---------------------------------------------------------------------------
// --reset-evidence
// ---------------------------------------------------------------------------

describe("--reset-evidence", () => {
  it("delegates to MigrationRunner.resetEvidence", async () => {
    const { stdout, stderr, err } = makeStreams();
    const { runner, calls } = stubMigrationRunner();
    const code = await main({
      argv: ["--reset-evidence", "channel-files"],
      stdout,
      stderr,
      loadMigrationRunner: async () => runner,
    });
    expect(code).toBe(0);
    expect(calls).toEqual(["resetEvidence:channel-files"]);
    expect(err()).toMatch(/Evidence cleared/);
  });
});

// ---------------------------------------------------------------------------
// --fix
// ---------------------------------------------------------------------------

describe("--fix", () => {
  it("invokes MigrationRunner.run()", async () => {
    const { stdout, stderr } = makeStreams();
    const { runner, calls } = stubMigrationRunner();
    const code = await main({
      argv: ["--fix"],
      stdout,
      stderr,
      loadMigrationRunner: async () => runner,
    });
    expect(code).toBe(0);
    expect(calls).toEqual(["run"]);
  });
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("renderCheckLine", () => {
  it("includes glyph + label on TTY", () => {
    const line = renderCheckLine(
      {
        id: "fake-pass",
        category: "hook-wiring",
        status: "pass",
        message: "ok",
      },
      true,
    );
    expect(line).toBe("✓ PASS fake-pass (hook-wiring) — ok");
  });

  it("omits glyph on non-TTY but keeps text label", () => {
    const line = renderCheckLine(
      {
        id: "fake-fail",
        category: "channel",
        status: "fail",
        message: "broken",
      },
      false,
    );
    expect(line).toBe("FAIL fake-fail (channel) — broken");
    expect(line).not.toMatch(/✗/);
  });
});

describe("renderText", () => {
  it("formats header, per-check, and summary", () => {
    const report: RenderableReport = {
      schemaVersion: 1,
      generatedAt: FROZEN_NOW.toISOString(),
      installSource: "plugin",
      tier: "project",
      overallStatus: "warnings",
      exitCode: 1,
      checks: [
        {
          id: "fake-warn",
          category: "settings",
          status: "warn",
          message: "drift",
        },
      ],
    };
    const text = renderText(report, {
      isTTY: false,
      quiet: false,
      version: "9.9.9",
    });
    expect(text).toMatch(/\[loom-doctor v9.9.9\] installSource=plugin/);
    expect(text).toMatch(/WARN fake-warn \(settings\) — drift/);
    expect(text).toMatch(
      /Summary: 0 checks passed, 1 warnings, 0 errors. Exit code: 1/,
    );
  });
});

// ---------------------------------------------------------------------------
// Bundle redaction & filename
// ---------------------------------------------------------------------------

describe("bundle.redact", () => {
  it("strips installSourceUrl and doNotTrack at every depth", () => {
    const input = {
      channel: "plugin",
      source: "marketplace",
      version: "1.2.3",
      installSourceUrl: "https://example.com/install",
      doNotTrack: true,
      nested: {
        installSourceUrl: "https://example.com/again",
        doNotTrack: false,
        keep: "yes",
      },
      list: [
        {
          installSourceUrl: "https://example.com/third",
          doNotTrack: true,
          channel: "curl",
        },
      ],
    };
    const out = redact(input) as Record<string, unknown>;
    expect(out.channel).toBe("plugin");
    expect(out.source).toBe("marketplace");
    expect(out.version).toBe("1.2.3");
    expect(out).not.toHaveProperty("installSourceUrl");
    expect(out).not.toHaveProperty("doNotTrack");
    const nested = out.nested as Record<string, unknown>;
    expect(nested).not.toHaveProperty("installSourceUrl");
    expect(nested).not.toHaveProperty("doNotTrack");
    expect(nested.keep).toBe("yes");
    const list = out.list as Record<string, unknown>[];
    expect(list[0]).not.toHaveProperty("installSourceUrl");
    expect(list[0]).not.toHaveProperty("doNotTrack");
    expect(list[0].channel).toBe("curl");
  });
});

describe("bundle.bundleFilename", () => {
  it("produces the canonical name", () => {
    const name = bundleFilename("1.2.3", FROZEN_NOW);
    expect(name).toBe("loom-doctor-1.2.3-2026-06-18T12-00-00-000Z.tar.gz");
  });
});
