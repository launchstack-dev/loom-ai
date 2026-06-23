/**
 * `/loom-update --resume` — pick up from a `install.toon.updateInProgress`
 * marker left by a killed mid-update.
 *
 * Two paths:
 *  - Recoverable (toVersion is in the manifest registry): re-invoke
 *    {@link apply} pinned to `toVersion`.
 *  - Unrecoverable (toVersion is gone): set
 *    `install.toon.updateInProgress = "failed"` (string sentinel per the
 *    InstallState discriminated union) and exit non-zero with a guidance
 *    message on stderr.
 */
import type { InstallState } from "../install-state.js";
import { apply, type ApplyDeps, type ApplyResult } from "./apply.js";
import { type ManifestRegistry, normalizeSemver } from "./check.js";

export interface ResumeDeps extends ApplyDeps {
  fetchManifest: () => Promise<ManifestRegistry>;
}

export type ResumeOutcome =
  | { kind: "noop"; reason: string }
  | { kind: "completed"; result: ApplyResult }
  | { kind: "failed"; message: string };

const UNRECOVERABLE_MESSAGE =
  "Update unrecoverable. Run /loom-update --check OR /loom-doctor --bundle to file an issue.";

export async function resume(deps: ResumeDeps): Promise<ResumeOutcome> {
  const state = deps.readState();
  if (!state) {
    return { kind: "noop", reason: "install-state-missing" };
  }
  if (state.updateInProgress === null) {
    return { kind: "noop", reason: "no marker present" };
  }
  if (state.updateInProgress === "failed") {
    return {
      kind: "failed",
      message: `marker already in terminal failed state — ${UNRECOVERABLE_MESSAGE}`,
    };
  }

  const marker = state.updateInProgress;
  const manifest = await deps.fetchManifest();
  const target = normalizeSemver(marker.toVersion);
  const known = manifest.versions.map(normalizeSemver);
  if (!known.includes(target)) {
    markFailed(deps, state);
    return { kind: "failed", message: UNRECOVERABLE_MESSAGE };
  }

  const result = await apply(deps, { pin: marker.toVersion });
  if (result.exitCode !== 0) {
    markFailed(deps, deps.readState() ?? state);
    return {
      kind: "failed",
      message: `resume apply failed (exit ${result.exitCode})`,
    };
  }
  return { kind: "completed", result };
}

function markFailed(
  deps: Pick<ResumeDeps, "readState" | "writeState">,
  fallback: InstallState,
): void {
  const cur = deps.readState() ?? fallback;
  const next: InstallState = { ...cur, updateInProgress: "failed" };
  deps.writeState(next);
}

export { UNRECOVERABLE_MESSAGE };
