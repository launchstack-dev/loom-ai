/**
 * scripts/loom-pause/secret-redactor.ts
 *
 * Pattern-based secret redactor for loom-pause handoff documents.
 * Strips known secret patterns from text and returns a count of
 * redacted secrets.
 *
 * Pure function — no side effects, no I/O.
 *
 * Documented secret patterns:
 *   - AWS access key IDs:         AKIA[0-9A-Z]{16}
 *   - GitHub tokens (fine-grained/classic):
 *       gh[pousr]_[A-Za-z0-9]{36}
 *   - Generic high-entropy assignments:
 *       (password|secret|token|api_key)\s*[=:]\s*\S+
 *
 * Run: bun scripts/loom-pause/secret-redactor.ts
 */

export interface RedactResult {
  /** The input string with all secret matches replaced by [REDACTED]. */
  redacted: string;
  /** Total number of secret occurrences stripped. */
  count: number;
}

/**
 * Ordered list of secret patterns.  Each entry has a human-readable label and
 * the compiled RegExp.  All patterns use the global flag so String.replace
 * replaces every occurrence and `match` counts all hits.
 */
const SECRET_PATTERNS: Array<{ label: string; re: RegExp }> = [
  {
    label: "aws-access-key-id",
    // AWS access key IDs: AKIA followed by 16 uppercase alphanumeric chars.
    re: /AKIA[0-9A-Z]{16}/g,
  },
  {
    label: "github-token",
    // GitHub tokens: gh followed by one of p/o/u/s/r, underscore, 36 alphanumeric.
    re: /gh[pousr]_[A-Za-z0-9]{36}/g,
  },
  {
    label: "generic-assignment",
    // Generic: password/secret/token/api_key = <value> or : <value>
    // Captures the key= prefix so the redaction preserves the key name.
    re: /((?:password|secret|token|api_key)\s*[=:]\s*)\S+/gi,
  },
];

/**
 * Redact all known secret patterns from `input`.
 *
 * @param input  Raw text that may contain secrets.
 * @returns      `{ redacted, count }` — the sanitised text and the total
 *               number of secret strings that were removed.
 */
export function redact(input: string): RedactResult {
  let text = input;
  let count = 0;

  for (const { re } of SECRET_PATTERNS) {
    // Reset lastIndex before counting (global regex is stateful).
    re.lastIndex = 0;
    const matches = text.match(re);
    if (matches) {
      count += matches.length;
    }

    // Re-run with replace — capture groups (group 1) must be preserved for
    // generic-assignment patterns so the key name remains visible.
    re.lastIndex = 0;
    if (re.source.includes("(")) {
      // Pattern has a capture group — preserve it, redact the rest.
      text = text.replace(re, "$1[REDACTED]");
    } else {
      text = text.replace(re, "[REDACTED]");
    }
  }

  return { redacted: text, count };
}
