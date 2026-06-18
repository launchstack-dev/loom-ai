/**
 * scripts/lib/tier-resolution.ts
 *
 * TierResolution algorithm: decides whether `register-loom-hooks.ts` should
 * write to `.claude/settings.local.json` (per-user, not committed) or
 * `.claude/settings.json` (shared, committed to git).
 *
 * As of the migration to local-by-default, the priorities are:
 *
 *   1. Explicit user choice (`--tier local` or `--tier project`) wins.
 *   2. With no explicit choice (or `--tier auto`):
 *        a. If Loom entries already exist in only one tier, preserve that
 *           tier — a re-run must NEVER silently migrate users between tiers.
 *        b. If Loom entries exist in BOTH tiers, fail with
 *           `MIGRATION_TIER_AMBIGUOUS` and require the user to pick one
 *           explicitly with `--tier`.
 *        c. Otherwise default to `local` (the new default flip).
 *
 * This is a pure function — no fs / argv / env access. Callers compute the
 * `existingLocalEntries` / `existingProjectEntries` booleans by inspecting
 * the two settings files (using `commandReferencesHook` on LOOM_HOOKS).
 */

export type ExplicitTierFlag = "auto" | "local" | "project";
export type Tier = "local" | "project";

export interface TierResolutionInput {
  /** Value of the `--tier` CLI flag, or undefined if the flag was omitted. */
  explicitFlag?: ExplicitTierFlag;
  /** True iff `.claude/settings.local.json` already has Loom hook entries. */
  existingLocalEntries: boolean;
  /** True iff `.claude/settings.json` already has Loom hook entries. */
  existingProjectEntries: boolean;
}

export type TierResolutionResult =
  | {
      ok: true;
      tier: Tier;
      /**
       * Why this tier was chosen — useful for logging / `--json` output.
       *   "explicit"      → user passed `--tier local` or `--tier project`.
       *   "preserve"      → re-run found entries in exactly one tier; kept it.
       *   "default-local" → no signals; fell back to the new default.
       */
      reason: "explicit" | "preserve" | "default-local";
    }
  | {
      ok: false;
      error: "MIGRATION_TIER_AMBIGUOUS";
      existingTiers: Tier[];
    };

/**
 * Pure resolver. See module doc for the decision table.
 *
 * Decision table (8 implicit-flag cases + 2 explicit overrides):
 *
 *   explicitFlag | existingLocal | existingProject | Result
 *   -------------+---------------+-----------------+----------------------
 *   undefined    | false         | false           | local (default-local)
 *   undefined    | true          | false           | local (preserve)
 *   undefined    | false         | true            | project (preserve)
 *   undefined    | true          | true            | MIGRATION_TIER_AMBIGUOUS
 *   'auto'       | false         | false           | local (default-local)
 *   'auto'       | true          | false           | local (preserve)
 *   'auto'       | false         | true            | project (preserve)
 *   'auto'       | true          | true            | MIGRATION_TIER_AMBIGUOUS
 *   'local'      | *             | *               | local (explicit)
 *   'project'    | *             | *               | project (explicit)
 */
export function resolveTier(input: TierResolutionInput): TierResolutionResult {
  const { explicitFlag, existingLocalEntries, existingProjectEntries } = input;

  // 1. Explicit override always wins. The user has accepted whatever
  //    consequences that brings (e.g. duplicate entries across tiers).
  if (explicitFlag === "local") {
    return { ok: true, tier: "local", reason: "explicit" };
  }
  if (explicitFlag === "project") {
    return { ok: true, tier: "project", reason: "explicit" };
  }

  // 2. Auto / undefined: inspect the existing-entry signals.
  if (existingLocalEntries && existingProjectEntries) {
    return {
      ok: false,
      error: "MIGRATION_TIER_AMBIGUOUS",
      existingTiers: ["local", "project"],
    };
  }
  if (existingLocalEntries) {
    return { ok: true, tier: "local", reason: "preserve" };
  }
  if (existingProjectEntries) {
    return { ok: true, tier: "project", reason: "preserve" };
  }
  // No prior entries anywhere — fall through to the new default.
  return { ok: true, tier: "local", reason: "default-local" };
}
