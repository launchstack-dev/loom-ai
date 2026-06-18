/**
 * First-run handler for the per-machine install envelope (`~/.loom/install.toon`).
 *
 * Invoked by:
 *   - the SessionStart hook on plugin install (`channel = plugin`)
 *   - `install.sh` tail on curl install        (`channel = curl`)
 *
 * Idempotent: re-invocation with the same `installedVersion` is a byte-for-byte
 * no-op on the frozen fields (`installTimestamp`, `installSourceUrl`, `source`,
 * `channel`). See Phase 4 acceptance criteria in
 * `planning/plans/PLAN-plugin-marketplace-merged.md`.
 *
 * Pure: all environment/clock/fs dependencies are injected via {@link FirstRunDeps}.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import {
  defaultInstallStatePath,
  readInstallState,
  writeInstallStateAtomic,
  type Channel,
  type InstallSource,
  type InstallState,
} from "./install-state";

/** Canonical default source URL when `$LOOM_INSTALL_URL` is not provided. */
export const DEFAULT_INSTALL_SOURCE_URL =
  "https://github.com/launchstack-dev/loom-ai";

/** Injectable dependencies for testability. */
export interface FirstRunDeps {
  env: NodeJS.ProcessEnv;
  now: () => Date;
  /** Absolute path to the install-state file. Defaults to `~/.loom/install.toon`. */
  installStatePath?: string;
  /**
   * Absolute path to the plugin's `plugin.json` from which to read
   * `installedVersion`. Required because callers may be invoked from a
   * non-canonical cwd.
   */
  pluginJsonPath: string;
  /** Pre-resolved runtime version (e.g., `node-20.11.0`). */
  runtimeVersion: string;
}

/** Outcome of the first-run pass — useful for tests and hook logging. */
export type FirstRunOutcome =
  | { kind: "created"; state: InstallState }
  | { kind: "noop"; state: InstallState }
  | { kind: "version-bumped"; previous: InstallState; state: InstallState };

// ---------------------------------------------------------------------------
// Channel + source derivation
// ---------------------------------------------------------------------------

/**
 * Derive the install {@link Channel} from environment.
 *
 *   plugin: `$CLAUDE_PLUGIN_ROOT` is set (Claude Code sets this when loading a plugin)
 *   curl:   otherwise
 */
export function deriveChannel(env: NodeJS.ProcessEnv): Channel {
  return env.CLAUDE_PLUGIN_ROOT && env.CLAUDE_PLUGIN_ROOT.length > 0
    ? "plugin"
    : "curl";
}

/**
 * Derive the install {@link InstallSource} from channel + environment.
 *
 *   plugin + $LOOM_INSTALL_SOURCE=direct-link → direct-link
 *   plugin (default)                          → marketplace-browse
 *   curl   + $LOOM_INSTALL_URL set            → self-hosted-url
 *   curl   (default)                          → curl-script
 */
export function deriveSource(channel: Channel, env: NodeJS.ProcessEnv): InstallSource {
  if (channel === "plugin") {
    if (env.LOOM_INSTALL_SOURCE === "direct-link") return "direct-link";
    return "marketplace-browse";
  }
  // curl channel
  if (env.LOOM_INSTALL_URL && env.LOOM_INSTALL_URL.length > 0) {
    return "self-hosted-url";
  }
  return "curl-script";
}

/** Derive the install-source URL: `$LOOM_INSTALL_URL` if set, else the canonical default. */
export function deriveInstallSourceUrl(env: NodeJS.ProcessEnv): string {
  return env.LOOM_INSTALL_URL && env.LOOM_INSTALL_URL.length > 0
    ? env.LOOM_INSTALL_URL
    : DEFAULT_INSTALL_SOURCE_URL;
}

/** Read `version` from `.claude-plugin/plugin.json` (or any compatible JSON). */
export function readPluginVersion(pluginJsonPath: string): string {
  const text = fs.readFileSync(pluginJsonPath, "utf8");
  const parsed = JSON.parse(text) as { version?: unknown };
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error(
      `plugin.json at ${pluginJsonPath} missing required string field "version"`,
    );
  }
  return parsed.version;
}

/** Detect runtime label — Bun if present, else Node from `process.version`. */
export function detectRuntimeVersion(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bun = (globalThis as any).Bun as { version?: string } | undefined;
  if (bun && typeof bun.version === "string") {
    return `bun-${bun.version}`;
  }
  // process.version is "v20.11.0" → strip leading "v"
  const v = process.version.startsWith("v")
    ? process.version.slice(1)
    : process.version;
  return `node-${v}`;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * Run the first-run handler. Idempotent.
 *
 *   1. If no envelope exists → write a fresh one (frozen fields stamped now).
 *   2. If envelope exists and version matches → no-op.
 *   3. If envelope exists and version differs → update only
 *      `installedVersion`, `runtimeVersion`, and `lastPing`; preserve
 *      everything else (including `updateInProgress`).
 *
 * Never clears `updateInProgress` — only `loom-update` may.
 */
export function runFirstRun(deps: FirstRunDeps): FirstRunOutcome {
  const statePath = deps.installStatePath ?? defaultInstallStatePath(deps.env);
  const installedVersion = readPluginVersion(deps.pluginJsonPath);
  const nowIso = deps.now().toISOString();

  const existing = safeReadInstallState(statePath);

  if (existing === null) {
    const channel = deriveChannel(deps.env);
    const source = deriveSource(channel, deps.env);
    const state: InstallState = {
      installedVersion,
      installTimestamp: nowIso,
      installSourceUrl: deriveInstallSourceUrl(deps.env),
      runtimeVersion: deps.runtimeVersion,
      channel,
      source,
      migratedFrom: null,
      lastPing: null,
      doNotTrack: false,
      updateInProgress: null,
      installError: null,
      pinnedVersion: null,
    };
    writeInstallStateAtomic(statePath, state);
    return { kind: "created", state };
  }

  if (existing.installedVersion === installedVersion) {
    // Idempotent no-op — must not touch the file (frozen-field contract).
    return { kind: "noop", state: existing };
  }

  // Version bump: update only the non-frozen fields, preserve everything else
  // (including updateInProgress, which only `loom-update` may clear).
  const updated: InstallState = {
    ...existing,
    installedVersion,
    runtimeVersion: deps.runtimeVersion,
    lastPing: nowIso,
  };
  writeInstallStateAtomic(statePath, updated);
  return { kind: "version-bumped", previous: existing, state: updated };
}

/**
 * Read the install-state, treating a corrupt or unreadable file as "not present"
 * for first-run purposes. We do NOT swallow JSON-parse-equivalent errors silently
 * past first-run; throwing here would brick a user's session, so we surface the
 * parse failure as `null` and let the caller observe a fresh install.
 *
 * (For non-first-run callers that need stricter semantics, use
 * `readInstallState` directly from `./install-state`.)
 */
function safeReadInstallState(filePath: string): InstallState | null {
  try {
    return readInstallState(filePath);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// CLI entry-point (used by SessionStart hook + install.sh tail)
// ---------------------------------------------------------------------------

/**
 * Resolve the canonical `.claude-plugin/plugin.json` location relative to this
 * module — works whether invoked from the worktree or from a globally-installed
 * release tarball.
 */
export function defaultPluginJsonPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CLAUDE_PLUGIN_ROOT && env.CLAUDE_PLUGIN_ROOT.length > 0) {
    return path.join(env.CLAUDE_PLUGIN_ROOT, ".claude-plugin", "plugin.json");
  }
  // Fallback: two levels up from scripts/lib/.
  return path.resolve(__dirname, "..", "..", ".claude-plugin", "plugin.json");
}
