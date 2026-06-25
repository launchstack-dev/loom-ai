/**
 * Hook: shellcheck-on-write (PostToolUse — Write/Edit)
 *
 * Runs shellcheck after writes to *.sh / *.bash. Feedback-only — never blocks
 * the operation. Catches the class of shell-quality bugs that bit PR #18:
 * unquoted variable expansions into Python -c, masked `2>/dev/null`, etc.
 *
 * Skipped silently when:
 *   - file is not a shell script (extension check + shebang check),
 *   - LOOM_SKIP_SHELLCHECK env var is set,
 *   - shellcheck binary is not installed (fail-open),
 *   - shellcheck takes longer than SHELLCHECK_TIMEOUT (10s).
 *
 * The companion skill at `skills/shell-conventions/SKILL.md` documents the
 * rules this hook checks (and a few that shellcheck doesn't cover). The hook
 * is the deterministic safety net; the skill is the authoring guidance.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { runHook, allow } from "./lib/run-hook.js";

const SHELL_EXTENSIONS = [".sh", ".bash"];
const SHELLCHECK_TIMEOUT = 10_000;

function isShellScript(filePath: string): boolean {
  if (SHELL_EXTENSIONS.some((ext) => filePath.endsWith(ext))) return true;
  // Shebang fallback — covers extension-less scripts in scripts/
  try {
    const head = fs.readFileSync(filePath, { encoding: "utf-8" }).slice(0, 64);
    return /^#!\s*\/(usr\/)?bin\/(env\s+)?(ba)?sh\b/.test(head);
  } catch {
    return false;
  }
}

runHook("shellcheck-on-write", async (input) => {
  if (process.env.LOOM_SKIP_SHELLCHECK) return allow();

  const filePath: string | undefined =
    input.tool_input?.file_path ?? input.result?.file_path;
  if (!filePath) return allow();

  if (!isShellScript(filePath)) return allow();
  if (!fs.existsSync(filePath)) return allow();

  // Probe shellcheck once — if absent, fail-open silently so users without it
  // installed don't see noise on every shell edit.
  try {
    execFileSync("shellcheck", ["--version"], {
      timeout: 2_000,
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {
    return allow();
  }

  // Detect shell from shebang so shellcheck applies the right ruleset
  // (#!/bin/sh vs #!/bin/bash have different valid grammars).
  let shell = "bash";
  try {
    const head = fs.readFileSync(filePath, { encoding: "utf-8" }).slice(0, 64);
    if (/^#!\s*\/(usr\/)?bin\/sh\b/.test(head)) shell = "sh";
  } catch {
    // ignore — default to bash
  }

  try {
    execFileSync(
      "shellcheck",
      ["-s", shell, "-f", "gcc", filePath],
      {
        timeout: SHELLCHECK_TIMEOUT,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return allow();
  } catch (err: any) {
    const output = (err.stdout ?? "") + (err.stderr ?? "");
    if (!output.trim()) return allow();
    const truncated =
      output.length > 2_000 ? output.slice(0, 2_000) + "\n... (truncated)" : output;
    return allow(`shellcheck findings in ${filePath}:\n${truncated}`);
  }
});
