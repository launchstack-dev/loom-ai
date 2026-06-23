/**
 * `/loom-update --check` drift detection.
 *
 * Pure module — all I/O dependencies (now, fetch, install-state reader) are
 * injected by callers. Produces UpdateCheck records per
 * `agents/protocols/update-check.schema.md`.
 */
import type { Channel, InstallState } from "../install-state.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UpdateCheck {
  schemaVersion: 1;
  currentVersion: string;
  latestVersion: string;
  behind: number;
  pinnedVersion: string | null;
  generatedAt: string;
  channel: Channel;
}

export interface ManifestRegistry {
  /** Ordered semver list, oldest first. The last entry is the latest. */
  versions: string[];
}

export interface CheckDeps {
  /** Returns the loaded `~/.loom/install.toon`. May be null if first-run. */
  readState: () => InstallState | null;
  /** Fetches the marketplace/release manifest registry. */
  fetchManifest: () => Promise<ManifestRegistry>;
  now: () => Date;
}

// ---------------------------------------------------------------------------
// Semver compare (loose) — supports `vX.Y.Z` and `X.Y.Z[-pre]`
// ---------------------------------------------------------------------------

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?$/;

export function parseSemver(s: string): [number, number, number, string] {
  const m = SEMVER_RE.exec(s.trim());
  if (!m) throw new Error(`invalid semver: "${s}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ?? ""];
}

export function compareSemver(a: string, b: string): number {
  const [ma, mi, pa, prea] = parseSemver(a);
  const [mb, mib, pb, preb] = parseSemver(b);
  if (ma !== mb) return ma - mb;
  if (mi !== mib) return mi - mib;
  if (pa !== pb) return pa - pb;
  // Pre-releases sort before their release per semver §11.
  if (prea === preb) return 0;
  if (prea === "") return 1;
  if (preb === "") return -1;
  return prea < preb ? -1 : 1;
}

/** Strip optional leading `v` so emitted output is consistent. */
export function normalizeSemver(s: string): string {
  return s.replace(/^v/, "");
}

// ---------------------------------------------------------------------------
// Core check
// ---------------------------------------------------------------------------

/**
 * Compute drift between the locally installed version and the latest manifest
 * version. Throws if no state present (caller maps to exit code 2).
 */
export async function check(deps: CheckDeps): Promise<UpdateCheck> {
  const state = deps.readState();
  if (!state) {
    throw new Error("install-state-missing: ~/.loom/install.toon not found");
  }
  const manifest = await deps.fetchManifest();
  if (!manifest.versions || manifest.versions.length === 0) {
    throw new Error("manifest-empty: no versions in registry");
  }
  const current = normalizeSemver(state.installedVersion);
  const latest = normalizeSemver(manifest.versions[manifest.versions.length - 1]);

  // behind = count of manifest entries strictly greater than current.
  let behind = 0;
  for (const v of manifest.versions) {
    if (compareSemver(normalizeSemver(v), current) > 0) behind += 1;
  }

  return {
    schemaVersion: 1,
    currentVersion: current,
    latestVersion: latest,
    behind,
    pinnedVersion: state.pinnedVersion,
    generatedAt: deps.now().toISOString(),
    channel: state.channel,
  };
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

/**
 * Single-line text rendering (S-01 acceptance). Uses ASCII `->` arrow and an
 * em-dash before the action hint, exactly as required by the plan.
 */
export function renderCheckText(c: UpdateCheck): string {
  if (c.behind === 0) {
    return `Loom v${c.currentVersion} installed — up to date`;
  }
  return `Loom v${c.currentVersion} installed -> v${c.latestVersion} available — run /loom-update to apply`;
}

/** JSON rendering — flat object per `update-check.schema.md`. */
export function renderCheckJSON(c: UpdateCheck): string {
  // Match field order in the schema's JSON exemplar.
  return (
    JSON.stringify(
      {
        schemaVersion: c.schemaVersion,
        currentVersion: c.currentVersion,
        latestVersion: c.latestVersion,
        behind: c.behind,
        pinnedVersion: c.pinnedVersion,
        generatedAt: c.generatedAt,
        channel: c.channel,
      },
      null,
      2,
    ) + "\n"
  );
}
