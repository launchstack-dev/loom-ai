/**
 * Integration tests for TierResolution. These exercise the pure resolver
 * through realistic scenarios (auto-resolution paths, explicit overrides,
 * the MIGRATION_TIER_AMBIGUOUS conflict). The exhaustive 8-row table lives
 * next to the source in `scripts/lib/tier-resolution.test.ts`; this file
 * focuses on documenting the resolver as a unit consumers can depend on.
 */
import { describe, it, expect } from "vitest";
import { resolveTier } from "../scripts/lib/tier-resolution";

describe("TierResolution — auto-resolution paths", () => {
  it("defaults to local when no prior entries exist (greenfield)", () => {
    const r = resolveTier({
      explicitFlag: undefined,
      existingLocalEntries: false,
      existingProjectEntries: false,
    });
    expect(r).toEqual({ ok: true, tier: "local", reason: "default-local" });
  });

  it("preserves project tier when re-running against a legacy install", () => {
    // Pre-flip users have entries only in settings.json. A re-run must not
    // silently migrate them to settings.local.json — that would orphan the
    // old entries and double-register hooks if their teammates `git pull`.
    const r = resolveTier({
      explicitFlag: undefined,
      existingLocalEntries: false,
      existingProjectEntries: true,
    });
    expect(r).toEqual({ ok: true, tier: "project", reason: "preserve" });
  });

  it("preserves local tier when entries already live there", () => {
    const r = resolveTier({
      explicitFlag: undefined,
      existingLocalEntries: true,
      existingProjectEntries: false,
    });
    expect(r).toEqual({ ok: true, tier: "local", reason: "preserve" });
  });

  it("treats --tier auto identically to undefined", () => {
    const undef = resolveTier({
      explicitFlag: undefined,
      existingLocalEntries: false,
      existingProjectEntries: true,
    });
    const auto = resolveTier({
      explicitFlag: "auto",
      existingLocalEntries: false,
      existingProjectEntries: true,
    });
    expect(auto).toEqual(undef);
  });
});

describe("TierResolution — explicit overrides", () => {
  it("--tier local wins even when only project entries exist", () => {
    const r = resolveTier({
      explicitFlag: "local",
      existingLocalEntries: false,
      existingProjectEntries: true,
    });
    expect(r).toEqual({ ok: true, tier: "local", reason: "explicit" });
  });

  it("--tier project wins even when only local entries exist", () => {
    const r = resolveTier({
      explicitFlag: "project",
      existingLocalEntries: true,
      existingProjectEntries: false,
    });
    expect(r).toEqual({ ok: true, tier: "project", reason: "explicit" });
  });

  it("explicit overrides bypass the ambiguous-conflict check", () => {
    // Both tiers occupied but user picked one — no error.
    const r = resolveTier({
      explicitFlag: "local",
      existingLocalEntries: true,
      existingProjectEntries: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tier).toBe("local");
  });
});

describe("TierResolution — conflict detection", () => {
  it("reports MIGRATION_TIER_AMBIGUOUS when both tiers have Loom entries", () => {
    const r = resolveTier({
      explicitFlag: undefined,
      existingLocalEntries: true,
      existingProjectEntries: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("MIGRATION_TIER_AMBIGUOUS");
      expect(r.existingTiers).toEqual(["local", "project"]);
    }
  });

  it("still reports MIGRATION_TIER_AMBIGUOUS when --tier auto is explicit", () => {
    const r = resolveTier({
      explicitFlag: "auto",
      existingLocalEntries: true,
      existingProjectEntries: true,
    });
    expect(r.ok).toBe(false);
  });
});
