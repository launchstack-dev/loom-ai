#!/usr/bin/env bash
# statusline-command.sh — thin wrapper that delegates to the Node.js renderer.
# Claude Code pipes JSON to stdin; this passes it through.
exec node "$(dirname "$0")/statusline-renderer.cjs"
