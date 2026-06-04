/**
 * Tests for hooks/lib/spec-validators/contract-page-drift.ts (Phase 7).
 *
 * The drift validator's correctness rests on three things:
 *   1. It MUST call `canonicalBodyChecksumFromPage` verbatim (no fork).
 *   2. A clean writer-emitted page round-trips: checksum matches immediately.
 *   3. Any body mutation that survives canonical-body normalization breaks
 *      the checksum and is flagged as blocking.
 *
 * We cover all three plus the recovery-plan heuristic and the legacy
 * (no-checksum) skip-with-info case.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { validateContractPageDrift } from "../hooks/lib/spec-validators/contract-page-drift.js";
import { canonicalBodyChecksumFromPage } from "../hooks/lib/checksum.js";
import { writeContractPage } from "../hooks/lib/contract-page-writer.js";

const FIXED_NOW_ISO = "2026-05-23T12:00:00Z";

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "contract-page-drift-"));
}

function pagesDir(project: string): string {
  return path.join(project, ".loom", "wiki", "pages");
}

function emitFreshPage(project: string, domain: string): string {
  const wikiRoot = path.join(project, ".loom", "wiki");
  writeContractPage(wikiRoot, {
    domain,
    title: domain.charAt(0).toUpperCase() + domain.slice(1),
    summary: `${domain} contract`,
    purpose: `Purpose for ${domain}.`,
    requirements: [
      { id: "R-01", requirementType: "functional", text: "MUST do thing." },
      { id: "R-02", requirementType: "functional", text: "MUST do other thing." },
    ],
    scenarios: [],
    entities: [],
    outOfScope: ["nothing"],
    history: [],
    contractVersion: 1,
    contractStatus: "active",
    sourceChanges: [],
    deprecatedAt: null,
    replacedBy: null,
    sourceRefs: [],
    tags: ["test"],
    createdAt: FIXED_NOW_ISO,
    updatedAt: FIXED_NOW_ISO,
    createdBy: "test",
    updatedBy: "test",
  });
  return path.join(pagesDir(project), `contract-${domain}.md`);
}

// ---------------------------------------------------------------------------

describe("validateContractPageDrift", () => {
  let project: string;
  beforeEach(() => {
    project = mkTempProject();
  });

  it("passes when the stored checksum matches the recomputed checksum (fresh writer page)", () => {
    const pageFile = emitFreshPage(project, "billing");
    const r = validateContractPageDrift(pageFile, { rootDir: project });
    expect(r.findings).toEqual([]);
  });

  it("flags drift as blocking when the body is mutated after a checksum is stamped", () => {
    const pageFile = emitFreshPage(project, "billing");
    const original = fs.readFileSync(pageFile, "utf8");
    // Tamper with the body: rename a requirement text. Keep frontmatter intact.
    const tampered = original.replace(
      "MUST do thing.",
      "MUST do thing — UNAUTHORIZED EDIT.",
    );
    expect(tampered).not.toBe(original);
    fs.writeFileSync(pageFile, tampered);

    const r = validateContractPageDrift(pageFile, { rootDir: project });
    const blocking = r.findings.filter((f) => f.severity === "blocking");
    expect(blocking.length).toBeGreaterThan(0);
    expect(blocking[0].ruleId).toBe("contract-page-drift/checksum-mismatch");
    expect(blocking[0].message).toContain("/loom-change");
  });

  it("emits an info-severity skip when contentChecksum is missing (legacy page)", () => {
    // Hand-roll a page that lacks contentChecksum entirely.
    const dir = pagesDir(project);
    fs.mkdirSync(dir, { recursive: true });
    const pageFile = path.join(dir, "contract-legacy.md");
    fs.writeFileSync(
      pageFile,
      [
        "```toon",
        "pageId: contract-legacy",
        "title: Legacy",
        "category: contract",
        "domain: legacy",
        "summary: legacy contract",
        // no contentChecksum line
        "```",
        "",
        "# Legacy",
        "",
        "## Purpose",
        "Legacy page imported before Phase 7.",
        "",
      ].join("\n"),
    );

    const r = validateContractPageDrift(pageFile, { rootDir: project });
    expect(r.findings.length).toBe(1);
    expect(r.findings[0].severity).toBe("info");
    expect(r.findings[0].ruleId).toBe("contract-page-drift/no-checksum");
  });

  it("the canonical-body algorithm is stable — identical bodies produce identical checksums", () => {
    const a = ["```toon", "pageId: contract-x", "domain: x", "```", "", "# X", "", "## Purpose", "Same body.", ""].join("\n");
    const b = a; // trivial duplicate
    expect(canonicalBodyChecksumFromPage(a)).toBe(canonicalBodyChecksumFromPage(b));
  });

  it("the canonical-body algorithm ignores frontmatter changes (drift validator only watches the body)", () => {
    const baseBody = ["", "# X", "", "## Purpose", "Same body content.", ""].join("\n");
    const front1 = ["```toon", "pageId: contract-x", "domain: x", "summary: alpha", "```"].join("\n");
    const front2 = ["```toon", "pageId: contract-x", "domain: x", "summary: BETA — totally different", "```"].join("\n");
    const fileA = `${front1}\n${baseBody}`;
    const fileB = `${front2}\n${baseBody}`;
    expect(canonicalBodyChecksumFromPage(fileA)).toBe(canonicalBodyChecksumFromPage(fileB));
  });

  it("emits a recovery plan when the History indicates a missing requirement (recovery candidate)", () => {
    // Build a page whose History claims R-03 was added, but R-03 is missing
    // from ## Requirements. Stamp a checksum that won't match anyway so the
    // drift validator fires AND surfaces the recovery plan.
    const dir = pagesDir(project);
    fs.mkdirSync(dir, { recursive: true });
    const pageFile = path.join(dir, "contract-billing.md");
    const body = [
      "",
      "# Billing",
      "",
      "## Purpose",
      "Billing purpose.",
      "",
      "## Requirements",
      "**R-01** *(functional)* — MUST do A.",
      "",
      "**R-02** *(functional)* — MUST do B.",
      "",
      "## Scenarios",
      "no scenarios",
      "",
      "## Entities",
      "no entities",
      "",
      "## Out of Scope",
      "nothing",
      "",
      "## History",
      "### chg-20260520-add-r03 — 2026-05-20",
      "",
      "**Rationale:** Added R-03 per request.",
      "**Deltas:** added R-03",
      "**Breaking:** false",
      "",
    ].join("\n");
    const content = [
      "```toon",
      "pageId: contract-billing",
      "title: Billing",
      "category: contract",
      "domain: billing",
      "summary: billing contract",
      "contractVersion: 1",
      "contractStatus: active",
      "sourceChanges[1]: chg-20260520-add-r03",
      "deprecatedAt:",
      "replacedBy:",
      // Intentionally wrong checksum so drift fires.
      "contentChecksum: sha256:deadbeef0000000000000000000000000000000000000000000000000000beef",
      "```",
      body,
    ].join("\n");
    fs.writeFileSync(pageFile, content);

    const r = validateContractPageDrift(pageFile, { rootDir: project });
    const blocking = r.findings.find((f) => f.severity === "blocking");
    expect(blocking).toBeDefined();
    expect(blocking?.recoveryPlan).not.toBeNull();
    expect(blocking?.recoveryPlan?.candidateChangeId).toBe("chg-20260520-add-r03");
    expect(blocking?.recoveryPlan?.missingRequirementIds).toContain("R-03");
    // The message should suggest /loom-change recover {changeId}.
    expect(blocking?.message).toContain("/loom-change recover chg-20260520-add-r03");
  });

  it("returns null recoveryPlan when drift is detected but no missing IDs (manual edit, not partial archive)", () => {
    const pageFile = emitFreshPage(project, "billing");
    // Replace a requirement's text in place — same IDs, different body.
    const raw = fs.readFileSync(pageFile, "utf8");
    fs.writeFileSync(pageFile, raw.replace("MUST do thing.", "MUST do thing differently."));
    const r = validateContractPageDrift(pageFile, { rootDir: project });
    const blocking = r.findings.find((f) => f.severity === "blocking");
    expect(blocking).toBeDefined();
    // No missing IDs — heuristic gives a null candidate but still emits the plan structure.
    expect(blocking?.recoveryPlan?.candidateChangeId).toBeNull();
    expect(blocking?.message).toContain("/loom-change init");
  });
});
