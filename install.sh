#!/bin/bash
# Loom Installer (bootstrap)
#
# One-time bootstrap: copies agents, protocols, commands, and the library
# catalog into ~/.claude/. After running this, delete the repo if you like —
# all ongoing management (updates, new installs) is handled by /loom-library
# which fetches directly from GitHub.
#
# See: /loom-library or commands/loom-library.md for the catalog-based approach.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="${HOME}/.claude"

echo "Installing Loom..."
echo "Source: ${SCRIPT_DIR}"
echo "Target: ${CLAUDE_DIR}"
echo ""

# Create target directories
mkdir -p "${CLAUDE_DIR}/agents/protocols"
mkdir -p "${CLAUDE_DIR}/commands"
mkdir -p "${CLAUDE_DIR}/skills/library"

# Copy agents
for f in "${SCRIPT_DIR}/agents"/*.md; do
  name=$(basename "$f")
  target="${CLAUDE_DIR}/agents/${name}"
  cp "$f" "$target"
  echo "  COPY agents/${name}"
done

# Copy protocols
for f in "${SCRIPT_DIR}/agents/protocols"/*.md; do
  name=$(basename "$f")
  target="${CLAUDE_DIR}/agents/protocols/${name}"
  cp "$f" "$target"
  echo "  COPY protocols/${name}"
done

# Copy commands
for f in "${SCRIPT_DIR}/commands"/*.md; do
  name=$(basename "$f")
  target="${CLAUDE_DIR}/commands/${name}"
  cp "$f" "$target"
  echo "  COPY commands/${name}"
done

# Copy library.yaml
cp "${SCRIPT_DIR}/skills/library.yaml" "${CLAUDE_DIR}/skills/library/library.yaml"
echo "  COPY skills/library/library.yaml"

echo ""
echo "Done. You can delete this repo — all updates are managed via /loom-library."
echo ""
echo "Next: open Claude Code and run /loom-library to manage your install."
echo "  /loom-library list       — see what's installed vs available"
echo "  /loom-library use <name> — install an agent or command (resolves deps)"
echo "  /loom-library sync       — re-pull all installed items from GitHub"
echo "  /loom-library update     — check for new catalog entries"
echo "  /loom                    — full reference"
