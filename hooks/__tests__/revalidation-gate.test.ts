/**
 * Acceptance re-validation stop-gate (roadmap C-08, M-2 metric
 * "self-certification impossible"): an agent declaring completion while any
 * acceptance criterion fails on independent re-run is blocked, under every
 * profile including minimal — with the failing criterion named.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runHook, parseDecision } from "./helpers/hook-runner.js";
import {
  revalidateCompletion,
  readVerificationPipeline,
  stateHasVerificationEvidence,
} from "../lib/revalidation.js";

let tmpDir: string;
let planExecDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-revalidation-"));
  planExecDir = path.join(tmpDir, ".plan-execution");
  fs.mkdirSync(planExecDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writePipelineState(stage: string) {
  fs.writeFileSync(
    path.join(planExecDir, "pipeline-state.toon"),
    `schemaVersion: 1\nagentsSpawned: 5\nmaxAgents: 30\ncurrentStage: ${stage}\nouterIteration: 1\nfixCycleCount: 0`,
    "utf-8"
  );
}

function writeVerificationPipeline(commands: string[], profile?: string) {
  const claudeDir = path.join(tmpDir, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  const discipline = profile ? `[settings.discipline]\nprofile = "${profile}"\n\n` : "";
  fs.writeFileSync(
    path.join(claudeDir, "orchestration.toml"),
    `${discipline}[domain]\ntype = "code"\nverificationPipeline = [${commands.map((c) => JSON.stringify(c)).join(", ")}]\n`,
    "utf-8"
  );
}

describe("readVerificationPipeline", () => {
  it("parses the [domain] command array", () => {
    writeVerificationPipeline(["tsc --noEmit", "bun test"]);
    expect(readVerificationPipeline(tmpDir)).toEqual(["tsc --noEmit", "bun test"]);
  });
  it("returns [] when absent", () => {
    expect(readVerificationPipeline(tmpDir)).toEqual([]);
  });
});

describe("revalidateCompletion (lib)", () => {
  it("fails with the failing command named", () => {
    writeVerificationPipeline(["true-check", "broken-check"]);
    const result = revalidateCompletion(planExecDir, {
      cwd: tmpDir,
      env: {} as NodeJS.ProcessEnv,
      runCommand: (cmd) => (cmd === "broken-check" ? { ok: false, detail: "exit 1" } : { ok: true, detail: "" }),
    });
    expect(result.verdict).toBe("fail");
    expect(result.failures).toEqual(["broken-check (exit 1)"]);
  });

  it("passes and writes a marker; unchanged state short-circuits the re-run", () => {
    writeVerificationPipeline(["ok-check"]);
    writePipelineState("complete");
    let runs = 0;
    const runCommand = () => {
      runs += 1;
      return { ok: true, detail: "" };
    };
    const first = revalidateCompletion(planExecDir, { cwd: tmpDir, env: {} as NodeJS.ProcessEnv, runCommand });
    expect(first.verdict).toBe("pass");
    expect(runs).toBe(1);
    const second = revalidateCompletion(planExecDir, { cwd: tmpDir, env: {} as NodeJS.ProcessEnv, runCommand });
    expect(second.verdict).toBe("already-validated");
    expect(runs).toBe(1);
  });

  it("treats missing verification evidence as a skipped verdict (no pipeline configured)", () => {
    fs.writeFileSync(
      path.join(planExecDir, "state.toon"),
      `status: completed\ncurrentWave: 1\n0:\n  status: succeeded\n1:\n  status: succeeded\n  verificationResult: pass\n`,
      "utf-8"
    );
    const evidence = stateHasVerificationEvidence(planExecDir);
    expect(evidence.ok).toBe(false);
    expect(evidence.detail).toContain("skipped verdict");
    const result = revalidateCompletion(planExecDir, { cwd: tmpDir, env: {} as NodeJS.ProcessEnv });
    expect(result.verdict).toBe("skipped-checks");
  });

  it("honors the explicit operator skip", () => {
    writeVerificationPipeline(["broken-check"]);
    const result = revalidateCompletion(planExecDir, {
      cwd: tmpDir,
      env: { LOOM_SKIP_REVALIDATION: "1" } as unknown as NodeJS.ProcessEnv,
    });
    expect(result.verdict).toBe("operator-skip");
  });
});

describe("quality-gate hook — self-certification impossible (M-2 metric)", () => {
  it.each(["strict", "standard", "minimal"])(
    "blocks a completion claim with a failing criterion under %s",
    async (profile) => {
      writePipelineState("complete");
      writeVerificationPipeline(["exit 1"], profile);
      const result = await runHook("quality-gate.ts", {}, { cwd: tmpDir });
      expect(result.exitCode).toBe(2);
      const decision = parseDecision(result.stdout);
      expect(decision?.decision).toBe("block");
      expect(decision?.reason).toContain("exit 1"); // failing criterion named
      expect(decision?.reason).toContain("re-validation FAILED");
    }
  );

  it("allows a completion claim when the criteria pass on re-run", async () => {
    writePipelineState("complete");
    writeVerificationPipeline(["exit 0"]);
    const result = await runHook("quality-gate.ts", {}, { cwd: tmpDir });
    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(path.join(planExecDir, "revalidation-marker.toon"))).toBe(true);
  });

  it("does not re-validate an escalation (not a done-claim)", async () => {
    writePipelineState("escalated");
    writeVerificationPipeline(["exit 1"]);
    const result = await runHook("quality-gate.ts", {}, { cwd: tmpDir });
    expect(result.exitCode).toBe(0);
  });

  it("gates execution-only completion claims via state.toon", async () => {
    fs.writeFileSync(
      path.join(planExecDir, "state.toon"),
      `status: completed\ncurrentWave: 0\n0:\n  status: succeeded\n`,
      "utf-8"
    );
    writeVerificationPipeline(["exit 1"]);
    const result = await runHook("quality-gate.ts", {}, { cwd: tmpDir });
    expect(result.exitCode).toBe(2);
  });

  it("stays silent with no completion claim and no pipeline state", async () => {
    const result = await runHook("quality-gate.ts", {}, { cwd: tmpDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });
});
