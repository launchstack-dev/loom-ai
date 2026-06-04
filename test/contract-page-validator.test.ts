/**
 * Tests for hooks/lib/spec-validators/contract-page.ts (Phase 7).
 *
 * Each test writes a minimal `contract-{domain}.md` page directly (we craft
 * the body shape to cover the rules we want), then runs the validator and
 * asserts the expected findings.
 *
 * We bypass writeContractPage for the negative cases because the writer
 * always emits the 6 required sections in canonical order — exactly the
 * shape we need to break for these tests.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  validateContractPage,
  REQUIRED_CONTRACT_BODY_SECTIONS,
} from "../hooks/lib/spec-validators/contract-page.js";
import { writeContractPage } from "../hooks/lib/contract-page-writer.js";

const FIXED_NOW_ISO = "2026-05-23T12:00:00Z";

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "contract-page-validator-"));
}

interface PageSpec {
  pageId: string;
  domain: string;
  /** Body sections in declared order. If omitted, all 6 required sections in order. */
  sections?: Array<{ heading: string; body: string }>;
  sourceChanges?: string[];
  contentChecksum?: string;
  replacedBy?: string | null;
}

function writeRawContractPage(project: string, spec: PageSpec): string {
  const wikiRoot = path.join(project, ".loom", "wiki");
  const pagesDir = path.join(wikiRoot, "pages");
  fs.mkdirSync(pagesDir, { recursive: true });
  const pageFile = path.join(pagesDir, `${spec.pageId}.md`);

  const sections =
    spec.sections ??
    REQUIRED_CONTRACT_BODY_SECTIONS.map((heading) => ({
      heading,
      body: `${heading} body content.`,
    }));

  const sourceChanges = spec.sourceChanges ?? [];
  const replacedByLine =
    spec.replacedBy && spec.replacedBy.length > 0
      ? `replacedBy: ${spec.replacedBy}`
      : `replacedBy:`;
  const checksumLine = spec.contentChecksum
    ? `contentChecksum: ${spec.contentChecksum}`
    : `contentChecksum: sha256:0000000000000000000000000000000000000000000000000000000000000000`;

  const fm = [
    "```toon",
    `pageId: ${spec.pageId}`,
    `title: ${spec.domain}`,
    `category: contract`,
    `subtype:`,
    `domain: ${spec.domain}`,
    `summary: ${spec.domain} contract`,
    `bodySections[${sections.length}]: ${sections.map((s) => s.heading).join(", ")}`,
    `contractVersion: 1`,
    `contractStatus: active`,
    sourceChanges.length === 0
      ? `sourceChanges[0]:`
      : `sourceChanges[${sourceChanges.length}]: ${sourceChanges.join(", ")}`,
    `deprecatedAt:`,
    replacedByLine,
    checksumLine,
    `createdAt: ${FIXED_NOW_ISO}`,
    `updatedAt: ${FIXED_NOW_ISO}`,
    `createdBy: test`,
    `updatedBy: test`,
    `sourceRefs[0]:`,
    `crossRefs[0]:`,
    `tags[0]:`,
    `staleness: fresh`,
    `confidence: high`,
    `estimatedTokens: 100`,
    "```",
  ];

  const body: string[] = ["", `# ${spec.domain}`, ""];
  for (const s of sections) {
    body.push(`## ${s.heading}`);
    body.push(s.body);
    body.push("");
  }

  fs.writeFileSync(pageFile, [...fm, ...body].join("\n"));
  return pageFile;
}

// ---------------------------------------------------------------------------

describe("validateContractPage", () => {
  let project: string;
  beforeEach(() => {
    project = mkTempProject();
  });

  it("passes when all 6 required sections are present in order", () => {
    const pageFile = writeRawContractPage(project, {
      pageId: "contract-billing",
      domain: "billing",
    });
    const r = validateContractPage(pageFile, { rootDir: project });
    const blocking = r.findings.filter((f) => f.severity === "blocking");
    expect(blocking).toEqual([]);
  });

  it("flags a missing required section as blocking", () => {
    const pageFile = writeRawContractPage(project, {
      pageId: "contract-billing",
      domain: "billing",
      sections: [
        { heading: "Purpose", body: "Purpose body" },
        { heading: "Requirements", body: "Requirements body" },
        // Scenarios missing.
        { heading: "Entities", body: "Entities body" },
        { heading: "Out of Scope", body: "Out of Scope body" },
        { heading: "History", body: "History body" },
      ],
    });
    const r = validateContractPage(pageFile, { rootDir: project });
    expect(
      r.findings.some(
        (f) => f.severity === "blocking" && f.ruleId === "contract-page/section-missing" && f.message.includes("Scenarios")
      )
    ).toBe(true);
  });

  it("flags out-of-order sections as blocking", () => {
    const pageFile = writeRawContractPage(project, {
      pageId: "contract-billing",
      domain: "billing",
      sections: [
        { heading: "Requirements", body: "Reqs first — wrong order!" },
        { heading: "Purpose", body: "Purpose second" },
        { heading: "Scenarios", body: "Scenarios body" },
        { heading: "Entities", body: "Entities body" },
        { heading: "Out of Scope", body: "Out of Scope body" },
        { heading: "History", body: "History body" },
      ],
    });
    const r = validateContractPage(pageFile, { rootDir: project });
    expect(
      r.findings.some(
        (f) =>
          f.severity === "blocking" && f.ruleId === "contract-page/section-out-of-order"
      )
    ).toBe(true);
  });

  it("flags duplicate R-NN IDs within ## Requirements as blocking", () => {
    const pageFile = writeRawContractPage(project, {
      pageId: "contract-billing",
      domain: "billing",
      sections: [
        { heading: "Purpose", body: "Purpose" },
        {
          heading: "Requirements",
          body:
            "**R-01** *(functional)* — first requirement.\n\n" +
            "**R-01** *(functional)* — duplicate ID!\n",
        },
        { heading: "Scenarios", body: "Scenarios" },
        { heading: "Entities", body: "Entities" },
        { heading: "Out of Scope", body: "Out of Scope" },
        { heading: "History", body: "History" },
      ],
    });
    const r = validateContractPage(pageFile, { rootDir: project });
    expect(
      r.findings.some(
        (f) =>
          f.severity === "blocking" &&
          f.ruleId === "contract-page/requirement-duplicate" &&
          f.message.includes("R-01")
      )
    ).toBe(true);
  });

  it("flags History entries out of chronological order as blocking", () => {
    const pageFile = writeRawContractPage(project, {
      pageId: "contract-billing",
      domain: "billing",
      sourceChanges: ["chg-20260520-first", "chg-20260515-second"],
      sections: [
        { heading: "Purpose", body: "Purpose" },
        { heading: "Requirements", body: "Requirements" },
        { heading: "Scenarios", body: "Scenarios" },
        { heading: "Entities", body: "Entities" },
        { heading: "Out of Scope", body: "Out of Scope" },
        {
          heading: "History",
          body:
            "### chg-20260520-first — 2026-05-20\n\n" +
            "**Rationale:** First change\n" +
            "**Deltas:** added R-01\n" +
            "**Breaking:** false\n\n" +
            "### chg-20260515-second — 2026-05-15\n\n" +
            "**Rationale:** Backwards-dated change!\n" +
            "**Deltas:** added R-02\n" +
            "**Breaking:** false\n",
        },
      ],
    });
    const r = validateContractPage(pageFile, { rootDir: project });
    expect(
      r.findings.some(
        (f) => f.severity === "blocking" && f.ruleId === "contract-page/history-backwards"
      )
    ).toBe(true);
  });

  it("flags sourceChanges[] length mismatch with History entries", () => {
    const pageFile = writeRawContractPage(project, {
      pageId: "contract-billing",
      domain: "billing",
      sourceChanges: ["chg-20260520-only-one"],
      sections: [
        { heading: "Purpose", body: "Purpose" },
        { heading: "Requirements", body: "Requirements" },
        { heading: "Scenarios", body: "Scenarios" },
        { heading: "Entities", body: "Entities" },
        { heading: "Out of Scope", body: "Out of Scope" },
        {
          heading: "History",
          body:
            "### chg-20260520-only-one — 2026-05-20\n\n" +
            "**Rationale:** First\n" +
            "**Deltas:** added R-01\n" +
            "**Breaking:** false\n\n" +
            "### chg-20260521-extra — 2026-05-21\n\n" +
            "**Rationale:** Second\n" +
            "**Deltas:** added R-02\n" +
            "**Breaking:** false\n",
        },
      ],
    });
    const r = validateContractPage(pageFile, { rootDir: project });
    expect(
      r.findings.some(
        (f) =>
          f.severity === "blocking" &&
          f.ruleId === "contract-page/history-source-changes-mismatch"
      )
    ).toBe(true);
  });

  it("flags sourceChanges[] order mismatch with History entries", () => {
    const pageFile = writeRawContractPage(project, {
      pageId: "contract-billing",
      domain: "billing",
      sourceChanges: ["chg-20260520-second", "chg-20260519-first"],
      sections: [
        { heading: "Purpose", body: "Purpose" },
        { heading: "Requirements", body: "Requirements" },
        { heading: "Scenarios", body: "Scenarios" },
        { heading: "Entities", body: "Entities" },
        { heading: "Out of Scope", body: "Out of Scope" },
        {
          heading: "History",
          body:
            "### chg-20260519-first — 2026-05-19\n\n" +
            "**Rationale:** R1\n" +
            "**Deltas:** added R-01\n" +
            "**Breaking:** false\n\n" +
            "### chg-20260520-second — 2026-05-20\n\n" +
            "**Rationale:** R2\n" +
            "**Deltas:** added R-02\n" +
            "**Breaking:** false\n",
        },
      ],
    });
    const r = validateContractPage(pageFile, { rootDir: project });
    expect(
      r.findings.some(
        (f) =>
          f.severity === "blocking" &&
          f.ruleId === "contract-page/history-source-changes-mismatch"
      )
    ).toBe(true);
  });

  it("flags replacedBy dangling reference as blocking", () => {
    const pageFile = writeRawContractPage(project, {
      pageId: "contract-billing",
      domain: "billing",
      replacedBy: "contract-nonexistent",
    });
    const r = validateContractPage(pageFile, { rootDir: project });
    expect(
      r.findings.some(
        (f) =>
          f.severity === "blocking" &&
          f.ruleId === "contract-page/replaced-by-dangling" &&
          f.message.includes("contract-nonexistent")
      )
    ).toBe(true);
  });

  it("passes when replacedBy resolves to an existing contract page", () => {
    // Seed the successor page first.
    writeRawContractPage(project, {
      pageId: "contract-billing-v2",
      domain: "billing-v2",
    });
    const pageFile = writeRawContractPage(project, {
      pageId: "contract-billing",
      domain: "billing",
      replacedBy: "contract-billing-v2",
    });
    const r = validateContractPage(pageFile, { rootDir: project });
    const blocking = r.findings.filter((f) => f.severity === "blocking");
    expect(blocking).toEqual([]);
  });

  it("treats a writer-emitted page as structurally valid (round-trip)", () => {
    const wikiRoot = path.join(project, ".loom", "wiki");
    writeContractPage(wikiRoot, {
      domain: "customer",
      title: "Customer",
      summary: "customer contract",
      purpose: "Customer purpose.",
      requirements: [
        { id: "R-01", requirementType: "functional", text: "MUST have email." },
      ],
      scenarios: [],
      entities: [],
      outOfScope: ["something out of scope"],
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
    const pageFile = path.join(wikiRoot, "pages", "contract-customer.md");
    const r = validateContractPage(pageFile, { rootDir: project });
    const blocking = r.findings.filter((f) => f.severity === "blocking");
    expect(blocking).toEqual([]);
  });
});
