#!/bin/sh
# probe-hook-runtime.sh — verify hook runtime resolution under a stripped PATH.
#
# Invoked by install.sh as a post-install check and by the Docker harness on
# Alpine. Runs the hook wrapper with a minimal PATH (no Homebrew bin) and a
# minimal Claude-Code-style stdin fixture to confirm the wrapper's PATH-prepend
# salvage works on a real machine.
#
# Exit codes:
#   0  — wrapper resolved a runtime and exited 0
#   1  — wrapper failed (no runtime / hook crashed); user should /loom-doctor
#
# Usage:
#   sh scripts/probe-hook-runtime.sh [hook-script-path] [fixture-path]
#
# Defaults probe `hooks/deploy-guard.ts` against `test/fixtures/hook-input.json`
# relative to the directory containing this script's parent (Loom root).

set -u

script_dir=$(cd "$(dirname "$0")" 2>/dev/null && pwd)
loom_root=$(cd "$script_dir/.." 2>/dev/null && pwd)

hook_script="${1:-${loom_root}/hooks/deploy-guard.ts}"
fixture="${2:-${loom_root}/test/fixtures/hook-input.json}"
wrapper="${loom_root}/hooks/run-hook.sh"

if [ ! -f "$wrapper" ]; then
  echo "probe-hook-runtime: wrapper not found at $wrapper" >&2
  exit 1
fi

if [ ! -f "$hook_script" ]; then
  # Missing hook script is not the probe's fault — skip cleanly so install.sh
  # can warn without blocking. Use exit code 2 to signal "skipped".
  echo "probe-hook-runtime: hook script not found at $hook_script — skipping" >&2
  exit 2
fi

# Build a fixture on the fly if none provided/exists. Minimal SessionStart-ish
# payload that won't trip deploy-guard's allow-list.
if [ ! -f "$fixture" ]; then
  fixture=$(mktemp 2>/dev/null || echo "/tmp/loom-probe-fixture.json")
  cat > "$fixture" <<'EOF'
{"session_id":"probe","transcript_path":"","cwd":"/tmp","hook_event_name":"SessionStart","tool_name":"Read","tool_input":{}}
EOF
fi

# Stripped PATH: no Homebrew bin. The wrapper itself prepends the standard
# Homebrew dirs (PR #9 salvage) — that's what we're exercising.
stripped_path="/usr/bin:/bin"

# Run under env -i so no inherited env can mask resolution bugs. Preserve HOME
# because the wrapper writes its fail-loud log under $HOME/.cache.
output=$(env -i HOME="${HOME:-/tmp}" PATH="$stripped_path" sh "$wrapper" "$hook_script" < "$fixture" 2>&1)
rc=$?

if [ "$rc" -ne 0 ]; then
  echo "probe-hook-runtime: wrapper exited $rc under stripped PATH" >&2
  if [ -n "$output" ]; then
    echo "$output" >&2
  fi
  echo "probe-hook-runtime: run /loom-doctor for diagnostics" >&2
  exit 1
fi

# Wrapper may emit a benign warning on stderr (e.g. "Neither bun nor node...")
# but still exit 0. Surface that as a warning, don't fail the probe.
if [ -n "$output" ]; then
  echo "probe-hook-runtime: wrapper exited 0 but emitted output:" >&2
  echo "$output" >&2
fi

exit 0
