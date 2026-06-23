import { describe, it, expect } from "vitest";
import { resolveTier, type TierResolutionInput } from "./tier-resolution";

/**
 * Exhaustive unit coverage of the TierResolution decision table.
 *
 * The 8 implicit-flag combinations are
 *   (explicitFlag in {undefined, "auto"}) × existingLocal × existingProject.
 *
 * Plus the two explicit overrides (`"local"` / `"project"`) which should
 * short-circuit regardless of existing-entry state.
 */

const ALL_BOOL = [false, true] as const;

describe("resolveTier — 8 implicit-flag combinations", () => {
  const cases: Array<{
    explicitFlag: TierResolutionInput["explicitFlag"];
    local: boolean;
    project: boolean;
    expect:
      | { tier: "local" | "project"; reason: "default-local" | "preserve" }
      | { error: "MIGRATION_TIER_AMBIGUOUS" };
  }> = [
    // explicitFlag: undefined
    { explicitFlag: undefined, local: false, project: false, expect: { tier: "local", reason: "default-local" } },
    { explicitFlag: undefined, local: true,  project: false, expect: { tier: "local", reason: "preserve" } },
    { explicitFlag: undefined, local: false, project: true,  expect: { tier: "project", reason: "preserve" } },
    { explicitFlag: undefined, local: true,  project: true,  expect: { error: "MIGRATION_TIER_AMBIGUOUS" } },
    // explicitFlag: "auto" — same as undefined
    { explicitFlag: "auto", local: false, project: false, expect: { tier: "local", reason: "default-local" } },
    { explicitFlag: "auto", local: true,  project: false, expect: { tier: "local", reason: "preserve" } },
    { explicitFlag: "auto", local: false, project: true,  expect: { tier: "project", reason: "preserve" } },
    { explicitFlag: "auto", local: true,  project: true,  expect: { error: "MIGRATION_TIER_AMBIGUOUS" } },
  ];

  for (const c of cases) {
    const flagDesc = c.explicitFlag ?? "undefined";
    const label = `flag=${flagDesc} local=${c.local} project=${c.project}`;
    it(label, () => {
      const result = resolveTier({
        explicitFlag: c.explicitFlag,
        existingLocalEntries: c.local,
        existingProjectEntries: c.project,
      });
      if ("error" in c.expect) {
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toBe("MIGRATION_TIER_AMBIGUOUS");
          expect(result.existingTiers).toEqual(["local", "project"]);
        }
      } else {
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.tier).toBe(c.expect.tier);
          expect(result.reason).toBe(c.expect.reason);
        }
      }
    });
  }
});

describe("resolveTier — explicit overrides", () => {
  for (const local of ALL_BOOL) {
    for (const project of ALL_BOOL) {
      it(`--tier local wins regardless of local=${local} project=${project}`, () => {
        const r = resolveTier({
          explicitFlag: "local",
          existingLocalEntries: local,
          existingProjectEntries: project,
        });
        expect(r.ok).toBe(true);
        if (r.ok) {
          expect(r.tier).toBe("local");
          expect(r.reason).toBe("explicit");
        }
      });
      it(`--tier project wins regardless of local=${local} project=${project}`, () => {
        const r = resolveTier({
          explicitFlag: "project",
          existingLocalEntries: local,
          existingProjectEntries: project,
        });
        expect(r.ok).toBe(true);
        if (r.ok) {
          expect(r.tier).toBe("project");
          expect(r.reason).toBe("explicit");
        }
      });
    }
  }
});
