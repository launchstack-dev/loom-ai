/**
 * Discipline-profile capability probe + resolver (roadmap C-01/C-02).
 *
 * This module and `hooks/lib/discipline.ts` are the ONLY two places allowed to
 * contain profile-resolution logic. The doctor probes harness capabilities —
 * never model names — and writes the outcome to `[settings.discipline]`
 * `resolved = "..."` in `.claude/orchestration.toml`. The `profile` key (the
 * user pin) is never touched.
 *
 * Resolution is deliberately conservative:
 * - `minimal` is never auto-resolved before M-4 (Fable validation) flips it.
 * - Any absent or ambiguous capability signal resolves to `strict`.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

export type ResolvableProfile = "strict" | "standard";

/**
 * Minimum Claude Code harness version whose native machinery (Workflow tool,
 * auto-compaction, worktree isolation) supersedes the scaffold layer. Tunable
 * constant — bump deliberately, with a changelog note.
 */
export const MIN_WORKFLOW_HARNESS_VERSION = "2.1.0";

export interface HarnessCapabilities {
  /** A Claude Code harness is present (CLAUDECODE / CLAUDE_CODE_* env). */
  claudeCode: boolean;
  /** Harness version from `<execpath> --version`, or null if unprobeable. */
  harnessVersion: string | null;
  /** Version meets MIN_WORKFLOW_HARNESS_VERSION; null when version unknown. */
  workflowCapable: boolean | null;
}

/** Numeric dotted-version compare: -1 / 0 / 1. Non-numeric parts compare as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((s) => parseInt(s, 10) || 0);
  const pb = b.split(".").map((s) => parseInt(s, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

export interface ProbeDeps {
  env?: NodeJS.ProcessEnv;
  /** Injectable version prober (tests). Returns raw `--version` output. */
  execVersion?: (execPath: string) => string;
}

/** Collect capability signals. Never throws. */
export function probeCapabilities(deps: ProbeDeps = {}): HarnessCapabilities {
  const env = deps.env ?? process.env;
  const claudeCode =
    env.CLAUDECODE === "1" ||
    Boolean(env.CLAUDE_CODE_SESSION_ID) ||
    Boolean(env.CLAUDE_CODE_EXECPATH);

  let harnessVersion: string | null = null;
  const execPath = env.CLAUDE_CODE_EXECPATH;
  if (claudeCode && execPath) {
    try {
      const execVersion =
        deps.execVersion ??
        ((p: string) =>
          execFileSync(p, ["--version"], { timeout: 5000, encoding: "utf-8" }));
      const raw = execVersion(execPath);
      // Format observed: "2.1.187 (Claude Code)"
      const m = raw.match(/(\d+\.\d+\.\d+)/);
      if (m) harnessVersion = m[1];
    } catch {
      harnessVersion = null;
    }
  }

  const workflowCapable = harnessVersion
    ? compareVersions(harnessVersion, MIN_WORKFLOW_HARNESS_VERSION) >= 0
    : null;

  return { claudeCode, harnessVersion, workflowCapable };
}

export interface Resolution {
  profile: ResolvableProfile;
  reasons: string[];
}

/** Pure resolution from capabilities. Conservative: ambiguity → strict. */
export function resolveFromCapabilities(caps: HarnessCapabilities): Resolution {
  const reasons: string[] = [];

  if (!caps.claudeCode) {
    reasons.push("no Claude Code harness detected — scaffold stays on");
    return { profile: "strict", reasons };
  }
  if (caps.harnessVersion === null) {
    reasons.push("harness version unprobeable — resolving conservatively");
    return { profile: "strict", reasons };
  }
  if (caps.workflowCapable) {
    reasons.push(
      `harness ${caps.harnessVersion} >= ${MIN_WORKFLOW_HARNESS_VERSION} — native Workflow/compaction machinery supersedes scaffold`
    );
    return { profile: "standard", reasons };
  }
  reasons.push(
    `harness ${caps.harnessVersion} < ${MIN_WORKFLOW_HARNESS_VERSION} — scaffold stays on`
  );
  return { profile: "strict", reasons };
}

export interface WriteResult {
  tomlPath: string;
  /** false when the file already contained this resolved value (no rewrite). */
  updated: boolean;
  previous: string | null;
}

/**
 * Write `resolved = "<profile>"` into [settings.discipline], atomically
 * (`.tmp` + rename). Creates the file/section when absent. Never modifies the
 * `profile` key.
 */
export function writeResolvedProfile(
  profile: ResolvableProfile,
  cwd: string = process.cwd(),
  nowIso?: string
): WriteResult {
  const claudeDir = path.resolve(cwd, ".claude");
  const tomlPath = path.join(claudeDir, "orchestration.toml");
  const stamp = nowIso ?? new Date().toISOString();
  const resolvedLine = `resolved = "${profile}" # written by /loom-doctor --resolve-profile @ ${stamp}`;

  let content = "";
  if (fs.existsSync(tomlPath)) {
    content = fs.readFileSync(tomlPath, "utf-8");
  } else {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  let previous: string | null = null;
  let next: string;

  const sectionRe = /(\[settings\.discipline\])([\s\S]*?)(?=\n\s*\[|\s*$)/;
  const sectionMatch = content.match(sectionRe);

  if (sectionMatch) {
    const prevMatch = sectionMatch[2].match(
      /^\s*resolved\s*=\s*"?(strict|standard|minimal)"?.*$/m
    );
    previous = prevMatch ? prevMatch[1] : null;
    if (previous === profile) {
      return { tomlPath, updated: false, previous };
    }
    let body = sectionMatch[2];
    if (prevMatch) {
      body = body.replace(/^\s*resolved\s*=.*$/m, resolvedLine);
    } else {
      body = `\n${resolvedLine}${body}`;
    }
    next =
      content.slice(0, sectionMatch.index!) +
      sectionMatch[1] +
      body +
      content.slice(sectionMatch.index! + sectionMatch[0].length);
  } else {
    const section = `\n[settings.discipline]\nprofile = "auto"\n${resolvedLine}\n`;
    next = content ? content.replace(/\s*$/, "\n") + section : section.trimStart();
  }

  const tmpPath = tomlPath + ".tmp";
  fs.writeFileSync(tmpPath, next, "utf-8");
  fs.renameSync(tmpPath, tomlPath);
  return { tomlPath, updated: true, previous };
}

/** Hooks turned off by each resolved profile — used for the doctor's summary. */
export const PROFILE_DISABLES: Record<ResolvableProfile, string[]> = {
  strict: [],
  standard: [
    "context-budget",
    "budget-tracker",
    "context-monitor",
    "checkpoint-trigger",
    "status-updater",
    "wiki-impact-warner",
  ],
};
