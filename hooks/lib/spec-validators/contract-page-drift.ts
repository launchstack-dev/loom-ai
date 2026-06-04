/**
 * Contract-page drift validator — Phase 7 of PLAN-spec-upgrades.md.
 *
 * Detects MANUAL edits to a `contract-*` wiki page by recomputing the
 * canonical-body SHA-256 and comparing against the `contentChecksum` stored
 * in frontmatter. A mismatch is blocking — manual edits are the failure mode
 * this validator was designed to catch, because they bypass the
 * change-proposal lifecycle that guarantees coherence.
 *
 * **Critical implementation note** (Phase 0 + Phase 4 lock-in): this module
 * MUST use `canonicalBodyChecksumFromPage` from `hooks/lib/checksum.ts`
 * verbatim. Forking the canonical-body algorithm would silently allow writer
 * vs. validator drift, which is exactly the failure mode the checksum was
 * meant to prevent. Do NOT inline the algorithm here.
 *
 * Distinct from wiki `staleness`:
 *   - `staleness` (wiki-page.schema.md / W-003) — time-based freshness drift
 *     (page hasn't been updated within its threshold)
 *   - `contentChecksum` drift (this validator) — manual content edit drift,
 *     surfaced as blocking
 *
 * Recovery mechanism (per the schema's `## Drift Detection` block):
 *   - Run `/loom-change recover {changeId}` to re-apply missing deltas (when
 *     the drift was caused by an in-progress change that failed mid-archive
 *     and left the page partially mutated)
 *   - Run `/loom-change init` to capture the manual edit as a retroactive
 *     change proposal (when the drift was a deliberate human edit)
 *
 * The drift validator includes a `recoveryPlan` field on its finding when it
 * can identify a candidate change to re-apply (heuristically: the last entry
 * in History whose deltas are NOT reflected in the current body — e.g., a
 * Requirement that History says was added but is missing from `## Requirements`).
 * Phase 8 ships the actual `/loom-change recover` subcommand; for Phase 7 the
 * recovery plan is emitted in the finding so a follow-up tool (or a human)
 * can act on it.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { canonicalBodyChecksumFromPage } from "../checksum.js";

export type FindingSeverity = "blocking" | "warning" | "info";

/** Recovery plan emitted alongside drift findings — Phase 8 consumes this. */
export interface DriftRecoveryPlan {
  /** Last archived change ID whose deltas the body appears to be missing. */
  candidateChangeId: string | null;
  /** Free-text hint: which command the user (or recover tool) should run. */
  hint: string;
  /** When non-empty, lists requirement IDs History says exist but body lacks. */
  missingRequirementIds: string[];
  /** When non-empty, lists scenario IDs History says exist but body lacks. */
  missingScenarioIds: string[];
}

/** A single drift finding. */
export interface ContractPageDriftFinding {
  severity: FindingSeverity;
  /** Machine-readable rule identifier. */
  ruleId: string;
  message: string;
  pageId: string;
  file: string;
  /** Stored checksum (from frontmatter). null when the field was missing. */
  storedChecksum: string | null;
  /** Recomputed checksum from canonicalBodyChecksumFromPage. */
  computedChecksum: string;
  /** Drift-recovery plan when blocking; null on pass or skip. */
  recoveryPlan: DriftRecoveryPlan | null;
}

export interface ContractPageDriftValidateOptions {
  /** Project root (defaults to `process.cwd()`). */
  rootDir?: string;
  /** Wiki root override (defaults to `<rootDir>/.loom/wiki`). */
  wikiRoot?: string;
}

export interface ContractPageDriftResult {
  pageId: string;
  file: string;
  findings: ContractPageDriftFinding[];
}

const RULE_DRIFT = "contract-page-drift/checksum-mismatch";
const RULE_LEGACY_NO_CHECKSUM = "contract-page-drift/no-checksum";
const RULE_FILE_MISSING = "contract-page-drift/file-missing";

/**
 * Validate a single contract page against its stored checksum.
 *
 *   - PASS  → empty `findings`.
 *   - SKIP  → info-severity finding with `RULE_LEGACY_NO_CHECKSUM` (legacy
 *             pages without contentChecksum — surfaced for awareness, NOT
 *             blocking, so existing wikis don't immediately fail lint after
 *             upgrade).
 *   - FAIL  → blocking finding with `RULE_DRIFT` and a `recoveryPlan`.
 */
export function validateContractPageDrift(
  pageFile: string,
  options: ContractPageDriftValidateOptions = {}
): ContractPageDriftResult {
  const _ = options; // reserved for future cross-page lookups; intentionally unused
  void _;

  const basename = path.basename(pageFile, ".md");
  const pageId = basename;

  const result: ContractPageDriftResult = {
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
      storedChecksum: null,
      computedChecksum: "",
      recoveryPlan: null,
    });
    return result;
  }

  const raw = fs.readFileSync(pageFile, "utf8");

  const storedChecksum = extractStoredChecksum(raw);
  // PASS-VERBATIM CALL into the canonical-body algorithm. Phase 0 and Phase 4
  // both insisted on this — do NOT reimplement.
  const computedChecksum = canonicalBodyChecksumFromPage(raw);

  if (storedChecksum === null) {
    // Legacy / brownfield page. Surface as info — drift cannot be checked,
    // but we don't want to flood lint reports.
    result.findings.push({
      severity: "info",
      ruleId: RULE_LEGACY_NO_CHECKSUM,
      message:
        `Contract page ${pageId} has no contentChecksum in frontmatter; ` +
        `drift detection skipped. Re-write via the materializer or an archive ` +
        `to stamp a checksum.`,
      pageId,
      file: pageFile,
      storedChecksum: null,
      computedChecksum,
      recoveryPlan: null,
    });
    return result;
  }

  if (storedChecksum === computedChecksum) {
    return result; // pass — no findings
  }

  // DRIFT — build a recovery plan and emit a blocking finding.
  const plan = buildRecoveryPlan(raw);
  const recoveryCommand = plan.candidateChangeId
    ? `/loom-change recover ${plan.candidateChangeId}`
    : `/loom-change init`;
  result.findings.push({
    severity: "blocking",
    ruleId: RULE_DRIFT,
    message:
      `Contract page ${pageId}: contentChecksum mismatch (manual edit detected).\n` +
      `  Stored:  ${storedChecksum}\n` +
      `  Current: ${computedChecksum}\n` +
      `  Recovery: run \`${recoveryCommand}\`${plan.candidateChangeId
        ? ` to re-apply missing deltas from ${plan.candidateChangeId}, OR run /loom-change init to capture the manual edit as a retroactive change.`
        : ` to capture the manual edit as a retroactive change.`}`,
    pageId,
    file: pageFile,
    storedChecksum,
    computedChecksum,
    recoveryPlan: plan,
  });
  return result;
}

/**
 * Walk `.loom/wiki/pages/contract-*.md` and aggregate drift findings. Used by
 * Phase 8 wiki-lint integration.
 */
export function validateAllContractPagesDrift(
  options: ContractPageDriftValidateOptions = {}
): ContractPageDriftFinding[] {
  const rootDir = options.rootDir ?? process.cwd();
  const wikiRoot = options.wikiRoot ?? path.join(rootDir, ".loom", "wiki");
  const pagesDir = path.join(wikiRoot, "pages");
  if (!fs.existsSync(pagesDir)) return [];

  const aggregated: ContractPageDriftFinding[] = [];
  for (const entry of fs.readdirSync(pagesDir)) {
    if (!entry.startsWith("contract-")) continue;
    if (!entry.endsWith(".md")) continue;
    const result = validateContractPageDrift(path.join(pagesDir, entry), options);
    aggregated.push(...result.findings);
  }
  return aggregated;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Extract the `contentChecksum` frontmatter value, or null when missing.
 *
 * The field lives inside the leading ```toon fence block. We scan only the
 * frontmatter region — never the body — so that a body literal mentioning
 * the field name can't fool the extractor.
 */
function extractStoredChecksum(content: string): string | null {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

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

  for (let i = openIdx + 1; i < closeIdx; i++) {
    const m = /^contentChecksum:\s*(.*)$/.exec(lines[i].trim());
    if (m) {
      const value = m[1].trim();
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

/**
 * Build a recovery plan by diffing the History section's claimed deltas
 * against the current `## Requirements` and `## Scenarios` IDs.
 *
 * If History says `chg-XXX added R-03..R-05` and only R-03..R-04 are present
 * in the body, the plan flags R-05 as missing and nominates `chg-XXX` as the
 * candidate to recover from.
 *
 * Heuristic — we parse the History `**Deltas:**` line for `added R-NN`,
 * `added S-NN` patterns. Returns a best-effort plan; the actual recover tool
 * (Phase 8) verifies against `.loom/changes/{changeId}/proposal.md`.
 */
function buildRecoveryPlan(content: string): DriftRecoveryPlan {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  // Find body section bounds.
  const bodyStart = locateBodyStart(lines);
  const sections = sliceH2Sections(lines.slice(bodyStart));

  const requirementsBody = sections.get("Requirements") ?? "";
  const scenariosBody = sections.get("Scenarios") ?? "";
  const historyBody = sections.get("History") ?? "";

  const currentReqIds = collectIds(requirementsBody, /\*\*(R-\d{2,})\*\*/g);
  const currentScnIds = collectIds(scenariosBody, /^\s*id:\s*(S-\d{2,})\s*$/gm);

  // Walk History entries in order; for each, extract `added R-NN` / `added S-NN`
  // mentions; check which are missing from the body.
  const entryRe = /^###\s+(chg-\d{8}-[a-z0-9-]+)\s+[—-]\s+\d{4}-\d{2}-\d{2}\s*$/gm;
  const deltasRe = /\*\*Deltas:\*\*\s+(.+)/g;

  const entries: Array<{ changeId: string; deltasLine: string }> = [];
  {
    const headers: Array<{ id: string; index: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = entryRe.exec(historyBody)) !== null) {
      headers.push({ id: m[1], index: m.index });
    }
    for (let i = 0; i < headers.length; i++) {
      const start = headers[i].index;
      const end = i + 1 < headers.length ? headers[i + 1].index : historyBody.length;
      const slice = historyBody.slice(start, end);
      const d = deltasRe.exec(slice);
      deltasRe.lastIndex = 0;
      entries.push({
        changeId: headers[i].id,
        deltasLine: d ? d[1].trim() : "",
      });
    }
  }

  const missingRequirementIds: string[] = [];
  const missingScenarioIds: string[] = [];
  let candidateChangeId: string | null = null;

  // Walk entries from oldest to newest; whichever entry has a missing ID is a
  // recovery candidate (use the most recent such entry).
  for (const entry of entries) {
    const addedReqRange = parseRange(entry.deltasLine, /added\s+(R-\d{2,})(?:\.\.(R-\d{2,}))?/g);
    const addedScnRange = parseRange(entry.deltasLine, /added\s+(S-\d{2,})(?:\.\.(S-\d{2,}))?/g);
    let entryMissing = false;
    for (const id of addedReqRange) {
      if (!currentReqIds.has(id) && !missingRequirementIds.includes(id)) {
        missingRequirementIds.push(id);
        entryMissing = true;
      }
    }
    for (const id of addedScnRange) {
      if (!currentScnIds.has(id) && !missingScenarioIds.includes(id)) {
        missingScenarioIds.push(id);
        entryMissing = true;
      }
    }
    if (entryMissing) candidateChangeId = entry.changeId;
  }

  return {
    candidateChangeId,
    hint: candidateChangeId
      ? `Re-apply deltas from ${candidateChangeId}; the body is missing ${
          missingRequirementIds.length + missingScenarioIds.length
        } archived ID(s).`
      : `No specific recovery candidate identified — capture the manual edit as a new change.`,
    missingRequirementIds,
    missingScenarioIds,
  };
}

function locateBodyStart(lines: string[]): number {
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
  return closeIdx === -1 ? 0 : closeIdx + 1;
}

function sliceH2Sections(bodyLines: string[]): Map<string, string> {
  const out = new Map<string, string>();
  let currentHeading: string | null = null;
  let buffer: string[] = [];
  for (const line of bodyLines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      if (currentHeading !== null) {
        out.set(currentHeading, buffer.join("\n"));
      }
      currentHeading = m[1].trim();
      buffer = [];
      continue;
    }
    buffer.push(line);
  }
  if (currentHeading !== null) {
    out.set(currentHeading, buffer.join("\n"));
  }
  return out;
}

function collectIds(text: string, re: RegExp): Set<string> {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.add(m[1]);
  }
  return out;
}

/**
 * Parse `added R-NN[..R-NN]` patterns from a Deltas line into a list of IDs.
 * `R-03..R-05` expands to [R-03, R-04, R-05].
 */
function parseRange(text: string, pattern: RegExp): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    const first = m[1];
    const last = m[2];
    if (!last) {
      out.push(first);
      continue;
    }
    const prefix = first.slice(0, 2); // "R-" or "S-"
    const startNum = parseInt(first.slice(2), 10);
    const endNum = parseInt(last.slice(2), 10);
    const width = first.length - 2;
    if (Number.isNaN(startNum) || Number.isNaN(endNum) || endNum < startNum) {
      out.push(first);
      continue;
    }
    for (let n = startNum; n <= endNum; n++) {
      out.push(`${prefix}${String(n).padStart(width, "0")}`);
    }
  }
  return out;
}
