/**
 * Phase 0 / S-01: convergence-state.toon v1 → v2 migration is idempotent and
 * produces a document the detector reports as current.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  detectConvergenceStateVersion,
  migrateConvergenceStateV1toV2,
  CONVERGENCE_STATE_CURRENT_VERSION,
} from "../../scripts/lib/convergence-state-migrator.js";

const FIXTURE_PATH = resolve(
  __dirname,
  "../../fixtures/pre-f18/convergence-state.toon",
);

describe("convergence-state migrator (v1 → v2)", () => {
  it("detects the pre-F-18 fixture as v1 and outdated", () => {
    const content = readFileSync(FIXTURE_PATH, "utf8");
    const detection = detectConvergenceStateVersion(content);
    expect(detection.detected).toBe(1);
    expect(detection.current).toBe(CONVERGENCE_STATE_CURRENT_VERSION);
    expect(detection.outdated).toBe(true);
  });

  it("migrates v1 → v2 and stamps schemaVersion: 2", () => {
    const content = readFileSync(FIXTURE_PATH, "utf8");
    const migrated = migrateConvergenceStateV1toV2(content);
    expect(migrated).toMatch(/^schemaVersion:\s*2\s*$/m);
  });

  it("adds a loops[] typed-array header", () => {
    const content = readFileSync(FIXTURE_PATH, "utf8");
    const migrated = migrateConvergenceStateV1toV2(content);
    expect(migrated).toMatch(
      /^loops\[0\]\{loopId,symptom,rung,verifiedRed,runtimeMs,linkedLoops,retiredAt\}:\s*$/m,
    );
  });

  it("is idempotent — second pass produces byte-identical output (S-01)", () => {
    const content = readFileSync(FIXTURE_PATH, "utf8");
    const once = migrateConvergenceStateV1toV2(content);
    const twice = migrateConvergenceStateV1toV2(once);
    expect(twice).toBe(once);
  });

  it("post-migration detection reports current:2, outdated:false (S-01)", () => {
    const content = readFileSync(FIXTURE_PATH, "utf8");
    const migrated = migrateConvergenceStateV1toV2(content);
    const detection = detectConvergenceStateVersion(migrated);
    expect(detection.detected).toBe(2);
    expect(detection.current).toBe(2);
    expect(detection.outdated).toBe(false);
  });

  it("preserves existing fields (findings, iterations, subject)", () => {
    const content = readFileSync(FIXTURE_PATH, "utf8");
    const migrated = migrateConvergenceStateV1toV2(content);
    expect(migrated).toContain("subject: planning/PLAN-pre-f18-example.md");
    expect(migrated).toContain("findings[3]");
    expect(migrated).toContain("iterations[3]");
  });
});
