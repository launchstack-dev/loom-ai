/**
 * Single resolution layer for the Loom plugin root.
 *
 * The plugin root is the directory containing Loom's shared assets (agents,
 * hooks library, skills, commands). Different install modes locate it
 * differently:
 *
 *   1. **Marketplace plugin install** — Claude Code sets `$CLAUDE_PLUGIN_ROOT`
 *      to the plugin install path (typically `~/.claude/plugins/loom/`).
 *      This wins over everything else because the active plugin is the
 *      source of truth when one is loaded.
 *   2. **Project pointer file** — `{cwd}/.loom/plugin-root` is a TOON file
 *      with shape `pluginRoot: <path>`. Used when the user has wired a
 *      project to a specific Loom install (worktree, dev checkout, etc.).
 *   3. **Repo-relative fallback** — `cwd` itself. The curl-installed Loom
 *      and dev checkouts use the repo as the plugin root.
 *
 * All returned paths are absolute. `~` is expanded to `$HOME`.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { parseToon } from "./toon-reader.js";

/** Optional injection seam for tests. */
export interface ResolverDeps {
  env?: NodeJS.ProcessEnv;
  readFile?: (p: string) => string;
  fileExists?: (p: string) => boolean;
  homedir?: () => string;
}

/**
 * Resolve the Loom plugin root for the given working directory.
 *
 * Resolution priority:
 *   1. `$CLAUDE_PLUGIN_ROOT` env var (if set and non-empty)
 *   2. `{cwd}/.loom/plugin-root` pointer file (`pluginRoot: <path>`)
 *   3. `cwd` itself
 *
 * Always returns an absolute path with `~` expanded and segments normalized.
 */
export function resolvePluginRoot(cwd: string, deps: ResolverDeps = {}): string {
  const env = deps.env ?? process.env;
  const readFile = deps.readFile ?? defaultReadFile;
  const fileExists = deps.fileExists ?? defaultFileExists;
  const homedir = deps.homedir ?? os.homedir;

  // 1. Env var wins (active plugin install)
  const envValue = env.CLAUDE_PLUGIN_ROOT;
  if (typeof envValue === "string" && envValue.trim() !== "") {
    return normalize(envValue.trim(), homedir);
  }

  // 2. Project pointer file
  const pointerPath = path.join(cwd, ".loom", "plugin-root");
  if (fileExists(pointerPath)) {
    try {
      const content = readFile(pointerPath);
      const parsed = parseToon(content);
      const pluginRoot = parsed.pluginRoot;
      if (typeof pluginRoot === "string" && pluginRoot.trim() !== "") {
        return normalize(pluginRoot.trim(), homedir);
      }
    } catch {
      // Fall through to repo-relative fallback.
    }
  }

  // 3. Repo-relative fallback
  return normalize(cwd, homedir);
}

function normalize(input: string, homedir: () => string): string {
  let expanded = input;
  if (expanded === "~") {
    expanded = homedir();
  } else if (expanded.startsWith("~/")) {
    expanded = path.join(homedir(), expanded.slice(2));
  }
  return path.resolve(expanded);
}

function defaultReadFile(p: string): string {
  return fs.readFileSync(p, "utf8");
}

function defaultFileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
