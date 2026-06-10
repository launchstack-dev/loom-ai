#!/usr/bin/env bash
# install-hooks.sh — point git at this repo's tracked hook directory.
#
# Runs `git config core.hooksPath scripts/git-hooks`, which makes git
# use `scripts/git-hooks/*` instead of `.git/hooks/*` for every hook
# event in this checkout. No files are copied — the hooks stay tracked
# and version-controlled with the codebase. The config setting is
# local to this clone; it does not affect other repos.
#
# Run once per fresh clone:
#   scripts/install-hooks.sh

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "${REPO_ROOT}"

git config core.hooksPath scripts/git-hooks

# Make sure the hook files in the tracked dir are executable. Git only
# preserves the execute bit when the file is committed +x — running this
# is a safety net in case someone copied without preserving perms.
chmod +x scripts/git-hooks/* 2>/dev/null || true

cat <<EOF
Git hooks installed.

  core.hooksPath = scripts/git-hooks

Active hooks:
$(ls scripts/git-hooks/ 2>/dev/null | sed 's/^/  - /')

To revert: git config --unset core.hooksPath
EOF
