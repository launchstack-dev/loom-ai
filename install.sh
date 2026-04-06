#!/bin/bash
# Meta-Orchestration System Installer
# Symlinks agents, commands, and protocols into ~/.claude/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="${HOME}/.claude"

echo "Installing meta-orchestration system..."
echo "Source: ${SCRIPT_DIR}"
echo "Target: ${CLAUDE_DIR}"
echo ""

# Create target directories
mkdir -p "${CLAUDE_DIR}/agents/protocols"
mkdir -p "${CLAUDE_DIR}/commands"
mkdir -p "${CLAUDE_DIR}/skills/library"

# Link agents
for f in "${SCRIPT_DIR}/agents"/*.md; do
  name=$(basename "$f")
  target="${CLAUDE_DIR}/agents/${name}"
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    echo "  SKIP ${name} (exists, not a symlink — back up manually)"
  else
    ln -sf "$f" "$target"
    echo "  LINK agents/${name}"
  fi
done

# Link protocols
for f in "${SCRIPT_DIR}/agents/protocols"/*.md; do
  name=$(basename "$f")
  target="${CLAUDE_DIR}/agents/protocols/${name}"
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    echo "  SKIP protocols/${name} (exists, not a symlink)"
  else
    ln -sf "$f" "$target"
    echo "  LINK agents/protocols/${name}"
  fi
done

# Link commands
for f in "${SCRIPT_DIR}/commands"/*.md; do
  name=$(basename "$f")
  target="${CLAUDE_DIR}/commands/${name}"
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    echo "  SKIP commands/${name} (exists, not a symlink)"
  else
    ln -sf "$f" "$target"
    echo "  LINK commands/${name}"
  fi
done

# Link library.yaml
target="${CLAUDE_DIR}/skills/library/library.yaml"
if [ -e "$target" ] && [ ! -L "$target" ]; then
  echo "  SKIP skills/library/library.yaml (exists, not a symlink)"
else
  ln -sf "${SCRIPT_DIR}/skills/library.yaml" "$target"
  echo "  LINK skills/library/library.yaml"
fi

echo ""
echo "Done. Available commands:"
echo "  /review-plan    — 5-agent parallel plan review"
echo "  /execute-plan   — wave-by-wave execution with approval gates"
echo "  /test-plan      — acceptance criteria + unit + E2E test generation"
echo "  /review-code    — built-in + bespoke code review"
echo "  /roadmap        — plan creation, tracking, and milestone management"
echo "  /help           — full reference"
