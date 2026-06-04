/**
 * Hook: wiki-session-status (SessionStart)
 *
 * Two responsibilities:
 *
 * 1. HEALTH SURFACING — emit a status line about wiki freshness with explicit
 *    silence thresholds:
 *      - M==0 AND D<7   → silent
 *      - M==0 AND D<14  → subdued one-line
 *      - M>0 OR D>=14   → [wiki:attention] with concrete remediation
 *
 * 2. CONTEXT LOADING (three-tier) — inject relevant wiki content into the
 *    session's initial context so ad-hoc Claude Code work outside the Loom
 *    pipeline can consult project knowledge without a manual /loom-wiki query.
 *    Honors `orchestration.toml [wiki].sessionContext = off | minimal | full`
 *    (default `minimal`). The whole hook can be disabled via
 *    `[wiki].sessionStatusEnabled = false` (status + context both suppressed).
 *
 *    Tier 1 (always, when wiki has ≥10 pages):
 *      Top 3-5 high-confidence decision/convention/pattern summaries.
 *    Tier 2 (when .plan-execution/state.toon shows active wave):
 *      Flow/contract/component summaries whose touches/producers/consumers
 *      overlap the current wave's file ownership.
 *    Tier 3 (when paused-session state present):
 *      Pages that were live in the resumed session's rolling-context.
 *
 *    Total worst-case ~1.5k tokens. Within 100k per-agent budget cap.
 *
 * Also: wipes per-session dedup state for wiki-impact-warner and wiki-commit-
 * ledger; logs lint-pending marker when D>14; honors LOOM_WIKI_HOOKS=0;
 * surfaces freshness-ledger debt count.
 *
 * Fail-open: any error → allow() silently. Never blocks session start.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { runHook, allow } from "./lib/run-hook.js";
import { parseToon, parseToonArray } from "./lib/toon-reader.js";
import {
  findProjectRoot,
  writeAtomic,
  daysSince,
  readWikiOptions,
  resolveSessionId,
  type WikiOptions,
} from "./lib/wiki-helpers.js";

interface PageMeta {
  pageId: string;
  title: string;
  category: string;
  staleness?: string;
  updatedAt?: string;
  summary?: string;
  confidence?: string;
  subtype?: string;
}

function readIndexPages(indexContent: string): PageMeta[] {
  const rows = parseToonArray(indexContent, "pages");
  return rows.map((r) => ({
    pageId: String(r["pageId"] ?? ""),
    title: String(r["title"] ?? ""),
    category: String(r["category"] ?? ""),
    staleness: r["staleness"] != null ? String(r["staleness"]) : undefined,
    updatedAt: r["updatedAt"] != null ? String(r["updatedAt"]) : undefined,
    summary: r["summary"] != null ? String(r["summary"]) : undefined,
    confidence: r["confidence"] != null ? String(r["confidence"]) : undefined,
    subtype: r["subtype"] != null ? String(r["subtype"]) : undefined,
  }));
}

/** Read first paragraph of a page body as a fallback summary (≤200 chars). */
function fallbackSummary(pagePath: string): string {
  try {
    const content = fs.readFileSync(pagePath, "utf-8");
    const lines = content.split("\n");
    let inFrontmatter = false;
    let bodyStart = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("```")) {
        if (!inFrontmatter) {
          inFrontmatter = true;
        } else {
          bodyStart = i + 1;
          break;
        }
      }
    }
    for (let i = bodyStart; i < lines.length && i < bodyStart + 50; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith("#") || line.startsWith("```")) continue;
      return line.slice(0, 200).replace(/\s+/g, " ");
    }
    return "";
  } catch {
    return "";
  }
}

function pageSummary(page: PageMeta, wikiDir: string): string {
  if (page.summary && !page.summary.startsWith("(legacy")) {
    return page.summary;
  }
  const pagePath = path.join(wikiDir, "pages", `${page.pageId}.md`);
  const fb = fallbackSummary(pagePath);
  return fb || page.title || page.pageId;
}

/**
 * Read current wave's file ownership from .plan-execution/state.toon.
 *
 * Scopes to the active wave (state.toon `currentWave` field) rather than
 * collecting fileOwnership across all waves. This prevents stale ownership
 * entries from completed waves bleeding into Tier 2 context selection.
 *
 * The state.toon structure puts waves under `waves.{N}:` blocks with the
 * shape:
 *   waves.0:
 *     status: succeeded
 *     tasks[K]{taskId,agent,status}: ...
 *     fileOwnership[M]: src/a.ts, src/b.ts
 *
 * We only return fileOwnership from the wave matching `currentWave`.
 */
function getActiveWaveFiles(planExecDir: string): Set<string> | null {
  const statePath = path.join(planExecDir, "state.toon");
  if (!fs.existsSync(statePath)) return null;
  try {
    const content = fs.readFileSync(statePath, "utf-8");
    const top = parseToon(content);
    if (String(top["status"] ?? "") !== "running") return null;

    const currentWave = String(top["currentWave"] ?? "");
    if (!currentWave) return null;

    // Locate the `waves.{currentWave}:` (or `wave.{currentWave}:`) block and
    // extract its indented fileOwnership line(s). Other waves' ownership is
    // ignored.
    const lines = content.split("\n");
    const waveHeaderRe = new RegExp(
      `^(?:waves?\\.)?${currentWave}:\\s*$`
    );
    const files = new Set<string>();
    let inActiveWave = false;
    for (const line of lines) {
      const trimmed = line.trim();
      // Detect wave boundaries — any non-indented `<number>:` or `waves.<N>:`
      // ends the active wave block.
      const anyWaveHeader = /^(?:waves?\.)?\d+:\s*$/.test(line);
      if (anyWaveHeader) {
        inActiveWave = waveHeaderRe.test(line);
        continue;
      }
      if (!inActiveWave) continue;
      // Wave-block content is indented; a non-indented non-empty line ends it.
      if (trimmed && !line.startsWith("  ") && !line.startsWith("\t")) {
        inActiveWave = false;
        continue;
      }
      const ownership = line.match(/^\s*fileOwnership\[\d+\]:\s*(.*)$/);
      if (ownership) {
        for (const f of ownership[1].split(",")) {
          const v = f.trim();
          if (v) files.add(v);
        }
      }
    }
    return files.size > 0 ? files : null;
  } catch {
    return null;
  }
}

/**
 * Three-tier context loader.
 * Returns a ## Project Knowledge markdown block ready to emit, or empty string.
 */
function loadProjectContext(
  wikiDir: string,
  projectRoot: string,
  opts: WikiOptions
): string {
  if (opts.sessionContext === "off") return "";

  const indexPath = path.join(wikiDir, "index.toon");
  if (!fs.existsSync(indexPath)) return "";

  let indexContent: string;
  try {
    indexContent = fs.readFileSync(indexPath, "utf-8");
  } catch {
    return "";
  }

  const pages = readIndexPages(indexContent);
  if (pages.length < 10) return "";

  // ── Tier 1 — Always-relevant architectural anchors ───────────────────────
  const categoryWeight: Record<string, number> = {
    decision: 100,
    convention: 90,
    pattern: 85,
    structure: 80,
  };
  const confidenceWeight: Record<string, number> = {
    high: 30,
    medium: 15,
    low: 0,
  };
  const tier1 = pages
    .filter((p) => categoryWeight[p.category] != null)
    .map((p) => ({
      page: p,
      score:
        categoryWeight[p.category] +
        confidenceWeight[p.confidence ?? "medium"] +
        (p.staleness === "fresh" ? 5 : p.staleness === "aging" ? 0 : -10),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.sessionContext === "full" ? 8 : 5)
    .map((x) => x.page);

  // ── Tier 2 — Plan-active overlap ─────────────────────────────────────────
  let tier2: PageMeta[] = [];
  const planExecDir = path.join(projectRoot, ".plan-execution");
  const waveFiles = fs.existsSync(planExecDir)
    ? getActiveWaveFiles(planExecDir)
    : null;

  if (waveFiles && waveFiles.size > 0) {
    const fileBasenames = new Set<string>();
    for (const fp of waveFiles) {
      fileBasenames.add(path.basename(fp).replace(/\.[^.]+$/, "").toLowerCase());
    }

    tier2 = pages
      .filter((p) => {
        if (
          !["flow", "contract", "component", "api-surface"].includes(p.category)
        ) {
          return false;
        }
        const suffix = p.pageId
          .replace(/^[a-z-]+?-/, "")
          .toLowerCase()
          .split("-");
        return suffix.some((token) => fileBasenames.has(token));
      })
      .sort((a, b) => {
        const order: Record<string, number> = {
          flow: 0,
          contract: 1,
          component: 2,
          "api-surface": 3,
        };
        return (order[a.category] ?? 9) - (order[b.category] ?? 9);
      })
      .slice(0, opts.sessionContext === "full" ? 6 : 4);
  }

  // ── Tier 3 — Resumed-session pages ───────────────────────────────────────
  let tier3: PageMeta[] = [];
  const pauseDir = path.join(projectRoot, ".plan-history", "pause");
  if (fs.existsSync(pauseDir)) {
    try {
      const pauseFiles = fs
        .readdirSync(pauseDir)
        .filter((f) => f.endsWith(".toon"));
      if (pauseFiles.length > 0) {
        pauseFiles.sort();
        const latestPath = path.join(pauseDir, pauseFiles[pauseFiles.length - 1]);
        const pauseContent = fs.readFileSync(latestPath, "utf-8");
        const m = pauseContent.match(/^wikiContext\[\d+\]:\s*(.*)$/m);
        if (m) {
          const pageIds = new Set(
            m[1].split(",").map((s) => s.trim()).filter(Boolean)
          );
          tier3 = pages.filter((p) => pageIds.has(p.pageId)).slice(0, 4);
        }
      }
    } catch {
      // ignore — tier 3 is best-effort
    }
  }

  // Dedup across tiers.
  const seen = new Set<string>();
  const dedup = (list: PageMeta[]) =>
    list.filter((p) => {
      if (seen.has(p.pageId)) return false;
      seen.add(p.pageId);
      return true;
    });

  const t2 = dedup(tier2);
  const t3 = dedup(tier3);
  const t1 = dedup(tier1);

  if (t1.length + t2.length + t3.length === 0) return "";

  const lines: string[] = [];
  lines.push("");
  lines.push("## Project Knowledge [from .loom/wiki/]");
  lines.push("");

  if (t1.length > 0) {
    lines.push("**Architectural anchors:**");
    for (const p of t1) {
      lines.push(`- \`${p.pageId}\` — ${pageSummary(p, wikiDir)}`);
    }
    lines.push("");
  }
  if (t2.length > 0) {
    lines.push("**Relevant to active wave:**");
    for (const p of t2) {
      lines.push(`- \`${p.pageId}\` (${p.category}) — ${pageSummary(p, wikiDir)}`);
    }
    lines.push("");
  }
  if (t3.length > 0) {
    lines.push("**From resumed session:**");
    for (const p of t3) {
      lines.push(`- \`${p.pageId}\` — ${pageSummary(p, wikiDir)}`);
    }
    lines.push("");
  }

  lines.push(
    "_Consult these before assuming. If something here is wrong, say so — wiki content can drift._"
  );
  lines.push("");
  return lines.join("\n");
}

runHook("wiki-session-status", async () => {
  if (process.env.LOOM_WIKI_HOOKS === "0") return allow();

  const root = findProjectRoot();
  if (!root) return allow();

  const wikiDir = path.join(root, ".loom", "wiki");
  if (!fs.existsSync(wikiDir)) return allow();

  const indexPath = path.join(wikiDir, "index.toon");
  if (!fs.existsSync(indexPath)) return allow();

  // Kill switch — disables both the status line and the context loader.
  // Fine-grained context-loader tier remains controlled by `sessionContext`.
  if (!readWikiOptions(root).sessionStatusEnabled) return allow();

  let content: string;
  try {
    content = fs.readFileSync(indexPath, "utf-8");
  } catch {
    return allow();
  }

  const top = parseToon(content);
  const N = Number(top["pageCount"] ?? 0);

  const pages = parseToonArray(content, "pages");
  let M = 0;
  for (const row of pages) {
    if (row["staleness"] === "stale") M++;
  }

  const logPath = path.join(wikiDir, "log.toon");
  let lastIso: string | null = null;
  if (fs.existsSync(logPath)) {
    try {
      const logContent = fs.readFileSync(logPath, "utf-8");
      const logTop = parseToon(logContent);
      const cand = logTop["lastEntry"];
      if (cand) lastIso = String(cand);
    } catch {
      // ignore
    }
  }
  if (!lastIso) {
    const cand = top["lastUpdated"];
    if (cand) lastIso = String(cand);
  }
  const D = daysSince(lastIso);

  // Empty-wiki edge case
  if (N === 0) {
    return allow(`[wiki] empty wiki — run /loom-wiki ingest --full to populate\n`);
  }

  // Reset per-session dedup state.
  const sessionId = resolveSessionId();
  const ephemeralDir = path.join(root, ".plan-execution", "ephemeral");
  try {
    const sessionStatePath = path.join(ephemeralDir, "wiki-impact-session.toon");
    writeAtomic(sessionStatePath, `sessionId: ${sessionId}\nfiles[0]:\n`);
    const throttlePath = path.join(ephemeralDir, "wiki-hook-signals.toon");
    writeAtomic(throttlePath, "");
  } catch {
    // Non-fatal
  }

  // Count freshness-ledger debt entries.
  let debtCount = 0;
  const ledgerPath = path.join(wikiDir, "freshness-ledger.toon");
  if (fs.existsSync(ledgerPath)) {
    try {
      const ledgerContent = fs.readFileSync(ledgerPath, "utf-8");
      const entries = parseToonArray(ledgerContent, "entries");
      for (const row of entries) {
        if (row["status"] === "debt") debtCount++;
      }
    } catch {
      // ignore
    }
  }

  // ── Build status message ──
  const messageParts: string[] = [];
  if (M === 0 && D < 7 && debtCount === 0) {
    // Fully healthy — silent.
  } else if (M === 0 && D < 14 && debtCount === 0) {
    messageParts.push(`[wiki] ${N} pages — last ingest ${D}d ago\n`);
  } else if (M > 0) {
    messageParts.push(
      `[wiki:attention] ${N} pages | ${M} stale | last ingest ${D}d ago\n`
    );
    messageParts.push(
      `  → Run /loom-wiki ingest --diff to refresh stale pages.\n`
    );
  } else if (D >= 14) {
    messageParts.push(`[wiki:attention] ${N} pages | last ingest ${D}d ago\n`);
    messageParts.push(
      `  → Run /loom-wiki ingest --diff to pick up recent changes.\n`
    );
  }

  if (debtCount > 0) {
    messageParts.push(
      `[wiki:ledger] ${debtCount} commits have unreconciled wiki impact — /loom-wiki ingest --diff to catch up.\n`
    );
  }

  // Log a lint-pending marker when D > 14.
  if (D > 14) {
    try {
      const markerPath = path.join(ephemeralDir, "wiki-lint-pending.toon");
      writeAtomic(
        markerPath,
        `queuedAt: ${new Date().toISOString()}\nreason: D>14\n`
      );
    } catch {
      // Non-fatal
    }
  }

  // ── Three-tier context loader ──
  const opts = readWikiOptions(root);
  const contextBlock = loadProjectContext(wikiDir, root, opts);

  const message = messageParts.join("") + contextBlock;
  return allow(message || undefined);
});
