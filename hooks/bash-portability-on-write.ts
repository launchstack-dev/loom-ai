/**
 * Hook: bash-portability-on-write (PostToolUse — Write/Edit)
 *
 * Regex-based scan for known macOS-BSD vs Linux-GNU coreutils divergences.
 * Feedback-only. Catches the class of "works on dev, breaks on CI" bugs that
 * bit PR #18 — e.g. `mktemp -d -t prefix` (no trailing XXXXXX), `sed -i '...'`
 * without backup arg, `readlink -f`, `grep -P`, `date -d`.
 *
 * Lighter-weight than shellcheck — no external binary, runs in process. Pairs
 * with shellcheck-on-write.ts (which catches a broader class of issues) and
 * the skills/shell-conventions/ skill (which prevents authoring the bug in
 * the first place).
 *
 * Skipped silently when:
 *   - file is not a shell script,
 *   - LOOM_SKIP_PORTABILITY env var is set.
 */

import * as fs from "node:fs";
import { runHook, allow } from "./lib/run-hook.js";

const SHELL_EXTENSIONS = [".sh", ".bash"];

interface PortabilityRule {
  name: string;
  pattern: RegExp;
  fix: string;
}

const RULES: PortabilityRule[] = [
  {
    name: "mktemp -t without XXXXXX template",
    // -t flag followed by a prefix that does NOT contain 3+ X's at end
    pattern: /\bmktemp\s+(?:-d\s+)?-t\s+[A-Za-z0-9_.\-]*(?<![Xx]{3})\b(?!\.[Xx]{3,})/,
    fix:
      "GNU mktemp requires the template to end with at least 3 X's. Use:\n" +
      "  mktemp -d -t prefix.XXXXXX",
  },
  {
    name: "sed -i without backup arg (BSD incompatible)",
    // sed -i followed by ' or " then non-empty single-quote suffix would be needed on BSD
    pattern: /\bsed\s+-i(?!\s*['"][.~][^'"]*['"])(?!\s+--?[A-Za-z])\s+['"]/,
    fix:
      "BSD sed requires an arg after -i (the suffix for in-place backup); GNU\n" +
      "sed forbids it without a flag. Portable form:\n" +
      "  sed -i.bak 's/.../.../' file && rm file.bak",
  },
  {
    name: "readlink -f (GNU-only)",
    pattern: /\breadlink\s+-f\b/,
    fix:
      "`readlink -f` is GNU-only; BSD has different semantics. Portable form:\n" +
      `  (cd "$(dirname "$path")" && pwd -P)/$(basename "$path")`,
  },
  {
    name: "grep -P / --perl-regexp (GNU-only)",
    pattern: /\bgrep\s+(-[A-Za-z]*P|-P[A-Za-z]*|--perl-regexp)\b/,
    fix:
      "`grep -P` (Perl regex) is GNU-only. Use POSIX extended (`-E`) or pipe\n" +
      "through perl/awk instead.",
  },
  {
    name: 'date -d (GNU-only relative-time)',
    // -d <quoted-string> or -d <bareword> with non-numeric suffix
    pattern: /\bdate\s+-d\s+['"]?[a-zA-Z]/,
    fix:
      "`date -d 'yesterday'` is GNU-only. BSD form: `date -v-1d`. Branch on\n" +
      "uname or use a portable date library.",
  },
  {
    name: "stat -c (GNU-only format spec)",
    pattern: /\bstat\s+-c\b/,
    fix: "`stat -c` is GNU-only. BSD uses `stat -f`. Avoid both — pipe through awk.",
  },
];

function isShellScript(filePath: string): boolean {
  if (SHELL_EXTENSIONS.some((ext) => filePath.endsWith(ext))) return true;
  try {
    const head = fs.readFileSync(filePath, { encoding: "utf-8" }).slice(0, 64);
    return /^#!\s*\/(usr\/)?bin\/(env\s+)?(ba)?sh\b/.test(head);
  } catch {
    return false;
  }
}

runHook("bash-portability-on-write", async (input) => {
  if (process.env.LOOM_SKIP_PORTABILITY) return allow();

  const filePath: string | undefined =
    input.tool_input?.file_path ?? input.result?.file_path;
  if (!filePath) return allow();
  if (!isShellScript(filePath)) return allow();
  if (!fs.existsSync(filePath)) return allow();

  let content: string;
  try {
    content = fs.readFileSync(filePath, { encoding: "utf-8" });
  } catch {
    return allow();
  }

  const findings: string[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comments — patterns inside comments are commentary, not invocations.
    if (/^\s*#/.test(line)) continue;
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        findings.push(`  ${filePath}:${i + 1}: ${rule.name}\n    ${line.trim()}\n    Fix: ${rule.fix.split("\n").join("\n         ")}`);
      }
    }
  }

  if (findings.length === 0) return allow();

  const message =
    `bash-portability concerns in ${filePath}:\n${findings.join("\n\n")}\n\n` +
    `Disable for one file by setting LOOM_SKIP_PORTABILITY=1 in your env.`;
  return allow(message);
});
