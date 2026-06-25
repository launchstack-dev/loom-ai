/**
 * Atomic writer for `.loom/wiki/pages/contract-{domain}.md` pages.
 *
 * Responsibilities:
 *   1. Compose the page frontmatter + body from a structured {@link ContractPageInput}.
 *   2. Compute `contentChecksum` using the canonical-body algorithm from
 *      `hooks/lib/checksum.ts` and embed it in the frontmatter BEFORE writing —
 *      the stored checksum covers the body that will actually live on disk.
 *   3. Write atomically via `.tmp` + rename per
 *      `protocols/execution-conventions.md`.
 *   4. Update the wiki index entry for the page per
 *      `protocols/wiki-index.schema.md` (atomic, bump `wikiVersion`,
 *      keep `pageCount` + `categories[]` in sync).
 *
 * This module is the only authorized writer of `contract-*` pages at greenfield
 * materialization time. Steady-state writes come from the change-archive
 * pipeline (Phase 6), which MUST also call through here so the checksum and
 * the body never diverge.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { canonicalBodyChecksum } from "./checksum.js";

/** A Scenario block as it will appear in `## Scenarios`. */
export interface ContractPageScenario {
  id: string;
  title: string;
  given: string[];
  /** Single `when` trigger per scenario schema. */
  when: string;
  whenTriggerType: string;
  then: string[];
  stateRef: string | null;
  tags: string[];
  /** Resolved tier; null is permitted and emitted as an empty value. */
  testTier: string | null;
  automatable: boolean;
}

/** A numbered requirement block as it will appear in `## Requirements`. */
export interface ContractPageRequirement {
  /** `R-NN` — zero-padded 2+ digits. Uniqueness is enforced by the validator. */
  id: string;
  /** `functional` | `non-functional`. */
  requirementType: "functional" | "non-functional";
  /** One-sentence RFC 2119 statement. */
  text: string;
}

/** A schema-style entity definition as it will appear in `## Entities`. */
export interface ContractPageEntity {
  name: string;
  /** Optional 1-line description above the table. */
  description?: string;
  fields: ContractPageEntityField[];
}

export interface ContractPageEntityField {
  name: string;
  type: string;
  constraints: string;
}

/** A History entry — one per archived change. */
export interface ContractPageHistoryEntry {
  /** `chg-{YYYYMMDD}-{slug}` — must match an entry in `sourceChanges[]`. */
  changeId: string;
  /** ISO date (YYYY-MM-DD) appearing in the entry heading. */
  date: string;
  rationale: string;
  deltas: string;
  /** `true` when the change broke compatibility. */
  breaking: boolean;
}

/** Input to {@link writeContractPage}. */
export interface ContractPageInput {
  /** kebab-case domain — becomes the `{domain}` portion of `contract-{domain}`. */
  domain: string;
  /** Human-readable title for the page. */
  title: string;
  /** One-line elevator pitch, ≤200 chars, no markdown. */
  summary: string;
  /** Free-text body for `## Purpose`. */
  purpose: string;
  requirements: ContractPageRequirement[];
  /** Empty array → emit placeholder per the Phase 4 spec. */
  scenarios: ContractPageScenario[];
  entities: ContractPageEntity[];
  /** Free-text items for `## Out of Scope`. May be empty (validator warns). */
  outOfScope: string[];
  /** History — chronological. Empty for greenfield. */
  history: ContractPageHistoryEntry[];

  // --- Frontmatter fields (lifecycle additions) --------------------------
  /** Currently `1`. */
  contractVersion: number;
  /** `active` | `deprecated` | `superseded`. */
  contractStatus: "active" | "deprecated" | "superseded";
  /** Chronological change IDs that mutated this page. */
  sourceChanges: string[];
  /** ISO 8601 timestamp; null when `contractStatus === "active"`. */
  deprecatedAt: string | null;
  /** Successor `contract-{domain}` pageId; null when not superseded. */
  replacedBy: string | null;

  // --- Base wiki-page fields (subset; base writer fields not added here) --
  sourceRefs: string[];
  tags: string[];
  /** ISO 8601 timestamp for `createdAt`. */
  createdAt: string;
  /** ISO 8601 timestamp for `updatedAt`. */
  updatedAt: string;
  /** Identity of the writer (`materializer` for greenfield). */
  createdBy: string;
  updatedBy: string;
}

/** Result of a single {@link writeContractPage} call. */
export interface WriteContractPageResult {
  /** Absolute path to the materialized page. */
  pageFile: string;
  /** The `pageId` written into frontmatter — `contract-{domain}`. */
  pageId: string;
  /** The `sha256:<hex>` checksum stored on the page. */
  contentChecksum: string;
  /** Number of warnings emitted (e.g., empty-scenarios placeholder). */
  warningCount: number;
  /** Free-text warnings — surfaced by the materializer caller for logging. */
  warnings: string[];
}

/** Index entry to seed `pages[]` in `.loom/wiki/index.toon`. */
export interface WikiIndexRow {
  pageId: string;
  title: string;
  category: string;
  subtype: string;
  staleness: string;
  updatedAt: string;
  summary: string;
  estimatedTokens: number;
}

const CONTRACT_PAGE_BODY_SECTIONS = [
  "Purpose",
  "Requirements",
  "Scenarios",
  "Entities",
  "Out of Scope",
  "History",
] as const;

const EMPTY_SCENARIOS_PLACEHOLDER =
  "<!-- no scenarios found — re-run after upgrading to planVersion: 2 -->";

/**
 * Compose, checksum, and atomically write a single contract page.
 *
 * `wikiRoot` is the wiki directory root (typically `.loom/wiki`); the page is
 * written to `{wikiRoot}/pages/contract-{input.domain}.md`. Returns a result
 * struct describing what was written, the checksum that was stamped, and any
 * warnings the caller should surface (the empty-scenarios fallback emits one).
 */
export function writeContractPage(
  wikiRoot: string,
  input: ContractPageInput
): WriteContractPageResult {
  validateInput(input);

  const pageId = `contract-${input.domain}`;
  const pagesDir = path.join(wikiRoot, "pages");
  const pageFile = path.join(pagesDir, `${pageId}.md`);

  fs.mkdirSync(pagesDir, { recursive: true });

  const warnings: string[] = [];
  const body = buildBody(input, warnings);
  const contentChecksum = canonicalBodyChecksum(body);

  // Frontmatter must include the contentChecksum so the page-as-written has
  // the canonical checksum embedded. The body is hashed before frontmatter is
  // composed — the frontmatter never contributes to the canonical body.
  const fullPage = composeFullPage({
    pageId,
    body,
    contentChecksum,
    input,
  });

  atomicWriteFile(pageFile, fullPage);

  return {
    pageFile,
    pageId,
    contentChecksum,
    warningCount: warnings.length,
    warnings,
  };
}

/**
 * Update the wiki index with one or more contract-page rows, atomically.
 *
 * Strategy:
 *   - If `.loom/wiki/index.toon` exists, parse just enough to extract the
 *     header fields (`schemaVersion`, `projectName`, `domain`, `wikiVersion`)
 *     and the existing rows so we can merge new rows in.
 *   - Replace any existing row with the same `pageId`; append otherwise.
 *   - Recompute `pageCount`, `categories[]`, `lastUpdated`, and bump
 *     `wikiVersion`.
 *   - Write back via `.tmp` + rename.
 *
 * If no index exists yet, write a minimal one with `schemaVersion: 2`.
 */
export function upsertContractWikiIndexEntries(
  wikiRoot: string,
  rows: WikiIndexRow[],
  options: { projectName?: string; domain?: string } = {}
): { indexFile: string; wikiVersion: number; pageCount: number } {
  const indexFile = path.join(wikiRoot, "index.toon");

  let existingRows: WikiIndexRow[] = [];
  let projectName = options.projectName ?? "unknown";
  let domain = options.domain ?? "code";
  let wikiVersion = 0;

  if (fs.existsSync(indexFile)) {
    const raw = fs.readFileSync(indexFile, "utf8");
    const parsed = parseIndexLight(raw);
    existingRows = parsed.rows;
    projectName = parsed.projectName ?? projectName;
    domain = parsed.domain ?? domain;
    wikiVersion = parsed.wikiVersion ?? 0;
  }

  // Merge: replace by pageId, append otherwise.
  const byId = new Map<string, WikiIndexRow>();
  for (const row of existingRows) byId.set(row.pageId, row);
  for (const row of rows) byId.set(row.pageId, row);

  const merged = Array.from(byId.values()).sort((a, b) => {
    if (a.category !== b.category) return a.category < b.category ? -1 : 1;
    return a.pageId < b.pageId ? -1 : a.pageId > b.pageId ? 1 : 0;
  });

  // Category counts.
  const categoryCounts = new Map<string, number>();
  for (const row of merged) {
    categoryCounts.set(row.category, (categoryCounts.get(row.category) ?? 0) + 1);
  }
  const categoriesSorted = Array.from(categoryCounts.entries()).sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0
  );

  const nextWikiVersion = wikiVersion + 1;
  const pageCount = merged.length;
  const lastUpdated = new Date().toISOString();

  const out: string[] = [];
  out.push(`schemaVersion: 2`);
  out.push(`projectName: ${projectName}`);
  out.push(`domain: ${domain}`);
  out.push(`wikiVersion: ${nextWikiVersion}`);
  out.push(`pageCount: ${pageCount}`);
  out.push(`lastUpdated: ${lastUpdated}`);
  out.push(``);
  out.push(
    `pages[${pageCount}]{pageId,title,category,subtype,staleness,updatedAt,summary,estimatedTokens}:`
  );
  for (const row of merged) {
    const summary = escapeCsvCell(row.summary);
    out.push(
      `  ${row.pageId},${row.title},${row.category},${row.subtype},${row.staleness},${row.updatedAt},${summary},${row.estimatedTokens}`
    );
  }
  out.push(``);
  out.push(`categories[${categoriesSorted.length}]{name,count}:`);
  for (const [name, count] of categoriesSorted) {
    out.push(`  ${name},${count}`);
  }
  out.push(``);

  atomicWriteFile(indexFile, out.join("\n"));

  return { indexFile, wikiVersion: nextWikiVersion, pageCount };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function validateInput(input: ContractPageInput): void {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(input.domain)) {
    throw new Error(`contract-page-writer: invalid domain "${input.domain}" (must be kebab-case)`);
  }
  if (input.contractVersion !== 1) {
    throw new Error(
      `contract-page-writer: unsupported contractVersion ${input.contractVersion} (expected 1)`
    );
  }
  if (input.contractStatus === "active" && input.deprecatedAt !== null) {
    throw new Error(
      `contract-page-writer: contractStatus=active requires deprecatedAt=null`
    );
  }
  if (input.contractStatus !== "active" && input.deprecatedAt === null) {
    throw new Error(
      `contract-page-writer: contractStatus=${input.contractStatus} requires non-null deprecatedAt`
    );
  }
  if (input.sourceChanges.length !== input.history.length) {
    throw new Error(
      `contract-page-writer: sourceChanges.length (${input.sourceChanges.length}) ` +
        `does not equal history.length (${input.history.length})`
    );
  }
  for (let i = 0; i < input.sourceChanges.length; i++) {
    if (input.sourceChanges[i] !== input.history[i].changeId) {
      throw new Error(
        `contract-page-writer: sourceChanges[${i}] (${input.sourceChanges[i]}) ` +
          `does not match history[${i}].changeId (${input.history[i].changeId})`
      );
    }
  }
}

function buildBody(input: ContractPageInput, warnings: string[]): string {
  const sections: string[] = [];
  sections.push(`# ${input.title}`);

  // Purpose
  sections.push(`## Purpose`);
  sections.push(input.purpose.trim());

  // Requirements
  sections.push(`## Requirements`);
  if (input.requirements.length === 0) {
    sections.push(`<!-- no requirements yet — populate in next change proposal -->`);
  } else {
    const reqLines: string[] = [];
    for (const r of input.requirements) {
      reqLines.push(`**${r.id}** *(${r.requirementType})* — ${r.text.trim()}`);
    }
    sections.push(reqLines.join("\n\n"));
  }

  // Scenarios
  sections.push(`## Scenarios`);
  if (input.scenarios.length === 0) {
    sections.push(EMPTY_SCENARIOS_PLACEHOLDER);
    warnings.push(
      `contract-${input.domain}: no scenarios in source plan/roadmap — emitted placeholder`
    );
  } else {
    const blocks: string[] = [];
    for (const s of input.scenarios) {
      blocks.push(renderScenarioBlock(s));
    }
    sections.push(blocks.join("\n\n"));
  }

  // Entities
  sections.push(`## Entities`);
  if (input.entities.length === 0) {
    sections.push(`<!-- no entities promoted from source -->`);
  } else {
    const blocks: string[] = [];
    for (const e of input.entities) {
      blocks.push(renderEntityTable(e));
    }
    sections.push(blocks.join("\n\n"));
  }

  // Out of Scope
  sections.push(`## Out of Scope`);
  if (input.outOfScope.length === 0) {
    sections.push(`<!-- explicit exclusions go here -->`);
  } else {
    sections.push(input.outOfScope.map((item) => `- ${item}`).join("\n"));
  }

  // History
  sections.push(`## History`);
  if (input.history.length === 0) {
    sections.push(
      `<!-- greenfield page — no archived changes yet; first change proposal will append here -->`
    );
  } else {
    const blocks: string[] = [];
    for (const h of input.history) {
      blocks.push(renderHistoryEntry(h));
    }
    sections.push(blocks.join("\n\n"));
  }

  // The body is everything below the (eventual) closing frontmatter fence —
  // join sections with one blank line so the canonical-body trim is stable.
  return sections.join("\n\n") + "\n";
}

function renderScenarioBlock(s: ContractPageScenario): string {
  const lines: string[] = [];
  lines.push("```toon");
  lines.push(`id: ${s.id}`);
  lines.push(`title: ${s.title}`);
  lines.push(renderStringArray("given", s.given));
  lines.push(`when: ${s.when}`);
  lines.push(`whenTriggerType: ${s.whenTriggerType}`);
  lines.push(renderStringArray("then", s.then));
  lines.push(`stateRef:${s.stateRef ? ` ${s.stateRef}` : ""}`);
  lines.push(renderStringArray("tags", s.tags));
  lines.push(`testTier:${s.testTier ? ` ${s.testTier}` : ""}`);
  lines.push(`automatable: ${s.automatable ? "true" : "false"}`);
  lines.push("```");
  return lines.join("\n");
}

function renderEntityTable(e: ContractPageEntity): string {
  const lines: string[] = [];
  lines.push(`### ${e.name}`);
  if (e.description) {
    lines.push(``);
    lines.push(e.description.trim());
  }
  lines.push(``);
  lines.push(`| Field | Type | Constraints |`);
  lines.push(`|-------|------|-------------|`);
  for (const f of e.fields) {
    lines.push(`| ${f.name} | ${f.type} | ${f.constraints} |`);
  }
  return lines.join("\n");
}

function renderHistoryEntry(h: ContractPageHistoryEntry): string {
  const lines: string[] = [];
  lines.push(`### ${h.changeId} — ${h.date}`);
  lines.push(``);
  lines.push(`**Rationale:** ${h.rationale.trim()}`);
  lines.push(`**Deltas:** ${h.deltas.trim()}`);
  lines.push(`**Breaking:** ${h.breaking ? "true" : "false"}`);
  return lines.join("\n");
}

function renderStringArray(name: string, items: string[]): string {
  if (items.length === 0) return `${name}[0]:`;
  return `${name}[${items.length}]: ${items.join(", ")}`;
}

function composeFullPage(args: {
  pageId: string;
  body: string;
  contentChecksum: string;
  input: ContractPageInput;
}): string {
  const { pageId, body, contentChecksum, input } = args;

  const bodySectionList = CONTRACT_PAGE_BODY_SECTIONS.join(", ");
  const fullChars = body.length; // approximation; frontmatter chars added below
  // estimatedTokens covers the full page (frontmatter + body) per
  // wiki-page.schema.md `estimatedTokens` field definition. We compute
  // frontmatter and body together below.

  const frontmatterLines: string[] = [];
  frontmatterLines.push("```toon");
  frontmatterLines.push(`pageId: ${pageId}`);
  frontmatterLines.push(`title: ${input.title}`);
  frontmatterLines.push(`category: contract`);
  frontmatterLines.push(`subtype: `);
  // Per contract-page-extensions.schema.md field-lock, `domain` is the
  // kebab-case partition domain (must match `{domain}` portion of pageId).
  // This overrides the base wiki-page meaning ("code | research | ...") for
  // category=contract pages; the project domain is preserved via
  // `projectDomain` so the wiki-index packer still has its routing field.
  frontmatterLines.push(`domain: ${input.domain}`);
  frontmatterLines.push(`projectDomain: code`);
  frontmatterLines.push(`summary: ${input.summary}`);
  frontmatterLines.push(`bodySections[${CONTRACT_PAGE_BODY_SECTIONS.length}]: ${bodySectionList}`);

  // Lifecycle additions
  frontmatterLines.push(`contractVersion: ${input.contractVersion}`);
  frontmatterLines.push(`contractStatus: ${input.contractStatus}`);
  frontmatterLines.push(renderStringArray("sourceChanges", input.sourceChanges));
  frontmatterLines.push(`deprecatedAt:${input.deprecatedAt ? ` ${input.deprecatedAt}` : ""}`);
  frontmatterLines.push(`replacedBy:${input.replacedBy ? ` ${input.replacedBy}` : ""}`);
  frontmatterLines.push(`contentChecksum: ${contentChecksum}`);

  // Standard wiki metadata
  frontmatterLines.push(`createdAt: ${input.createdAt}`);
  frontmatterLines.push(`updatedAt: ${input.updatedAt}`);
  frontmatterLines.push(`createdBy: ${input.createdBy}`);
  frontmatterLines.push(`updatedBy: ${input.updatedBy}`);
  frontmatterLines.push(renderStringArray("sourceRefs", input.sourceRefs));
  frontmatterLines.push(`crossRefs[0]:`);
  frontmatterLines.push(renderStringArray("tags", input.tags));
  frontmatterLines.push(`staleness: fresh`);
  frontmatterLines.push(`confidence: high`);

  // estimatedTokens is computed last from the rendered character count so the
  // value matches what `loom-wiki` sees on read. We compute it including a
  // placeholder for the field itself; one-pass approximation is acceptable
  // because the heuristic is `Math.ceil(chars / 4)`.
  const frontmatterDraft = frontmatterLines.join("\n");
  const totalChars = frontmatterDraft.length + 4 /* fences */ + body.length;
  const estimatedTokens = Math.ceil(totalChars / 4);
  frontmatterLines.push(`estimatedTokens: ${estimatedTokens}`);
  frontmatterLines.push("```");

  return `${frontmatterLines.join("\n")}\n\n${body}`;
}

/** Atomically write `content` to `target` via a `.tmp` then `rename`. */
function atomicWriteFile(target: string, content: string): void {
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, target);
}

interface ParsedIndexLight {
  schemaVersion: number | null;
  projectName: string | null;
  domain: string | null;
  wikiVersion: number | null;
  rows: WikiIndexRow[];
}

/**
 * Minimal index parser — extracts header fields plus the typed `pages[...]`
 * array. Does not preserve unknown sections; the upsert recomputes
 * `categories[]` and other derived sections.
 */
function parseIndexLight(raw: string): ParsedIndexLight {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const out: ParsedIndexLight = {
    schemaVersion: null,
    projectName: null,
    domain: null,
    wikiVersion: null,
    rows: [],
  };

  let inPages = false;
  let pageColumns: string[] | null = null;

  for (const line of lines) {
    if (!inPages) {
      const trimmed = line.trim();
      if (trimmed.startsWith("schemaVersion:")) {
        out.schemaVersion = parseInt(trimmed.split(":")[1].trim(), 10);
      } else if (trimmed.startsWith("projectName:")) {
        out.projectName = trimmed.slice("projectName:".length).trim();
      } else if (trimmed.startsWith("domain:")) {
        out.domain = trimmed.slice("domain:".length).trim();
      } else if (trimmed.startsWith("wikiVersion:")) {
        out.wikiVersion = parseInt(trimmed.split(":")[1].trim(), 10);
      } else {
        const m = /^pages\[\d+\]\{([^}]+)\}:\s*$/.exec(trimmed);
        if (m) {
          pageColumns = m[1].split(",").map((s) => s.trim());
          inPages = true;
        }
      }
      continue;
    }

    // In pages array
    if (!line.startsWith("  ")) {
      // Non-indented line ends the array section.
      inPages = false;
      pageColumns = null;
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!pageColumns) continue;

    const values = parseCsvRow(trimmed);
    const obj: Record<string, string> = {};
    for (let i = 0; i < pageColumns.length; i++) {
      obj[pageColumns[i]] = (values[i] ?? "").trim();
    }
    out.rows.push({
      pageId: obj.pageId ?? "",
      title: obj.title ?? "",
      category: obj.category ?? "",
      subtype: obj.subtype ?? "",
      staleness: obj.staleness ?? "fresh",
      updatedAt: obj.updatedAt ?? "",
      summary: unescapeCsvCell(obj.summary ?? ""),
      estimatedTokens: parseInt(obj.estimatedTokens ?? "0", 10) || 0,
    });
  }

  return out;
}

function parseCsvRow(row: string): string[] {
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

/** Escape a string for inclusion in a TOON CSV cell. */
function escapeCsvCell(value: string): string {
  if (value.includes(",") || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function unescapeCsvCell(value: string): string {
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1).replace(/""/g, '"');
  }
  return value;
}
