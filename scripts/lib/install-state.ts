/**
 * Per-machine install-state envelope at `~/.loom/install.toon`.
 *
 * Distinct from the v3 component-inventory at
 * `~/.claude/skills/library/install-state.toon` (which is consumed by
 * `/loom-upgrade --rollback`). This envelope is consumed by the doctor and
 * update CLIs for channel detection, freshness checks, and source attribution.
 *
 * See `protocols/install-state.schema.md` (Reconciliation note) and
 * `planning/plans/PLAN-plugin-marketplace-merged.md` Phase 4 for the
 * per-machine schema.
 *
 * Pure module — all I/O dependencies (fs, path) are injected by callers.
 */
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Channel = "curl" | "plugin";

export type InstallSource =
  | "curl-script"
  | "marketplace-browse"
  | "self-hosted-url"
  | "direct-link"
  | "migration";

export interface MigratedFrom {
  channel: Channel;
  version: string;
}

export interface UpdateInProgress {
  fromVersion: string;
  toVersion: string;
  startedAt: string;
}

export interface InstallError {
  step: string;
  message: string;
  timestamp: string;
}

export interface InstallState {
  installedVersion: string;
  installTimestamp: string;
  installSourceUrl: string;
  runtimeVersion: string;
  channel: Channel;
  source: InstallSource;
  migratedFrom: MigratedFrom | null;
  lastPing: string | null;
  doNotTrack: boolean;
  /** Either a structured object, the sentinel string "failed", or null. */
  updateInProgress: UpdateInProgress | "failed" | null;
  installError: InstallError | null;
  pinnedVersion: string | null;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the default `~/.loom/install.toon` path.
 *
 * Honors `$LOOM_HOME` for testability (vitest sets it to a tmpdir).
 */
export function defaultInstallStatePath(env: NodeJS.ProcessEnv = process.env): string {
  const loomHome = env.LOOM_HOME;
  if (loomHome && loomHome.length > 0) {
    return path.join(loomHome, "install.toon");
  }
  const home = env.HOME || env.USERPROFILE || "";
  if (!home) {
    throw new Error("Cannot resolve install-state path: HOME is unset");
  }
  return path.join(home, ".loom", "install.toon");
}

// ---------------------------------------------------------------------------
// TOON encode / decode
// ---------------------------------------------------------------------------

/**
 * Encode an InstallState as TOON (flat keys, nested blocks with 2-space
 * indent). The output is deterministic — fields are written in a fixed order
 * so the field-freeze contract is observable byte-for-byte.
 */
export function encodeInstallState(state: InstallState): string {
  const lines: string[] = [];
  lines.push(`installedVersion: ${state.installedVersion}`);
  lines.push(`installTimestamp: ${state.installTimestamp}`);
  lines.push(`installSourceUrl: ${state.installSourceUrl}`);
  lines.push(`runtimeVersion: ${state.runtimeVersion}`);
  lines.push(`channel: ${state.channel}`);
  lines.push(`source: ${state.source}`);

  if (state.migratedFrom === null) {
    lines.push(`migratedFrom: null`);
  } else {
    lines.push(`migratedFrom:`);
    lines.push(`  channel: ${state.migratedFrom.channel}`);
    lines.push(`  version: ${state.migratedFrom.version}`);
  }

  lines.push(`lastPing: ${state.lastPing === null ? "null" : state.lastPing}`);
  lines.push(`doNotTrack: ${state.doNotTrack ? "true" : "false"}`);

  if (state.updateInProgress === null) {
    lines.push(`updateInProgress: null`);
  } else if (state.updateInProgress === "failed") {
    lines.push(`updateInProgress: failed`);
  } else {
    lines.push(`updateInProgress:`);
    lines.push(`  fromVersion: ${state.updateInProgress.fromVersion}`);
    lines.push(`  toVersion: ${state.updateInProgress.toVersion}`);
    lines.push(`  startedAt: ${state.updateInProgress.startedAt}`);
  }

  if (state.installError === null) {
    lines.push(`installError: null`);
  } else {
    lines.push(`installError:`);
    lines.push(`  step: ${state.installError.step}`);
    lines.push(`  message: ${escapeOneLine(state.installError.message)}`);
    lines.push(`  timestamp: ${state.installError.timestamp}`);
  }

  lines.push(`pinnedVersion: ${state.pinnedVersion === null ? "null" : state.pinnedVersion}`);

  return lines.join("\n") + "\n";
}

/** Single-line escape: collapse newlines so they don't break the TOON structure. */
function escapeOneLine(s: string): string {
  return s.replace(/\r?\n/g, " ").trim();
}

/**
 * Decode a TOON envelope written by {@link encodeInstallState}.
 *
 * Tolerant: throws a clear error on missing required fields, but accepts
 * additional flat keys (forward-compat). Block values must use 2-space indent.
 */
export function decodeInstallState(text: string): InstallState {
  const raw = parseToonFlat(text);

  const required = [
    "installedVersion",
    "installTimestamp",
    "installSourceUrl",
    "runtimeVersion",
    "channel",
    "source",
  ];
  for (const key of required) {
    if (!(key in raw.scalars) && !(key in raw.blocks)) {
      throw new Error(`install.toon: missing required field "${key}"`);
    }
  }

  const channel = raw.scalars.channel as Channel;
  if (channel !== "curl" && channel !== "plugin") {
    throw new Error(`install.toon: invalid channel "${channel}"`);
  }
  const source = raw.scalars.source as InstallSource;
  const validSources: InstallSource[] = [
    "curl-script",
    "marketplace-browse",
    "self-hosted-url",
    "direct-link",
    "migration",
  ];
  if (!validSources.includes(source)) {
    throw new Error(`install.toon: invalid source "${source}"`);
  }

  let migratedFrom: MigratedFrom | null = null;
  if ("migratedFrom" in raw.blocks) {
    const block = raw.blocks.migratedFrom;
    if (!block.channel || !block.version) {
      throw new Error(`install.toon: migratedFrom block missing channel/version`);
    }
    if (block.channel !== "curl" && block.channel !== "plugin") {
      throw new Error(`install.toon: migratedFrom.channel invalid`);
    }
    migratedFrom = { channel: block.channel as Channel, version: block.version };
  } else if (raw.scalars.migratedFrom && raw.scalars.migratedFrom !== "null") {
    throw new Error(`install.toon: migratedFrom must be null or a block`);
  }

  const lastPingRaw = raw.scalars.lastPing;
  const lastPing = !lastPingRaw || lastPingRaw === "null" ? null : lastPingRaw;

  const doNotTrack = (raw.scalars.doNotTrack ?? "false") === "true";

  let updateInProgress: UpdateInProgress | "failed" | null = null;
  if ("updateInProgress" in raw.blocks) {
    const b = raw.blocks.updateInProgress;
    if (!b.fromVersion || !b.toVersion || !b.startedAt) {
      throw new Error(`install.toon: updateInProgress block missing fields`);
    }
    updateInProgress = {
      fromVersion: b.fromVersion,
      toVersion: b.toVersion,
      startedAt: b.startedAt,
    };
  } else {
    const scalar = raw.scalars.updateInProgress;
    if (scalar === "failed") updateInProgress = "failed";
    else if (scalar && scalar !== "null") {
      throw new Error(`install.toon: updateInProgress must be null, "failed", or a block`);
    }
  }

  let installError: InstallError | null = null;
  if ("installError" in raw.blocks) {
    const b = raw.blocks.installError;
    if (!b.step || !b.message || !b.timestamp) {
      throw new Error(`install.toon: installError block missing fields`);
    }
    installError = { step: b.step, message: b.message, timestamp: b.timestamp };
  } else if (raw.scalars.installError && raw.scalars.installError !== "null") {
    throw new Error(`install.toon: installError must be null or a block`);
  }

  const pinnedRaw = raw.scalars.pinnedVersion;
  const pinnedVersion = !pinnedRaw || pinnedRaw === "null" ? null : pinnedRaw;

  return {
    installedVersion: raw.scalars.installedVersion,
    installTimestamp: raw.scalars.installTimestamp,
    installSourceUrl: raw.scalars.installSourceUrl,
    runtimeVersion: raw.scalars.runtimeVersion,
    channel,
    source,
    migratedFrom,
    lastPing,
    doNotTrack,
    updateInProgress,
    installError,
    pinnedVersion,
  };
}

interface ParsedToon {
  scalars: Record<string, string>;
  blocks: Record<string, Record<string, string>>;
}

/** Minimal TOON parser sufficient for the install-state envelope. */
function parseToonFlat(text: string): ParsedToon {
  const scalars: Record<string, string> = {};
  const blocks: Record<string, Record<string, string>> = {};
  const lines = text.split(/\r?\n/);

  let currentBlock: string | null = null;

  for (const rawLine of lines) {
    if (rawLine.length === 0) continue;
    if (rawLine.startsWith("#")) continue;

    if (rawLine.startsWith("  ")) {
      // Nested key under the current block.
      if (currentBlock === null) {
        throw new Error(`install.toon: indented line outside any block: "${rawLine}"`);
      }
      const trimmed = rawLine.slice(2);
      const idx = trimmed.indexOf(":");
      if (idx === -1) {
        throw new Error(`install.toon: bad indented line: "${rawLine}"`);
      }
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      blocks[currentBlock][key] = value;
      continue;
    }

    // Top-level line.
    currentBlock = null;
    const idx = rawLine.indexOf(":");
    if (idx === -1) {
      throw new Error(`install.toon: bad top-level line: "${rawLine}"`);
    }
    const key = rawLine.slice(0, idx).trim();
    const value = rawLine.slice(idx + 1).trim();

    if (value === "") {
      // Start of a block.
      blocks[key] = {};
      currentBlock = key;
    } else {
      scalars[key] = value;
    }
  }

  return { scalars, blocks };
}

// ---------------------------------------------------------------------------
// Atomic I/O
// ---------------------------------------------------------------------------

/**
 * Read the install-state envelope from disk. Returns `null` if the file does
 * not exist. Throws on parse errors (caller decides whether to overwrite or
 * abort).
 */
export function readInstallState(filePath: string): InstallState | null {
  if (!fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, "utf8");
  return decodeInstallState(text);
}

/**
 * Atomically write the install-state envelope: write to `${filePath}.tmp`,
 * then `fs.renameSync` onto the target. The parent directory is created if
 * missing (mkdirSync recursive).
 */
export function writeInstallStateAtomic(filePath: string, state: InstallState): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp`;
  const encoded = encodeInstallState(state);
  fs.writeFileSync(tmp, encoded, { encoding: "utf8", mode: 0o644 });
  fs.renameSync(tmp, filePath);
}
