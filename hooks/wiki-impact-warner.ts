/**
 * Hook: wiki-impact-warner (PreToolUse — Write/Edit)
 * Surfaces flow/contract impact before file edits via graph walk over
 * .loom/wiki/. Never blocks; only emits informational messages.
 *
 * Noise control:
 *  - LOOM_WIKI_HOOKS=0 env-var → silent for the session
 *  - Per-file-per-session dedup (notify once per unique file per session)
 *  - 5-minute session throttle (collapses to count after 2+ signals)
 *  - impactAck=require config → emits prompt-instruction for user confirmation
 *
 * Fail-open: any error → allow() silently.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { runHook, allow } from "./lib/run-hook.js";
import { parseToon, parseToonArray } from "./lib/toon-reader.js";
import {
  findProjectRoot,
  writeAtomic,
  canonicalize,
  readWikiOptions,
  resolveSessionId,
} from "./lib/wiki-helpers.js";

interface ImpactMatch {
  pageId: string;
  summary: string;
}

interface ImpactCache {
  flowMap: Record<string, ImpactMatch[]>;
  contractMap: Record<string, ImpactMatch[]>;
  indexMtime: number;
}

/** Extract rows from a typed-array section by name. Returns raw row strings. */
function extractTypedArrayRows(content: string, arrayName: string): string[] {
  const lines = content.split("\n");
  const rows: string[] = [];
  let inArray = false;
  const headerRe = new RegExp(`^\\s*${arrayName}\\[\\d+\\]\\{[^}]+\\}:\\s*$`);
  for (const line of lines) {
    if (!inArray) {
      if (headerRe.test(line)) {
        inArray = true;
      }
      continue;
    }
    if (!line.startsWith("  ") || !line.trim()) {
      break;
    }
    rows.push(line.trim());
  }
  return rows;
}

function buildImpactCache(wikiDir: string, projectRoot: string): ImpactCache {
  const pagesDir = path.join(wikiDir, "pages");
  const flowMap: Record<string, ImpactMatch[]> = {};
  const contractMap: Record<string, ImpactMatch[]> = {};

  const indexPath = path.join(wikiDir, "index.toon");
  const indexMtime = fs.existsSync(indexPath) ? fs.statSync(indexPath).mtimeMs : 0;

  // Build pageId → summary lookup from index.toon for nicer messages.
  const summaryByPageId: Record<string, string> = {};
  try {
    const indexContent = fs.readFileSync(indexPath, "utf-8");
    const pages = parseToonArray(indexContent, "pages");
    for (const row of pages) {
      const pid = String(row["pageId"] ?? "");
      let summary = String(row["summary"] ?? "");
      if (!summary || summary.startsWith("(legacy")) {
        summary = String(row["title"] ?? pid);
      }
      summaryByPageId[pid] = summary;
    }
  } catch {
    // ignore — fall back to pageId-as-summary
  }

  if (!fs.existsSync(pagesDir)) {
    return { flowMap, contractMap, indexMtime };
  }

  let entries: string[];
  try {
    entries = fs.readdirSync(pagesDir);
  } catch {
    return { flowMap, contractMap, indexMtime };
  }

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const pageId = entry.replace(/\.md$/, "");
    const pagePath = path.join(pagesDir, entry);

    let body: string;
    try {
      body = fs.readFileSync(pagePath, "utf-8");
    } catch {
      continue;
    }

    const match: ImpactMatch = {
      pageId,
      summary: summaryByPageId[pageId] || pageId,
    };

    if (pageId.startsWith("flow-")) {
      // steps[] row format: order,name,actor,touches,outcome,nextOnFail,errorExits
      // We extract column 4 (index 3) which is "touches". Multi-file values can
      // use "+" as a separator within a cell (e.g., "src/a.ts + src/b.ts").
      const stepsRows = extractTypedArrayRows(body, "steps");
      for (const row of stepsRows) {
        const cols = splitCsvCells(row);
        if (cols.length >= 4) {
          const touches = cols[3];
          const files = touches.split(/\s*\+\s*/);
          for (const f of files) {
            const fp = f.trim();
            if (!fp || fp.startsWith("component-")) continue;
            const resolved = path.resolve(projectRoot, fp);
            (flowMap[resolved] ||= []).push(match);
          }
        }
      }
    } else if (pageId.startsWith("contract-")) {
      const authorityMatch = body.match(/^authorityFile:\s*(.+)$/m);
      if (authorityMatch) {
        const f = authorityMatch[1].trim();
        if (f) {
          const resolved = path.resolve(projectRoot, f);
          (contractMap[resolved] ||= []).push(match);
        }
      }
      const shapeFilesMatch = body.match(/^shapeFiles\[\d+\]:\s*(.*)$/m);
      if (shapeFilesMatch) {
        const files = shapeFilesMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
        for (const f of files) {
          const resolved = path.resolve(projectRoot, f);
          (contractMap[resolved] ||= []).push(match);
        }
      }
      // producers/consumers may contain pageIds OR file paths. Only resolve as
      // files if the string looks path-like (contains / or has a file extension).
      for (const field of ["producers", "consumers"]) {
        const re = new RegExp(`^${field}\\[\\d+\\]:\\s*(.*)$`, "m");
        const m = body.match(re);
        if (m) {
          const entries = m[1].split(",").map((s) => s.trim()).filter(Boolean);
          for (const e of entries) {
            if (e.includes("/") || /\.\w{1,5}$/.test(e)) {
              const resolved = path.resolve(projectRoot, e);
              (contractMap[resolved] ||= []).push(match);
            }
          }
        }
      }
    }
  }

  return { flowMap, contractMap, indexMtime };
}

function splitCsvCells(row: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of row) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function loadOrBuildCache(
  wikiDir: string,
  projectRoot: string,
  cachePath: string
): ImpactCache {
  const indexPath = path.join(wikiDir, "index.toon");
  const currentMtime = fs.existsSync(indexPath) ? fs.statSync(indexPath).mtimeMs : 0;

  if (fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as ImpactCache;
      if (cached.indexMtime === currentMtime) {
        return cached;
      }
    } catch {
      // ignore — rebuild
    }
  }

  const cache = buildImpactCache(wikiDir, projectRoot);
  try {
    writeAtomic(cachePath, JSON.stringify(cache));
  } catch {
    // Caching is best-effort
  }
  return cache;
}

interface SessionState {
  sessionId: string;
  files: Set<string>;
}

function loadSessionState(statePath: string, currentSessionId: string): SessionState {
  try {
    if (!fs.existsSync(statePath)) {
      return { sessionId: currentSessionId, files: new Set() };
    }
    const content = fs.readFileSync(statePath, "utf-8");
    const top = parseToon(content);
    const storedId = String(top["sessionId"] ?? "");
    if (storedId !== currentSessionId) {
      return { sessionId: currentSessionId, files: new Set() };
    }
    const files = new Set<string>();
    const lines = content.split("\n");
    for (const line of lines) {
      const m = line.match(/^files\[\d+\]:\s*(.*)$/);
      if (m) {
        const entries = m[1].split(",").map((s) => s.trim()).filter(Boolean);
        for (const e of entries) files.add(e);
        break;
      }
    }
    return { sessionId: currentSessionId, files };
  } catch {
    return { sessionId: currentSessionId, files: new Set() };
  }
}

function saveSessionState(statePath: string, state: SessionState): void {
  try {
    const filesList = Array.from(state.files);
    const content =
      `sessionId: ${state.sessionId}\n` +
      `files[${filesList.length}]: ${filesList.join(", ")}\n`;
    writeAtomic(statePath, content);
  } catch {
    // best-effort
  }
}

function loadThrottle(throttlePath: string): number[] {
  try {
    if (!fs.existsSync(throttlePath)) return [];
    const content = fs.readFileSync(throttlePath, "utf-8");
    const signals: number[] = [];
    for (const line of content.split("\n")) {
      const m = line.match(/^\s*(\d+)\s*$/);
      if (m) signals.push(Number(m[1]));
    }
    return signals;
  } catch {
    return [];
  }
}

function saveThrottle(throttlePath: string, signals: number[]): void {
  try {
    const trimmed = signals.slice(-100);
    writeAtomic(throttlePath, trimmed.join("\n") + "\n");
  } catch {
    // best-effort
  }
}

runHook("wiki-impact-warner", async (input) => {
  const filePath: string | undefined = input.tool_input?.file_path;
  if (!filePath) return allow();
  if (process.env.LOOM_WIKI_HOOKS === "0") return allow();

  const absPath = canonicalize(filePath);
  const root = findProjectRoot();
  if (!root) return allow();

  const wikiDir = path.join(root, ".loom", "wiki");
  if (!fs.existsSync(wikiDir)) return allow();

  const ephemeralDir = path.join(root, ".plan-execution", "ephemeral");
  const cachePath = path.join(ephemeralDir, "wiki-impact-index.json");
  const cache = loadOrBuildCache(wikiDir, root, cachePath);

  const flowMatches = cache.flowMap[absPath] || [];
  const contractMatches = cache.contractMap[absPath] || [];
  const allMatches = [...flowMatches, ...contractMatches];
  if (allMatches.length === 0) return allow();

  const opts = readWikiOptions(root);
  const sessionId = resolveSessionId();

  const sessionStatePath = path.join(ephemeralDir, "wiki-impact-session.toon");
  const sessionState = loadSessionState(sessionStatePath, sessionId);

  if (opts.impactDedup && sessionState.files.has(absPath)) {
    return allow();
  }

  const throttlePath = path.join(ephemeralDir, "wiki-hook-signals.toon");
  const signals = loadThrottle(throttlePath);
  const now = Date.now();
  const recentSignals = signals.filter((t) => now - t < 5 * 60 * 1000);

  if (opts.sessionThrottle && recentSignals.length >= 2) {
    signals.push(now);
    saveThrottle(throttlePath, signals);
    return allow(`[wiki] +1 additional signal — /loom-wiki status for details\n`);
  }

  const filename = path.basename(absPath);
  const prefix =
    opts.impactAck === "require" ? "[wiki:impact:ack-required]" : "[wiki:impact]";
  const shown = allMatches.slice(0, 5);
  const summaries = shown.map((m) => `${m.pageId} (${m.summary})`).join(", ");
  const overflow = allMatches.length > 5 ? ` + ${allMatches.length - 5} more` : "";
  let message = `${prefix} Edits to ${filename} affect: ${summaries}${overflow}\n`;
  if (opts.impactAck === "require") {
    message += `  → confirm with the user before proceeding.\n`;
  }

  sessionState.files.add(absPath);
  saveSessionState(sessionStatePath, sessionState);
  signals.push(now);
  saveThrottle(throttlePath, signals);

  return allow(message);
});
