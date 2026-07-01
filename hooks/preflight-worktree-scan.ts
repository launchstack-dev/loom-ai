/**
 * Hook: preflight-worktree-scan (PreToolUse — Bash)
 *
 * Watches for `/loom-git pr` (SlashCommand or Bash-shelled) invocations and
 * runs the cross-worktree ownership scanner. Emits non-blocking warning
 * findings on any overlap detected against a sibling worktree. NEVER blocks
 * — decision is always "allow"; findings go to stderr where the user sees
 * them and decides whether to proceed.
 *
 * Contract:
 *   - protocols/worktree-lease.schema.toon (lease registry format)
 *   - Findings row schema mirrors protocols/agent-result.schema.md (each
 *     finding carries confidence:1-10 + suggestedAction).
 *
 * Registration:
 *   Declared in skills/library.yaml under library.infrastructure. Wired via
 *   scripts/register-loom-hooks.ts on next run.
 *
 * Env overrides:
 *   LOOM_WORKTREE_PREFLIGHT_DISABLE=1  — skip the scan entirely
 *
 * NOTE: This is the 80/20 first step. See skills/loom-worktree/SKILL.md for
 * the three-mechanism roadmap of the fully-solved fan-in problem.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

interface HookInput {
  tool_name?: string;
  tool_input?: {
    command?: string;
  };
}

const PREFLIGHT_WARN_CODE = "WORKTREE_PREFLIGHT_OVERLAP";

function readStdinSync(): string {
  try {
    const nodeFs = require("node:fs");
    return nodeFs.readFileSync(0, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Returns true when the Bash command is (or wraps) a `/loom-git pr` invocation.
 * Also matches the underlying skill/script paths used by loom-git.
 */
export function isLoomGitPr(command: string): boolean {
  if (!command) return false;
  // Direct slash-command via SlashCommand tool piped through Bash echo
  if (/\/loom-git\s+pr\b/.test(command)) return true;
  // Script equivalents
  if (/scripts\/loom-git\b[^\n]*\bpr\b/.test(command)) return true;
  if (/commands\/loom-git\/pr\.md\b/.test(command)) return true;
  return false;
}

function findScannerPath(cwd: string): string | null {
  // Walk up looking for scripts/loom-worktree-scan.ts within a git tree.
  let dir = cwd;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "scripts", "loom-worktree-scan.ts");
    try {
      fs.statSync(candidate);
      return candidate;
    } catch {
      /* keep walking */
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function runPreflight(scannerPath: string, cwd: string): { ok: boolean; report: string } {
  try {
    const stdout = execFileSync("bunx", ["tsx", scannerPath, "scan"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
    });
    return { ok: true, report: stdout };
  } catch (err: any) {
    // Fallback to npx if bunx is missing.
    try {
      const stdout = execFileSync("npx", ["-y", "tsx", scannerPath, "scan"], {
        cwd,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 15_000,
      });
      return { ok: true, report: stdout };
    } catch (err2: any) {
      const msg = err2?.stderr?.toString?.() ?? err2?.message ?? String(err2);
      return { ok: false, report: msg };
    }
  }
}

/**
 * Parse the scanner's report and return overlap count. Report format is
 * defined in scripts/loom-worktree-scan.ts::printReport.
 */
export function parseOverlapCount(report: string): number {
  const m = report.match(/^overlapCount:\s*(\d+)/m);
  return m ? Number(m[1]) : 0;
}

function main(): void {
  try {
    if (process.env.LOOM_WORKTREE_PREFLIGHT_DISABLE === "1") {
      process.exit(0);
    }

    const raw = readStdinSync();
    if (!raw.trim()) process.exit(0);

    let input: HookInput;
    try {
      input = JSON.parse(raw);
    } catch {
      process.exit(0);
    }

    if (input.tool_name !== "Bash") process.exit(0);
    const cmd = input.tool_input?.command ?? "";
    if (!isLoomGitPr(cmd)) process.exit(0);

    const cwd = process.cwd();
    const scanner = findScannerPath(cwd);
    if (!scanner) {
      // Scanner not present in this repo — silently allow.
      process.exit(0);
    }

    const { ok, report } = runPreflight(scanner, cwd);
    if (!ok) {
      process.stderr.write(
        `[preflight-worktree-scan] scanner failed (fail-open): ${report}\n`
      );
      process.exit(0);
    }

    const overlapCount = parseOverlapCount(report);
    if (overlapCount > 0) {
      process.stderr.write(
        `[preflight-worktree-scan] ${PREFLIGHT_WARN_CODE} ${overlapCount} sibling-worktree overlap(s) detected.\n` +
          `Advisory only — the /loom-git pr command will proceed. Review the report below and consider rebasing.\n` +
          `suggestedAction: Run rebase-from-main and re-verify before merging\n` +
          `---\n${report}---\n`
      );
    }
    // Always non-blocking.
    process.exit(0);
  } catch (err) {
    // Fail-open on any error.
    process.stderr.write(`[preflight-worktree-scan] fail-open: ${(err as Error)?.message ?? err}\n`);
    process.exit(0);
  }
}

// Exported for unit tests.
export { PREFLIGHT_WARN_CODE };

if (typeof require !== "undefined" && require.main === module) {
  main();
}
