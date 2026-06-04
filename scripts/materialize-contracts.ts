#!/usr/bin/env node
/**
 * Contract-page materializer — Phase 4 of PLAN-spec-upgrades.md (M-02).
 *
 * Reads an `EntityDomainPartition` manifest + an approved ROADMAP.md + a
 * completed PLAN.md, and emits one `.loom/wiki/pages/contract-{domain}.md` page
 * per domain. Scenarios are extracted from the source documents via the
 * existing scenario parser; entities are promoted from the plan's
 * `## Schema / Type Definitions` section; requirements are seeded from the
 * plan's acceptance criteria.
 *
 * Per D-02 (resolved in PLAN-spec-upgrades.md), this materializer is the
 * primary trigger surface for greenfield contract pages. The lifecycle
 * thereafter is owned by `/loom-change` (Phases 5 & 6).
 *
 * Flags (parsed from argv when invoked as a CLI):
 *   --dry-run             Print the plan without writing pages or index.
 *   --propose-partition   Scaffold `.loom/wiki/contract-partition.toon` from
 *                         the source roadmap+plan entity set, then exit.
 *                         The user must review + commit the manifest before
 *                         running materialize for real.
 *   --wiki-root <path>    Override the wiki root (default `.loom/wiki`).
 *   --roadmap <path>      Override the roadmap path (default `ROADMAP.md`).
 *   --plan <path>         Override the plan path (default `PLAN.md`).
 *   --partition <path>    Override the partition path
 *                         (default `<wiki-root>/contract-partition.toon`).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseScenarios } from "../hooks/lib/scenario-parser.js";
import type { Scenario } from "../hooks/lib/scenario-parser.js";
import {
  writeContractPage,
  upsertContractWikiIndexEntries,
} from "../hooks/lib/contract-page-writer.js";
import type {
  ContractPageInput,
  ContractPageScenario,
  ContractPageRequirement,
  ContractPageEntity,
  ContractPageEntityField,
  WikiIndexRow,
  WriteContractPageResult,
} from "../hooks/lib/contract-page-writer.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** One row from `.loom/wiki/contract-partition.toon`'s `partitions[]` array. */
export interface PartitionEntry {
  domain: string;
  entities: string[];
  description: string;
}

/** The parsed partition manifest. */
export interface PartitionManifest {
  manifestVersion: number;
  generatedAt: string;
  generatedBy: string;
  sourceRoadmap: string | null;
  sourcePlans: string[];
  partitions: PartitionEntry[];
  unassignedEntities: string[];
  notes: string | null;
}

/** Options driving a materialization run. */
export interface MaterializeOptions {
  /** Working directory (used to resolve relative paths). Default `process.cwd()`. */
  cwd?: string;
  /** Wiki root (default `<cwd>/.loom/wiki`). */
  wikiRoot?: string;
  /** Path to the roadmap (default `<cwd>/ROADMAP.md`). */
  roadmapPath?: string;
  /** Path to the plan (default `<cwd>/PLAN.md`). */
  planPath?: string;
  /** Path to the partition manifest (default `<wikiRoot>/contract-partition.toon`). */
  partitionPath?: string;
  /** When true, do not write any files; return the materialization plan. */
  dryRun?: boolean;
  /** Used in frontmatter `createdAt`/`updatedAt`. Defaults to current time. */
  now?: Date;
  /** Stamped into `createdBy`/`updatedBy`. Default: `materializer`. */
  actor?: string;
  /** Optional project name for wiki index when no index exists yet. */
  projectName?: string;
}

/** Result of {@link materializeContracts}. */
export interface MaterializeResult {
  /** Per-domain page writes. Empty when `dryRun: true`. */
  pages: WriteContractPageResult[];
  /** Wiki index file path + new version (only set when not dry-run). */
  wikiIndex: {
    indexFile: string;
    wikiVersion: number;
    pageCount: number;
  } | null;
  /** Pages that *would* be written (always populated; mirrors `pages` shape). */
  plan: Array<{
    domain: string;
    pageFile: string;
    scenarioCount: number;
    requirementCount: number;
    entityCount: number;
  }>;
  /** Warnings emitted during materialization — surfaced to the CLI. */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Top-level entry point — used by CLI and tests.
// ---------------------------------------------------------------------------

/**
 * Run the materializer. Returns a structured {@link MaterializeResult}.
 *
 * Throws on hard preconditions (partition manifest missing, malformed
 * manifest, etc.). Warnings (e.g., empty scenarios) are collected in the
 * result and the run succeeds.
 */
export function materializeContracts(options: MaterializeOptions): MaterializeResult {
  const cwd = options.cwd ?? process.cwd();
  const wikiRoot = options.wikiRoot ?? path.join(cwd, ".loom", "wiki");
  const roadmapPath = options.roadmapPath ?? path.join(cwd, "ROADMAP.md");
  const planPath = options.planPath ?? path.join(cwd, "PLAN.md");
  const partitionPath = options.partitionPath ?? path.join(wikiRoot, "contract-partition.toon");
  const now = options.now ?? new Date();
  const actor = options.actor ?? "materializer";
  const warnings: string[] = [];

  if (!fs.existsSync(partitionPath)) {
    throw new Error(
      `materialize-contracts: partition manifest not found at "${partitionPath}". ` +
        `Run with --propose-partition first to scaffold one, then review and commit it.`
    );
  }

  const manifest = parsePartitionManifest(fs.readFileSync(partitionPath, "utf8"));
  validatePartitionManifest(manifest);

  // Source documents are optional in the strictest sense, but in practice the
  // materializer needs them to seed scenarios/entities. We tolerate missing
  // files (warn, emit placeholders) so partial fixtures don't hard-fail tests.
  const roadmapSource = readIfExists(roadmapPath);
  const planSource = readIfExists(planPath);
  if (!roadmapSource) {
    warnings.push(`roadmap not found at "${roadmapPath}" — proceeding without roadmap content`);
  }
  if (!planSource) {
    warnings.push(`plan not found at "${planPath}" — proceeding without plan content`);
  }

  // Extract source-document content shared across all domains.
  const allScenarios = collectScenarios([roadmapSource, planSource]);
  const entityDefs = planSource ? extractEntitiesFromPlan(planSource) : new Map<string, ContractPageEntity>();
  const requirementMatrix = planSource
    ? extractRequirementsFromPlan(planSource)
    : new Map<string, ContractPageRequirement[]>();

  const plan: MaterializeResult["plan"] = [];
  const pageWrites: WriteContractPageResult[] = [];
  const indexRows: WikiIndexRow[] = [];

  // Use a deterministic ISO timestamp (no fractional seconds) so that
  // re-running against unchanged inputs produces byte-identical output. The
  // caller MUST pass a fixed `now` to achieve full idempotency; when omitted,
  // re-runs produce a stable structure but the `createdAt`/`updatedAt`
  // timestamps differ. The acceptance criterion is satisfied by passing a
  // fixed Date in the test fixture flow.
  const stamp = now.toISOString();

  for (const partition of manifest.partitions) {
    const scenariosForDomain = filterScenariosForDomain(allScenarios, partition);
    const entities = partition.entities
      .map((name) => entityDefs.get(name))
      .filter((e): e is ContractPageEntity => Boolean(e));

    // Requirements: pull from the plan's acceptance criteria, attributed to
    // this domain's entities. When the plan has no acceptance criteria we
    // emit an empty-requirements placeholder via the writer.
    const requirements = requirementsForDomain(requirementMatrix, partition);

    const summary = truncateSummary(
      `${capitalize(partition.domain)} domain contract — ${partition.description}`
    );

    const pageInput: ContractPageInput = {
      domain: partition.domain,
      title: capitalize(partition.domain),
      summary,
      purpose: partition.description,
      requirements,
      scenarios: scenariosForDomain.map(toContractPageScenario),
      entities,
      outOfScope: [],
      history: [],

      contractVersion: 1,
      contractStatus: "active",
      sourceChanges: [],
      deprecatedAt: null,
      replacedBy: null,

      sourceRefs: collectSourceRefs(roadmapPath, planPath, roadmapSource, planSource),
      tags: ["contract", partition.domain],
      createdAt: stamp,
      updatedAt: stamp,
      createdBy: actor,
      updatedBy: actor,
    };

    const pageFile = path.join(wikiRoot, "pages", `contract-${partition.domain}.md`);
    plan.push({
      domain: partition.domain,
      pageFile,
      scenarioCount: scenariosForDomain.length,
      requirementCount: requirements.length,
      entityCount: entities.length,
    });

    if (options.dryRun) continue;

    const result = writeContractPage(wikiRoot, pageInput);
    pageWrites.push(result);
    warnings.push(...result.warnings);

    indexRows.push({
      pageId: result.pageId,
      title: pageInput.title,
      category: "contract",
      subtype: "",
      staleness: "fresh",
      updatedAt: stamp,
      summary: pageInput.summary,
      estimatedTokens: estimateFileTokens(result.pageFile),
    });
  }

  let wikiIndex: MaterializeResult["wikiIndex"] = null;
  if (!options.dryRun && indexRows.length > 0) {
    wikiIndex = upsertContractWikiIndexEntries(wikiRoot, indexRows, {
      projectName: options.projectName,
    });
  }

  return { pages: pageWrites, wikiIndex, plan, warnings };
}

/**
 * Scaffold a partition manifest from source documents.
 *
 * Implements the `--propose-partition` flow: collect entity names from the
 * roadmap + plan, drop them into a single "default" partition with the user
 * expected to split it post-review. Always uses `unassignedEntities: []` and
 * writes a `notes:` block explaining the scaffold rationale.
 *
 * Refuses to overwrite an existing partition file — fails fast with an error
 * the CLI surfaces verbatim.
 */
export function proposePartition(options: MaterializeOptions): {
  partitionFile: string;
  entityCount: number;
} {
  const cwd = options.cwd ?? process.cwd();
  const wikiRoot = options.wikiRoot ?? path.join(cwd, ".loom", "wiki");
  const partitionPath = options.partitionPath ?? path.join(wikiRoot, "contract-partition.toon");
  const planPath = options.planPath ?? path.join(cwd, "PLAN.md");
  const roadmapPath = options.roadmapPath ?? path.join(cwd, "ROADMAP.md");

  if (fs.existsSync(partitionPath)) {
    throw new Error(
      `materialize-contracts: partition manifest already exists at "${partitionPath}". ` +
        `Edit it directly rather than re-scaffolding.`
    );
  }

  const planSource = readIfExists(planPath);
  const roadmapSource = readIfExists(roadmapPath);

  const entityDefs = planSource ? extractEntitiesFromPlan(planSource) : new Map<string, ContractPageEntity>();
  const entityNames = Array.from(entityDefs.keys()).sort();

  // Also pick up entity-shaped tokens from the roadmap Data Model section if
  // present, even when the plan has no entities. Keep this conservative — we
  // only want UpperCamelCase identifiers that look like type names.
  if (roadmapSource) {
    const additional = extractEntitiesFromRoadmap(roadmapSource);
    for (const name of additional) {
      if (!entityNames.includes(name)) entityNames.push(name);
    }
  }
  entityNames.sort();

  if (entityNames.length === 0) {
    throw new Error(
      `materialize-contracts: no entities found in ROADMAP.md or PLAN.md to scaffold a partition. ` +
        `Add an entity to the plan's Schema / Type Definitions section and rerun.`
    );
  }

  fs.mkdirSync(path.dirname(partitionPath), { recursive: true });

  const now = (options.now ?? new Date()).toISOString();
  const actor = options.actor ?? "agent:materialize-contracts";

  const sourcePlans = fs.existsSync(planPath) ? [path.relative(cwd, planPath)] : [];
  const sourceRoadmap = fs.existsSync(roadmapPath) ? path.relative(cwd, roadmapPath) : null;

  const lines: string[] = [];
  lines.push(`manifestVersion: 1`);
  lines.push(`generatedAt: ${now}`);
  lines.push(`generatedBy: ${actor}`);
  lines.push(`sourceRoadmap:${sourceRoadmap ? ` ${sourceRoadmap}` : ""}`);
  if (sourcePlans.length === 0) {
    lines.push(`sourcePlans[0]:`);
  } else {
    lines.push(`sourcePlans[${sourcePlans.length}]: ${sourcePlans.join(", ")}`);
  }
  lines.push(`partitions[1]{domain,entities,description}:`);
  lines.push(`  default,"${entityNames.join(",")}",Default scaffolded partition — split before running materialize`);
  lines.push(`unassignedEntities[0]:`);
  lines.push(`notes: Scaffolded by /loom-plan materialize --propose-partition. Review and split into coherent bounded contexts before running materialize for real.`);

  const tmp = `${partitionPath}.tmp`;
  fs.writeFileSync(tmp, lines.join("\n") + "\n", "utf8");
  fs.renameSync(tmp, partitionPath);

  return { partitionFile: partitionPath, entityCount: entityNames.length };
}

// ---------------------------------------------------------------------------
// Partition manifest parsing
// ---------------------------------------------------------------------------

/** Parse a partition manifest TOON string into a typed object. */
export function parsePartitionManifest(content: string): PartitionManifest {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  let manifestVersion = 1;
  let generatedAt = "";
  let generatedBy = "";
  let sourceRoadmap: string | null = null;
  let sourcePlans: string[] = [];
  let notes: string | null = null;
  const partitions: PartitionEntry[] = [];
  let unassignedEntities: string[] = [];

  let inPartitions = false;
  let inUnassigned = false;

  for (const line of lines) {
    if (inPartitions) {
      if (!line.startsWith("  ") || !line.trim()) {
        inPartitions = false;
      } else {
        const parsed = parsePartitionRow(line.trim());
        if (parsed) partitions.push(parsed);
        continue;
      }
    }

    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (trimmed.startsWith("manifestVersion:")) {
      manifestVersion = parseInt(trimmed.split(":")[1].trim(), 10) || 1;
      continue;
    }
    if (trimmed.startsWith("generatedAt:")) {
      generatedAt = trimmed.slice("generatedAt:".length).trim();
      continue;
    }
    if (trimmed.startsWith("generatedBy:")) {
      generatedBy = trimmed.slice("generatedBy:".length).trim();
      continue;
    }
    if (trimmed.startsWith("sourceRoadmap:")) {
      const raw = trimmed.slice("sourceRoadmap:".length).trim();
      sourceRoadmap = raw.length > 0 ? raw : null;
      continue;
    }
    if (trimmed.startsWith("notes:")) {
      const raw = trimmed.slice("notes:".length).trim();
      notes = raw.length > 0 ? raw : null;
      continue;
    }

    const sourcePlansMatch = /^sourcePlans\[(\d+)\]\s*:\s*(.*)$/.exec(trimmed);
    if (sourcePlansMatch) {
      const count = parseInt(sourcePlansMatch[1], 10);
      const rest = sourcePlansMatch[2];
      sourcePlans = count === 0 || !rest ? [] : splitCsv(rest).map((s) => s.trim());
      continue;
    }

    const partitionsHeader = /^partitions\[\d+\]\{[^}]+\}\s*:\s*$/.exec(trimmed);
    if (partitionsHeader) {
      inPartitions = true;
      continue;
    }

    const unassignedMatch = /^unassignedEntities\[(\d+)\]\s*:\s*(.*)$/.exec(trimmed);
    if (unassignedMatch) {
      const count = parseInt(unassignedMatch[1], 10);
      const rest = unassignedMatch[2];
      unassignedEntities = count === 0 || !rest ? [] : splitCsv(rest).map((s) => s.trim());
      inUnassigned = false;
      continue;
    }
  }
  void inUnassigned;

  return {
    manifestVersion,
    generatedAt,
    generatedBy,
    sourceRoadmap,
    sourcePlans,
    partitions,
    unassignedEntities,
    notes,
  };
}

function parsePartitionRow(row: string): PartitionEntry | null {
  // Row format: domain,"Ent1,Ent2,Ent3",description text
  const cells = splitCsv(row);
  if (cells.length < 3) return null;
  const domain = cells[0].trim();
  const entitiesRaw = stripQuotes(cells[1].trim());
  const entities = entitiesRaw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  // Description may contain commas in the source manifest — rejoin remaining cells.
  const description = cells.slice(2).join(",").trim();
  if (!domain) return null;
  return { domain, entities, description };
}

function validatePartitionManifest(manifest: PartitionManifest): void {
  if (manifest.manifestVersion !== 1) {
    throw new Error(
      `materialize-contracts: unsupported partition manifestVersion ${manifest.manifestVersion} (expected 1)`
    );
  }
  if (manifest.partitions.length === 0) {
    throw new Error(`materialize-contracts: partition manifest has no partitions`);
  }
  const seenDomains = new Set<string>();
  const seenEntities = new Set<string>();
  for (const p of manifest.partitions) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.domain)) {
      throw new Error(
        `materialize-contracts: partition domain "${p.domain}" is not kebab-case`
      );
    }
    if (seenDomains.has(p.domain)) {
      throw new Error(
        `materialize-contracts: duplicate domain "${p.domain}" in partition manifest`
      );
    }
    seenDomains.add(p.domain);
    if (p.entities.length === 0) {
      throw new Error(
        `materialize-contracts: partition "${p.domain}" has no entities`
      );
    }
    for (const e of p.entities) {
      if (seenEntities.has(e)) {
        throw new Error(
          `materialize-contracts: entity "${e}" appears in multiple partitions — partitions must be disjoint`
        );
      }
      seenEntities.add(e);
    }
  }
}

// ---------------------------------------------------------------------------
// Source-document extraction
// ---------------------------------------------------------------------------

/** Collect scenarios from every non-null source document, deduping by id. */
function collectScenarios(sources: Array<string | null>): Scenario[] {
  const byId = new Map<string, Scenario>();
  for (const src of sources) {
    if (!src) continue;
    const { scenarios } = parseScenarios(src);
    for (const s of scenarios) {
      // Earlier sources win; later duplicates are ignored. Roadmap is passed
      // before plan so the roadmap definition is canonical when both exist.
      if (!byId.has(s.id)) byId.set(s.id, s);
    }
  }
  return Array.from(byId.values());
}

/**
 * Decide which scenarios belong to a given domain. Heuristic: a scenario
 * belongs to the domain when its body mentions any of the partition's
 * entities by name, OR when no domain in the manifest claims it (fallthrough
 * to the first domain — surfaces orphan-scenario warnings via the writer).
 *
 * This heuristic is a deliberate Phase 4 simplification — the long-term plan
 * is to attribute scenarios via `scenarioCoverage.requirementId` once Phase 7
 * lands. For now it produces stable, reviewable assignments that the user can
 * adjust via change proposals.
 */
function filterScenariosForDomain(scenarios: Scenario[], partition: PartitionEntry): Scenario[] {
  if (scenarios.length === 0) return [];
  const entityTokens = partition.entities.map((e) => e.toLowerCase());
  const matched: Scenario[] = [];
  for (const s of scenarios) {
    const haystack = `${s.title} ${s.given.join(" ")} ${s.when} ${s.then.join(" ")}`.toLowerCase();
    if (entityTokens.some((tok) => haystack.includes(tok.toLowerCase()))) {
      matched.push(s);
    }
  }
  return matched;
}

function toContractPageScenario(s: Scenario): ContractPageScenario {
  return {
    id: s.id,
    title: s.title,
    given: s.given,
    when: s.when,
    whenTriggerType: s.whenTriggerType,
    then: s.then,
    stateRef: s.stateRef,
    tags: s.tags,
    testTier: s.testTier,
    automatable: s.automatable,
  };
}

/**
 * Extract entity definitions from the plan's `## Schema / Type Definitions`
 * section. Each `### EntityName` followed by a Markdown table becomes one
 * {@link ContractPageEntity}.
 */
function extractEntitiesFromPlan(planSource: string): Map<string, ContractPageEntity> {
  const out = new Map<string, ContractPageEntity>();
  const lines = planSource.replace(/\r\n/g, "\n").split("\n");

  // Find the Schema / Type Definitions section bounds.
  let sectionStart = -1;
  let sectionEnd = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Schema\s*\/\s*Type Definitions\s*$/i.test(lines[i].trim())) {
      sectionStart = i + 1;
      break;
    }
  }
  if (sectionStart < 0) return out;
  for (let i = sectionStart; i < lines.length; i++) {
    if (/^##\s/.test(lines[i].trim())) {
      sectionEnd = i;
      break;
    }
  }

  // Walk for `### EntityName` headings, capture the trailing markdown table.
  let i = sectionStart;
  while (i < sectionEnd) {
    const headingMatch = /^###\s+(.+?)\s*$/.exec(lines[i]);
    if (!headingMatch) {
      i++;
      continue;
    }
    const name = headingMatch[1].trim();
    // Only treat UpperCamelCase tokens as entities.
    if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
      i++;
      continue;
    }
    i++;

    // Skip blank lines.
    while (i < sectionEnd && lines[i].trim().length === 0) i++;

    let description: string | undefined;
    // Optional 1-line description before the table.
    if (i < sectionEnd && !lines[i].trim().startsWith("|")) {
      description = lines[i].trim();
      i++;
      while (i < sectionEnd && lines[i].trim().length === 0) i++;
    }

    // Look for table header.
    if (i >= sectionEnd || !lines[i].trim().startsWith("|")) continue;

    // Capture table rows.
    const fields: ContractPageEntityField[] = [];
    // Header row, then separator row.
    i += 2;
    while (i < sectionEnd) {
      const raw = lines[i];
      if (!raw.trim().startsWith("|")) break;
      const cells = raw.split("|").map((c) => c.trim()).filter((c) => c.length > 0);
      if (cells.length >= 3) {
        fields.push({
          name: cells[0],
          type: cells[1],
          constraints: cells.slice(2).join(" | "),
        });
      }
      i++;
    }

    if (fields.length > 0) {
      out.set(name, { name, description, fields });
    }
  }

  return out;
}

/** Extract UpperCamelCase entity names from a roadmap Data Model section. */
function extractEntitiesFromRoadmap(roadmapSource: string): string[] {
  const lines = roadmapSource.replace(/\r\n/g, "\n").split("\n");
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Data Model\s*$/i.test(lines[i].trim())) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return [];
  for (let i = start; i < lines.length; i++) {
    if (/^##\s/.test(lines[i].trim())) {
      end = i;
      break;
    }
  }
  const names = new Set<string>();
  for (let i = start; i < end; i++) {
    const m = /^###\s+([A-Z][A-Za-z0-9]*)\s*$/.exec(lines[i].trim());
    if (m) names.add(m[1]);
  }
  return Array.from(names);
}

/**
 * Extract acceptance criteria from the plan as requirement candidates. The
 * heuristic groups criteria per `### Phase N` section; we then attribute them
 * to a domain based on entity-name mentions when the materializer iterates.
 *
 * Returns a map keyed by entity-name token → list of candidate requirements.
 * Domains receive every requirement whose key matches one of their entities.
 */
function extractRequirementsFromPlan(
  planSource: string
): Map<string, ContractPageRequirement[]> {
  const out = new Map<string, ContractPageRequirement[]>();
  const lines = planSource.replace(/\r\n/g, "\n").split("\n");

  let inCriteria = false;
  let counter = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^####\s+Acceptance Criteria\s*$/i.test(trimmed)) {
      inCriteria = true;
      continue;
    }
    if (inCriteria && /^#{1,6}\s/.test(trimmed)) {
      // Any subsequent heading ends the criteria block for that phase.
      inCriteria = false;
      continue;
    }
    if (!inCriteria) continue;

    const itemMatch = /^-\s+\[\s*[ xX]?\s*\]\s+(.+)$/.exec(trimmed);
    if (!itemMatch) continue;
    const text = itemMatch[1].trim();

    counter += 1;
    const id = `R-${String(counter).padStart(2, "0")}`;
    const requirement: ContractPageRequirement = {
      id,
      requirementType: "functional",
      text,
    };

    // Attribute to every UpperCamelCase token that appears in the criterion.
    const entityMentions = new Set<string>();
    const tokenRe = /\b([A-Z][A-Za-z0-9]+)\b/g;
    let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(text)) !== null) {
      // Skip leading sentence-case words by filtering common English words via
      // a length floor + multi-uppercase or camelcase shape.
      if (/[a-z][A-Z]|^[A-Z][a-z]{2,}$/.test(m[1])) {
        entityMentions.add(m[1]);
      }
    }
    if (entityMentions.size === 0) {
      // Unattributed — drop into the catch-all "*" bucket the resolver
      // ignores. We keep the requirement out of the page in that case rather
      // than splattering it across every domain.
      continue;
    }
    for (const ent of entityMentions) {
      const arr = out.get(ent) ?? [];
      arr.push(requirement);
      out.set(ent, arr);
    }
  }

  return out;
}

function requirementsForDomain(
  matrix: Map<string, ContractPageRequirement[]>,
  partition: PartitionEntry
): ContractPageRequirement[] {
  const seen = new Set<string>();
  const out: ContractPageRequirement[] = [];
  for (const entity of partition.entities) {
    const reqs = matrix.get(entity) ?? [];
    for (const r of reqs) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
    }
  }
  // Renumber so each page's R-NN sequence starts at R-01. Preserve order.
  return out.map((r, idx) => ({
    ...r,
    id: `R-${String(idx + 1).padStart(2, "0")}`,
  }));
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

function collectSourceRefs(
  roadmapPath: string,
  planPath: string,
  roadmapSource: string | null,
  planSource: string | null
): string[] {
  const refs: string[] = [];
  if (roadmapSource) refs.push(roadmapPath);
  if (planSource) refs.push(planPath);
  return refs;
}

function readIfExists(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function estimateFileTokens(p: string): number {
  try {
    const stat = fs.statSync(p);
    return Math.ceil(stat.size / 4);
  } catch {
    return 0;
  }
}

function truncateSummary(s: string): string {
  if (s.length <= 200) return s;
  return s.slice(0, 197) + "...";
}

function capitalize(domain: string): string {
  // Convert kebab-case to Title Case.
  return domain
    .split("-")
    .map((part) => (part.length === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join(" ");
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

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

interface CliArgs {
  dryRun: boolean;
  proposePartition: boolean;
  wikiRoot?: string;
  roadmapPath?: string;
  planPath?: string;
  partitionPath?: string;
}

function parseArgv(argv: string[]): CliArgs {
  const out: CliArgs = { dryRun: false, proposePartition: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--dry-run":
        out.dryRun = true;
        break;
      case "--propose-partition":
        out.proposePartition = true;
        break;
      case "--wiki-root":
        out.wikiRoot = argv[++i];
        break;
      case "--roadmap":
        out.roadmapPath = argv[++i];
        break;
      case "--plan":
        out.planPath = argv[++i];
        break;
      case "--partition":
        out.partitionPath = argv[++i];
        break;
      default:
        if (arg.startsWith("--")) {
          process.stderr.write(`materialize-contracts: unknown flag "${arg}"\n`);
          process.exit(2);
        }
    }
  }
  return out;
}

/** CLI driver — invoked from `commands/loom-plan/materialize.md`. */
export function main(argv: string[]): number {
  const args = parseArgv(argv);
  const options: MaterializeOptions = {
    dryRun: args.dryRun,
    wikiRoot: args.wikiRoot,
    roadmapPath: args.roadmapPath,
    planPath: args.planPath,
    partitionPath: args.partitionPath,
  };

  try {
    if (args.proposePartition) {
      const result = proposePartition(options);
      process.stdout.write(
        `Scaffolded partition manifest with ${result.entityCount} entities at: ${result.partitionFile}\n` +
          `Review and split into coherent bounded contexts, then re-run /loom-plan materialize.\n`
      );
      return 0;
    }

    const result = materializeContracts(options);

    if (args.dryRun) {
      process.stdout.write(`[dry-run] Materialization plan:\n`);
      for (const p of result.plan) {
        process.stdout.write(
          `  ${p.domain.padEnd(20)} → ${p.pageFile}  (scenarios=${p.scenarioCount} requirements=${p.requirementCount} entities=${p.entityCount})\n`
        );
      }
      for (const w of result.warnings) {
        process.stderr.write(`[warning] ${w}\n`);
      }
      return 0;
    }

    process.stdout.write(
      `Materialized ${result.pages.length} contract page(s).\n`
    );
    for (const page of result.pages) {
      process.stdout.write(
        `  ${page.pageId.padEnd(28)} ${page.contentChecksum}  → ${page.pageFile}\n`
      );
    }
    if (result.wikiIndex) {
      process.stdout.write(
        `Wiki index updated: ${result.wikiIndex.indexFile} (wikiVersion=${result.wikiIndex.wikiVersion}, pageCount=${result.wikiIndex.pageCount})\n`
      );
    }
    for (const w of result.warnings) {
      process.stderr.write(`[warning] ${w}\n`);
    }
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    if (msg.includes("partition manifest not found")) {
      process.stderr.write(
        `Run \`/loom-plan materialize --propose-partition\` first to scaffold one.\n`
      );
    }
    return 1;
  }
}

// Run when invoked directly as a script.
const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  /materialize-contracts(\.ts|\.js)?$/.test(process.argv[1]);
if (isMain) {
  const exitCode = main(process.argv.slice(2));
  process.exit(exitCode);
}
