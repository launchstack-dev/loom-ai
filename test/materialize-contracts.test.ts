/**
 * Tests for the Phase 4 contract-page materializer.
 *
 * Covers acceptance criteria from PLAN-spec-upgrades.md Phase 4:
 *   - Emits one contract-{domain}.md per partition entry with category=contract
 *     and lifecycle frontmatter.
 *   - Empty scenarios → placeholder + warning.
 *   - Idempotency: re-running against unchanged inputs is byte-identical.
 *   - Multi-domain emission.
 *   - Wiki index integration (pages array, categories[], wikiVersion bump).
 *   - --dry-run produces a plan without writing.
 *   - Missing partition manifest fails with a clear "run --propose-partition first" message.
 *   - --propose-partition scaffolds a manifest from entity discovery.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  materializeContracts,
  proposePartition,
  parsePartitionManifest,
} from "../scripts/materialize-contracts.js";
import { canonicalBodyChecksumFromPage } from "../hooks/lib/checksum.js";

const FIXED_NOW = new Date("2026-05-23T12:00:00Z");

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "materialize-contracts-"));
}

function copyFixture(target: string): void {
  const src = path.resolve(__dirname, "..", "test-fixtures", "contract-pages", "example");
  copyDirRecursive(src, target);
}

function copyDirRecursive(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDirRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

describe("materializeContracts — example fixture", () => {
  let project: string;

  beforeEach(() => {
    project = mkTempProject();
    copyFixture(project);
  });

  it("emits one contract page per partition entry with lifecycle frontmatter", () => {
    const result = materializeContracts({ cwd: project, now: FIXED_NOW });

    expect(result.pages).toHaveLength(2);
    const pageIds = result.pages.map((p) => p.pageId).sort();
    expect(pageIds).toEqual(["contract-billing", "contract-customer"]);

    for (const page of result.pages) {
      const content = fs.readFileSync(page.pageFile, "utf8");
      expect(content).toMatch(/category: contract/);
      expect(content).toMatch(/contractVersion: 1/);
      expect(content).toMatch(/contractStatus: active/);
      expect(content).toMatch(/sourceChanges\[0\]:/);
      expect(content).toMatch(/deprecatedAt:\s*$/m);
      expect(content).toMatch(/replacedBy:\s*$/m);
      expect(content).toMatch(/contentChecksum: sha256:[0-9a-f]{64}/);
      // All 6 required body sections present in order.
      expect(content).toMatch(/## Purpose[\s\S]*## Requirements[\s\S]*## Scenarios[\s\S]*## Entities[\s\S]*## Out of Scope[\s\S]*## History/);
    }
  });

  it("is idempotent — re-running with the same `now` produces byte-identical output", () => {
    materializeContracts({ cwd: project, now: FIXED_NOW });
    const billingFirst = fs.readFileSync(
      path.join(project, ".loom", "wiki", "pages", "contract-billing.md"),
      "utf8"
    );
    const indexFirst = fs.readFileSync(
      path.join(project, ".loom", "wiki", "index.toon"),
      "utf8"
    );

    // Capture wikiVersion from first run.
    const versionMatch = /wikiVersion:\s*(\d+)/.exec(indexFirst);
    expect(versionMatch).not.toBeNull();

    materializeContracts({ cwd: project, now: FIXED_NOW });
    const billingSecond = fs.readFileSync(
      path.join(project, ".loom", "wiki", "pages", "contract-billing.md"),
      "utf8"
    );
    expect(billingSecond).toBe(billingFirst);

    // Wiki index is technically not byte-identical because wikiVersion bumps
    // on every write — but the pages[] body must match. Verify pages content
    // by stripping the dynamic header.
    const stripHeader = (raw: string): string =>
      raw.replace(/wikiVersion:\s*\d+/g, "wikiVersion: X").replace(/lastUpdated:.*$/m, "lastUpdated: X");
    const indexSecond = fs.readFileSync(
      path.join(project, ".loom", "wiki", "index.toon"),
      "utf8"
    );
    expect(stripHeader(indexSecond)).toBe(stripHeader(indexFirst));
  });

  it("populates wiki index pages[] and categories[] with the new contract rows", () => {
    materializeContracts({ cwd: project, now: FIXED_NOW, projectName: "billing-sample" });
    const indexRaw = fs.readFileSync(
      path.join(project, ".loom", "wiki", "index.toon"),
      "utf8"
    );

    expect(indexRaw).toMatch(/schemaVersion: 2/);
    expect(indexRaw).toMatch(/projectName: billing-sample/);
    expect(indexRaw).toMatch(/pageCount: 2/);
    expect(indexRaw).toMatch(/wikiVersion: 1/);

    expect(indexRaw).toMatch(/contract-billing,Billing,contract,,/);
    expect(indexRaw).toMatch(/contract-customer,Customer,contract,,/);
    expect(indexRaw).toMatch(/categories\[1\]\{name,count\}:\n  contract,2/);
  });

  it("computes a stable contentChecksum that matches a fresh recomputation from the file body", () => {
    const result = materializeContracts({ cwd: project, now: FIXED_NOW });
    for (const page of result.pages) {
      const raw = fs.readFileSync(page.pageFile, "utf8");
      const recomputed = canonicalBodyChecksumFromPage(raw);
      expect(recomputed).toBe(page.contentChecksum);
    }
  });

  it("dry-run mode does not write pages or update the wiki index", () => {
    const wikiPages = path.join(project, ".loom", "wiki", "pages");
    const result = materializeContracts({ cwd: project, now: FIXED_NOW, dryRun: true });

    expect(result.pages).toHaveLength(0);
    expect(result.wikiIndex).toBeNull();
    expect(result.plan).toHaveLength(2);
    expect(fs.existsSync(wikiPages)).toBe(false);
    expect(fs.existsSync(path.join(project, ".loom", "wiki", "index.toon"))).toBe(false);
  });
});

describe("materializeContracts — empty-scenarios fallback", () => {
  it("emits the Scenarios placeholder and logs a warning when sources have no scenarios", () => {
    const project = mkTempProject();
    fs.mkdirSync(path.join(project, ".loom", "wiki"), { recursive: true });

    // Minimal PLAN.md with no scenarios.
    fs.writeFileSync(
      path.join(project, "PLAN.md"),
      [
        "---",
        "planVersion: 1",
        "name: Empty Plan",
        "status: completed",
        "created: 2026-05-23",
        "lastReviewed: 2026-05-23",
        "roadmapRef: null",
        "totalPhases: 1",
        "totalWaves: 1",
        "---",
        "# Plan: Empty Plan",
        "## Overview",
        "Empty test case.",
        "## Tech Stack",
        "- TypeScript",
        "## Schema / Type Definitions",
        "### Widget",
        "| Field | Type | Constraints |",
        "|-------|------|-------------|",
        "| id | string | UUID |",
        "## Execution Phases",
        "### Phase 0 — Wave 0: Contracts",
        "**Agent:** contracts-agent",
        "**Objective:** Create types.",
        "**Dependencies:** None",
        "**File Ownership:** .plan-execution/contracts/**",
        "#### Deliverables",
        "| File | Action | Owner hint |",
        "|------|--------|------------|",
        "| types.ts | Create | contracts-agent |",
        "#### Acceptance Criteria",
        "- [ ] Widget MUST have a unique id",
        "## Verification Commands",
        "```bash",
        "npx tsc --noEmit",
        "```",
      ].join("\n")
    );

    fs.writeFileSync(
      path.join(project, ".loom", "wiki", "contract-partition.toon"),
      [
        "manifestVersion: 1",
        "generatedAt: 2026-05-23T12:00:00Z",
        "generatedBy: human:test",
        "sourceRoadmap:",
        "sourcePlans[1]: PLAN.md",
        "partitions[1]{domain,entities,description}:",
        '  widget,"Widget",Single-entity test partition',
        "unassignedEntities[0]:",
        "notes:",
        "",
      ].join("\n")
    );

    const result = materializeContracts({ cwd: project, now: FIXED_NOW });
    expect(result.pages).toHaveLength(1);
    const widgetPage = fs.readFileSync(result.pages[0].pageFile, "utf8");
    expect(widgetPage).toContain(
      "<!-- no scenarios found — re-run after upgrading to planVersion: 2 -->"
    );
    expect(result.warnings.some((w) => w.includes("contract-widget"))).toBe(true);
  });
});

describe("materializeContracts — preconditions", () => {
  it("fails non-zero with a clear message when the partition manifest is missing", () => {
    const project = mkTempProject();
    fs.writeFileSync(path.join(project, "PLAN.md"), "# Empty\n");
    expect(() => materializeContracts({ cwd: project, now: FIXED_NOW })).toThrow(
      /partition manifest not found.*--propose-partition/s
    );
  });

  it("rejects a partition with overlapping entities across domains", () => {
    const project = mkTempProject();
    copyFixture(project);

    // Inject a malformed partition with duplicate entity.
    fs.writeFileSync(
      path.join(project, ".loom", "wiki", "contract-partition.toon"),
      [
        "manifestVersion: 1",
        "generatedAt: 2026-05-23T12:00:00Z",
        "generatedBy: human:test",
        "sourceRoadmap: ROADMAP.md",
        "sourcePlans[1]: PLAN.md",
        "partitions[2]{domain,entities,description}:",
        '  billing,"Invoice,Shared",Billing domain',
        '  customer,"Customer,Shared",Customer domain',
        "unassignedEntities[0]:",
        "notes:",
        "",
      ].join("\n")
    );

    expect(() => materializeContracts({ cwd: project, now: FIXED_NOW })).toThrow(
      /entity "Shared" appears in multiple partitions/
    );
  });

  it("rejects a partition with a non-kebab-case domain", () => {
    const project = mkTempProject();
    copyFixture(project);

    fs.writeFileSync(
      path.join(project, ".loom", "wiki", "contract-partition.toon"),
      [
        "manifestVersion: 1",
        "generatedAt: 2026-05-23T12:00:00Z",
        "generatedBy: human:test",
        "sourceRoadmap: ROADMAP.md",
        "sourcePlans[1]: PLAN.md",
        "partitions[1]{domain,entities,description}:",
        '  BadDomain,"Invoice",Domain in PascalCase is invalid',
        "unassignedEntities[0]:",
        "notes:",
        "",
      ].join("\n")
    );

    expect(() => materializeContracts({ cwd: project, now: FIXED_NOW })).toThrow(
      /is not kebab-case/
    );
  });
});

describe("proposePartition", () => {
  it("scaffolds a manifest from entities discovered in the plan", () => {
    const project = mkTempProject();
    copyFixture(project);

    // Remove the seeded partition so propose can run.
    fs.unlinkSync(path.join(project, ".loom", "wiki", "contract-partition.toon"));

    const result = proposePartition({ cwd: project, now: FIXED_NOW });
    expect(result.entityCount).toBeGreaterThanOrEqual(2);
    expect(fs.existsSync(result.partitionFile)).toBe(true);

    const raw = fs.readFileSync(result.partitionFile, "utf8");
    expect(raw).toMatch(/manifestVersion: 1/);
    expect(raw).toMatch(/partitions\[1\]\{domain,entities,description\}:/);
    expect(raw).toContain("default,");
    expect(raw).toContain("Invoice");
    expect(raw).toContain("Customer");

    // The scaffolded manifest must parse cleanly via the same parser used by
    // the materializer at runtime.
    const parsed = parsePartitionManifest(raw);
    expect(parsed.manifestVersion).toBe(1);
    expect(parsed.partitions).toHaveLength(1);
    expect(parsed.partitions[0].entities.length).toBeGreaterThanOrEqual(2);
  });

  it("refuses to overwrite an existing partition manifest", () => {
    const project = mkTempProject();
    copyFixture(project);

    expect(() => proposePartition({ cwd: project, now: FIXED_NOW })).toThrow(
      /partition manifest already exists/
    );
  });
});

describe("parsePartitionManifest", () => {
  it("round-trips the example fixture's manifest", () => {
    const raw = fs.readFileSync(
      path.resolve(
        __dirname,
        "..",
        "test-fixtures",
        "contract-pages",
        "example",
        ".loom",
        "wiki",
        "contract-partition.toon"
      ),
      "utf8"
    );
    const parsed = parsePartitionManifest(raw);
    expect(parsed.manifestVersion).toBe(1);
    expect(parsed.sourceRoadmap).toBe("ROADMAP.md");
    expect(parsed.sourcePlans).toEqual(["PLAN.md"]);
    expect(parsed.partitions.map((p) => p.domain).sort()).toEqual(["billing", "customer"]);
    expect(parsed.partitions.find((p) => p.domain === "billing")?.entities).toEqual(["Invoice"]);
    expect(parsed.partitions.find((p) => p.domain === "customer")?.entities).toEqual(["Customer"]);
  });
});
