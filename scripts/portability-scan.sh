#!/usr/bin/env bash
# portability-scan.sh — run hooks/lib/portability-rules.ts against given files.
#
# Single source of truth for portability rules: this script delegates to the
# TypeScript module that the bash-portability-on-write hook also uses. Pairs
# with the pre-commit hook so the regex sets never diverge.
#
# Usage:
#   scripts/portability-scan.sh file1 [file2 ...]
#
# Exit codes:
#   0 — no findings
#   1 — findings printed to stdout
#   2 — invocation error (no runtime, no files)

set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: portability-scan.sh <file> [file ...]" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RULES_TS="${SCRIPT_DIR}/../hooks/lib/portability-rules.ts"

if [ ! -f "${RULES_TS}" ]; then
  echo "[portability-scan] rules module not found at ${RULES_TS}" >&2
  exit 2
fi

# Resolve runtime: bun first, then npx tsx. Mirror the hook runtime selection.
RUNTIME=""
if command -v bun >/dev/null 2>&1; then
  RUNTIME="bun"
elif command -v npx >/dev/null 2>&1; then
  RUNTIME="npx --yes tsx"
else
  # No runtime — skip silently (this is a feedback gate, not a hard
  # requirement). Pre-commit treats absence as "no findings".
  exit 0
fi

# Inline TS that reads files from argv, runs scanContent, and prints findings.
SCAN_SCRIPT=$(cat <<'TS'
import * as fs from "node:fs";
import { scanContent } from REPLACE_PATH;

let hadFindings = false;
for (const file of process.argv.slice(2)) {
  let content: string;
  try {
    content = fs.readFileSync(file, "utf-8");
  } catch (err: any) {
    process.stderr.write(`[portability-scan] could not read ${file}: ${err?.code ?? "unknown"}\n`);
    continue;
  }
  const findings = scanContent(content);
  if (findings.length === 0) continue;
  hadFindings = true;
  for (const f of findings) {
    console.log(`  ${file}:${f.line}: ${f.ruleName}`);
    console.log(`    ${f.content}`);
    const fixLines = f.fix.split("\n").join("\n         ");
    console.log(`    Fix: ${fixLines}`);
    console.log("");
  }
}

process.exit(hadFindings ? 1 : 0);
TS
)

# Materialize the inline script with the actual rules-module path and run it.
TMP=$(mktemp -t portability-scan.XXXXXX)
trap 'rm -f "${TMP}"' EXIT

# Use absolute path so the TS module resolver works regardless of cwd.
RULES_ABS="$(cd "$(dirname "${RULES_TS}")" && pwd)/$(basename "${RULES_TS}")"
echo "${SCAN_SCRIPT}" | sed "s|REPLACE_PATH|\"${RULES_ABS}\"|" > "${TMP}"

# shellcheck disable=SC2086 — RUNTIME word-split is intentional (e.g. "npx --yes tsx").
${RUNTIME} "${TMP}" "$@"
