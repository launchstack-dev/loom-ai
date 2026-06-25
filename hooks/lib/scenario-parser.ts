/**
 * Scenario block parser — extracts BDD-shaped Given/When/Then scenarios from
 * markdown documents (PLAN.md, ROADMAP.md, contract pages, change proposals).
 *
 * Scenarios are stored as fenced TOON blocks (`​`​`​`toon ... `​`​`​`) under a
 * parent heading (e.g., `#### Scenarios` in plans, `Scenarios:` in roadmap
 * features). See protocols/scenario.schema.md for the canonical field
 * reference and block format.
 *
 * This module is intentionally narrow: it parses the flat-key and simple-array
 * TOON shapes used by scenario blocks. It does NOT cover the full TOON spec
 * (typed object arrays, nested blocks) — those shapes do not appear inside a
 * scenario block.
 */

export type WhenTriggerType = "actor-action" | "system-event" | "api-call";

export type TestTier = "unit" | "integration" | "e2e" | "qa-review";

/**
 * A parsed scenario. Field names match scenario.schema.md exactly.
 *
 * `stateRef` is `null` when the empty value (`stateRef:`) is supplied or when
 * the field is omitted. `testTier` is `null` when the field is omitted; the
 * default-tier resolution chain in `scenario-validator.ts` fills it in.
 *
 * `sourceLine` is the 1-indexed line number of the opening fence in the source
 * markdown — used by validators to emit human-readable findings.
 */
export interface Scenario {
  id: string;
  title: string;
  given: string[];
  when: string;
  whenTriggerType: WhenTriggerType | string;
  then: string[];
  stateRef: string | null;
  tags: string[];
  testTier: TestTier | string | null;
  automatable: boolean;
  /** 1-indexed line where the opening ```toon fence appears in the source. */
  sourceLine: number;
}

/** A parse error tied to a specific scenario block (or unowned). */
export interface ScenarioParseError {
  /** 1-indexed line where the problem was detected. */
  line: number;
  /** Optional scenario id, if the block had one. */
  scenarioId?: string;
  /** Human-readable explanation. */
  message: string;
}

/** Result of parsing a markdown document for scenario blocks. */
export interface ScenarioParseResult {
  scenarios: Scenario[];
  errors: ScenarioParseError[];
}

interface FencedBlock {
  startLine: number; // 1-indexed line of the opening fence
  body: string;
}

/**
 * Parse all scenario blocks from a markdown source.
 *
 * A scenario block is any fenced code block with the `toon` info string that
 * appears under a Scenarios-style heading. To keep the parser maximally
 * compatible across parent doc shapes, we accept any fenced ```toon block —
 * downstream orchestrators (plan-scenarios.ts, roadmap-scenarios.ts) decide
 * which sections to include.
 */
export function parseScenarios(markdown: string): ScenarioParseResult {
  const blocks = extractToonBlocks(markdown);
  const scenarios: Scenario[] = [];
  const errors: ScenarioParseError[] = [];

  for (const block of blocks) {
    const parsed = parseScenarioBlock(block);
    if ("error" in parsed) {
      errors.push(parsed.error);
    } else {
      scenarios.push(parsed.scenario);
    }
  }

  return { scenarios, errors };
}

/**
 * Parse scenarios from a specific section of a markdown document.
 *
 * `sectionHeadingPattern` is a regex matched against the trimmed line; matching
 * lines are treated as section starts. Parsing continues until a heading of
 * equal-or-higher level is encountered (i.e., `## X` ends a `## Scenarios`
 * section; `### X` does not).
 */
export function parseScenariosInSection(
  markdown: string,
  sectionHeadingPattern: RegExp
): ScenarioParseResult {
  const lines = markdown.split("\n");
  const sections: Array<{ start: number; end: number }> = [];

  let activeStart: number | null = null;
  let activeHeadingLevel = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = /^(#{1,6})\s/.exec(line);

    if (headingMatch && activeStart !== null) {
      const level = headingMatch[1].length;
      if (level <= activeHeadingLevel) {
        sections.push({ start: activeStart, end: i - 1 });
        activeStart = null;
      }
    }

    if (sectionHeadingPattern.test(line.trim())) {
      const match = /^(#{1,6})\s/.exec(line);
      activeHeadingLevel = match ? match[1].length : 1;
      activeStart = i;
    }
  }

  if (activeStart !== null) {
    sections.push({ start: activeStart, end: lines.length - 1 });
  }

  const scenarios: Scenario[] = [];
  const errors: ScenarioParseError[] = [];

  for (const section of sections) {
    const slice = lines.slice(section.start, section.end + 1).join("\n");
    const result = parseScenarios(slice);

    // Offset line numbers back to original document coordinates.
    for (const s of result.scenarios) {
      scenarios.push({ ...s, sourceLine: s.sourceLine + section.start });
    }
    for (const e of result.errors) {
      errors.push({ ...e, line: e.line + section.start });
    }
  }

  return { scenarios, errors };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Extract every fenced ```toon block in document order. */
function extractToonBlocks(markdown: string): FencedBlock[] {
  const lines = markdown.split("\n");
  const blocks: FencedBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const openMatch = /^```\s*toon\s*$/.exec(line);
    if (!openMatch) {
      i++;
      continue;
    }

    const startLine = i + 1; // 1-indexed
    const bodyLines: string[] = [];
    i++;
    let closed = false;

    while (i < lines.length) {
      if (/^```\s*$/.test(lines[i])) {
        closed = true;
        i++;
        break;
      }
      bodyLines.push(lines[i]);
      i++;
    }

    if (closed) {
      blocks.push({ startLine, body: bodyLines.join("\n") });
    }
    // Unclosed fences are silently skipped — markdown parsers diverge on
    // recovery and we'd rather not bail on a single typo upstream.
  }

  return blocks;
}

type BlockParseOk = { scenario: Scenario };
type BlockParseErr = { error: ScenarioParseError };

function parseScenarioBlock(block: FencedBlock): BlockParseOk | BlockParseErr {
  const fields = parseFlatToon(block.body);

  if (!fields.has("id")) {
    return {
      error: {
        line: block.startLine,
        message: "scenario block missing required field 'id'",
      },
    };
  }

  const id = fields.get("id");
  const candidateId = typeof id === "string" ? id : undefined;

  if (!candidateId) {
    return {
      error: {
        line: block.startLine,
        message: "scenario block has empty 'id'",
      },
    };
  }

  // Required string fields — title, when, whenTriggerType.
  const title = fields.get("title");
  if (typeof title !== "string" || title.length === 0) {
    return {
      error: {
        line: block.startLine,
        scenarioId: candidateId,
        message: `scenario ${candidateId}: missing required field 'title'`,
      },
    };
  }

  const when = fields.get("when");
  if (typeof when !== "string" || when.length === 0) {
    return {
      error: {
        line: block.startLine,
        scenarioId: candidateId,
        message: `scenario ${candidateId}: missing required field 'when'`,
      },
    };
  }

  const whenTriggerType = fields.get("whenTriggerType");
  if (typeof whenTriggerType !== "string" || whenTriggerType.length === 0) {
    return {
      error: {
        line: block.startLine,
        scenarioId: candidateId,
        message: `scenario ${candidateId}: missing required field 'whenTriggerType'`,
      },
    };
  }

  // Required array fields — given, then, tags.
  const givenArr = readArrayField(block.body, "given");
  const thenArr = readArrayField(block.body, "then");
  const tagsArr = readArrayField(block.body, "tags");

  // Optional fields.
  const stateRefRaw = fields.has("stateRef") ? fields.get("stateRef") : null;
  const stateRef: string | null =
    typeof stateRefRaw === "string" && stateRefRaw.length > 0 ? stateRefRaw : null;

  const testTierRaw = fields.has("testTier") ? fields.get("testTier") : null;
  const testTier: string | null =
    typeof testTierRaw === "string" && testTierRaw.length > 0 ? testTierRaw : null;

  const automatableRaw = fields.get("automatable");
  if (typeof automatableRaw !== "boolean") {
    return {
      error: {
        line: block.startLine,
        scenarioId: candidateId,
        message: `scenario ${candidateId}: missing or non-boolean 'automatable' (expected true|false)`,
      },
    };
  }

  return {
    scenario: {
      id: candidateId,
      title,
      given: givenArr,
      when,
      whenTriggerType,
      then: thenArr,
      stateRef,
      tags: tagsArr,
      testTier,
      automatable: automatableRaw,
      sourceLine: block.startLine,
    },
  };
}

type ScalarValue = string | number | boolean | null;

/**
 * Parse flat key: value lines from a TOON block body.
 *
 * Behavior tailored to scenario blocks:
 * - Empty value (`stateRef:`) yields an empty string (parseScenarioBlock
 *   coerces this to null).
 * - Array headers (`given[2]: ...`) are skipped here; they're consumed by
 *   `readArrayField`.
 * - Indented continuation lines (typed-array rows) are ignored.
 */
function parseFlatToon(body: string): Map<string, ScalarValue> {
  const out = new Map<string, ScalarValue>();
  const lines = body.split("\n");

  for (const line of lines) {
    if (line.startsWith("  ")) continue; // typed-array row
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Skip array headers — they look like `name[N]:` or `name[N]{...}:`
    if (/^[A-Za-z_]\w*\[\d+\]/.test(trimmed)) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const rawValue = trimmed.slice(colonIdx + 1).trim();

    if (!isValidKey(key)) continue;

    out.set(key, parseScalar(rawValue));
  }

  return out;
}

function isValidKey(key: string): boolean {
  return /^[A-Za-z_]\w*$/.test(key);
}

function parseScalar(raw: string): ScalarValue {
  if (raw.length === 0) return "";
  if (raw === "null") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    return raw.slice(1, -1);
  }
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    return Number(raw);
  }
  return raw;
}

/**
 * Read a simple-array field from a TOON block: `name[N]: item1, item2`.
 *
 * Returns `[]` when the array is empty (`name[0]:`), missing, or malformed.
 * Items are trimmed; commas inside double-quoted segments are preserved.
 */
function readArrayField(body: string, fieldName: string): string[] {
  const lines = body.split("\n");
  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headerRe = new RegExp(`^${escaped}\\[(\\d+)\\]\\s*:\\s*(.*)$`);

  for (const line of lines) {
    const trimmed = line.trim();
    const match = headerRe.exec(trimmed);
    if (!match) continue;

    const count = Number.parseInt(match[1], 10);
    if (count === 0) return [];

    const valuesStr = match[2];
    if (!valuesStr) return [];
    return splitCsv(valuesStr).map((s) => stripQuotes(s.trim()));
  }
  return [];
}

function splitCsv(row: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;

  for (const ch of row) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

function stripQuotes(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1);
  }
  return s;
}
