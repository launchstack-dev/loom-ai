#!/usr/bin/env bash
# F-03 fixture — repro script.
#
# Exits non-zero when the bug is present (divide(10, 0) does NOT throw).
# Exits zero when the fix is applied.
#
# The harness invokes this script via `bash <path>` (per scripts/debug-harness.ts
# § reproduceSymptom). Path-independent: relies on the buggy.ts that sits next
# to it in src/.

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBJECT="$DIR/src/buggy.ts"

# Run a tiny inline assertion via bun. We use `bun -e` to avoid pulling in any
# test runner. The script tries to call divide(10, 0); if it does NOT throw,
# we exit 1 (symptom reproduces). If it throws, exit 0 (symptom resolved).
bun -e "
import { divide } from '$SUBJECT';
try {
  const result = divide(10, 0);
  // If we get here without throwing, the bug is present.
  console.error('SYMPTOM: divide(10, 0) returned', result, '— expected throw');
  process.exit(1);
} catch (e) {
  // Throw is the post-fix behavior — symptom resolved.
  process.exit(0);
}
"
