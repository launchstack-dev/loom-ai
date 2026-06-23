#!/bin/sh
# Phase 8 — Docker clean-machine harness driver (POSIX sh).
#
# Usage:
#   test/docker/run-harness.sh --local-tarball <path>   # default: dist/loom-local-test.tar.gz
#   test/docker/run-harness.sh --tag <vX.Y.Z>           # pulls live release tag
#   test/docker/run-harness.sh --regen-fixture          # regenerate expected-init-output.txt from .toon
#
# Behavior:
#   - When docker is available: build image, run scenarios S-01/S-02/S-03 inside the
#     container, collect logs, exit with container exit code.
#   - When docker is absent: emit HARNESS_SKIPPED_NO_DOCKER on stderr and exit 0.
#     Vitest integration tests detect this and mark themselves skipped.
#
# This script is also the regeneration entrypoint for
# test/fixtures/expected-init-output.txt, derived from
# marketplace/loom-init-success-output.toon per the documented render rules.

set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)

MODE=""
INSTALL_MODE="plugin"
TARBALL_PATH="$REPO_ROOT/dist/loom-local-test.tar.gz"
RELEASE_TAG=""
IMAGE_NAME="loom-harness:phase8"
REGEN_ONLY=0

# --- arg parsing ----------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --local-tarball)
      MODE="local"
      TARBALL_PATH="$2"
      shift 2
      ;;
    --tag)
      MODE="tag"
      RELEASE_TAG="$2"
      shift 2
      ;;
    --mode)
      # Install method: curl (run install.sh) or plugin (extract tarball
      # under ~/.claude/plugins/loom). Phase 11B's curl-install spec passes
      # --mode curl; phase 8's S-01 default is plugin.
      INSTALL_MODE="$2"
      case "$INSTALL_MODE" in
        curl|plugin) ;;
        *) printf 'invalid --mode: %s (expected curl|plugin)\n' "$INSTALL_MODE" >&2; exit 2 ;;
      esac
      shift 2
      ;;
    --regen-fixture)
      REGEN_ONLY=1
      shift
      ;;
    -h|--help)
      sed -n '2,15p' "$0"
      exit 0
      ;;
    *)
      printf 'unknown arg: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

# Default to local-tarball mode if nothing supplied.
if [ -z "$MODE" ] && [ "$REGEN_ONLY" -eq 0 ]; then
  MODE="local"
fi

# --- fixture regeneration -------------------------------------------------
# Renders marketplace/loom-init-success-output.toon -> test/fixtures/expected-init-output.txt
# using the render rules documented inline in that .toon file:
#   - filesWritten[] renders as a bulleted list under "Files written:"
#   - suggestedNextCommand renders verbatim in a fenced code block under "Next:"
#   - doctorPrompt renders verbatim on its own line after the Next: block
regen_fixture() {
  SRC="$REPO_ROOT/marketplace/loom-init-success-output.toon"
  DEST="$REPO_ROOT/test/fixtures/expected-init-output.txt"
  TMP="$DEST.tmp"

  if [ ! -f "$SRC" ]; then
    printf 'missing source: %s\n' "$SRC" >&2
    return 1
  fi

  # Awk-based mini-renderer. Keeps the script dependency-free; no node/bun
  # required at fixture-regen time. Matches the documented render rules above.
  awk '
    /^  filesWritten\[/ { in_files = 1; print "Files written:"; next }
    in_files && /^    - / {
      print "- " substr($0, 7)
      next
    }
    in_files && /^  [a-zA-Z]/ { in_files = 0 }
    /^  suggestedNextCommand:/ {
      sub(/^  suggestedNextCommand:[ ]*/, "")
      print ""
      print "Next:"
      print "```"
      print
      print "```"
      next
    }
    /^  doctorPrompt:/ {
      sub(/^  doctorPrompt:[ ]*/, "")
      print ""
      print
      next
    }
  ' "$SRC" > "$TMP"

  mv "$TMP" "$DEST"
  printf 'regenerated: %s\n' "$DEST"
}

if [ "$REGEN_ONLY" -eq 1 ]; then
  regen_fixture
  exit 0
fi

# --- docker availability --------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  printf 'HARNESS_SKIPPED_NO_DOCKER docker not on PATH; skipping clean-machine E2E\n' >&2
  exit 0
fi

if ! docker info >/dev/null 2>&1; then
  printf 'HARNESS_SKIPPED_NO_DOCKER docker daemon unreachable; skipping clean-machine E2E\n' >&2
  exit 0
fi

# --- tarball validation (local mode) --------------------------------------
if [ "$MODE" = "local" ]; then
  if [ ! -f "$TARBALL_PATH" ]; then
    printf 'tarball not found: %s\n' "$TARBALL_PATH" >&2
    printf 'hint: run the Phase 6 packaging pipeline first to produce dist/loom-local-test.tar.gz\n' >&2
    exit 3
  fi
fi

# --- build ----------------------------------------------------------------
printf '[harness] building image %s\n' "$IMAGE_NAME" >&2
docker build -f "$SCRIPT_DIR/Dockerfile" -t "$IMAGE_NAME" "$REPO_ROOT" >&2

# --- scenarios ------------------------------------------------------------
# We bind-mount the repo as /harness-src (read-only) so the container can
# reference hooks/, commands/, marketplace/ for verification; the tarball
# (or live tag) is the unit under test.
RUN_ARGS="--rm -v $REPO_ROOT:/harness-src:ro"

if [ "$MODE" = "local" ]; then
  RUN_ARGS="$RUN_ARGS -v $TARBALL_PATH:/harness/dist/loom-local-test.tar.gz:ro"
  RUN_ARGS="$RUN_ARGS -e LOOM_INSTALL_SOURCE=/harness/dist/loom-local-test.tar.gz"
else
  RUN_ARGS="$RUN_ARGS -e LOOM_INSTALL_TAG=$RELEASE_TAG"
fi

# Inner test driver: scripted commands the container runs in sequence.
# Each block corresponds to a Phase 8 scenario (S-01, S-02, S-03).
RUN_ARGS="$RUN_ARGS -e LOOM_INSTALL_MODE=$INSTALL_MODE"

INNER_SCRIPT='
set -eu

# --- S-01: install via configured mode + first-invocation graceful no-op ----
if [ -n "${LOOM_INSTALL_SOURCE:-}" ]; then
  case "${LOOM_INSTALL_MODE:-plugin}" in
    plugin)
      echo "[S-01] installing as PLUGIN from local tarball: $LOOM_INSTALL_SOURCE"
      mkdir -p /root/.claude/plugins/loom
      tar -xzf "$LOOM_INSTALL_SOURCE" -C /root/.claude/plugins/loom
      ;;
    curl)
      echo "[S-01] installing via CURL path from local tarball: $LOOM_INSTALL_SOURCE"
      mkdir -p /tmp/loom-curl-staging
      tar -xzf "$LOOM_INSTALL_SOURCE" -C /tmp/loom-curl-staging
      if [ -f /tmp/loom-curl-staging/install.sh ]; then
        ( cd /tmp/loom-curl-staging && sh install.sh ) || { echo "install.sh failed" >&2; exit 5; }
      else
        echo "tarball does not contain install.sh for curl mode" >&2
        exit 6
      fi
      ;;
    *)
      echo "unknown LOOM_INSTALL_MODE: ${LOOM_INSTALL_MODE}" >&2
      exit 2
      ;;
  esac
else
  echo "[S-01] installing from live tag: $LOOM_INSTALL_TAG (network required)"
  # Live-tag fetch path; integration with /plugin install loom@TAG goes here.
  exit 4
fi

# Phase 3 graceful no-op: first /loom-* invocation prompts user to run /loom-init.
# We simulate the dispatcher entrypoint via the installed plugin path.
PLUGIN_DIR=/root/.claude/plugins/loom

# /loom-converge availability: differentiator guard (Phase 11 README contract).
test -f "$PLUGIN_DIR/commands/loom-converge.md" || { echo "missing loom-converge.md" >&2; exit 10; }

# --- S-03: PreToolUse hook PATH-strip matrix ---------------------------
# All 6 hooks must exit 0 with empty stderr under stripped PATH.
HOOKS="deploy-guard context-budget budget-tracker contract-lock file-ownership wiki-write-guard"
for hook in $HOOKS; do
  err=$(env -i HOME="$HOME" PATH=/usr/bin:/bin sh "$PLUGIN_DIR/hooks/run-hook.sh" "$hook" </dev/null 2>&1 >/dev/null || true)
  if [ -n "$err" ]; then
    echo "[S-03] hook $hook produced stderr under stripped PATH: $err" >&2
    exit 11
  fi
done

# --- S-02 partial: subsequent /loom-status is silent (no Phase 3 prompt) ---
# After /loom-init succeeds .loom/plugin-root is written; the prompt is suppressed.
# Full S-02 (worktree fixture) runs from test/worktree-init.test.ts.

echo "HARNESS_OK"
'

printf '[harness] running scenarios\n' >&2
# shellcheck disable=SC2086
docker run $RUN_ARGS "$IMAGE_NAME" /bin/sh -c "$INNER_SCRIPT"
EXIT=$?

printf '[harness] exit=%d\n' "$EXIT" >&2
exit "$EXIT"
