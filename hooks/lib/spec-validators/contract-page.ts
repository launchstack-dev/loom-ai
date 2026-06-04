/**
 * Contract-page structural validator — Phase 7 of PLAN-spec-upgrades.md.
 *
 * Validates a single `category: contract` wiki page at
 * `.loom/wiki/pages/contract-{domain}.md` against the body-section, R-NN,
 * History, and replacedBy rules locked in
 * `agents/protocols/contract-page-extensions.schema.md`.
 *
 * Enforced rules (severity per `agents/protocols/validation-rules.md`):
 *
 *   blocking
 *     - all six required body sections present:
 *       Purpose, Requirements, Scenarios, Entities, Out of Scope, History
 *     - body sections appear in the order listed above
 *     - R-NN uniqueness within `## Requirements`
 *     - History chronology — each archived change's date is ≥ the previous one
 *     - sourceChanges[] frontmatter matches the History entries 1:1 (length
 *       AND order)
 *     - replacedBy (when set) resolves to an existing contract-{domain} page
 *
 *   warning  / info
 *     - Out of Scope section empty or placeholder (warning)
 *
 * Manual-edit (checksum) detection is in `contract-page-drift.ts` — a SEPARATE
 * validator so callers can run it independently when they care only about
 * structural drift (this file) vs. content drift (the drift validator).
 *
 * Wiki-lint pipeline integration (Phase 8 wiring):
 *
 *   - validateContractPage(filePath, options) — validate one page
 *   - validateAllContractPages(options)       — walk `.loom/wiki/pages/`
 *
 * Both return ContractPageFinding[] in the same envelope shape as
 * change-proposal.ts so the lint harness can render them uniformly.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { changeDir } from "../change-paths.js";

export type FindingSeverity = "blocking" | "warning" | "info";

/** A single contract-page validator finding. */
export interface ContractPageFinding {
  severity: FindingSeverity;
  /** Machine-readable rule identifier. */
  ruleId: string;
  /** Human-readable explanation. */
  message: string;
  /** pageId — `contract-{domain}` — of the offending page. */
  pageId: string;
  /** Absolute path to the offending file. */
  file: string;
}

export interface ContractPageValidateOptions {
  /** Project root (defaults to `process.cwd()`). */
  rootDir?: string;
  /** Wiki root override (defaults to `<rootDir>/.loom/wiki`). */
  wikiRoot?: string;
}

export interface ContractPageValidationResult {
  pageId: string;
  file: string;
  findings: ContractPageFinding[];
}

const RULE_SECTION_MISSING = "contract-page/section-missing";
const RULE_SECTION_OUT_OF_ORDER = "contract-page/section-out-of-order";
const RULE_REQUIREMENT_DUPLICATE = "contract-page/requirement-duplicate";
const RULE_HISTORY_BACKWARDS = "contract-page/history-backwards";
const RULE_HISTORY_MISMATCH = "contract-page/history-source-changes-mismatch";
const RULE_REPLACED_BY_DANGLING = "contract-page/replaced-by-dangling";
const RULE_OUT_OF_SCOPE_EMPTY = "contract-page/out-of-scope-empty";
const RULE_FRONTMATTER_MISSING = "contract-page/frontmatter-missing";
const RULE_FILE_MISSING = "contract-page/file-missing";

/** The six body sections required by contract-page-extensions.schema.md, in order. */
export const REQUIRED_CONTRACT_BODY_SECTIONS: ReadonlyArray<string> = [
  "Purpose",
  "Requirements",
  "Scenarios",
  "Entities",
  "Out of Scope",
  "History",
];

/**
 * Validate a single contract page file. `pageFile` is absolute; the page's
 * `pageId` is inferred from the file basename (`contract-{domain}.md`).
 */
export function validateContractPage(
  pageFile: string,
  options: ContractPageValidateOptions = {}
): ContractPageValidationResult {
  const rootDir = options.rootDir ?? process.cwd();
  const wikiRoot = options.wikiRoot ?? path.join(rootDir, ".loom", "wiki");
  const pagesDir = path.join(wikiRoot, "pages");

  const basename = path.basename(pageFile, ".md");
  const pageId = basename;

  const result: ContractPageValidationResult = {
    pageId,
    file: pageFile,
    findings: [],
  };

  if (!fs.existsSync(pageFile)) {
    result.findings.push({
      severity: "blocking",
      ruleId: RULE_FILE_MISSING,
      message: `Contract page does not exist at ${pageFile}.`,
      pageId,
      file: pageFile,
    });
    return result;
  }

  const raw = fs.readFileSync(pageFile, "utf8");
  const parsed = parsePageStructure(raw);
  if (parsed === null) {
    result.findings.push({
      severity: "blocking",
      ruleId: RULE_FRONTMATTER_MISSING,
      message: `Contract page ${pageId} has no parseable TOON frontmatter block.`,
      pageId,
      file: pageFile,
    });
    return result;
  }

  // --- Required body sections (presence + order) -------------------------
  const presentSections = parsed.sections.map((s) => s.heading);
  const presentSet = new Set(presentSections);
  for (const required of REQUIRED_CONTRACT_BODY_SECTIONS) {
    if (!presentSet.has(required)) {
      result.findings.push({
        severity: "blocking",
        ruleId: RULE_SECTION_MISSING,
        message: `Required body section "## ${required}" missing from ${pageId}.`,
        pageId,
        file: pageFile,
      });
    }
  }

  // Order check — only compare sections that ARE present. We do this on the
  // subsequence of required sections that actually appear, in their on-disk
  // order. If the indices into REQUIRED_CONTRACT_BODY_SECTIONS aren't
  // monotonically increasing, sections are out of order.
  const indexedRequired = presentSections
    .map((heading) => REQUIRED_CONTRACT_BODY_SECTIONS.indexOf(heading))
    .filter((idx) => idx !== -1);
  for (let i = 1; i < indexedRequired.length; i++) {
    if (indexedRequired[i] < indexedRequired[i - 1]) {
      result.findings.push({
        severity: "blocking",
        ruleId: RULE_SECTION_OUT_OF_ORDER,
        message:
          `Required body sections on ${pageId} are out of order. ` +
          `Expected order: ${REQUIRED_CONTRACT_BODY_SECTIONS.join(", ")}. ` +
          `Got: ${presentSections.filter((s) => REQUIRED_CONTRACT_BODY_SECTIONS.includes(s)).join(", ")}.`,
        pageId,
        file: pageFile,
      });
      break; // single finding per page is sufficient — issue is the ordering, not each pair
    }
  }

  // --- R-NN uniqueness within ## Requirements ----------------------------
  const reqsSection = parsed.sections.find((s) => s.heading === "Requirements");
  if (reqsSection !== undefined) {
    const idCounts = new Map<string, number>();
    const re = /\*\*(R-\d{2,})\*\*/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(reqsSection.body)) !== null) {
      idCounts.set(m[1], (idCounts.get(m[1]) ?? 0) + 1);
    }
    for (const [id, count] of idCounts) {
      if (count > 1) {
        result.findings.push({
          severity: "blocking",
          ruleId: RULE_REQUIREMENT_DUPLICATE,
          message: `Requirement ID ${id} appears ${count} times in ${pageId}'s ## Requirements section.`,
          pageId,
          file: pageFile,
        });
      }
    }
  }

  // --- History chronology + sourceChanges parity -------------------------
  const historySection = parsed.sections.find((s) => s.heading === "History");
  const historyEntries =
    historySection !== undefined ? parseHistoryEntries(historySection.body) : [];

  // History chronology — each archivedAt date >= the previous one.
  for (let i = 1; i < historyEntries.length; i++) {
    const prev = historyEntries[i - 1].date;
    const curr = historyEntries[i].date;
    if (curr < prev) {
      result.findings.push({
        severity: "blocking",
        ruleId: RULE_HISTORY_BACKWARDS,
        message:
          `History on ${pageId} is out of chronological order: ` +
          `${historyEntries[i].changeId} (${curr}) precedes ${historyEntries[i - 1].changeId} (${prev}).`,
        pageId,
        file: pageFile,
      });
    }
  }

  // sourceChanges[] vs. History entries — length and order MUST match.
  const sourceChanges = parsed.frontmatterArrays.get("sourceChanges") ?? [];
  if (sourceChanges.length !== historyEntries.length) {
    result.findings.push({
      severity: "blocking",
      ruleId: RULE_HISTORY_MISMATCH,
      message:
        `sourceChanges[] (length ${sourceChanges.length}) does not match ` +
        `History entries (length ${historyEntries.length}) on ${pageId}.`,
      pageId,
      file: pageFile,
    });
  } else {
    for (let i = 0; i < sourceChanges.length; i++) {
      if (sourceChanges[i] !== historyEntries[i].changeId) {
        result.findings.push({
          severity: "blocking",
          ruleId: RULE_HISTORY_MISMATCH,
          message:
            `sourceChanges[${i}]='${sourceChanges[i]}' does not match History entry ${i + 1} ` +
            `(changeId='${historyEntries[i].changeId}') on ${pageId}.`,
          pageId,
          file: pageFile,
        });
        break;
      }
    }
  }

  // --- replacedBy resolution --------------------------------------------
  const replacedBy = parsed.frontmatterScalars.get("replacedBy") ?? "";
  if (replacedBy.length > 0) {
    const targetFile = path.join(pagesDir, `${replacedBy}.md`);
    if (!fs.existsSync(targetFile)) {
      result.findings.push({
        severity: "blocking",
        ruleId: RULE_REPLACED_BY_DANGLING,
        message:
          `replacedBy on ${pageId} references '${replacedBy}' but no such ` +
          `page exists at ${path.relative(rootDir, targetFile)}.`,
        pageId,
        file: pageFile,
      });
    }
  }

  // --- Out of Scope warnings --------------------------------------------
  const outOfScope = parsed.sections.find((s) => s.heading === "Out of Scope");
  if (outOfScope !== undefined) {
    const body = outOfScope.body.trim();
    if (body.length === 0 || /^<!--/.test(body)) {
      result.findings.push({
        severity: "warning",
        ruleId: RULE_OUT_OF_SCOPE_EMPTY,
        message: `## Out of Scope on ${pageId} is empty — every domain should record exclusions.`,
        pageId,
        file: pageFile,
      });
    }
  }

  return result;
}

/**
 * Walk every `contract-*.md` page under `.loom/wiki/pages/` and aggregate
 * findings. Used by Phase 8 wiki-lint integration.
 */
export function validateAllContractPages(
  options: ContractPageValidateOptions = {}
): ContractPageFinding[] {
  const rootDir = options.rootDir ?? process.cwd();
  const wikiRoot = options.wikiRoot ?? path.join(rootDir, ".loom", "wiki");
  const pagesDir = path.join(wikiRoot, "pages");
  if (!fs.existsSync(pagesDir)) return [];

  const aggregated: ContractPageFinding[] = [];
  for (const entry of fs.readdirSync(pagesDir)) {
    if (!entry.startsWith("contract-")) continue;
    if (!entry.endsWith(".md")) continue;
    const result = validateContractPage(path.join(pagesDir, entry), options);
    aggregated.push(...result.findings);
  }
  return aggregated;
}

// ---------------------------------------------------------------------------
// Internals — minimal page structure parser
// ---------------------------------------------------------------------------

interface PageSection {
  heading: string;
  body: string;
}

interface PageStructure {
  frontmatterScalars: Map<string, string>;
  frontmatterArrays: Map<string, string[]>;
  sections: PageSection[];
}

/**
 * Parse the page into frontmatter scalars/arrays + an ordered list of H2
 * sections. Returns null when no TOON frontmatter is present (caller surfaces
 * as a blocking finding).
 */
function parsePageStructure(content: string): PageStructure | null {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  // Locate the frontmatter fences.
  let openIdx = -1;
  let closeIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (openIdx === -1 && /^```\s*toon\s*$/.test(lines[i])) {
      openIdx = i;
      continue;
    }
    if (openIdx !== -1 && /^```\s*$/.test(lines[i])) {
      closeIdx = i;
      break;
    }
  }
  if (openIdx === -1 || closeIdx === -1) return null;

  const frontmatterScalars = new Map<string, string>();
  const frontmatterArrays = new Map<string, string[]>();

  for (let i = openIdx + 1; i < closeIdx; i++) {
    const line = lines[i];
    if (line.startsWith("  ")) continue;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    // Simple array: `name[N]: a, b, c`.
    const arrayMatch = /^([A-Za-z_][A-Za-z0-9_]*)\[(\d+)\]\s*:\s*(.*)$/.exec(trimmed);
    if (arrayMatch && !arrayMatch[3].startsWith("{")) {
      const declared = Number(arrayMatch[2]);
      frontmatterArrays.set(arrayMatch[1], parseInlineList(arrayMatch[3], declared));
      continue;
    }
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();
    frontmatterScalars.set(key, value);
  }

  // Sections — H2 headings in body. Body starts after the closing fence.
  const sections: PageSection[] = [];
  let currentHeading: string | null = null;
  let buffer: string[] = [];
  for (let i = closeIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    if (h2) {
      if (currentHeading !== null) {
        sections.push({ heading: currentHeading, body: buffer.join("\n") });
      }
      currentHeading = h2[1].trim();
      buffer = [];
      continue;
    }
    buffer.push(line);
  }
  if (currentHeading !== null) {
    sections.push({ heading: currentHeading, body: buffer.join("\n") });
  }

  return { frontmatterScalars, frontmatterArrays, sections };
}

interface HistoryEntry {
  changeId: string;
  date: string;
}

/**
 * Parse a History section body into a list of entries. Each entry is an H3
 * heading of the form `### chg-{YYYYMMDD}-{slug} — {YYYY-MM-DD}` per
 * contract-page-extensions.schema.md → History Section.
 */
function parseHistoryEntries(body: string): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  // The em-dash separator is canonical in the schema; allow both em-dash and
  // hyphen forward-compat (writers should emit em-dash).
  const re = /^###\s+(chg-\d{8}-[a-z0-9-]+)\s+[—-]\s+(\d{4}-\d{2}-\d{2})\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    out.push({ changeId: m[1], date: m[2] });
  }
  return out;
}

function parseInlineList(rest: string, declared: number): string[] {
  if (declared === 0) return [];
  const trimmed = rest.trim();
  if (trimmed.length === 0) return [];
  const cells = splitCsvRow(trimmed);
  return cells.map((c) => c.trim()).filter((c) => c.length > 0);
}

function splitCsvRow(row: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') {
      const next = row[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
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

// ---------------------------------------------------------------------------
// Cross-validator integration — exported for Phase 8 wiring
// ---------------------------------------------------------------------------

/**
 * Validate every contract page referenced by an archived change-proposal's
 * `affectedSpecs[]`. Used by the wiki-lint pipeline to spot-check pages
 * touched by the most-recent set of archives without re-walking the whole
 * `.loom/wiki/pages/` tree.
 *
 * Intentionally light — no batching — so callers can scope arbitrarily.
 */
export function validateContractPagesForChange(
  changeId: string,
  domains: string[],
  options: ContractPageValidateOptions = {}
): ContractPageFinding[] {
  const rootDir = options.rootDir ?? process.cwd();
  const wikiRoot = options.wikiRoot ?? path.join(rootDir, ".loom", "wiki");
  const pagesDir = path.join(wikiRoot, "pages");
  // changeDir is only referenced for documentation; the caller has already
  // resolved the change directory. Keep the import live so refactors that
  // tighten path-helper usage don't drop it silently.
  void changeDir(rootDir, changeId);

  const aggregated: ContractPageFinding[] = [];
  for (const domain of domains) {
    const pageFile = path.join(pagesDir, `contract-${domain}.md`);
    const result = validateContractPage(pageFile, options);
    aggregated.push(...result.findings);
  }
  return aggregated;
}
