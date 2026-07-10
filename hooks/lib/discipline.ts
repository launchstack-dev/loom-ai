/**
 * Discipline profile resolution — the single conditional seam (roadmap C-02).
 *
 * One writer (`/loom-doctor --resolve-profile`), this one reader, many consumers.
 * Hooks call `hookActive(name)` and self-bail; no hook performs its own detection
 * or branches on a model name. See protocols/discipline.schema.md.
 *
 * Fail-strict: any missing section, parse failure, or invalid value resolves to
 * "strict" (today's behavior). In an enforcement product a config error must never
 * silently turn enforcement off.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export type DisciplineProfile = "strict" | "standard" | "minimal";
export type ProfileSetting = DisciplineProfile | "auto";
export type DisciplineLayer = "core" | "engine" | "scaffold";

export interface DisciplineConfig {
  /** The `profile` key: user pin, or "auto" (default when absent). */
  profile: ProfileSetting;
  /** The `resolved` key written by the doctor; only consulted when profile = "auto". */
  resolved: DisciplineProfile | null;
  /** Per-agent-tier floors from [settings.discipline.tierOverrides], merged over built-ins. */
  tierOverrides: Record<string, DisciplineProfile>;
}

export interface HookGate {
  layer: DisciplineLayer;
  /** Minimum effective profile at which this hook runs. */
  minProfile: DisciplineProfile;
  /** Tier floors lift the effective profile for this hook (per-agent enforcement). */
  tierSensitive?: boolean;
}

const PROFILE_RANK: Record<DisciplineProfile, number> = {
  minimal: 0,
  standard: 1,
  strict: 2,
};

const VALID_PROFILES = new Set<string>(["strict", "standard", "minimal"]);

/** Built-in floors; config tierOverrides entries override per tier (roadmap C-01). */
const DEFAULT_TIER_FLOORS: Record<string, DisciplineProfile> = {
  haiku: "standard",
};

const ALWAYS: HookGate = { layer: "core", minProfile: "minimal" };

/**
 * Hook-level layer membership. A hook missing from this table is treated as
 * core/always-on — unknown never means disabled.
 * Keep in sync with the table in protocols/discipline.schema.md.
 */
export const HOOK_GATES: Record<string, HookGate> = {
  // core — always active
  "deploy-guard": ALWAYS,
  "typecheck-on-write": ALWAYS,
  "shellcheck-on-write": ALWAYS,
  "bash-portability-on-write": ALWAYS,
  "pylint-on-write": ALWAYS,
  "contract-lock": ALWAYS,
  "wiki-session-status": ALWAYS,
  "wiki-write-guard": ALWAYS,
  "wiki-commit-ledger": ALWAYS,
  "loom-migration": ALWAYS,
  // core (C-08): fail-closed map-freshness precondition on planning artifacts;
  // dormant until .loom/wiki/maps/ exists (Track B).
  "map-freshness": ALWAYS,
  // core, tier-gated: off for the main session under minimal, but tier floors
  // keep it on for cheap-tier subagents.
  "file-ownership": { layer: "core", minProfile: "standard", tierSensitive: true },
  // core (C-08/C-11): the Stop-time gate blocks under every profile. Today it
  // is the stage-based check; M-2 replaces its internals with acceptance
  // re-validation without changing its layer.
  "quality-gate": ALWAYS,
  // scaffold — strict only
  "context-budget": { layer: "scaffold", minProfile: "strict" },
  "budget-tracker": { layer: "scaffold", minProfile: "strict" },
  "context-monitor": { layer: "scaffold", minProfile: "strict" },
  "checkpoint-trigger": { layer: "scaffold", minProfile: "strict" },
  "status-updater": { layer: "scaffold", minProfile: "strict" },
  "wiki-impact-warner": { layer: "scaffold", minProfile: "strict" },
};

/** Read [settings.discipline] from .claude/orchestration.toml. Never throws. */
export function readDisciplineConfig(cwd?: string): DisciplineConfig {
  const defaults: DisciplineConfig = {
    profile: "auto",
    resolved: null,
    tierOverrides: { ...DEFAULT_TIER_FLOORS },
  };

  try {
    const tomlPath = path.resolve(cwd ?? process.cwd(), ".claude", "orchestration.toml");
    if (!fs.existsSync(tomlPath)) return defaults;
    const content = fs.readFileSync(tomlPath, "utf-8");

    const sectionMatch = content.match(
      /\[settings\.discipline\]([\s\S]*?)(?=\n\s*\[|\s*$)/
    );
    if (sectionMatch) {
      const profileMatch = sectionMatch[1].match(
        /^\s*profile\s*=\s*"?(auto|strict|standard|minimal)"?\s*(?:#.*)?$/m
      );
      if (profileMatch) defaults.profile = profileMatch[1] as ProfileSetting;

      const resolvedMatch = sectionMatch[1].match(
        /^\s*resolved\s*=\s*"?(strict|standard|minimal)"?\s*(?:#.*)?$/m
      );
      if (resolvedMatch) defaults.resolved = resolvedMatch[1] as DisciplineProfile;
    }

    const overridesMatch = content.match(
      /\[settings\.discipline\.tierOverrides\]([\s\S]*?)(?=\n\s*\[|\s*$)/
    );
    if (overridesMatch) {
      const entryRe = /^\s*([A-Za-z0-9_-]+)\s*=\s*"?(strict|standard|minimal)"?\s*(?:#.*)?$/gm;
      let m: RegExpExecArray | null;
      while ((m = entryRe.exec(overridesMatch[1])) !== null) {
        defaults.tierOverrides[m[1]] = m[2] as DisciplineProfile;
      }
    }

    return defaults;
  } catch {
    return defaults;
  }
}

/**
 * Resolve the session-level profile. Precedence:
 * 1. LOOM_DISCIPLINE_PROFILE env var (test/debug escape hatch)
 * 2. explicit `profile` pin
 * 3. `resolved` (doctor-written), when profile = "auto"
 * 4. "strict" (C-06: existing installs behave exactly as today)
 */
export function resolveProfile(config?: DisciplineConfig, cwd?: string): DisciplineProfile {
  const envOverride = process.env.LOOM_DISCIPLINE_PROFILE;
  if (envOverride && VALID_PROFILES.has(envOverride)) {
    return envOverride as DisciplineProfile;
  }

  const cfg = config ?? readDisciplineConfig(cwd);
  if (cfg.profile !== "auto" && VALID_PROFILES.has(cfg.profile)) {
    return cfg.profile;
  }
  if (cfg.resolved && VALID_PROFILES.has(cfg.resolved)) {
    return cfg.resolved;
  }
  return "strict";
}

/** The stricter of two profiles. */
export function maxProfile(a: DisciplineProfile, b: DisciplineProfile): DisciplineProfile {
  return PROFILE_RANK[a] >= PROFILE_RANK[b] ? a : b;
}

/**
 * Effective profile for a tier-sensitive check: max(session profile, tier floor).
 * Tier defaults to LOOM_AGENT_TIER (set by orchestrators on subagent spawn).
 */
export function effectiveProfile(opts?: {
  tier?: string | null;
  config?: DisciplineConfig;
  cwd?: string;
}): DisciplineProfile {
  const cfg = opts?.config ?? readDisciplineConfig(opts?.cwd);
  const session = resolveProfile(cfg, opts?.cwd);
  const tier = opts?.tier !== undefined ? opts.tier : process.env.LOOM_AGENT_TIER ?? null;
  if (!tier) return session;
  const floor = cfg.tierOverrides[tier];
  if (!floor || !VALID_PROFILES.has(floor)) return session;
  return maxProfile(session, floor);
}

/**
 * Should this hook run? The one call every gated hook makes, right after its
 * cheap input filters. Under "strict" this always returns true, keeping strict
 * behavior byte-identical to pre-profile Loom. Never throws.
 */
export function hookActive(
  hookName: string,
  opts?: { tier?: string | null; cwd?: string }
): boolean {
  try {
    const gate = HOOK_GATES[hookName] ?? ALWAYS;
    const cfg = readDisciplineConfig(opts?.cwd);
    const profile = gate.tierSensitive
      ? effectiveProfile({ tier: opts?.tier, config: cfg, cwd: opts?.cwd })
      : resolveProfile(cfg, opts?.cwd);
    return PROFILE_RANK[profile] >= PROFILE_RANK[gate.minProfile];
  } catch {
    return true; // fail-strict: enforcement stays on
  }
}
