/**
 * `/loom-update --apply` — channel-aware update execution.
 *
 * Curl path: re-runs the installer script pinned to the latest tag.
 * Plugin path: delegates to `claude plugin update loom` with `plugin add` fallback.
 *
 * Pure module — exec, fs, install-state I/O are injected. Writes the
 * `install.toon.updateInProgress` marker atomically before performing the
 * channel-specific action, then clears it on success.
 */
import type { Channel, InstallState, UpdateInProgress } from "../install-state.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApplyDeps {
  readState: () => InstallState | null;
  writeState: (s: InstallState) => void;
  /** Resolve latest manifest version. */
  resolveLatestVersion: () => Promise<string>;
  /** Execute a shell command; returns exit code + stdout/stderr. */
  exec: (
    cmd: string,
    args: string[],
  ) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  now: () => Date;
  /** Optional logger for human-readable progress. */
  log?: (line: string) => void;
}

export interface ApplyOptions {
  /** Override channel (`--channel curl|plugin`). Defaults to install-state. */
  channelOverride?: Channel;
  /** Pin to a specific version (`--pin <version>`). */
  pin?: string;
}

export interface ApplyResult {
  exitCode: number;
  /** True when the operation requires a Claude Code restart to take effect. */
  restartRequired: boolean;
  /** Channel actually used (post-resolution). */
  channel: Channel;
  /** The version we attempted to install. */
  toVersion: string;
}

// ---------------------------------------------------------------------------
// Marker helpers
// ---------------------------------------------------------------------------

export function writeMarker(
  deps: Pick<ApplyDeps, "readState" | "writeState" | "now">,
  toVersion: string,
): InstallState {
  const state = deps.readState();
  if (!state) {
    throw new Error("install-state-missing: cannot mark update in progress");
  }
  const marker: UpdateInProgress = {
    fromVersion: state.installedVersion,
    toVersion,
    startedAt: deps.now().toISOString(),
  };
  const next: InstallState = { ...state, updateInProgress: marker };
  deps.writeState(next);
  return next;
}

export function clearMarker(
  deps: Pick<ApplyDeps, "readState" | "writeState">,
  newVersion: string,
): InstallState {
  const state = deps.readState();
  if (!state) {
    throw new Error("install-state-missing: cannot clear update marker");
  }
  const next: InstallState = {
    ...state,
    installedVersion: newVersion,
    updateInProgress: null,
    installError: null,
  };
  deps.writeState(next);
  return next;
}

export function recordPin(
  deps: Pick<ApplyDeps, "readState" | "writeState">,
  pinned: string,
): InstallState {
  const state = deps.readState();
  if (!state) {
    throw new Error("install-state-missing: cannot record pin");
  }
  const next: InstallState = { ...state, pinnedVersion: pinned };
  deps.writeState(next);
  return next;
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export async function apply(
  deps: ApplyDeps,
  opts: ApplyOptions = {},
): Promise<ApplyResult> {
  const state = deps.readState();
  if (!state) {
    throw new Error("install-state-missing: ~/.loom/install.toon not found");
  }

  const channel: Channel = opts.channelOverride ?? state.channel;
  const target = opts.pin ?? (await deps.resolveLatestVersion());
  const log = deps.log ?? (() => {});

  if (opts.pin) {
    recordPin(deps, opts.pin);
  }

  writeMarker(deps, target);
  log(`Updating Loom to v${stripV(target)} via ${channel} channel`);

  let result: ApplyResult;
  if (channel === "plugin") {
    result = await applyPlugin(deps, target, log);
  } else {
    result = await applyCurl(deps, target, log);
  }

  if (result.exitCode === 0) {
    clearMarker(deps, stripV(target));
  }
  return result;
}

function stripV(v: string): string {
  return v.replace(/^v/, "");
}

async function applyPlugin(
  deps: ApplyDeps,
  target: string,
  log: (l: string) => void,
): Promise<ApplyResult> {
  const versioned = `loom@${stripV(target)}`;

  // Primary: `claude plugin update loom`.
  const primary = await deps.exec("claude", ["plugin", "update", "loom"]);
  if (primary.exitCode === 0) {
    log(primary.stdout.trim());
    return {
      exitCode: 0,
      restartRequired: true,
      channel: "plugin",
      toVersion: stripV(target),
    };
  }
  log(`plugin update failed (exit ${primary.exitCode}); falling back to plugin add`);

  // Fallback: `claude plugin add loom@<version>`.
  const fallback = await deps.exec("claude", ["plugin", "add", versioned]);
  if (fallback.exitCode === 0) {
    log(fallback.stdout.trim());
    return {
      exitCode: 0,
      restartRequired: true,
      channel: "plugin",
      toVersion: stripV(target),
    };
  }

  return {
    exitCode: fallback.exitCode || 1,
    restartRequired: false,
    channel: "plugin",
    toVersion: stripV(target),
  };
}

async function applyCurl(
  deps: ApplyDeps,
  target: string,
  log: (l: string) => void,
): Promise<ApplyResult> {
  // The curl installer is the canonical bootstrap URL pinned to the target
  // tag. Re-running it is idempotent and preserves repo-root state because
  // the installer itself reads `~/.loom/install.toon` for prior config.
  const tag = target.startsWith("v") ? target : `v${target}`;
  const url = `https://raw.githubusercontent.com/launchstack-dev/loom-ai/${tag}/scripts/install.sh`;

  // bash -c "curl -fsSL <url> | bash" — but expose via separate args so the
  // injected exec can intercept in tests without shell parsing.
  const cmd = `curl -fsSL ${url} | LOOM_PINNED_TAG=${tag} bash`;
  const r = await deps.exec("bash", ["-c", cmd]);
  if (r.exitCode === 0) {
    log(r.stdout.trim());
    return {
      exitCode: 0,
      restartRequired: false,
      channel: "curl",
      toVersion: stripV(target),
    };
  }
  return {
    exitCode: r.exitCode || 1,
    restartRequired: false,
    channel: "curl",
    toVersion: stripV(target),
  };
}
