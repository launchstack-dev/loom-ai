/**
 * Shared helpers for wiki hooks (wiki-session-status, wiki-impact-warner,
 * wiki-commit-ledger). Extracts ~150 lines of duplication from the three
 * hook files into a single module.
 *
 * All helpers fail-open: errors return null / default values rather than
 * throwing. The runHook harness catches anything that escapes.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ─── Filesystem helpers ─────────────────────────────────────────────────

/**
 * Walk up from cwd looking for a Loom-aware project root.
 * Recognizes any of: .loom/, .plan-execution/, .git/.
 * Returns null if no marker is found within 20 levels.
 */
export function findProjectRoot(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(dir, ".loom"))) return dir;
    if (fs.existsSync(path.join(dir, ".plan-execution"))) return dir;
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Atomic write: write to {path}.tmp, then rename to {path}.
 * Creates parent directories as needed.
 */
export function writeAtomic(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, filePath);
}

/**
 * Canonicalize a file path that may not exist yet.
 * Walks up to the first existing ancestor, resolves it, then reattaches the
 * non-existent tail. Handles macOS /var → /private/var symlinks.
 */
export function canonicalize(filePath: string): string {
  let abs = path.resolve(filePath);
  try {
    let current = abs;
    let tail = "";
    while (!fs.existsSync(current) && current !== path.dirname(current)) {
      tail = tail ? path.join(path.basename(current), tail) : path.basename(current);
      current = path.dirname(current);
    }
    if (fs.existsSync(current)) {
      abs = tail ? path.join(fs.realpathSync(current), tail) : fs.realpathSync(current);
    }
  } catch {
    // path.resolve is the best we can do
  }
  return abs;
}

// ─── Session identity ───────────────────────────────────────────────────

/**
 * Stable session ID for per-session state (dedup, throttle, freshness reset).
 *
 * Production: Claude Code spawns each hook as a child of the same long-lived
 * parent, so `process.ppid` is stable across tool calls within a session.
 *
 * Tests: hook subprocesses are launched through npx, which forks a new
 * intermediate process per invocation — ppid then changes between calls and
 * would defeat dedup. Set `LOOM_SESSION_ID` to pin the session for tests.
 */
export function resolveSessionId(): string {
  const override = process.env.LOOM_SESSION_ID;
  if (override && override.trim()) return override.trim();
  return String(process.ppid || "no-session");
}

// ─── Date helpers ───────────────────────────────────────────────────────

/**
 * Days (floor) between now and the given ISO-8601 timestamp.
 * Returns Infinity for invalid / missing input — works correctly with
 * threshold comparisons (Infinity > N is always true).
 */
export function daysSince(iso: string | undefined | null): number {
  if (!iso) return Infinity;
  const t = new Date(String(iso)).getTime();
  if (Number.isNaN(t)) return Infinity;
  return Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
}

// ─── Wiki configuration (orchestration.toml [wiki] section) ─────────────

export type SessionContextMode = "off" | "minimal" | "full";
export type ImpactAckMode = "notify" | "require";

export interface WikiOptions {
  sessionStatusEnabled: boolean;
  sessionContext: SessionContextMode;
  impactDedup: boolean;
  sessionThrottle: boolean;
  impactAck: ImpactAckMode;
}

const DEFAULT_WIKI_OPTIONS: WikiOptions = {
  sessionStatusEnabled: true,
  sessionContext: "minimal",
  impactDedup: true,
  sessionThrottle: true,
  impactAck: "notify",
};

/**
 * Parse .claude/orchestration.toml `[wiki]` section into a unified options
 * object. Missing fields fall back to defaults. Missing file or missing
 * `[wiki]` section returns the full defaults set.
 *
 * This is a naive TOML scanner — only handles the fields we use. Not a
 * general-purpose TOML parser.
 */
export function readWikiOptions(projectRoot: string): WikiOptions {
  const tomlPath = path.join(projectRoot, ".claude", "orchestration.toml");
  if (!fs.existsSync(tomlPath)) return { ...DEFAULT_WIKI_OPTIONS };

  try {
    const content = fs.readFileSync(tomlPath, "utf-8");
    const wikiSection = content.match(/\[wiki\]([\s\S]*?)(?=\n\[|\n*$)/);
    if (!wikiSection) return { ...DEFAULT_WIKI_OPTIONS };

    const body = wikiSection[1];
    const statusMatch = body.match(/sessionStatusEnabled\s*=\s*(true|false)/i);
    const ctxMatch = body.match(/sessionContext\s*=\s*"?(off|minimal|full)"?/i);
    const dedupMatch = body.match(/impactDedup\s*=\s*"?(on|off|true|false)"?/i);
    const throttleMatch = body.match(/sessionThrottle\s*=\s*(true|false)/i);
    const ackMatch = body.match(/impactAck\s*=\s*"?(notify|require)"?/i);

    return {
      sessionStatusEnabled: statusMatch
        ? statusMatch[1].toLowerCase() === "true"
        : DEFAULT_WIKI_OPTIONS.sessionStatusEnabled,
      sessionContext: ctxMatch
        ? (ctxMatch[1].toLowerCase() as SessionContextMode)
        : DEFAULT_WIKI_OPTIONS.sessionContext,
      impactDedup: dedupMatch
        ? !["off", "false"].includes(dedupMatch[1].toLowerCase())
        : DEFAULT_WIKI_OPTIONS.impactDedup,
      sessionThrottle: throttleMatch
        ? throttleMatch[1].toLowerCase() === "true"
        : DEFAULT_WIKI_OPTIONS.sessionThrottle,
      impactAck: ackMatch
        ? (ackMatch[1].toLowerCase() as ImpactAckMode)
        : DEFAULT_WIKI_OPTIONS.impactAck,
    };
  } catch {
    return { ...DEFAULT_WIKI_OPTIONS };
  }
}
