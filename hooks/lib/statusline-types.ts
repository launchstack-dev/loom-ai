/**
 * Shared type definitions for the Claude Code status line feature.
 * Consumed by the statusline shell command and hook integrations.
 */

/** Seconds before status.toon is considered stale and ignored. */
export const STALENESS_THRESHOLD_SECONDS = 300;

/**
 * Active execution state, read from `.plan-execution/status.toon`.
 * Present only while an orchestrator command is running.
 */
export interface ActiveState {
  /** The orchestrator command in progress (e.g. "execute-plan", "review-code"). */
  command: string;
  /** Current execution phase (e.g. "implementing", "contracts", "verifying"). */
  phase: string;
  /** Current wave number (zero-indexed). */
  wave: number;
  /** Total number of waves in this execution. */
  totalWaves: number;
  /** Number of agents currently in flight. */
  agentsRunning: number;
  /** Number of agents that have completed. */
  agentsDone: number;
  /** Total number of agents in this step. */
  agentsTotal: number;
  /** Number of agents that have failed. */
  agentsFailed: number;
  /** Finding count (total or remaining, depending on command). */
  findings: number;
  /** ISO 8601 timestamp of last update. */
  updatedAt: string;
}

/**
 * Ambient/idle state shown when no orchestrator command is active.
 * Assembled from plan metadata, git state, and notes.
 */
export interface AmbientState {
  /** High-level plan status (e.g. "draft", "approved", "executing") or null if no plan. */
  planStatus: string | null;
  /** Human-readable plan name, or null if no plan. */
  planName: string | null;
  /** Number of unprocessed loom notes. */
  pendingNotes: number;
  /** Name of the last orchestrator command that ran, or null. */
  lastCommand: string | null;
  /** Result of the last command: "ok", "failed", or null. */
  lastResult: "ok" | "failed" | null;
  /** Current git branch name, or null if not in a repo. */
  gitBranch: string | null;
  /** Whether a catalog update is available (from ~/.cache/loom/update-check.toon). */
  updateAvailable: boolean;
}

/**
 * Configuration state for the statusline integration itself.
 * Used by the setup wizard and health checks.
 */
export interface StatuslineConfig {
  /** Absolute path to the statusline shell command. */
  statuslineCommand: string;
  /** Whether the command file exists and is executable. */
  installed: boolean;
  /** Whether starship.toml has the custom command configured. */
  starshipConfigured: boolean;
}
