#!/usr/bin/env tsx
/**
 * /loom-change archive <id> [--by <actor>] — atomically apply a change.
 *
 * THE BIG ONE. Multi-domain atomic archive:
 *
 *   1. Pre-flight validate — every deltaBlock.id exists / does not collide on
 *      the target contract-{domain}.md page; modified-requirement `before`
 *      text matches current page text.
 *   2. Conflict scan — read every in-flight ChangeState. If another in-flight
 *      change touches an overlapping requirement/scenario ID on a shared
 *      domain, populate `conflicts[]` on BOTH ChangeStates and abort.
 *   3. Compute new bodies — for each affectedSpec, build a new
 *      ContractPageInput by parsing the existing page and applying the deltas.
 *   4. Snapshot existing pages as `.bak` files.
 *   5. Stage writes via contract-page-writer (which uses `.tmp` + rename
 *      internally per call). We invoke it once per domain, so a failure
 *      mid-domain leaves earlier domains already committed; we restore from
 *      `.bak` snapshots in reverse order on any failure and emit a rollback
 *      log per change-proposal.schema.md → Rollback Log Format.
 *   6. On success: refresh wiki index (single upsert across all affected
 *      pages), set status `archived`, transition `in-progress → archived`,
 *      then run the supersession scan against all OTHER in-flight changes.
 *   7. Cleanup: remove `.bak` files.
 *
 * Phase 6 deliverable. See PLAN-spec-upgrades.md Phase 6 + change-proposal.schema.md
 * → Atomic Archive Semantics + change-state.schema.md → Conflict Detection,
 * Supersession Discovery.
 *
 * Exit codes:
 *   0  success
 *   1  illegal transition / pre-flight failure / conflict detected
 *   2  invalid arguments / IO error
 *   3  mid-archive rollback emitted (rollback log written; manual recovery needed)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

import {
  CHANGE_ID_PATTERN,
  archiveLogPath,
  changeDir,
  changesDir,
  isValidChangeId,
  proposalPath,
  rollbackPath,
  tmpPathFor,
} from "../../hooks/lib/change-paths.js";
import {
  listChangeStates,
  readChangeState,
  writeChangeState,
  type ChangeState,
  type ConflictEntry,
} from "../../hooks/lib/change-state.js";
import {
  writeContractPage,
  upsertContractWikiIndexEntries,
  type ContractPageInput,
  type ContractPageScenario,
  type ContractPageRequirement,
  type ContractPageEntity,
  type ContractPageHistoryEntry,
  type WikiIndexRow,
} from "../../hooks/lib/contract-page-writer.js";
import { canonicalBodyChecksumFromPage } from "../../hooks/lib/checksum.js";
import { bumpAfter, atomicWriteText } from "./init.js";
import { applyFrontmatterUpdates } from "./review.js";
import { parseProposalFrontmatter } from "./proposal-frontmatter.js";
import {
  parseDeltasFromProposal,
  type DeltaBlockSummary,
  type ScenarioSummary,
} from "./diff.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ArchiveOptions {
  changeId: string;
  rootDir?: string;
  by?: string;
  now?: Date;
  /** Wiki root, defaults to `<rootDir>/.loom/wiki`. */
  wikiRoot?: string;
  /** When true, skip the conflict scan. Used internally by quick-archive only when documented. Default false. */
  skipConflictScan?: boolean;
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
}

export interface ArchiveResult {
  changeId: string;
  /** Domains successfully written. */
  domainsArchived: string[];
  /** Conflicts detected during scan; non-empty means archive aborted. */
  conflicts: ConflictEntry[];
  /** Other change IDs marked superseded as a result of this archive. */
  supersededChangeIds: string[];
  /** Path to rollback log when emitted; null on success. */
  rollbackLog: string | null;
  exitCode: number;
}

export function runArchive(options: ArchiveOptions): ArchiveResult {
  const rootDir = options.rootDir ?? process.cwd();
  const out = options.out ?? process.stdout;
  const err = options.err ?? process.stderr;
  const now = options.now ?? new Date();
  const actor = options.by ?? "agent:change-archiver";
  const wikiRoot = options.wikiRoot ?? path.join(rootDir, ".loom", "wiki");

  const result: ArchiveResult = {
    changeId: options.changeId,
    domainsArchived: [],
    conflicts: [],
    supersededChangeIds: [],
    rollbackLog: null,
    exitCode: 0,
  };

  // -- Validation ----------------------------------------------------------
  if (!isValidChangeId(options.changeId)) {
    err.write(
      `Invalid changeId '${options.changeId}': expected ${CHANGE_ID_PATTERN}\n`
    );
    result.exitCode = 2;
    return result;
  }

  const dir = changeDir(rootDir, options.changeId);
  if (!fs.existsSync(dir)) {
    err.write(`No change found at ${path.relative(rootDir, dir)}\n`);
    result.exitCode = 1;
    return result;
  }

  let state: ChangeState | null;
  try {
    state = readChangeState(rootDir, options.changeId);
  } catch (e) {
    err.write(`Failed to read ChangeState: ${stringifyError(e)}\n`);
    result.exitCode = 2;
    return result;
  }
  if (state === null) {
    err.write(`No ChangeState for ${options.changeId}\n`);
    result.exitCode = 1;
    return result;
  }
  if (state.status !== "in-progress") {
    err.write(
      `Illegal transition: cannot archive change with status '${state.status}' (expected 'in-progress').\n`
    );
    result.exitCode = 1;
    return result;
  }

  // -- Read proposal + deltas ---------------------------------------------
  const propPath = proposalPath(rootDir, options.changeId);
  if (!fs.existsSync(propPath)) {
    err.write(`Proposal missing at ${path.relative(rootDir, propPath)}\n`);
    result.exitCode = 1;
    return result;
  }
  const proposalRaw = fs.readFileSync(propPath, "utf8");
  let deltas: DeltaBlockSummary[];
  try {
    deltas = parseDeltasFromProposal(proposalRaw);
  } catch (e) {
    err.write(`Failed to parse deltas from proposal: ${stringifyError(e)}\n`);
    result.exitCode = 2;
    return result;
  }

  if (deltas.length === 0) {
    err.write(`Cannot archive: proposal has no DeltaBlock entries.\n`);
    result.exitCode = 1;
    return result;
  }

  // -- Pre-flight validation + conflict scan ------------------------------
  const pagesDir = path.join(wikiRoot, "pages");
  const targets: PerDomainTarget[] = [];

  for (const delta of deltas) {
    const pageFile = path.join(pagesDir, `contract-${delta.domain}.md`);
    if (!fs.existsSync(pageFile)) {
      err.write(
        `Pre-flight failed: contract page for domain '${delta.domain}' not found at ${path.relative(rootDir, pageFile)}.\n`
      );
      result.exitCode = 1;
      return result;
    }
    const pageContent = fs.readFileSync(pageFile, "utf8");
    let parsedPage: ParsedContractPage;
    try {
      parsedPage = parseContractPage(pageContent);
    } catch (e) {
      err.write(
        `Pre-flight failed: cannot parse contract page for '${delta.domain}': ${stringifyError(e)}\n`
      );
      result.exitCode = 2;
      return result;
    }

    // -- Validate IDs ---
    const reqIds = new Set(parsedPage.requirements.map((r) => r.id));
    const scnIds = new Set(parsedPage.scenarios.map((s) => s.id));

    for (const mod of delta.modifiedRequirements) {
      if (!reqIds.has(mod.id)) {
        err.write(
          `Pre-flight failed: modifiedRequirements[${mod.id}] does not exist on contract-${delta.domain}.md.\n`
        );
        result.exitCode = 1;
        return result;
      }
      // Verify before-text matches.
      const current = parsedPage.requirements.find((r) => r.id === mod.id);
      if (current && normalizeText(current.text) !== normalizeText(mod.before)) {
        err.write(
          `Pre-flight failed: modifiedRequirements[${mod.id}].before drift on contract-${delta.domain}.md.\n` +
            `  expected: ${normalizeText(mod.before)}\n` +
            `  current:  ${normalizeText(current.text)}\n`
        );
        result.exitCode = 1;
        return result;
      }
    }
    for (const rid of delta.removedRequirements) {
      if (!reqIds.has(rid)) {
        err.write(
          `Pre-flight failed: removedRequirements[${rid}] does not exist on contract-${delta.domain}.md.\n`
        );
        result.exitCode = 1;
        return result;
      }
    }
    for (const sc of delta.addedScenarios) {
      if (scnIds.has(sc.id)) {
        err.write(
          `Pre-flight failed: addedScenarios[${sc.id}] collides with existing scenario on contract-${delta.domain}.md.\n`
        );
        result.exitCode = 1;
        return result;
      }
    }
    for (const mod of delta.modifiedScenarios) {
      if (!scnIds.has(mod.id)) {
        err.write(
          `Pre-flight failed: modifiedScenarios[${mod.id}] does not exist on contract-${delta.domain}.md.\n`
        );
        result.exitCode = 1;
        return result;
      }
    }
    for (const sid of delta.removedScenarios) {
      if (!scnIds.has(sid)) {
        err.write(
          `Pre-flight failed: removedScenarios[${sid}] does not exist on contract-${delta.domain}.md.\n`
        );
        result.exitCode = 1;
        return result;
      }
    }

    if (delta.breakingChange && (delta.migrationNote === null || delta.migrationNote.length === 0)) {
      err.write(
        `Pre-flight failed: domain '${delta.domain}' has breakingChange=true but no migrationNote.\n`
      );
      result.exitCode = 1;
      return result;
    }
    if (delta.rationale.trim().length < 30) {
      err.write(
        `Pre-flight failed: domain '${delta.domain}' rationale is shorter than 30 chars.\n`
      );
      result.exitCode = 1;
      return result;
    }

    targets.push({
      delta,
      pageFile,
      pageContent,
      parsedPage,
    });
  }

  // -- Conflict scan ------------------------------------------------------
  if (!options.skipConflictScan) {
    const conflictResult = runConflictScan(rootDir, options.changeId, deltas, now);
    if (conflictResult.conflicts.length > 0) {
      result.conflicts = conflictResult.conflicts;
      // Persist conflicts to BOTH change states.
      const scanAt = bumpAfter(state.updatedAt, now);
      for (const entry of conflictResult.conflicts) {
        // Update peer ChangeState (append conflict, bump updatedAt).
        const peerState = safeReadState(rootDir, entry.otherChangeId);
        if (peerState !== null) {
          const peerAt = bumpAfter(peerState.updatedAt, now);
          writeChangeState(rootDir, {
            ...peerState,
            conflicts: [...peerState.conflicts, {
              otherChangeId: options.changeId,
              conflictingIds: entry.conflictingIds,
              detectedAt: peerAt,
            }],
            updatedAt: peerAt,
          });
        }
      }
      // Update this change's state.
      writeChangeState(rootDir, {
        ...state,
        conflicts: [...state.conflicts, ...conflictResult.conflicts.map((c) => ({
          otherChangeId: c.otherChangeId,
          conflictingIds: c.conflictingIds,
          detectedAt: scanAt,
        }))],
        updatedAt: scanAt,
      });

      err.write(
        `CONFLICT: ${options.changeId} cannot archive.\n` +
          conflictResult.conflicts
            .map(
              (c) =>
                `  Conflicts with ${c.otherChangeId} on [${c.conflictingIds.join(", ")}]`
            )
            .join("\n") +
          `\n  Options: (reject the other change) (rebase this change) (abort)\n`
      );
      result.exitCode = 1;
      return result;
    }
  }

  // -- Stage backups + compute new page inputs ----------------------------
  const stamp = bumpAfter(state.updatedAt, now);
  const dateOnly = stamp.slice(0, 10);
  const backups: BackupRecord[] = [];

  // We perform the snapshot and compute-new-input upfront, then commit pages in sequence.
  const composed: ComposedPage[] = [];
  for (const target of targets) {
    // Snapshot to .bak (raw bytes).
    const bakPath = `${target.pageFile}.bak`;
    fs.copyFileSync(target.pageFile, bakPath);
    backups.push({ pageFile: target.pageFile, bakPath });

    // Build new ContractPageInput.
    const newInput = composeNewPageInput({
      target,
      changeId: options.changeId,
      stamp,
      dateOnly,
      actor,
    });
    composed.push({ target, newInput });
  }

  // -- Commit phase -------------------------------------------------------
  // Pages were snapshotted; now write each via contract-page-writer (atomic
  // per page). If any throws, restore all `.bak` snapshots in reverse order
  // and emit a rollback log.
  let committedCount = 0;
  const writeResults: { domain: string; pageFile: string }[] = [];
  // Sort deterministically — alphabetical by domain — so behavior is stable.
  composed.sort((a, b) => a.target.delta.domain.localeCompare(b.target.delta.domain));

  for (const c of composed) {
    try {
      const writeRes = writeContractPage(wikiRoot, c.newInput);
      writeResults.push({ domain: c.target.delta.domain, pageFile: writeRes.pageFile });
      committedCount++;
    } catch (e) {
      // ROLLBACK
      const restored: string[] = [];
      // Restore committed pages from their .bak in reverse order.
      for (let i = backups.length - 1; i >= 0; i--) {
        const b = backups[i];
        try {
          fs.copyFileSync(b.bakPath, b.pageFile);
          restored.push(b.pageFile);
        } catch {
          // best-effort; surface in error message
        }
      }
      // Write rollback log.
      const rollbackLog = rollbackPath(rootDir, options.changeId);
      const log = renderRollbackLog({
        changeId: options.changeId,
        failedAt: stamp,
        attempted: composed.map((x) => x.target.pageFile),
        committedBefore: writeResults.map((w) => w.pageFile),
        failedOn: c.target.pageFile,
        failureReason: stringifyError(e),
        restored,
      });
      atomicWriteText(rollbackLog, log);
      err.write(
        `Archive failed mid-commit on ${path.relative(rootDir, c.target.pageFile)}: ${stringifyError(e)}\n` +
          `  Rollback emitted: ${path.relative(rootDir, rollbackLog)}\n` +
          `  Status remains 'in-progress' — manual recovery required.\n`
      );
      // Leave .bak files for forensic review.
      result.rollbackLog = rollbackLog;
      result.exitCode = 3;
      return result;
    }
  }

  // -- Post-commit: refresh wiki index ------------------------------------
  const indexRows: WikiIndexRow[] = composed.map((c) => ({
    pageId: `contract-${c.newInput.domain}`,
    title: c.newInput.title,
    category: "contract",
    subtype: "",
    staleness: "fresh",
    updatedAt: stamp,
    summary: c.newInput.summary,
    estimatedTokens: estimateFileTokens(
      path.join(wikiRoot, "pages", `contract-${c.newInput.domain}.md`)
    ),
  }));
  upsertContractWikiIndexEntries(wikiRoot, indexRows);

  // -- Update proposal.md frontmatter (archivedAt + status) ---------------
  const propRaw = fs.readFileSync(propPath, "utf8");
  const propUpdated = applyFrontmatterUpdates(propRaw, {
    status: "archived",
    archivedAt: stamp,
  });
  atomicWriteText(propPath, propUpdated);

  // -- Update this change's ChangeState -----------------------------------
  const nextState: ChangeState = {
    ...state,
    status: "archived",
    transitions: [
      ...state.transitions,
      {
        from: "in-progress",
        to: "archived",
        at: stamp,
        by: actor,
        reason: `multi-domain commit succeeded (${composed.length} domain${composed.length === 1 ? "" : "s"})`,
      },
    ],
    updatedAt: stamp,
  };
  writeChangeState(rootDir, nextState);

  // -- Write archive-log.toon mirror -------------------------------------
  const archiveLog = archiveLogPath(rootDir, options.changeId);
  atomicWriteText(archiveLog, renderArchiveLog({
    changeId: options.changeId,
    archivedAt: stamp,
    domains: composed.map((c) => c.target.delta.domain),
    actor,
  }));

  // -- Supersession scan --------------------------------------------------
  const superseded = runSupersessionScan({
    rootDir,
    archivedChangeId: options.changeId,
    deltas,
    now,
  });
  result.supersededChangeIds = superseded;

  // -- Cleanup backups ----------------------------------------------------
  for (const b of backups) {
    try {
      fs.rmSync(b.bakPath, { force: true });
    } catch {
      // best-effort
    }
  }

  result.domainsArchived = composed.map((c) => c.target.delta.domain);
  out.write(
    `Archived ${options.changeId} — ${result.domainsArchived.length} domain${result.domainsArchived.length === 1 ? "" : "s"} (${result.domainsArchived.join(", ")}).\n`
  );
  if (superseded.length > 0) {
    out.write(`  Superseded: ${superseded.join(", ")}\n`);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Conflict scan
// ---------------------------------------------------------------------------

interface PerDomainTarget {
  delta: DeltaBlockSummary;
  pageFile: string;
  pageContent: string;
  parsedPage: ParsedContractPage;
}

interface ComposedPage {
  target: PerDomainTarget;
  newInput: ContractPageInput;
}

interface BackupRecord {
  pageFile: string;
  bakPath: string;
}

interface ConflictScanResult {
  conflicts: ConflictEntry[];
}

function runConflictScan(
  rootDir: string,
  thisChangeId: string,
  thisDeltas: DeltaBlockSummary[],
  now: Date
): ConflictScanResult {
  const sweep = listChangeStates(rootDir);
  const inFlightStatuses: ReadonlyArray<string> = [
    "proposed",
    "reviewed",
    "approved",
    "in-progress",
  ];
  const peers = sweep.states.filter(
    (s) => s.changeId !== thisChangeId && inFlightStatuses.includes(s.status)
  );

  // Build the touched-IDs map for THIS change.
  const myIds = buildTouchedIdMap(thisDeltas);

  const conflicts: ConflictEntry[] = [];
  for (const peer of peers) {
    const peerPropPath = proposalPath(rootDir, peer.changeId);
    if (!fs.existsSync(peerPropPath)) continue;
    let peerDeltas: DeltaBlockSummary[];
    try {
      const peerRaw = fs.readFileSync(peerPropPath, "utf8");
      peerDeltas = parseDeltasFromProposal(peerRaw);
    } catch {
      continue;
    }
    const peerIds = buildTouchedIdMap(peerDeltas);

    const overlapping: string[] = [];
    for (const [domain, ids] of myIds) {
      const peerSet = peerIds.get(domain);
      if (!peerSet) continue;
      for (const id of ids) {
        if (peerSet.has(id)) overlapping.push(id);
      }
    }
    if (overlapping.length > 0) {
      conflicts.push({
        otherChangeId: peer.changeId,
        conflictingIds: dedupeSorted(overlapping),
        detectedAt: now.toISOString(),
      });
    }
  }

  return { conflicts };
}

function buildTouchedIdMap(deltas: DeltaBlockSummary[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const d of deltas) {
    const ids = new Set<string>();
    for (const m of d.modifiedRequirements) ids.add(m.id);
    for (const r of d.removedRequirements) ids.add(r);
    for (const s of d.addedScenarios) ids.add(s.id);
    for (const m of d.modifiedScenarios) ids.add(m.id);
    for (const r of d.removedScenarios) ids.add(r);
    // Added requirements have no id at proposal time (auto-assigned by archive)
    // so they cannot collide via ID — but they're still part of this delta. We
    // do NOT include them in the touched map.
    map.set(d.domain, ids);
  }
  return map;
}

function dedupeSorted(items: string[]): string[] {
  return Array.from(new Set(items)).sort();
}

// ---------------------------------------------------------------------------
// Supersession scan
// ---------------------------------------------------------------------------

interface SupersessionScanArgs {
  rootDir: string;
  archivedChangeId: string;
  deltas: DeltaBlockSummary[];
  now: Date;
}

function runSupersessionScan(args: SupersessionScanArgs): string[] {
  const { rootDir, archivedChangeId, deltas, now } = args;
  const sweep = listChangeStates(rootDir);
  const inFlightStatuses: ReadonlyArray<string> = [
    "proposed",
    "reviewed",
    "approved",
    "in-progress",
  ];
  const peers = sweep.states.filter(
    (s) => s.changeId !== archivedChangeId && inFlightStatuses.includes(s.status)
  );

  // removedThisArchive by domain.
  const removedByDomain = new Map<string, Set<string>>();
  for (const d of deltas) {
    const set = new Set<string>();
    for (const r of d.removedRequirements) set.add(r);
    removedByDomain.set(d.domain, set);
  }

  const superseded: string[] = [];

  for (const peer of peers) {
    const peerPropPath = proposalPath(rootDir, peer.changeId);
    if (!fs.existsSync(peerPropPath)) continue;
    let peerDeltas: DeltaBlockSummary[];
    try {
      const peerRaw = fs.readFileSync(peerPropPath, "utf8");
      peerDeltas = parseDeltasFromProposal(peerRaw);
    } catch {
      continue;
    }

    let isSuperseded = false;
    outer: for (const d of peerDeltas) {
      const removed = removedByDomain.get(d.domain);
      if (!removed) continue;
      for (const m of d.modifiedRequirements) {
        if (removed.has(m.id)) {
          isSuperseded = true;
          break outer;
        }
      }
      for (const r of d.removedRequirements) {
        if (removed.has(r)) {
          isSuperseded = true;
          break outer;
        }
      }
    }
    if (!isSuperseded) continue;

    // Stamp supersession on both ChangeState and proposal.md.
    const peerAt = bumpAfter(peer.updatedAt, now);
    const newPeerState: ChangeState = {
      ...peer,
      status: "superseded",
      transitions: [
        ...peer.transitions,
        {
          from: peer.status,
          to: "superseded",
          at: peerAt,
          by: "agent:change-archiver",
          reason: `superseded by ${archivedChangeId}`,
        },
      ],
      supersededBy: archivedChangeId,
      updatedAt: peerAt,
    };
    try {
      writeChangeState(rootDir, newPeerState);
    } catch {
      continue; // best-effort; don't fail the archive
    }

    const peerRaw = fs.readFileSync(peerPropPath, "utf8");
    const peerUpdated = applyFrontmatterUpdates(peerRaw, { status: "superseded" });
    atomicWriteText(peerPropPath, peerUpdated);

    superseded.push(peer.changeId);
  }

  return superseded;
}

// ---------------------------------------------------------------------------
// Contract page parser + composer
// ---------------------------------------------------------------------------

interface ParsedContractPage {
  /** TOON frontmatter scalars (only the ones we care about; everything else preserved via raw). */
  frontmatter: Map<string, string>;
  /** Per-section raw text below each H2 heading. */
  sections: Map<string, string>;
  /** Parsed requirements from `## Requirements`. */
  requirements: ContractPageRequirement[];
  /** Parsed scenarios from `## Scenarios` (raw bodies — we only need IDs for archive). */
  scenarios: Array<{ id: string; raw: string; title: string }>;
  /** Existing entities — preserved verbatim. */
  entities: ContractPageEntity[];
  /** Existing out-of-scope items as plain bullets. */
  outOfScope: string[];
  /** Existing history entries. */
  history: ContractPageHistoryEntry[];
  /** sourceChanges[] from frontmatter. */
  sourceChanges: string[];
  /** Page title (H1 line). */
  title: string;
  /** Page summary from frontmatter. */
  summary: string;
  /** Purpose section prose. */
  purpose: string;
  /** Tags from frontmatter. */
  tags: string[];
  /** sourceRefs from frontmatter. */
  sourceRefs: string[];
  /** createdAt from frontmatter (preserved). */
  createdAt: string;
}

function parseContractPage(content: string): ParsedContractPage {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  // Find frontmatter fences.
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
  if (openIdx === -1 || closeIdx === -1) {
    throw new Error("contract page missing TOON frontmatter fence");
  }

  const frontmatter = new Map<string, string>();
  const simpleArrays = new Map<string, string[]>();
  for (let i = openIdx + 1; i < closeIdx; i++) {
    const line = lines[i];
    if (line.startsWith("  ")) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    // Array header form `name[N]: a, b`.
    const arrayMatch = /^([A-Za-z_][A-Za-z0-9_]*)\[(\d+)\]$/.exec(key);
    if (arrayMatch) {
      simpleArrays.set(arrayMatch[1], splitCsvLine(value));
      continue;
    }
    frontmatter.set(key, value);
  }

  // Parse body sections.
  const bodyLines = lines.slice(closeIdx + 1);
  const sections = new Map<string, string>();
  let titleLine = "";
  let currentHeading: string | null = null;
  let buffer: string[] = [];
  for (const line of bodyLines) {
    const h1 = /^#\s+(.+)$/.exec(line);
    if (h1 && titleLine === "") {
      titleLine = h1[1].trim();
      continue;
    }
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) {
      if (currentHeading !== null) {
        sections.set(currentHeading, buffer.join("\n").trim());
      }
      currentHeading = h2[1].trim();
      buffer = [];
      continue;
    }
    buffer.push(line);
  }
  if (currentHeading !== null) {
    sections.set(currentHeading, buffer.join("\n").trim());
  }

  const requirements = parseRequirementsSection(sections.get("Requirements") ?? "");
  const scenarios = parseScenariosSection(sections.get("Scenarios") ?? "");
  const entities = parseEntitiesSection(sections.get("Entities") ?? "");
  const outOfScope = parseOutOfScopeSection(sections.get("Out of Scope") ?? "");
  const history = parseHistorySection(sections.get("History") ?? "");

  return {
    frontmatter,
    sections,
    requirements,
    scenarios,
    entities,
    outOfScope,
    history,
    sourceChanges: simpleArrays.get("sourceChanges") ?? [],
    title: titleLine,
    summary: frontmatter.get("summary") ?? "",
    purpose: sections.get("Purpose") ?? "",
    tags: simpleArrays.get("tags") ?? [],
    sourceRefs: simpleArrays.get("sourceRefs") ?? [],
    createdAt: frontmatter.get("createdAt") ?? "",
  };
}

function parseRequirementsSection(raw: string): ContractPageRequirement[] {
  const out: ContractPageRequirement[] = [];
  const re = /\*\*(R-\d{2,})\*\*\s+\*\((functional|non-functional)\)\*\s+—\s+(.+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    out.push({
      id: match[1],
      requirementType: match[2] as "functional" | "non-functional",
      text: match[3].trim(),
    });
  }
  return out;
}

function parseScenariosSection(raw: string): Array<{ id: string; raw: string; title: string }> {
  const out: Array<{ id: string; raw: string; title: string }> = [];
  const lines = raw.split("\n");
  let i = 0;
  while (i < lines.length) {
    if (/^```\s*toon\s*$/.test(lines[i])) {
      const bodyLines: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        bodyLines.push(lines[i]);
        i++;
      }
      i++; // consume closing fence
      const body = bodyLines.join("\n");
      const idMatch = /^id:\s*(\S+)/m.exec(body);
      const titleMatch = /^title:\s*(.+)$/m.exec(body);
      if (idMatch) {
        out.push({
          id: idMatch[1].trim(),
          raw: body,
          title: titleMatch ? titleMatch[1].trim() : "",
        });
      }
      continue;
    }
    i++;
  }
  return out;
}

function parseEntitiesSection(raw: string): ContractPageEntity[] {
  if (!raw || raw.startsWith("<!--")) return [];
  const out: ContractPageEntity[] = [];
  // Each entity is `### Name` followed by an optional description and a table.
  const lines = raw.split("\n");
  let i = 0;
  while (i < lines.length) {
    const h3 = /^###\s+(.+)$/.exec(lines[i]);
    if (!h3) {
      i++;
      continue;
    }
    const name = h3[1].trim();
    i++;
    // optional blank + description.
    let description = "";
    while (i < lines.length && !/^\|/.test(lines[i]) && !/^###/.test(lines[i])) {
      if (lines[i].trim().length > 0) {
        description += (description ? "\n" : "") + lines[i];
      }
      i++;
    }
    // table.
    const fields: Array<{ name: string; type: string; constraints: string }> = [];
    if (i < lines.length && /^\|\s*Field/.test(lines[i])) {
      i++; // skip header
      if (i < lines.length && /^\|---/.test(lines[i])) i++; // skip separator
      while (i < lines.length && /^\|/.test(lines[i])) {
        const cells = lines[i].split("|").slice(1, -1).map((s) => s.trim());
        if (cells.length >= 3) {
          fields.push({ name: cells[0], type: cells[1], constraints: cells[2] });
        }
        i++;
      }
    }
    out.push({
      name,
      description: description.trim() || undefined,
      fields,
    });
  }
  return out;
}

function parseOutOfScopeSection(raw: string): string[] {
  if (!raw || raw.startsWith("<!--")) return [];
  const out: string[] = [];
  for (const line of raw.split("\n")) {
    const m = /^[-*]\s+(.+)$/.exec(line.trim());
    if (m) out.push(m[1].trim());
  }
  return out;
}

function parseHistorySection(raw: string): ContractPageHistoryEntry[] {
  if (!raw || raw.startsWith("<!--")) return [];
  const out: ContractPageHistoryEntry[] = [];
  const lines = raw.split("\n");
  let current: ContractPageHistoryEntry | null = null;
  for (const line of lines) {
    const headingMatch = /^###\s+(chg-\d{8}-[a-z0-9-]+)\s+—\s+(\d{4}-\d{2}-\d{2})\s*$/.exec(line);
    if (headingMatch) {
      if (current !== null) out.push(current);
      current = {
        changeId: headingMatch[1],
        date: headingMatch[2],
        rationale: "",
        deltas: "",
        breaking: false,
      };
      continue;
    }
    if (current === null) continue;
    const rMatch = /^\*\*Rationale:\*\*\s+(.+)$/.exec(line);
    if (rMatch) {
      current.rationale = rMatch[1].trim();
      continue;
    }
    const dMatch = /^\*\*Deltas:\*\*\s+(.+)$/.exec(line);
    if (dMatch) {
      current.deltas = dMatch[1].trim();
      continue;
    }
    const bMatch = /^\*\*Breaking:\*\*\s+(true|false)/.exec(line);
    if (bMatch) {
      current.breaking = bMatch[1] === "true";
      continue;
    }
  }
  if (current !== null) out.push(current);
  return out;
}

function composeNewPageInput(args: {
  target: PerDomainTarget;
  changeId: string;
  stamp: string;
  dateOnly: string;
  actor: string;
}): ContractPageInput {
  const { target, changeId, stamp, dateOnly, actor } = args;
  const page = target.parsedPage;
  const delta = target.delta;

  // ---- Requirements ---------------------------------------------------
  // 1. Start with existing reqs.
  // 2. Apply modifications (replace text on matching IDs).
  // 3. Remove removed IDs.
  // 4. Append added requirements with newly-assigned R-NN IDs.
  let reqs: ContractPageRequirement[] = page.requirements.map((r) => ({ ...r }));
  const modifiedSet = new Map<string, string>();
  for (const m of delta.modifiedRequirements) modifiedSet.set(m.id, m.after);
  const removedSet = new Set(delta.removedRequirements);

  reqs = reqs
    .filter((r) => !removedSet.has(r.id))
    .map((r) => {
      const newText = modifiedSet.get(r.id);
      return newText ? { ...r, text: newText } : r;
    });

  // Add new requirements with auto-assigned IDs. Skip numbers used by
  // existing OR tombstoned (we don't track tombstones from parsing alone;
  // simplest safe behavior: take max existing R-NN + 1).
  const existingNums = page.requirements.map((r) => parseInt(r.id.slice(2), 10));
  let nextNum = existingNums.length > 0 ? Math.max(...existingNums) + 1 : 1;
  for (const text of delta.addedRequirements) {
    reqs.push({
      id: `R-${String(nextNum).padStart(2, "0")}`,
      requirementType: inferRequirementType(text),
      text,
    });
    nextNum++;
  }

  // ---- Scenarios ------------------------------------------------------
  // 1. Drop removed.
  // 2. Apply modifications.
  // 3. Append added.
  const scnRemovedSet = new Set(delta.removedScenarios);
  const scnModifiedMap = new Map<string, string>();
  for (const m of delta.modifiedScenarios) scnModifiedMap.set(m.id, m.afterRaw);

  const existingScenarios: ContractPageScenario[] = page.scenarios
    .filter((s) => !scnRemovedSet.has(s.id))
    .map((s) => {
      const newRaw = scnModifiedMap.get(s.id);
      if (newRaw) {
        return parseScenarioToon(newRaw, s.id);
      }
      return parseScenarioToon(s.raw, s.id);
    });

  const addedScenarios: ContractPageScenario[] = delta.addedScenarios.map((s) =>
    parseScenarioToon(s.raw, s.id)
  );

  // ---- History --------------------------------------------------------
  const newHistory: ContractPageHistoryEntry = {
    changeId,
    date: dateOnly,
    rationale: delta.rationale,
    deltas: summarizeDeltas(delta),
    breaking: delta.breakingChange,
  };
  const history = [...page.history, newHistory];
  const sourceChanges = [...page.sourceChanges, changeId];

  // ---- Build input ----------------------------------------------------
  const input: ContractPageInput = {
    domain: delta.domain,
    title: page.title || capitalize(delta.domain),
    summary: page.summary,
    purpose: page.purpose,
    requirements: reqs,
    scenarios: [...existingScenarios, ...addedScenarios],
    entities: page.entities,
    outOfScope: page.outOfScope,
    history,
    contractVersion: 1,
    contractStatus: "active",
    sourceChanges,
    deprecatedAt: null,
    replacedBy: null,
    sourceRefs: page.sourceRefs,
    tags: page.tags,
    createdAt: page.createdAt || stamp,
    updatedAt: stamp,
    createdBy: target.parsedPage.frontmatter.get("createdBy") ?? "materializer",
    updatedBy: actor,
  };

  return input;
}

function inferRequirementType(text: string): "functional" | "non-functional" {
  // Heuristic: non-functional tends to mention latency/throughput/availability/
  // response time / p95 / SLO; otherwise functional.
  if (/\b(p\d{2}|SLO|latency|throughput|availability|response time|complete within|MUST scale)\b/i.test(text)) {
    return "non-functional";
  }
  return "functional";
}

function summarizeDeltas(d: DeltaBlockSummary): string {
  const parts: string[] = [];
  if (d.addedRequirements.length > 0) parts.push(`added ${d.addedRequirements.length} req(s)`);
  if (d.modifiedRequirements.length > 0) parts.push(`modified ${d.modifiedRequirements.length} req(s)`);
  if (d.removedRequirements.length > 0) parts.push(`removed ${d.removedRequirements.length} req(s)`);
  if (d.addedScenarios.length > 0) parts.push(`added ${d.addedScenarios.length} scenario(s)`);
  if (d.modifiedScenarios.length > 0) parts.push(`modified ${d.modifiedScenarios.length} scenario(s)`);
  if (d.removedScenarios.length > 0) parts.push(`removed ${d.removedScenarios.length} scenario(s)`);
  return parts.join("; ") || "no changes";
}

function parseScenarioToon(raw: string, fallbackId: string): ContractPageScenario {
  const find = (key: string): string => {
    const m = new RegExp(`^${escape(key)}:\\s*(.*)$`, "m").exec(raw);
    return m ? m[1].trim() : "";
  };
  const findArray = (key: string): string[] => {
    const m = new RegExp(`^${escape(key)}\\[(\\d+)\\]:\\s*(.*)$`, "m").exec(raw);
    if (!m) return [];
    if (Number(m[1]) === 0) return [];
    return splitCsvLine(m[2]).filter((s) => s.length > 0);
  };

  const id = find("id") || fallbackId;
  const title = find("title");
  const given = findArray("given");
  const when = find("when");
  const whenTriggerType = find("whenTriggerType");
  const then = findArray("then");
  const stateRefRaw = find("stateRef");
  const tags = findArray("tags");
  const testTierRaw = find("testTier");
  const automatableRaw = find("automatable");

  return {
    id,
    title,
    given,
    when,
    whenTriggerType,
    then,
    stateRef: stateRefRaw.length > 0 ? stateRefRaw : null,
    tags,
    testTier: testTierRaw.length > 0 ? testTierRaw : null,
    automatable: automatableRaw.toLowerCase() === "true",
  };
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

function splitCsvLine(value: string): string[] {
  if (value.length === 0) return [];
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '"') {
      const next = value[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current.trim());
  return out.filter((s) => s.length > 0);
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function stringifyError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function safeReadState(rootDir: string, changeId: string): ChangeState | null {
  try {
    return readChangeState(rootDir, changeId);
  } catch {
    return null;
  }
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function estimateFileTokens(filePath: string): number {
  try {
    const stat = fs.statSync(filePath);
    return Math.ceil(stat.size / 4);
  } catch {
    return 0;
  }
}

function renderRollbackLog(args: {
  changeId: string;
  failedAt: string;
  attempted: string[];
  committedBefore: string[];
  failedOn: string;
  failureReason: string;
  restored: string[];
}): string {
  const lines: string[] = [];
  lines.push(`changeId: ${args.changeId}`);
  lines.push(`failedAt: ${args.failedAt}`);
  lines.push(`attemptedTargets[${args.attempted.length}]: ${args.attempted.join(", ")}`);
  lines.push(`committedBefore[${args.committedBefore.length}]: ${args.committedBefore.join(", ")}`);
  lines.push(`failedOn: ${args.failedOn}`);
  lines.push(`failureReason: ${csvEscape(args.failureReason)}`);
  lines.push(`restoredFromBackup[${args.restored.length}]: ${args.restored.join(", ")}`);
  lines.push(`recoveryCommand: /loom-change recover ${args.changeId}`);
  return lines.join("\n") + "\n";
}

function renderArchiveLog(args: {
  changeId: string;
  archivedAt: string;
  domains: string[];
  actor: string;
}): string {
  const lines: string[] = [];
  lines.push(`changeId: ${args.changeId}`);
  lines.push(`archivedAt: ${args.archivedAt}`);
  lines.push(`actor: ${args.actor}`);
  lines.push(`domains[${args.domains.length}]: ${args.domains.join(", ")}`);
  return lines.join("\n") + "\n";
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

// ---------------------------------------------------------------------------
// CLI entry-point
// ---------------------------------------------------------------------------

function parseCliArgs(argv: string[]): ArchiveOptions | { error: string } {
  let changeId: string | null = null;
  let by: string | undefined;
  let rootDir: string | undefined;
  let wikiRoot: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--by") by = argv[++i];
    else if (arg.startsWith("--by=")) by = arg.slice("--by=".length);
    else if (arg.startsWith("--root=")) rootDir = arg.slice("--root=".length);
    else if (arg.startsWith("--wiki-root=")) wikiRoot = arg.slice("--wiki-root=".length);
    else if (!arg.startsWith("--")) {
      if (changeId !== null) {
        return { error: `Multiple changeId arguments: '${changeId}', '${arg}'` };
      }
      changeId = arg;
    }
  }
  if (changeId === null) {
    return { error: "Usage: /loom-change archive <changeId> [--by <actor>] [--wiki-root <path>]" };
  }
  return { changeId, by, rootDir, wikiRoot };
}

const isMain =
  (process.argv[1] ?? "").endsWith("archive.ts") ||
  (process.argv[1] ?? "").endsWith("archive.js");

if (isMain) {
  const parsed = parseCliArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(parsed.error + "\n");
    process.exit(2);
  }
  const result = runArchive(parsed);
  process.exit(result.exitCode);
}
