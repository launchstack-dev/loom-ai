/**
 * Shared portability rule definitions used by:
 *   - hooks/bash-portability-on-write.ts (PostToolUse, fires at Claude
 *     write-time, feedback-only)
 *   - scripts/git-hooks/pre-commit (fail-closed gate at git commit time)
 *
 * Single source of truth. The two consumers cannot diverge silently because
 * the pre-commit hook calls `scripts/portability-scan.sh` which re-exports the
 * regex strings declared here via an extraction step.
 *
 * Adding a rule:
 *   1. Add an entry to RULES below.
 *   2. Add a corresponding line to scripts/portability-scan.sh (kept in sync
 *      with a comment block pointing back here; the pre-commit-bsdgrep test
 *      asserts the rule sets match).
 *   3. Document the underlying BSD/GNU divergence in the rule's `fix` field.
 */

export interface PortabilityRule {
  /** Stable identifier — used by tests and rule-suppression comments. */
  id: string;
  /** Human-readable name shown in the hook's feedback message. */
  name: string;
  /** The pattern to match. Linear time, no nested unbounded quantifiers. */
  pattern: RegExp;
  /** Multi-line explanation of the divergence and the portable form. */
  fix: string;
}

export const RULES: PortabilityRule[] = [
  {
    id: "mktemp-template-no-xxx",
    name: "mktemp -t without XXXXXX template",
    // GNU mktemp requires the template to end with >=3 X's. We match `mktemp
    // [-d] -t prefix` where prefix does NOT end with 3+ X's.
    pattern: /\bmktemp\s+(?:-d\s+)?-t\s+[A-Za-z0-9_.\-]*(?<![Xx]{3})\b(?!\.[Xx]{3,})/,
    fix:
      "GNU mktemp requires the template to end with at least 3 X's. Use:\n" +
      "  mktemp -d -t prefix.XXXXXX",
  },
  {
    id: "sed-i-gnu-only",
    name: "sed -i without backup arg (BSD incompatible)",
    // BSD sed requires an arg after -i (the suffix for in-place backup). The
    // canonical PORTABLE form is `sed -i.bak ...` (with a non-empty suffix).
    // Match the GNU-only form: `sed -i 's/...'` — `-i` followed by whitespace
    // then a quote, with no suffix in between. ALLOW `sed -i.bak '...'` and
    // ALLOW `sed -i '' '...'` (BSD-only empty-suffix form).
    pattern: /\bsed\s+-i\s+(?!['"]{2})['"]/,
    fix:
      "BSD sed requires an arg after -i (the suffix for in-place backup); GNU\n" +
      "sed accepts no arg. Use the portable form with a non-empty suffix:\n" +
      "  sed -i.bak 's/.../.../' file && rm file.bak",
  },
  {
    id: "readlink-f-gnu-only",
    name: "readlink -f (GNU-only)",
    pattern: /\breadlink\s+-f\b/,
    fix:
      "`readlink -f` is GNU-only; BSD has different semantics. Portable form:\n" +
      `  (cd "$(dirname "$path")" && pwd -P)/$(basename "$path")`,
  },
  {
    id: "grep-P-gnu-only",
    name: "grep -P / --perl-regexp (GNU-only)",
    // Match -P appearing as a standalone or as part of a flag combo at the
    // first arg position of grep. Do NOT match -A1/-B1 followed by -P at a
    // later position (those are valid GNU-only usage we already flag via the
    // first match).
    pattern: /\bgrep\s+(-[A-Za-z]*P|-P[A-Za-z]*|--perl-regexp)\b/,
    fix:
      "`grep -P` (Perl regex) is GNU-only. Use POSIX extended (`-E`) or pipe\n" +
      "through perl/awk instead.",
  },
  {
    id: "date-d-gnu-only",
    name: "date -d (GNU-only relative-time)",
    pattern: /\bdate\s+-d\s+['"]?[a-zA-Z]/,
    fix:
      "`date -d 'yesterday'` is GNU-only. BSD form: `date -v-1d`. Branch on\n" +
      "uname or use a portable date library.",
  },
  {
    id: "stat-c-gnu-only",
    name: "stat -c (GNU-only format spec)",
    pattern: /\bstat\s+-c\b/,
    fix: "`stat -c` is GNU-only. BSD uses `stat -f`. Avoid both — pipe through awk.",
  },
];

/**
 * Run every rule against a piece of shell-script content. Skips comment lines
 * (patterns inside comments are commentary, not invocations).
 *
 * Returns one finding per (rule, line) match. Multiple rules can match the
 * same line.
 */
export interface RuleMatch {
  ruleId: string;
  ruleName: string;
  line: number; // 1-indexed
  content: string;
  fix: string;
}

export function scanContent(content: string): RuleMatch[] {
  const findings: RuleMatch[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*#/.test(line)) continue;
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        findings.push({
          ruleId: rule.id,
          ruleName: rule.name,
          line: i + 1,
          content: line.trim(),
          fix: rule.fix,
        });
      }
    }
  }
  return findings;
}
