/**
 * Pure-function classification heuristic for `/loom-library add`.
 *
 * Extracted in Phase 0 (Pass 4 architectural review) so Phase 4's vitest
 * tests can import directly without depending on `commands/loom-library.md`
 * (vitest cannot import from markdown). Phase 9 wires this module from the
 * command's `bun` runtime invocation.
 *
 * NO I/O at module level — `classifyAddSource` takes the file path and the
 * already-read content as parameters. The caller reads the file from disk.
 *
 * See planning/plans/PLAN-kit-native-skills.md § library-add-heuristic and
 * § Error Handling Specification → DEPRECATION_WARNING template.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Discriminated classification outcome. `ambiguous` triggers an inline
 *  N-04 prompt to the user. */
export type ClassifiedType = "skill" | "protocol" | "agent" | "prompt" | "ambiguous";

export interface ClassificationResult {
  type: ClassifiedType;
  /** Human-readable explanation of the decision. Useful in error messages
   *  and ambiguous-prompt context lines. */
  reason: string;
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Classify a candidate source file by inspecting its filename and content.
 *
 * Priority order (N-07: triggers-first, not filename-first):
 *   1. `triggers:` key in YAML frontmatter with at least one entry → `skill`
 *   2. AgentResult / state.toon schema markers → `protocol`
 *   3. `$ARGUMENTS` token → `prompt`
 *   4. Agent-style markers (`# Agent Instructions`, `You are an agent`) → `agent`
 *   5. Otherwise → `ambiguous`
 *
 * Notes:
 *   - `SKILL.md` filename WITHOUT a populated `triggers:` key is
 *     `ambiguous` (bt-4-38; CG-04). Empty `triggers: []` is also `ambiguous`
 *     (bt-4-43).
 *   - `filePath` is currently used only for the reason text, but reserved
 *     for richer filename-aware heuristics in future revisions.
 */
export function classifyAddSource(filePath: string, content: string): ClassificationResult {
  // 1) triggers: in frontmatter — primary signal.
  if (hasPopulatedTriggers(content)) {
    return {
      type: "skill",
      reason: "frontmatter `triggers:` is present and non-empty (Claude Code SKILL.md)",
    };
  }

  // 2) Protocol schema markers. Inter-agent messages routinely include
  //    `AgentResult` and `state.toon`-style fields.
  if (/\bAgentResult\b/.test(content) || /\bfilesCreated\[\d*\]\s*:/.test(content)) {
    return {
      type: "protocol",
      reason: "content contains AgentResult / Loom protocol schema markers",
    };
  }

  // 3) Prompt — `$ARGUMENTS` template variable is the canonical Claude
  //    Code slash-command marker.
  if (/\$ARGUMENTS\b/.test(content)) {
    return {
      type: "prompt",
      reason: "content contains the $ARGUMENTS slash-command marker",
    };
  }

  // 4) Agent — instructional / persona markers.
  if (/^#\s*Agent\s+Instructions\b/im.test(content) || /\bYou are an agent\b/i.test(content)) {
    return {
      type: "agent",
      reason: 'content contains agent-style markers ("# Agent Instructions" / "You are an agent")',
    };
  }

  // 5) Nothing matched.
  return {
    type: "ambiguous",
    reason: `no classification signal detected in ${filePath || "source"} — prompt user`,
  };
}

/**
 * Inline N-04 prompt template shown when `classifyAddSource` returns
 * `ambiguous`. The template body is fixed; `filePath` is currently unused
 * (reserved for future per-file context lines).
 *
 * The exact line shapes are pinned to the Phase 4 test assertions
 * (bt-4-45, bt-4-46, bt-4-47).
 */
export function formatAmbiguousPrompt(_filePath: string): string {
  return [
    "The source file's type is ambiguous. Choose:",
    "  [1] skill    — activates automatically on matching file patterns via Claude Code (SKILL.md format)",
    "  [2] protocol — inter-agent message schema used by Loom orchestration",
    "  [q] abort",
    "",
    "Selection:",
  ].join("\n");
}

/**
 * Render the N-24 DEPRECATION_WARNING template for a bare-name include that
 * was resolved via cross-section fallback.
 *
 * Substitutes `{name}` and `{type}` into the canonical template defined in
 * Error Handling Specification → DEPRECATION_WARNING.
 *
 * @example
 *   formatDeprecationWarning("python-conventions", "skill")
 *   // => "DEPRECATION WARNING: bare-name include 'python-conventions' resolved
 *   //     to skill:python-conventions via cross-section fallback. Update your
 *   //     kit to use the typed form (e.g. skill:python-conventions) before v5.
 *   //     Bare-name support will be removed in library catalog v5."
 */
export function formatDeprecationWarning(name: string, resolvedType: string): string {
  return (
    `DEPRECATION WARNING: bare-name include '${name}' resolved to ` +
    `${resolvedType}:${name} via cross-section fallback. Update your kit to ` +
    `use the typed form (e.g. ${resolvedType}:${name}) before v5. ` +
    `Bare-name support will be removed in library catalog v5.`
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Return true iff `content` has a YAML-frontmatter `triggers:` key with at
 * least one list item. Empty `triggers: []` returns false (bt-4-43 / CG-04).
 *
 * The check is intentionally regex-based — we don't depend on js-yaml here
 * because Phase 4 tests feed partial / minimal frontmatter fragments.
 */
function hasPopulatedTriggers(content: string): boolean {
  // Find the frontmatter block (between leading `---` lines). Fall back to
  // scanning the whole document for the `triggers:` key if no frontmatter is
  // demarcated — some authors embed frontmatter-style YAML inline.
  let block: string = content;
  const fmMatch = /^---\s*\n([\s\S]*?)\n---\s*$/m.exec(content);
  if (fmMatch) {
    block = fmMatch[1];
  }

  // Inline-array form: `triggers: ["..."]` or `triggers: []`.
  const inlineRe = /^triggers:\s*\[(.*?)\]\s*$/m;
  const inlineMatch = inlineRe.exec(block);
  if (inlineMatch) {
    const inner = inlineMatch[1].trim();
    return inner.length > 0;
  }

  // Block-array form: `triggers:` followed by `  - "..."` lines.
  // Bound the search to the triggers block only — stop at the next unindented
  // key so a `triggers:` with an empty body followed by `requires: [- foo]`
  // does not produce a false positive.
  const blockHeaderRe = /^triggers:\s*$/m;
  const headerMatch = blockHeaderRe.exec(block);
  if (!headerMatch) {
    return false;
  }
  const after = block.slice(headerMatch.index + headerMatch[0].length);
  // Bound the triggers block to the next YAML key at column 0. We deliberately
  // match `[A-Za-z0-9_-]+\s*:` rather than `^\S` so that comment lines starting
  // with `#` at column 0 do NOT count as a key boundary — they're noise inside
  // the triggers block, not the start of a new key.
  const nextKeysMatch = /^[A-Za-z0-9_-]+\s*:/m.exec(after);
  const triggersBlock = nextKeysMatch ? after.slice(0, nextKeysMatch.index) : after;
  const itemRe = /^\s+-\s+\S/m;
  return itemRe.test(triggersBlock);
}
