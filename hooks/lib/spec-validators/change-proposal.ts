/**
 * Change-proposal validator — Phase 7 of PLAN-spec-upgrades.md.
 *
 * Validates a single ChangeProposal directory at `.loom/changes/{changeId}/`
 * against the rules locked in `agents/protocols/change-proposal.schema.md`.
 *
 * Enforced rules (severity per `agents/protocols/validation-rules.md`):
 *
 *   blocking
 *     - scope.included[] non-empty
 *     - scope.excluded[] non-empty
 *     - every affectedSpecs[] entry resolves to a contract-{domain} wiki page
 *       (checked first against `.loom/wiki/index.toon`; falls back to
 *       `.loom/wiki/pages/contract-{domain}.md` on disk)
 *     - every modifiedRequirements[].id exists on the target page's R-NN list
 *     - every removedRequirements[] entry exists on the target page's R-NN list
 *     - addedRequirements[] does not introduce an R-NN that already exists
 *       (proposal authors may write requirement text only — the archive
 *       auto-assigns IDs — but if a proposal embeds an explicit R-NN prefix
 *       in the text, this rule catches the collision)
 *     - breakingChange=true requires non-null, non-empty migrationNote
 *     - deltas.toon mirror file content is consistent with proposal.md deltas
 *
 *   warning
 *     - linkedPlan (when set) resolves to an existing file
 *
 * The validator is intentionally additive — the existing wiki lint pipeline
 * (`agents/protocols/wiki-lint-rules.md`) continues to run; this layer adds
 * change-proposal-specific structural checks. Findings are returned in the
 * same envelope shape as the scenario validators so the lint harness can
 * surface them through `loom-wiki lint` (Phase 8 wiring).
 *
 * Re-uses (does NOT reimplement):
 *   - parseProposalFrontmatter from scripts/loom-change/proposal-frontmatter.ts
 *     for proposal.md frontmatter parsing
 *   - parseDeltasFromProposal from scripts/loom-change/diff.ts for body
 *     DeltaBlock parsing
 *   - changeDir / proposalPath / deltasPath from hooks/lib/change-paths.ts for
 *     path resolution
 *
 * Returns a typed result rather than throwing. Empty `findings` ⇒ pass.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  changeDir,
  deltasPath,
  isValidChangeId,
  proposalPath,
  CHANGE_ID_PATTERN,
} from "../change-paths.js";
import { parseProposalFrontmatter } from "../../../scripts/loom-change/proposal-frontmatter.js";
import {
  parseDeltasFromProposal,
  type DeltaBlockSummary,
  type ModifiedRequirementEntry,
} from "../../../scripts/loom-change/diff.js";

export type FindingSeverity = "blocking" | "warning" | "info";

/** A single change-proposal validator finding. */
export interface ChangeProposalFinding {
  severity: FindingSeverity;
  /** Machine-readable rule identifier. */
  ruleId: string;
  /** Human-readable explanation. */
  message: string;
  /** The change being validated. */
  changeId: string;
  /** Affected file (proposal.md, deltas.toon, contract page, …) when applicable. */
  file?: string;
  /** Optional domain context — useful for multi-delta proposals. */
  domain?: string;
}

/** Options for {@link validateChangeProposal}. */
export interface ChangeProposalValidateOptions {
  /** Project root (defaults to `process.cwd()` for ergonomic callers). */
  rootDir?: string;
  /** Wiki root override (defaults to `<rootDir>/.loom/wiki`). */
  wikiRoot?: string;
}

/** Result envelope. */
export interface ChangeProposalValidationResult {
  changeId: string;
  /** Absolute path to the change directory that was validated. */
  changeDir: string;
  /** All findings (blocking + warning + info). */
  findings: ChangeProposalFinding[];
}

const RULE_INVALID_CHANGE_ID = "change-proposal/invalid-changeId";
const RULE_MISSING_PROPOSAL = "change-proposal/missing-proposal";
const RULE_FRONTMATTER_PARSE = "change-proposal/frontmatter-parse";
const RULE_SCOPE_INCLUDED_EMPTY = "change-proposal/scope-included-empty";
const RULE_SCOPE_EXCLUDED_EMPTY = "change-proposal/scope-excluded-empty";
const RULE_AFFECTED_SPEC_UNRESOLVED = "change-proposal/affected-spec-unresolved";
const RULE_REQ_NOT_FOUND = "change-proposal/requirement-not-found";
const RULE_REQ_COLLISION = "change-proposal/requirement-id-collision";
const RULE_BREAKING_MIGRATION = "change-proposal/breaking-without-migration";
const RULE_DELTAS_DRIFT = "change-proposal/deltas-toon-drift";
const RULE_LINKED_PLAN = "change-proposal/linked-plan-missing";
const RULE_DELTAS_PARSE = "change-proposal/deltas-parse";

const R_NN_PATTERN = /\bR-(\d{2,})\b/;

/**
 * Validate a ChangeProposal directory and return all findings.
 *
 * Pass `changeId` as the directory name (`chg-{YYYYMMDD}-{slug}`). The validator
 * reads `.loom/changes/{changeId}/proposal.md` and `.loom/changes/{changeId}/deltas.toon`
 * from disk relative to `rootDir`.
 */
export function validateChangeProposal(
  changeId: string,
  options: ChangeProposalValidateOptions = {}
): ChangeProposalValidationResult {
  const rootDir = options.rootDir ?? process.cwd();
  const wikiRoot = options.wikiRoot ?? path.join(rootDir, ".loom", "wiki");
  const dir = changeDir(rootDir, changeId);

  const result: ChangeProposalValidationResult = {
    changeId,
    changeDir: dir,
    findings: [],
  };

  if (!isValidChangeId(changeId)) {
    result.findings.push({
      severity: "blocking",
      ruleId: RULE_INVALID_CHANGE_ID,
      message: `Invalid changeId '${changeId}': expected ${CHANGE_ID_PATTERN}`,
      changeId,
    });
    return result;
  }

  const propPath = proposalPath(rootDir, changeId);
  if (!fs.existsSync(propPath)) {
    result.findings.push({
      severity: "blocking",
      ruleId: RULE_MISSING_PROPOSAL,
      message: `proposal.md missing at ${path.relative(rootDir, propPath)}`,
      changeId,
      file: propPath,
    });
    return result;
  }

  const proposalRaw = fs.readFileSync(propPath, "utf8");

  // --- Frontmatter -------------------------------------------------------
  let frontmatter: ReturnType<typeof parseProposalFrontmatter>;
  try {
    frontmatter = parseProposalFrontmatter(proposalRaw);
  } catch (err) {
    result.findings.push({
      severity: "blocking",
      ruleId: RULE_FRONTMATTER_PARSE,
      message: `Failed to parse proposal.md frontmatter: ${stringifyError(err)}`,
      changeId,
      file: propPath,
    });
    return result;
  }

  // Scope.included / scope.excluded — both must be non-empty.
  if (frontmatter.scope.included.length === 0) {
    result.findings.push({
      severity: "blocking",
      ruleId: RULE_SCOPE_INCLUDED_EMPTY,
      message: `scope.included[] is empty — proposals MUST declare what's in scope.`,
      changeId,
      file: propPath,
    });
  }
  if (frontmatter.scope.excluded.length === 0) {
    result.findings.push({
      severity: "blocking",
      ruleId: RULE_SCOPE_EXCLUDED_EMPTY,
      message: `scope.excluded[] is empty — proposals MUST declare exclusions to prevent scope creep.`,
      changeId,
      file: propPath,
    });
  }

  // linkedPlan resolution — warning only.
  if (frontmatter.linkedPlan !== null && frontmatter.linkedPlan.length > 0) {
    const resolved = path.isAbsolute(frontmatter.linkedPlan)
      ? frontmatter.linkedPlan
      : path.join(rootDir, frontmatter.linkedPlan);
    if (!fs.existsSync(resolved)) {
      result.findings.push({
        severity: "warning",
        ruleId: RULE_LINKED_PLAN,
        message: `linkedPlan '${frontmatter.linkedPlan}' does not resolve to an existing file.`,
        changeId,
        file: propPath,
      });
    }
  }

  // --- affectedSpecs[] resolution ----------------------------------------
  const indexedDomains = readWikiIndexContractDomains(wikiRoot);
  const pagesDir = path.join(wikiRoot, "pages");

  const resolvedSpec = (domain: string): { resolved: boolean; pageFile: string } => {
    const pageId = `contract-${domain}`;
    if (indexedDomains.has(domain)) {
      return { resolved: true, pageFile: path.join(pagesDir, `${pageId}.md`) };
    }
    // Fallback: page file on disk even if index hasn't been refreshed.
    const pageFile = path.join(pagesDir, `${pageId}.md`);
    if (fs.existsSync(pageFile)) {
      return { resolved: true, pageFile };
    }
    return { resolved: false, pageFile };
  };

  // Track resolved targets so we can read R-NN lists once per domain.
  const targetPages = new Map<string, ContractPageSnapshot>();

  for (const domain of frontmatter.affectedSpecs) {
    const { resolved, pageFile } = resolvedSpec(domain);
    if (!resolved) {
      result.findings.push({
        severity: "blocking",
        ruleId: RULE_AFFECTED_SPEC_UNRESOLVED,
        message:
          `affectedSpec '${domain}' does not resolve to a contract-${domain} ` +
          `wiki page (checked index + disk).`,
        changeId,
        file: propPath,
        domain,
      });
      continue;
    }
    try {
      const content = fs.readFileSync(pageFile, "utf8");
      targetPages.set(domain, snapshotContractPage(content));
    } catch (err) {
      result.findings.push({
        severity: "blocking",
        ruleId: RULE_AFFECTED_SPEC_UNRESOLVED,
        message: `Failed to read contract page for '${domain}': ${stringifyError(err)}`,
        changeId,
        file: pageFile,
        domain,
      });
    }
  }

  // --- Deltas -----------------------------------------------------------
  let proposalDeltas: DeltaBlockSummary[] = [];
  try {
    proposalDeltas = parseDeltasFromProposal(proposalRaw);
  } catch (err) {
    result.findings.push({
      severity: "blocking",
      ruleId: RULE_DELTAS_PARSE,
      message: `Failed to parse ## Deltas section: ${stringifyError(err)}`,
      changeId,
      file: propPath,
    });
  }

  for (const delta of proposalDeltas) {
    const snapshot = targetPages.get(delta.domain);
    if (!snapshot) continue; // unresolved spec already reported above

    // modifiedRequirements[].id must exist.
    for (const mod of delta.modifiedRequirements) {
      if (!snapshot.requirementIds.has(mod.id)) {
        result.findings.push({
          severity: "blocking",
          ruleId: RULE_REQ_NOT_FOUND,
          message:
            `modifiedRequirements[].id '${mod.id}' does not exist on contract-${delta.domain}.md.`,
          changeId,
          file: propPath,
          domain: delta.domain,
        });
      }
    }
    // removedRequirements[] must exist.
    for (const rid of delta.removedRequirements) {
      if (!snapshot.requirementIds.has(rid)) {
        result.findings.push({
          severity: "blocking",
          ruleId: RULE_REQ_NOT_FOUND,
          message:
            `removedRequirements[] entry '${rid}' does not exist on contract-${delta.domain}.md.`,
          changeId,
          file: propPath,
          domain: delta.domain,
        });
      }
    }
    // addedRequirements[] must not embed a colliding R-NN prefix.
    for (const text of delta.addedRequirements) {
      const m = R_NN_PATTERN.exec(text);
      if (m === null) continue;
      const id = `R-${m[1]}`;
      if (snapshot.requirementIds.has(id)) {
        result.findings.push({
          severity: "blocking",
          ruleId: RULE_REQ_COLLISION,
          message:
            `addedRequirements[] introduces R-NN '${id}' which already exists on ` +
            `contract-${delta.domain}.md. The archive auto-assigns IDs — remove the ` +
            `explicit prefix or pick a free ID.`,
          changeId,
          file: propPath,
          domain: delta.domain,
        });
      }
    }
    // breakingChange ⇒ migrationNote required.
    if (delta.breakingChange) {
      const note = (delta.migrationNote ?? "").trim();
      if (note.length === 0) {
        result.findings.push({
          severity: "blocking",
          ruleId: RULE_BREAKING_MIGRATION,
          message: `breakingChange=true on domain '${delta.domain}' requires a non-empty migrationNote.`,
          changeId,
          file: propPath,
          domain: delta.domain,
        });
      }
    }
  }

  // --- deltas.toon consistency with proposal.md --------------------------
  const delPath = deltasPath(rootDir, changeId);
  if (fs.existsSync(delPath)) {
    const delRaw = fs.readFileSync(delPath, "utf8");
    const drift = compareDeltasToMirror(proposalDeltas, delRaw);
    if (drift !== null) {
      result.findings.push({
        severity: "blocking",
        ruleId: RULE_DELTAS_DRIFT,
        message: `deltas.toon drifts from proposal.md: ${drift}`,
        changeId,
        file: delPath,
      });
    }
  }

  return result;
}

/**
 * Entry point shaped for the wiki-lint pipeline (Phase 8 wiring).
 *
 * Walks every change directory under `.loom/changes/` and aggregates findings.
 * `loom-wiki lint` will call this alongside its standard wiki-rule passes.
 */
export function validateAllChangeProposals(
  options: ChangeProposalValidateOptions = {}
): ChangeProposalFinding[] {
  const rootDir = options.rootDir ?? process.cwd();
  const changesRoot = path.join(rootDir, ".loom", "changes");
  if (!fs.existsSync(changesRoot)) return [];

  const aggregated: ChangeProposalFinding[] = [];
  for (const entry of fs.readdirSync(changesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!isValidChangeId(entry.name)) continue;
    const single = validateChangeProposal(entry.name, options);
    aggregated.push(...single.findings);
  }
  return aggregated;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface ContractPageSnapshot {
  requirementIds: Set<string>;
  scenarioIds: Set<string>;
}

/**
 * Snapshot a contract page just enough to look up its current R-NN and S-NN IDs.
 * We deliberately keep this minimal and self-contained — the heavyweight page
 * parser lives in `scripts/loom-change/archive.ts`; importing it here would
 * couple the validator to a CLI module. Both extractors look at the same body
 * shape so they stay consistent.
 */
function snapshotContractPage(content: string): ContractPageSnapshot {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  // Locate `## Requirements` and `## Scenarios` H2 sections.
  const sectionBounds = (heading: string): { start: number; end: number } | null => {
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
      if (new RegExp(`^##\\s+${escapeRegex(heading)}\\s*$`).test(lines[i])) {
        start = i;
        break;
      }
    }
    if (start === -1) return null;
    let end = lines.length - 1;
    for (let j = start + 1; j < lines.length; j++) {
      if (/^##\s+\S/.test(lines[j])) {
        end = j - 1;
        break;
      }
    }
    return { start, end };
  };

  const requirementIds = new Set<string>();
  const reqBounds = sectionBounds("Requirements");
  if (reqBounds !== null) {
    const re = /\*\*(R-\d{2,})\*\*/g;
    const body = lines.slice(reqBounds.start, reqBounds.end + 1).join("\n");
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      requirementIds.add(m[1]);
    }
  }

  const scenarioIds = new Set<string>();
  const scnBounds = sectionBounds("Scenarios");
  if (scnBounds !== null) {
    const body = lines.slice(scnBounds.start, scnBounds.end + 1).join("\n");
    const re = /^\s*id:\s*(S-\d{2,})\s*$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      scenarioIds.add(m[1]);
    }
  }

  return { requirementIds, scenarioIds };
}

/**
 * Read the wiki index and return the set of domains that have an indexed
 * `contract-*` page. Returns an empty set when the index is missing or
 * unparseable — callers fall back to disk-based resolution.
 */
function readWikiIndexContractDomains(wikiRoot: string): Set<string> {
  const indexFile = path.join(wikiRoot, "index.toon");
  if (!fs.existsSync(indexFile)) return new Set();
  let raw: string;
  try {
    raw = fs.readFileSync(indexFile, "utf8");
  } catch {
    return new Set();
  }
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const domains = new Set<string>();
  let inPages = false;
  let pageColumns: string[] | null = null;
  for (const line of lines) {
    if (!inPages) {
      const m = /^pages\[\d+\]\{([^}]+)\}:\s*$/.exec(line.trim());
      if (m) {
        pageColumns = m[1].split(",").map((s) => s.trim());
        inPages = true;
      }
      continue;
    }
    if (!line.startsWith("  ")) {
      inPages = false;
      pageColumns = null;
      continue;
    }
    if (!pageColumns) continue;
    const cells = splitCsvRow(line.trim());
    const obj: Record<string, string> = {};
    for (let i = 0; i < pageColumns.length; i++) {
      obj[pageColumns[i]] = (cells[i] ?? "").trim();
    }
    const pageId = obj.pageId ?? "";
    const category = obj.category ?? "";
    if (category === "contract" && pageId.startsWith("contract-")) {
      domains.add(pageId.slice("contract-".length));
    }
  }
  return domains;
}

/**
 * Compare the proposal.md deltas against the deltas.toon mirror. Returns a
 * human-readable drift message, or null when the mirror matches.
 *
 * The mirror's typed-array shape (locked in change-proposal.schema.md → DeltaBlock
 * mirror) is:
 *
 *   deltas[N]{domain,breakingChange,addedReqCount,modifiedReqCount,removedReqCount,
 *             addedScenarioCount,modifiedScenarioCount,removedScenarioCount}:
 *     domain,true|false,N,N,N,N,N,N
 *
 * Drift is computed as a set comparison of (domain, counts, breakingChange).
 * The empty-mirror form `deltas[0]{...}:` is treated as "no rows" — that's
 * tolerated when proposal.md also has no deltas yet (e.g., a freshly
 * initialized change). When proposal has deltas and mirror does not (or has
 * different rows), drift is reported.
 */
function compareDeltasToMirror(
  proposalDeltas: DeltaBlockSummary[],
  deltasToonRaw: string
): string | null {
  const mirrorRows = parseDeltasMirror(deltasToonRaw);

  // proposal-empty AND mirror-empty ⇒ OK.
  if (proposalDeltas.length === 0 && mirrorRows.length === 0) {
    return null;
  }

  // proposal has deltas but mirror is empty ⇒ drift (mirror not refreshed).
  if (proposalDeltas.length > 0 && mirrorRows.length === 0) {
    return `proposal.md has ${proposalDeltas.length} delta block(s) but deltas.toon mirror is empty.`;
  }
  // mirror has rows but proposal does not ⇒ drift (stale mirror).
  if (proposalDeltas.length === 0 && mirrorRows.length > 0) {
    return `deltas.toon mirror has ${mirrorRows.length} row(s) but proposal.md ## Deltas section is empty.`;
  }

  // Row counts differ.
  if (proposalDeltas.length !== mirrorRows.length) {
    return (
      `row count mismatch — proposal has ${proposalDeltas.length} delta block(s) ` +
      `but mirror has ${mirrorRows.length}.`
    );
  }

  // Build by-domain maps and compare.
  const byDomainProposal = new Map<string, DeltaBlockSummary>();
  for (const d of proposalDeltas) byDomainProposal.set(d.domain, d);
  const byDomainMirror = new Map<string, DeltasMirrorRow>();
  for (const r of mirrorRows) byDomainMirror.set(r.domain, r);

  for (const [domain, proposal] of byDomainProposal) {
    const mirror = byDomainMirror.get(domain);
    if (mirror === undefined) {
      return `mirror is missing a row for domain '${domain}'.`;
    }
    if (proposal.breakingChange !== mirror.breakingChange) {
      return `domain '${domain}' breakingChange mismatch (proposal=${proposal.breakingChange}, mirror=${mirror.breakingChange}).`;
    }
    if (proposal.addedRequirements.length !== mirror.addedReqCount) {
      return `domain '${domain}' addedReqCount mismatch (proposal=${proposal.addedRequirements.length}, mirror=${mirror.addedReqCount}).`;
    }
    if (proposal.modifiedRequirements.length !== mirror.modifiedReqCount) {
      return `domain '${domain}' modifiedReqCount mismatch (proposal=${proposal.modifiedRequirements.length}, mirror=${mirror.modifiedReqCount}).`;
    }
    if (proposal.removedRequirements.length !== mirror.removedReqCount) {
      return `domain '${domain}' removedReqCount mismatch (proposal=${proposal.removedRequirements.length}, mirror=${mirror.removedReqCount}).`;
    }
    if (proposal.addedScenarios.length !== mirror.addedScenarioCount) {
      return `domain '${domain}' addedScenarioCount mismatch (proposal=${proposal.addedScenarios.length}, mirror=${mirror.addedScenarioCount}).`;
    }
    if (proposal.modifiedScenarios.length !== mirror.modifiedScenarioCount) {
      return `domain '${domain}' modifiedScenarioCount mismatch (proposal=${proposal.modifiedScenarios.length}, mirror=${mirror.modifiedScenarioCount}).`;
    }
    if (proposal.removedScenarios.length !== mirror.removedScenarioCount) {
      return `domain '${domain}' removedScenarioCount mismatch (proposal=${proposal.removedScenarios.length}, mirror=${mirror.removedScenarioCount}).`;
    }
  }

  // Mirror has any row not in proposal? Already covered by row-count check
  // since maps were equal-sized; defensive check kept anyway.
  for (const domain of byDomainMirror.keys()) {
    if (!byDomainProposal.has(domain)) {
      return `mirror has an extra row for domain '${domain}' not present in proposal.md.`;
    }
  }
  return null;
}

interface DeltasMirrorRow {
  domain: string;
  breakingChange: boolean;
  addedReqCount: number;
  modifiedReqCount: number;
  removedReqCount: number;
  addedScenarioCount: number;
  modifiedScenarioCount: number;
  removedScenarioCount: number;
}

function parseDeltasMirror(raw: string): DeltasMirrorRow[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const headerRe =
    /^deltas\[(\d+)\]\{domain,breakingChange,addedReqCount,modifiedReqCount,removedReqCount,addedScenarioCount,modifiedScenarioCount,removedScenarioCount\}:\s*$/;
  let declared = -1;
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = headerRe.exec(lines[i].trim());
    if (m) {
      declared = Number(m[1]);
      startIdx = i + 1;
      break;
    }
  }
  if (startIdx === -1) return [];
  if (declared === 0) return [];

  const rows: DeltasMirrorRow[] = [];
  for (let j = startIdx; j < lines.length; j++) {
    const line = lines[j];
    if (!line.startsWith("  ")) break;
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const cells = splitCsvRow(trimmed);
    if (cells.length < 8) continue;
    rows.push({
      domain: cells[0].trim(),
      breakingChange: cells[1].trim().toLowerCase() === "true",
      addedReqCount: parseInt(cells[2].trim(), 10) || 0,
      modifiedReqCount: parseInt(cells[3].trim(), 10) || 0,
      removedReqCount: parseInt(cells[4].trim(), 10) || 0,
      addedScenarioCount: parseInt(cells[5].trim(), 10) || 0,
      modifiedScenarioCount: parseInt(cells[6].trim(), 10) || 0,
      removedScenarioCount: parseInt(cells[7].trim(), 10) || 0,
    });
  }
  return rows;
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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stringifyError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Unused-import retention — keeps TypeScript from elision-warning the
 * imported types we re-export through the public surface.
 */
type _ModifiedRequirementEntry = ModifiedRequirementEntry;
