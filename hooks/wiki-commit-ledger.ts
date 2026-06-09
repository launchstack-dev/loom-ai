/**
 * Hook: wiki-commit-ledger (PostToolUse — Bash)
 *
 * Detects successful `git commit` invocations and appends a ledger entry to
 * `.loom/wiki/freshness-ledger.toon`. The ledger answers: "for every commit,
 * was the wiki updated to reflect its impact?"
 *
 * Ledger entry shape:
 *   - commitSha:      first 7 chars of new HEAD SHA
 *   - timestamp:      ISO-8601 of commit time
 *   - filesChanged:   files in the commit (joined by " + ")
 *   - impactedPages:  wiki pageIds whose flow.touches / contract.producers /
 *                     contract.consumers / contract.shapeFiles / page.sourceRefs
 *                     overlap filesChanged (joined by " + ")
 *   - wikiUpdatedAt:  null at commit time; reconciled to ISO timestamp when
 *                     wiki-maintainer-agent or wiki-ingest-agent writes any of
 *                     the impacted pages
 *   - status:         "n/a" (no wiki impact) | "debt" (impact but not reconciled)
 *                     | "fresh" (reconciled)
 *
 * Read-side consumers:
 *   - wiki-session-status hook surfaces debt count on SessionStart
 *   - /loom status Wiki Health block reports debt count (if implemented)
 *   - wiki-maintainer-agent / wiki-ingest-agent SHOULD scan the ledger after
 *     writing pages and mark matching debt entries as `fresh`
 *
 * Honors LOOM_WIKI_HOOKS=0. Fail-open on any error.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { runHook, allow } from "./lib/run-hook.js";
import { parseToon, parseToonArray } from "./lib/toon-reader.js";
import { findProjectRoot, writeAtomic } from "./lib/wiki-helpers.js";

/**
 * Cached file→pages map. Serialized as JSON to
 * `.plan-execution/ephemeral/wiki-ledger-index.json` with the index.toon mtime
 * as the cache-busting key. On every commit we'd otherwise re-read every page
 * file under .loom/wiki/pages/ which gets expensive at scale (~100 file reads
 * per commit for a 100-page wiki). Cache cuts that to a single JSON.parse when
 * the wiki hasn't changed.
 *
 * The serialized form uses Record<string, string[]> instead of Sets because
 * Sets don't survive JSON round-trips; we convert on load.
 */
interface SerializedCache {
  indexMtime: number;
  map: Record<string, string[]>;
}

function loadOrBuildFileToPagesMap(
  wikiDir: string,
  projectRoot: string,
  cachePath: string
): Record<string, Set<string>> {
  const indexPath = path.join(wikiDir, "index.toon");
  const currentMtime = fs.existsSync(indexPath)
    ? fs.statSync(indexPath).mtimeMs
    : 0;

  // Try the cache first.
  if (fs.existsSync(cachePath)) {
    try {
      const raw = fs.readFileSync(cachePath, "utf-8");
      const cached = JSON.parse(raw) as SerializedCache;
      if (cached.indexMtime === currentMtime && cached.map) {
        const restored: Record<string, Set<string>> = {};
        for (const [k, v] of Object.entries(cached.map)) {
          restored[k] = new Set(v);
        }
        return restored;
      }
    } catch {
      // Fall through to rebuild on any parse/format error.
    }
  }

  const map = buildFileToPagesMap(wikiDir, projectRoot);

  // Persist cache best-effort.
  try {
    const serialized: SerializedCache = {
      indexMtime: currentMtime,
      map: Object.fromEntries(
        Object.entries(map).map(([k, v]) => [k, Array.from(v)])
      ),
    };
    writeAtomic(cachePath, JSON.stringify(serialized));
  } catch {
    // Cache write is best-effort; correctness path is unaffected.
  }

  return map;
}

/**
 * Build a map of (resolved file path) → (pageIds that reference it).
 * Reads page bodies under .loom/wiki/pages/ and extracts file references
 * from sourceRefs, flow.steps[].touches, contract.authorityFile,
 * contract.shapeFiles[], contract.producers, contract.consumers.
 */
function buildFileToPagesMap(
  wikiDir: string,
  projectRoot: string
): Record<string, Set<string>> {
  const map: Record<string, Set<string>> = {};
  const pagesDir = path.join(wikiDir, "pages");
  if (!fs.existsSync(pagesDir)) return map;

  let entries: string[];
  try {
    entries = fs.readdirSync(pagesDir);
  } catch {
    return map;
  }

  const add = (file: string, pageId: string) => {
    const resolved = path.resolve(projectRoot, file);
    (map[resolved] ||= new Set()).add(pageId);
  };

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const pageId = entry.replace(/\.md$/, "");
    let body: string;
    try {
      body = fs.readFileSync(path.join(pagesDir, entry), "utf-8");
    } catch {
      continue;
    }

    // sourceRefs[N]: a, b, c — applies to ALL page categories
    const sourceRefsMatch = body.match(/^sourceRefs\[\d+\]:\s*(.*)$/m);
    if (sourceRefsMatch) {
      for (const f of sourceRefsMatch[1].split(",").map((s) => s.trim()).filter(Boolean)) {
        add(f, pageId);
      }
    }

    if (pageId.startsWith("flow-")) {
      // steps[N]{order,name,actor,touches,...} — extract column 4 (touches)
      const lines = body.split("\n");
      let inSteps = false;
      const stepsHeaderRe = /^\s*steps\[\d+\]\{[^}]+\}:\s*$/;
      for (const line of lines) {
        if (!inSteps) {
          if (stepsHeaderRe.test(line)) inSteps = true;
          continue;
        }
        if (!line.startsWith("  ") || !line.trim()) break;
        const cols = splitCsvCells(line.trim());
        if (cols.length >= 4) {
          const touches = cols[3];
          for (const f of touches.split(/\s*\+\s*/)) {
            const v = f.trim();
            if (v && !v.startsWith("component-")) add(v, pageId);
          }
        }
      }
    }

    if (pageId.startsWith("contract-")) {
      const authority = body.match(/^authorityFile:\s*(.+)$/m);
      if (authority) {
        const f = authority[1].trim();
        if (f) add(f, pageId);
      }
      const shapeFiles = body.match(/^shapeFiles\[\d+\]:\s*(.*)$/m);
      if (shapeFiles) {
        for (const f of shapeFiles[1].split(",").map((s) => s.trim()).filter(Boolean)) {
          add(f, pageId);
        }
      }
      for (const field of ["producers", "consumers"]) {
        const re = new RegExp(`^${field}\\[\\d+\\]:\\s*(.*)$`, "m");
        const m = body.match(re);
        if (m) {
          for (const e of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
            if (e.includes("/") || /\.\w{1,5}$/.test(e)) add(e, pageId);
          }
        }
      }
    }
  }

  return map;
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

interface LedgerEntry {
  commitSha: string;
  timestamp: string;
  filesChanged: string;
  impactedPages: string;
  wikiUpdatedAt: string;
  status: string;
}

function readLedger(ledgerPath: string): {
  header: string;
  entries: LedgerEntry[];
} {
  if (!fs.existsSync(ledgerPath)) {
    return { header: defaultLedgerHeader(), entries: [] };
  }
  try {
    const content = fs.readFileSync(ledgerPath, "utf-8");
    const headerLines: string[] = [];
    const lines = content.split("\n");
    for (const line of lines) {
      if (/^entries\[/.test(line.trim())) break;
      headerLines.push(line);
    }
    const rows = parseToonArray(content, "entries");
    const entries: LedgerEntry[] = rows.map((r) => ({
      commitSha: String(r["commitSha"] ?? ""),
      timestamp: String(r["timestamp"] ?? ""),
      filesChanged: String(r["filesChanged"] ?? ""),
      impactedPages: String(r["impactedPages"] ?? ""),
      wikiUpdatedAt: String(r["wikiUpdatedAt"] ?? "null"),
      status: String(r["status"] ?? ""),
    }));
    return { header: headerLines.join("\n"), entries };
  } catch {
    return { header: defaultLedgerHeader(), entries: [] };
  }
}

function defaultLedgerHeader(): string {
  return `schemaVersion: 1
projectName: ${path.basename(process.cwd())}
lastEntry: ${new Date().toISOString()}
totalEntries: 0
`;
}

function writeLedger(
  ledgerPath: string,
  entries: LedgerEntry[],
  projectName: string
): void {
  const lastTs =
    entries.length > 0 ? entries[entries.length - 1].timestamp : new Date().toISOString();
  const header = `schemaVersion: 1
projectName: ${projectName}
lastEntry: ${lastTs}
totalEntries: ${entries.length}
`;
  const arrayHeader = `entries[${entries.length}]{commitSha,timestamp,filesChanged,impactedPages,wikiUpdatedAt,status}:`;
  const rows = entries.map(
    (e) =>
      `  ${e.commitSha},${e.timestamp},"${e.filesChanged}","${e.impactedPages}",${e.wikiUpdatedAt},${e.status}`
  );
  const content = [header, arrayHeader, ...rows, ""].join("\n");
  writeAtomic(ledgerPath, content);
}

function readProjectName(wikiDir: string, fallback: string): string {
  const indexPath = path.join(wikiDir, "index.toon");
  if (!fs.existsSync(indexPath)) return fallback;
  try {
    const top = parseToon(fs.readFileSync(indexPath, "utf-8"));
    return String(top["projectName"] ?? fallback);
  } catch {
    return fallback;
  }
}

runHook("wiki-commit-ledger", async (input) => {
  if (process.env.LOOM_WIKI_HOOKS === "0") return allow();

  // Only fire for Bash tool calls.
  const toolName = input.tool_name ?? input.toolName;
  if (toolName !== "Bash") return allow();

  // Only for `git commit` invocations. Uses (\s|$) instead of \b to exclude
  // plumbing commands like `git commit-tree` and `git commit-graph` whose
  // hyphen creates a word boundary that \b would match.
  const command: string | undefined = input.tool_input?.command;
  if (!command || !/(^|\s|;|&&|\|\|)\s*git\s+commit(\s|$)/.test(command)) {
    return allow();
  }

  // Only when the tool succeeded. PostToolUse provides tool_response with exit info.
  const exitCode =
    input.tool_response?.exit_code ??
    input.tool_response?.exitCode ??
    input.tool_response?.code;
  if (exitCode !== undefined && exitCode !== 0) {
    return allow();
  }

  const root = findProjectRoot();
  if (!root) return allow();

  const wikiDir = path.join(root, ".loom", "wiki");
  if (!fs.existsSync(wikiDir)) return allow();

  // Get the new HEAD SHA and changed files via git.
  let sha = "";
  let files: string[] = [];
  try {
    sha = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf-8" }).trim();
    const filesStr = execSync(
      "git diff-tree --no-commit-id --name-only -r HEAD",
      { cwd: root, encoding: "utf-8" }
    );
    files = filesStr.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    // Not in a git repo or commit not yet visible — bail.
    return allow();
  }
  if (!sha) return allow();

  // Build file→pages map (cached against index.toon mtime) and compute impact.
  const cachePath = path.join(
    root,
    ".plan-execution",
    "ephemeral",
    "wiki-ledger-index.json"
  );
  const fileMap = loadOrBuildFileToPagesMap(wikiDir, root, cachePath);
  const impactedPages = new Set<string>();
  for (const f of files) {
    const resolved = path.resolve(root, f);
    const pageIds = fileMap[resolved];
    if (pageIds) {
      for (const pid of pageIds) impactedPages.add(pid);
    }
  }

  const ledgerPath = path.join(wikiDir, "freshness-ledger.toon");
  const projectName = readProjectName(wikiDir, path.basename(root));
  const ledger = readLedger(ledgerPath);

  // Idempotency: skip if this SHA already has an entry.
  const shaShort = sha.slice(0, 7);
  if (ledger.entries.some((e) => e.commitSha === shaShort)) {
    return allow();
  }

  const status = impactedPages.size === 0 ? "n/a" : "debt";
  const entry: LedgerEntry = {
    commitSha: shaShort,
    timestamp: new Date().toISOString(),
    filesChanged: files.join(" + "),
    impactedPages: Array.from(impactedPages).join(" + "),
    wikiUpdatedAt: "null",
    status,
  };
  ledger.entries.push(entry);

  // Cap the ledger at 500 entries (oldest pruned). Reconciliation can scan back
  // farther via git log if needed; this is the recent activity window.
  if (ledger.entries.length > 500) {
    ledger.entries = ledger.entries.slice(-500);
  }

  try {
    writeLedger(ledgerPath, ledger.entries, projectName);
  } catch {
    return allow();
  }

  if (status === "debt") {
    const count = impactedPages.size;
    const samples = Array.from(impactedPages).slice(0, 3).join(", ");
    const overflow = count > 3 ? ` (+${count - 3} more)` : "";
    return allow(
      `[wiki:ledger] Commit ${shaShort} affects ${count} wiki page${count === 1 ? "" : "s"}: ${samples}${overflow} — run /loom-wiki ingest --diff to reconcile.\n`
    );
  }

  return allow();
});
