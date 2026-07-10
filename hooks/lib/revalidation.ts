/**
 * Acceptance re-validation (roadmap C-08, CT6 Track A2 port).
 *
 * When a run claims terminal completion, the Stop-time gate independently
 * re-runs the acceptance checks instead of trusting the claim: self-certified
 * or skipped verdicts are blocked, under every discipline profile.
 *
 * What "independently re-run" means today (M-2):
 * 1. `[domain].verificationPipeline` commands from .claude/orchestration.toml
 *    are re-executed (bounded timeout per command). Any failure blocks, named.
 * 2. With no pipeline configured, the gate requires recorded verification
 *    evidence: every completed wave in state.toon must carry
 *    `verificationResult: pass`. Absent or failed evidence blocks as a
 *    skipped verdict.
 *
 * A pass is recorded in `.plan-execution/revalidation-marker.toon` keyed to
 * the state file's mtime, so repeated Stops don't re-run the suite until the
 * state changes again.
 *
 * Escape hatch: LOOM_SKIP_REVALIDATION=1 (mirrors the LOOM_SKIP_* convention;
 * an explicit operator act, logged to stderr).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

const COMMAND_TIMEOUT_MS = 120_000;
const MARKER_FILE = "revalidation-marker.toon";

export interface RevalidationResult {
  verdict: "pass" | "fail" | "skipped-checks" | "already-validated" | "operator-skip";
  /** Failing commands / missing evidence, for the block message. */
  failures: string[];
}

export type CommandRunner = (command: string, cwd: string) => { ok: boolean; detail: string };

const defaultRunner: CommandRunner = (command, cwd) => {
  try {
    execSync(command, { cwd, timeout: COMMAND_TIMEOUT_MS, stdio: "pipe" });
    return { ok: true, detail: "" };
  } catch (err) {
    const e = err as { status?: number; signal?: string };
    return {
      ok: false,
      detail: e.signal === "SIGTERM" ? "timed out" : `exit ${e.status ?? "?"}`,
    };
  }
};

/** Parse `[domain].verificationPipeline = ["cmd", ...]` from orchestration.toml. */
export function readVerificationPipeline(cwd: string): string[] {
  try {
    const tomlPath = path.resolve(cwd, ".claude", "orchestration.toml");
    if (!fs.existsSync(tomlPath)) return [];
    const content = fs.readFileSync(tomlPath, "utf-8");
    const section = content.match(/\[domain\]([\s\S]*?)(?=\n\s*\[|\s*$)/);
    if (!section) return [];
    const arr = section[1].match(/verificationPipeline\s*=\s*\[([\s\S]*?)\]/);
    if (!arr) return [];
    const commands: string[] = [];
    const re = /"((?:[^"\\]|\\.)*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(arr[1])) !== null) commands.push(m[1].replace(/\\"/g, '"'));
    return commands;
  } catch {
    return [];
  }
}

/** Every wave block in state.toon must record `verificationResult: pass`. */
export function stateHasVerificationEvidence(planExecDir: string): {
  ok: boolean;
  detail: string;
} {
  // No execution state at all (pipeline-only run) — nothing to certify
  // against; the verificationPipeline path is the gate for those runs.
  if (!fs.existsSync(path.join(planExecDir, "state.toon"))) {
    return { ok: true, detail: "no execution state" };
  }
  try {
    const content = fs.readFileSync(path.join(planExecDir, "state.toon"), "utf-8");
    const waveHeaders = content.match(/^\d+:$/gm) ?? [];
    const passes = content.match(/^\s*verificationResult:\s*pass\s*$/gm) ?? [];
    const fails = content.match(/^\s*verificationResult:\s*fail\s*$/gm) ?? [];
    if (fails.length > 0) return { ok: false, detail: `${fails.length} wave(s) recorded verificationResult: fail` };
    if (waveHeaders.length === 0) return { ok: true, detail: "no waves recorded" };
    if (passes.length < waveHeaders.length) {
      return {
        ok: false,
        detail: `${waveHeaders.length - passes.length} of ${waveHeaders.length} wave(s) have no verificationResult: pass (skipped verdict)`,
      };
    }
    return { ok: true, detail: "" };
  } catch {
    return { ok: false, detail: "state.toon unreadable" };
  }
}

function stateMtime(planExecDir: string): number {
  let latest = 0;
  for (const f of ["state.toon", "pipeline-state.toon"]) {
    try {
      latest = Math.max(latest, fs.statSync(path.join(planExecDir, f)).mtimeMs);
    } catch {
      // absent file — ignore
    }
  }
  return latest;
}

function markerPath(planExecDir: string): string {
  return path.join(planExecDir, MARKER_FILE);
}

function readMarker(planExecDir: string): { stateMtimeMs: number } | null {
  try {
    const content = fs.readFileSync(markerPath(planExecDir), "utf-8");
    const m = content.match(/stateMtimeMs:\s*([\d.]+)/);
    return m ? { stateMtimeMs: Number(m[1]) } : null;
  } catch {
    return null;
  }
}

function writeMarker(planExecDir: string, stateMtimeMs: number): void {
  try {
    const tmp = markerPath(planExecDir) + ".tmp";
    fs.writeFileSync(
      tmp,
      `validatedAt: ${new Date().toISOString()}\nstateMtimeMs: ${stateMtimeMs}\nverdict: pass\n`,
      "utf-8"
    );
    fs.renameSync(tmp, markerPath(planExecDir));
  } catch {
    // best-effort — a lost marker only costs a redundant re-run
  }
}

/**
 * Re-validate a completion claim. Fail-closed on failing checks; the only
 * allow paths are a real pass, a still-valid marker, or the explicit
 * operator skip.
 */
export function revalidateCompletion(
  planExecDir: string,
  opts?: { cwd?: string; runCommand?: CommandRunner; env?: NodeJS.ProcessEnv }
): RevalidationResult {
  const env = opts?.env ?? process.env;
  if (env.LOOM_SKIP_REVALIDATION === "1") {
    process.stderr.write(
      "[loom:quality-gate] LOOM_SKIP_REVALIDATION=1 — acceptance re-validation skipped by operator\n"
    );
    return { verdict: "operator-skip", failures: [] };
  }

  const cwd = opts?.cwd ?? process.cwd();
  const currentMtime = stateMtime(planExecDir);
  const marker = readMarker(planExecDir);
  if (marker && marker.stateMtimeMs >= currentMtime) {
    return { verdict: "already-validated", failures: [] };
  }

  const pipeline = readVerificationPipeline(cwd);
  if (pipeline.length > 0) {
    const run = opts?.runCommand ?? defaultRunner;
    const failures: string[] = [];
    for (const command of pipeline) {
      const result = run(command, cwd);
      if (!result.ok) failures.push(`${command} (${result.detail})`);
    }
    if (failures.length > 0) return { verdict: "fail", failures };
    writeMarker(planExecDir, currentMtime);
    return { verdict: "pass", failures: [] };
  }

  // No pipeline configured — require recorded verification evidence.
  const evidence = stateHasVerificationEvidence(planExecDir);
  if (!evidence.ok) {
    return { verdict: "skipped-checks", failures: [evidence.detail] };
  }
  writeMarker(planExecDir, currentMtime);
  return { verdict: "pass", failures: [] };
}
