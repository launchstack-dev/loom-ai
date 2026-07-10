import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  compareVersions,
  probeCapabilities,
  resolveFromCapabilities,
  writeResolvedProfile,
  MIN_WORKFLOW_HARNESS_VERSION,
} from "../profile-resolver.js";
import DisciplineProfileCheck from "../checks/discipline-profile.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-profile-resolver-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const tomlPath = () => path.join(tmpDir, ".claude", "orchestration.toml");

describe("compareVersions", () => {
  it("orders dotted versions numerically", () => {
    expect(compareVersions("2.1.187", "2.1.0")).toBe(1);
    expect(compareVersions("2.0.9", "2.1.0")).toBe(-1);
    expect(compareVersions("2.1.0", "2.1.0")).toBe(0);
    expect(compareVersions("10.0.0", "9.9.9")).toBe(1);
    expect(compareVersions("2.1", "2.1.0")).toBe(0);
  });
});

describe("probeCapabilities", () => {
  it("detects no harness from an empty env", () => {
    const caps = probeCapabilities({ env: {} as NodeJS.ProcessEnv });
    expect(caps.claudeCode).toBe(false);
    expect(caps.harnessVersion).toBeNull();
    expect(caps.workflowCapable).toBeNull();
  });

  it("parses the version from the harness binary output", () => {
    const caps = probeCapabilities({
      env: { CLAUDECODE: "1", CLAUDE_CODE_EXECPATH: "/fake/claude" } as NodeJS.ProcessEnv,
      execVersion: () => "2.1.187 (Claude Code)\n",
    });
    expect(caps.claudeCode).toBe(true);
    expect(caps.harnessVersion).toBe("2.1.187");
    expect(caps.workflowCapable).toBe(true);
  });

  it("treats a failing version probe as unknown", () => {
    const caps = probeCapabilities({
      env: { CLAUDECODE: "1", CLAUDE_CODE_EXECPATH: "/fake/claude" } as NodeJS.ProcessEnv,
      execVersion: () => {
        throw new Error("spawn failed");
      },
    });
    expect(caps.claudeCode).toBe(true);
    expect(caps.harnessVersion).toBeNull();
    expect(caps.workflowCapable).toBeNull();
  });
});

describe("resolveFromCapabilities (conservative)", () => {
  it("resolves strict when no harness is detected", () => {
    const r = resolveFromCapabilities({
      claudeCode: false,
      harnessVersion: null,
      workflowCapable: null,
    });
    expect(r.profile).toBe("strict");
  });

  it("resolves strict when the version is unprobeable", () => {
    const r = resolveFromCapabilities({
      claudeCode: true,
      harnessVersion: null,
      workflowCapable: null,
    });
    expect(r.profile).toBe("strict");
  });

  it("resolves standard on a workflow-capable harness", () => {
    const r = resolveFromCapabilities({
      claudeCode: true,
      harnessVersion: "2.1.187",
      workflowCapable: true,
    });
    expect(r.profile).toBe("standard");
    expect(r.reasons.join(" ")).toContain(MIN_WORKFLOW_HARNESS_VERSION);
  });

  it("resolves strict below the workflow threshold", () => {
    const r = resolveFromCapabilities({
      claudeCode: true,
      harnessVersion: "1.0.0",
      workflowCapable: false,
    });
    expect(r.profile).toBe("strict");
  });

  it("never resolves minimal (reserved for M-4)", () => {
    for (const caps of [
      { claudeCode: true, harnessVersion: "99.0.0", workflowCapable: true },
      { claudeCode: false, harnessVersion: null, workflowCapable: null },
    ]) {
      expect(["strict", "standard"]).toContain(resolveFromCapabilities(caps).profile);
    }
  });
});

describe("writeResolvedProfile", () => {
  it("creates the file and section when nothing exists", () => {
    const result = writeResolvedProfile("standard", tmpDir, "2026-07-09T00:00:00Z");
    expect(result.updated).toBe(true);
    const content = fs.readFileSync(tomlPath(), "utf-8");
    expect(content).toContain("[settings.discipline]");
    expect(content).toContain('profile = "auto"');
    expect(content).toContain('resolved = "standard"');
    expect(fs.existsSync(tomlPath() + ".tmp")).toBe(false);
  });

  it("appends the section without disturbing existing content", () => {
    fs.mkdirSync(path.join(tmpDir, ".claude"), { recursive: true });
    fs.writeFileSync(tomlPath(), `[settings]\nmaxParallelAgents = 6\n`, "utf-8");
    writeResolvedProfile("standard", tmpDir, "2026-07-09T00:00:00Z");
    const content = fs.readFileSync(tomlPath(), "utf-8");
    expect(content).toContain("maxParallelAgents = 6");
    expect(content).toContain('resolved = "standard"');
  });

  it("inserts resolved into an existing section, preserving the pin", () => {
    fs.mkdirSync(path.join(tmpDir, ".claude"), { recursive: true });
    fs.writeFileSync(
      tomlPath(),
      `[settings.discipline]\nprofile = "auto"\n\n[wiki]\nenabled = true\n`,
      "utf-8"
    );
    writeResolvedProfile("standard", tmpDir, "2026-07-09T00:00:00Z");
    const content = fs.readFileSync(tomlPath(), "utf-8");
    expect(content).toContain('profile = "auto"');
    expect(content).toContain('resolved = "standard"');
    expect(content).toContain("[wiki]");
    // resolved must land inside [settings.discipline], before [wiki]
    expect(content.indexOf('resolved = "standard"')).toBeLessThan(content.indexOf("[wiki]"));
  });

  it("replaces a previous resolved value", () => {
    fs.mkdirSync(path.join(tmpDir, ".claude"), { recursive: true });
    fs.writeFileSync(
      tomlPath(),
      `[settings.discipline]\nprofile = "auto"\nresolved = "strict"\n`,
      "utf-8"
    );
    const result = writeResolvedProfile("standard", tmpDir, "2026-07-09T00:00:00Z");
    expect(result.updated).toBe(true);
    expect(result.previous).toBe("strict");
    const content = fs.readFileSync(tomlPath(), "utf-8");
    expect(content).toContain('resolved = "standard"');
    expect(content).not.toContain('resolved = "strict"');
  });

  it("is a no-op when already resolved to the same profile", () => {
    fs.mkdirSync(path.join(tmpDir, ".claude"), { recursive: true });
    fs.writeFileSync(
      tomlPath(),
      `[settings.discipline]\nprofile = "auto"\nresolved = "standard"\n`,
      "utf-8"
    );
    const before = fs.readFileSync(tomlPath(), "utf-8");
    const result = writeResolvedProfile("standard", tmpDir, "2026-07-09T00:00:00Z");
    expect(result.updated).toBe(false);
    expect(fs.readFileSync(tomlPath(), "utf-8")).toBe(before);
  });

  it("never touches an explicit user pin", () => {
    fs.mkdirSync(path.join(tmpDir, ".claude"), { recursive: true });
    fs.writeFileSync(
      tomlPath(),
      `[settings.discipline]\nprofile = "strict"\n`,
      "utf-8"
    );
    writeResolvedProfile("standard", tmpDir, "2026-07-09T00:00:00Z");
    const content = fs.readFileSync(tomlPath(), "utf-8");
    expect(content).toContain('profile = "strict"');
  });
});

describe("DisciplineProfileCheck", () => {
  it("reports the C-06 strict default with a resolve hint", async () => {
    const check = new DisciplineProfileCheck({ cwd: tmpDir });
    const result = (await check.run(undefined)) as { status: string; message: string };
    expect(result.status).toBe("pass");
    expect(result.message).toContain("effective=strict");
    expect(result.message).toContain("--resolve-profile");
  });

  it("reflects a pinned profile", async () => {
    fs.mkdirSync(path.join(tmpDir, ".claude"), { recursive: true });
    fs.writeFileSync(tomlPath(), `[settings.discipline]\nprofile = "minimal"\n`, "utf-8");
    const check = new DisciplineProfileCheck({ cwd: tmpDir });
    const result = (await check.run(undefined)) as { status: string; message: string };
    expect(result.status).toBe("pass");
    expect(result.message).toContain("effective=minimal");
    expect(result.message).not.toContain("--resolve-profile");
  });
});
