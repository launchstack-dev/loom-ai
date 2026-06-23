#!/usr/bin/env bash
# scripts/refresh-upstream-schemas.sh
#
# Refresh pinned snapshots of upstream Anthropic schemas under
# agents/protocols/upstream/. Wave 1 of PLAN-plugin-marketplace-migration
# validates Loom's `.claude-plugin/plugin.json` against this snapshot; if the
# snapshot is the deferred-fetch placeholder shipped in Wave 0, the validation
# is meaningless.
#
# This script fetches the current docs, extracts the JSON Schema for the plugin
# manifest, writes it to agents/protocols/upstream/plugin.schema.json, and
# updates agents/protocols/upstream/.meta.toon with a fresh snapshotDate.
#
# Invocation:
#   scripts/refresh-upstream-schemas.sh           # fetch + write
#   scripts/refresh-upstream-schemas.sh --check   # fetch + diff only (CI)
#
# Exit codes:
#   0  success (or --check found no drift)
#   1  fetch failure / extractor failure
#   2  --check detected drift (file would change)
#
# Dependencies: curl, jq, node (for the extractor). No bun-only features so it
# runs in stock GitHub Actions runners.

set -euo pipefail

# Anthropic's docs site renders pages client-side, so the HTML response has no
# code blocks. The Mintlify-backed docs expose a markdown twin at <url>.md that
# preserves fenced ```json blocks — that's what we scrape.
SOURCE_URL="${LOOM_PLUGIN_DOCS_URL:-https://code.claude.com/docs/en/plugins-reference.md}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UPSTREAM_DIR="$REPO_ROOT/agents/protocols/upstream"
SCHEMA_FILE="$UPSTREAM_DIR/plugin.schema.json"
META_FILE="$UPSTREAM_DIR/.meta.toon"
TODAY="$(date -u +%Y-%m-%d)"

MODE="write"
if [[ "${1:-}" == "--check" ]]; then
  MODE="check"
fi

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "refresh-upstream-schemas: missing required tool: $1" >&2
    exit 1
  }
}
require curl
require jq
require node

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT
RAW="$TMPDIR/page.md"
EXTRACTED="$TMPDIR/plugin.schema.json"

echo "refresh-upstream-schemas: fetching $SOURCE_URL"
if ! curl -fsSL --retry 3 --retry-delay 2 -o "$RAW" "$SOURCE_URL"; then
  echo "refresh-upstream-schemas: fetch failed" >&2
  exit 1
fi

# Anthropic's docs page embeds the plugin manifest schema as a fenced JSON code
# block. The extractor pulls every <code class="language-json"> block, parses
# each as JSON, and keeps the first one whose top-level shape matches the
# plugin manifest contract (has `name`, `version`, `description`, and either
# `commands` or `hooks` keys). If the docs page format ever changes, this is
# where the script breaks — failure here is the signal to update the extractor,
# not to silently fall back.
EXTRACTOR="$TMPDIR/extract.mjs"
cat > "$EXTRACTOR" <<'NODE'
import fs from 'node:fs';

const md = fs.readFileSync(process.argv[2], 'utf8');

// Match fenced ```json blocks. Mintlify appends ` theme={null}` after the
// language; tolerate any trailing junk on the opening fence line.
const codeBlocks = [];
const re = /^```json[^\n]*\n([\s\S]*?)^```$/gm;
let m;
while ((m = re.exec(md)) !== null) {
  codeBlocks.push(m[1]);
}

if (codeBlocks.length === 0) {
  console.error('extractor: no fenced ```json blocks found in markdown');
  process.exit(1);
}

const PLUGIN_KEYS = new Set(['commands', 'hooks', 'agents', 'skills', 'mcpServers']);
let chosen = null;
for (const block of codeBlocks) {
  try {
    const parsed = JSON.parse(block);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    const looksLikeManifest =
      'name' in parsed &&
      'version' in parsed &&
      'description' in parsed &&
      Object.keys(parsed).some((k) => PLUGIN_KEYS.has(k));
    if (looksLikeManifest) {
      chosen = parsed;
      break;
    }
  } catch {
    /* skip unparseable blocks */
  }
}

if (!chosen) {
  console.error('extractor: no code block matched plugin manifest shape');
  process.exit(1);
}

// The docs page ships an *example* manifest, not a JSON Schema. Synthesize a
// minimal JSON Schema from the example: every present top-level key becomes
// a property, type inferred from the example value. additionalProperties stays
// true so upstream additions do not break validation. Required keys are the
// three documented as mandatory.
function inferType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://loom-ai.dev/schemas/upstream/plugin.schema.json',
  title: 'Anthropic Claude Code Plugin Manifest (Loom-side snapshot)',
  description: `Synthesized from example manifest at ${process.argv[3]}. snapshotDate: ${process.argv[4]}. snapshotMethod: extract-example-and-infer-schema. Treat as guidance, not authoritative — additionalProperties=true so upstream changes do not break local validation.`,
  type: 'object',
  required: ['name', 'version', 'description'],
  additionalProperties: true,
  properties: {},
};

for (const [key, value] of Object.entries(chosen)) {
  schema.properties[key] = { type: inferType(value) };
}

fs.writeFileSync(process.argv[5], JSON.stringify(schema, null, 2) + '\n');
NODE

node "$EXTRACTOR" "$RAW" "$SOURCE_URL" "$TODAY" "$EXTRACTED" || {
  echo "refresh-upstream-schemas: extractor failed" >&2
  exit 1
}

if [[ "$MODE" == "check" ]]; then
  if ! diff -u "$SCHEMA_FILE" "$EXTRACTED" >/dev/null; then
    echo "refresh-upstream-schemas: drift detected" >&2
    diff -u "$SCHEMA_FILE" "$EXTRACTED" || true
    exit 2
  fi
  echo "refresh-upstream-schemas: no drift"
  exit 0
fi

# Atomic write (CLAUDE.md convention).
TMP_SCHEMA="$SCHEMA_FILE.tmp"
cp "$EXTRACTED" "$TMP_SCHEMA"
mv "$TMP_SCHEMA" "$SCHEMA_FILE"

# Update .meta.toon snapshotDate + snapshotMethod.
TMP_META="$META_FILE.tmp"
cat > "$TMP_META" <<TOON
upstreamSchemas[1]{filename,sourceUrl,snapshotDate,snapshotMethod}:
  plugin.schema.json,$SOURCE_URL,$TODAY,refresh-upstream-schemas.sh
TOON
mv "$TMP_META" "$META_FILE"

echo "refresh-upstream-schemas: wrote $SCHEMA_FILE (snapshotDate $TODAY)"
