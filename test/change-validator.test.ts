/**
 * Tests for hooks/lib/spec-validators/change-proposal.ts (Phase 7).
 *
 * Each test seeds a tiny project under tmp with:
 *   - .loom/wiki/pages/contract-{domain}.md (via the writer where possible,
 *     or by hand-rolled minimal fixture for "no such page" cases)
 *   - .loom/changes/{changeId}/proposal.md (frontmatter + ## Deltas body)
 *   - .loom/changes/{changeId}/deltas.toon (mirror)
 *
 * Then runs `validateChangeProposal` and asserts the expected findings.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { validateChangeProposal } from "../hooks/lib/spec-validators/change-proposal.js";
import { writeContractPage } from "../hooks/lib/contract-page-writer.js";

const FIXED_NOW_ISO = "2026-05-23T12:00:00Z";

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "change-validator-"));
}

function seedContractPage(args: {
  project: string;
  domain: string;
  requirements?: Array<{ id: string; text: string }>;
}): void {
  const wikiRoot = path.join(args.project, ".loom", "wiki");
  fs.mkdirSync(path.join(wikiRoot, "pages"), { recursive: true });
  writeContractPage(wikiRoot, {
    domain: args.domain,
    title: args.domain.charAt(0).toUpperCase() + args.domain.slice(1),
    summary: `${args.domain} contract`,
    purpose: `Domain ${args.domain} purpose.`,
    requirements: (args.requirements ?? [
      { id: "R-01", text: "The system MUST do thing one." },
      { id: "R-02", text: "The system MUST do thing two." },
    ]).map((r) => ({
      id: r.id,
      requirementType: "functional" as const,
      text: r.text,
    })),
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
}

interface ProposalSpec {
  changeId: string;
  affectedSpecs: string[];
  scope?: { included: string[]; excluded: string[] };
  linkedPlan?: string | null;
  deltaBlocks?: DeltaBlockSpec[];
  /** Override the deltas.toon mirror; default = generated from deltaBlocks. */
  mirrorOverride?: string;
}

interface DeltaBlockSpec {
  domain: string;
  addedRequirements?: string[];
  modifiedRequirements?: Array<{ id: string; before: string; after: string }>;
  removedRequirements?: string[];
  breakingChange?: boolean;
  migrationNote?: string | null;
  rationale?: string;
}

function seedProposal(project: string, spec: ProposalSpec): void {
  const changeDir = path.join(project, ".loom", "changes", spec.changeId);
  fs.mkdirSync(changeDir, { recursive: true });

  const scope = spec.scope ?? {
    included: ["thing in scope"],
    excluded: ["thing out of scope"],
  };
  const deltaBlocks = spec.deltaBlocks ?? [];
  const linkedPlanLine =
    spec.linkedPlan === undefined
      ? "linkedPlan:"
      : spec.linkedPlan === null
        ? "linkedPlan:"
        : `linkedPlan: ${spec.linkedPlan}`;

  const frontmatter = [
    "```toon",
    `changeId: ${spec.changeId}`,
    `status: proposed`,
    `intent: Test change for validator unit tests; populated by seedProposal.`,
    `scope:`,
    `  included[${scope.included.length}]: ${scope.included.join(", ")}`,
    `  excluded[${scope.excluded.length}]: ${scope.excluded.join(", ")}`,
    `approach: Approach text.`,
    `affectedSpecs[${spec.affectedSpecs.length}]: ${spec.affectedSpecs.join(", ")}`,
    linkedPlanLine,
    `reviewedBy:`,
    `reviewedAt:`,
    `reviewNotes:`,
    `approvedBy:`,
    `approvedAt:`,
    `createdAt: ${FIXED_NOW_ISO}`,
    `archivedAt:`,
    "```",
  ];

  const body: string[] = [
    "",
    `# Change Proposal: Test`,
    "",
    "## Intent",
    "Test intent.",
    "",
    "## Scope",
    "Test scope.",
    "",
    "## Approach",
    "Test approach.",
    "",
    "## Deltas",
    "",
  ];

  for (const d of deltaBlocks) {
    const added = d.addedRequirements ?? [];
    const modified = d.modifiedRequirements ?? [];
    const removed = d.removedRequirements ?? [];
    const breaking = d.breakingChange ?? false;
    const migrationNoteRaw = d.migrationNote ?? null;
    const migrationNoteLine =
      migrationNoteRaw === null ? "migrationNote:" : `migrationNote: ${migrationNoteRaw}`;
    const rationale =
      d.rationale ?? "Rationale text long enough to clear the 30 character minimum.";

    body.push(`### ${d.domain}`);
    body.push("");
    body.push("```toon");
    body.push(`domain: ${d.domain}`);
    if (added.length === 0) {
      body.push("addedRequirements[0]:");
    } else {
      body.push(`addedRequirements[${added.length}]: ${added.join(", ")}`);
    }
    body.push(`modifiedRequirements[${modified.length}]{id,before,after}:`);
    for (const m of modified) {
      body.push(`  ${m.id},${m.before},${m.after}`);
    }
    if (removed.length === 0) {
      body.push("removedRequirements[0]:");
    } else {
      body.push(`removedRequirements[${removed.length}]: ${removed.join(", ")}`);
    }
    body.push("addedScenarios[0]:");
    body.push("modifiedScenarios[0]{id,before,after}:");
    body.push("removedScenarios[0]:");
    body.push(`breakingChange: ${breaking ? "true" : "false"}`);
    body.push(migrationNoteLine);
    body.push(`rationale: ${rationale}`);
    body.push("```");
    body.push("");
  }
  body.push("## Rationale");
  body.push("Combined rationale.");
  body.push("");

  fs.writeFileSync(path.join(changeDir, "proposal.md"), [...frontmatter, ...body].join("\n"));

  // Generate the deltas.toon mirror in sync with the body (unless overridden).
  const mirrorContent =
    spec.mirrorOverride ??
    (deltaBlocks.length === 0
      ? "deltas[0]{domain,breakingChange,addedReqCount,modifiedReqCount,removedReqCount,addedScenarioCount,modifiedScenarioCount,removedScenarioCount}:\n"
      : [
          `deltas[${deltaBlocks.length}]{domain,breakingChange,addedReqCount,modifiedReqCount,removedReqCount,addedScenarioCount,modifiedScenarioCount,removedScenarioCount}:`,
          ...deltaBlocks.map((d) =>
            `  ${d.domain},${(d.breakingChange ?? false) ? "true" : "false"},` +
            `${(d.addedRequirements ?? []).length},` +
            `${(d.modifiedRequirements ?? []).length},` +
            `${(d.removedRequirements ?? []).length},0,0,0`
          ),
          "",
        ].join("\n"));
  fs.writeFileSync(path.join(changeDir, "deltas.toon"), mirrorContent);
}

// ---------------------------------------------------------------------------

describe("validateChangeProposal", () => {
  let project: string;
  beforeEach(() => {
    project = mkTempProject();
  });

  it("flags empty scope.included as blocking", () => {
    seedContractPage({ project, domain: "billing" });
    seedProposal(project, {
      changeId: "chg-20260523-empty-included",
      affectedSpecs: ["billing"],
      scope: { included: [], excluded: ["excluded thing"] },
      deltaBlocks: [
        {
          domain: "billing",
          addedRequirements: ["The system MUST add behavior X."],
        },
      ],
    });

    const r = validateChangeProposal("chg-20260523-empty-included", { rootDir: project });
    const blocking = r.findings.filter((f) => f.severity === "blocking");
    expect(blocking.length).toBeGreaterThan(0);
    expect(blocking.some((f) => f.ruleId === "change-proposal/scope-included-empty")).toBe(true);
  });

  it("flags empty scope.excluded as blocking", () => {
    seedContractPage({ project, domain: "billing" });
    seedProposal(project, {
      changeId: "chg-20260523-empty-excluded",
      affectedSpecs: ["billing"],
      scope: { included: ["included thing"], excluded: [] },
      deltaBlocks: [
        {
          domain: "billing",
          addedRequirements: ["The system MUST add behavior."],
        },
      ],
    });

    const r = validateChangeProposal("chg-20260523-empty-excluded", { rootDir: project });
    expect(
      r.findings.some(
        (f) => f.severity === "blocking" && f.ruleId === "change-proposal/scope-excluded-empty"
      )
    ).toBe(true);
  });

  it("flags affectedSpec that does not resolve to a contract page", () => {
    // No contract page seeded for `nonexistent`.
    seedProposal(project, {
      changeId: "chg-20260523-no-such-spec",
      affectedSpecs: ["nonexistent"],
      deltaBlocks: [
        {
          domain: "nonexistent",
          addedRequirements: ["The system MUST do something."],
        },
      ],
    });

    const r = validateChangeProposal("chg-20260523-no-such-spec", { rootDir: project });
    expect(
      r.findings.some(
        (f) =>
          f.severity === "blocking" &&
          f.ruleId === "change-proposal/affected-spec-unresolved" &&
          f.domain === "nonexistent"
      )
    ).toBe(true);
  });

  it("flags modifiedRequirements.id that does not exist on the target page", () => {
    seedContractPage({
      project,
      domain: "billing",
      requirements: [{ id: "R-01", text: "Original requirement." }],
    });
    seedProposal(project, {
      changeId: "chg-20260523-modify-missing-id",
      affectedSpecs: ["billing"],
      deltaBlocks: [
        {
          domain: "billing",
          modifiedRequirements: [
            { id: "R-99", before: "anything", after: "anything else" },
          ],
        },
      ],
    });

    const r = validateChangeProposal("chg-20260523-modify-missing-id", { rootDir: project });
    expect(
      r.findings.some(
        (f) =>
          f.severity === "blocking" &&
          f.ruleId === "change-proposal/requirement-not-found" &&
          f.message.includes("R-99")
      )
    ).toBe(true);
  });

  it("flags removedRequirements that do not exist on the target page", () => {
    seedContractPage({
      project,
      domain: "billing",
      requirements: [{ id: "R-01", text: "Real requirement." }],
    });
    seedProposal(project, {
      changeId: "chg-20260523-remove-missing-id",
      affectedSpecs: ["billing"],
      deltaBlocks: [
        {
          domain: "billing",
          removedRequirements: ["R-77"],
        },
      ],
    });

    const r = validateChangeProposal("chg-20260523-remove-missing-id", { rootDir: project });
    expect(
      r.findings.some(
        (f) =>
          f.severity === "blocking" &&
          f.ruleId === "change-proposal/requirement-not-found" &&
          f.message.includes("R-77")
      )
    ).toBe(true);
  });

  it("flags addedRequirements that embed a colliding R-NN", () => {
    seedContractPage({
      project,
      domain: "billing",
      requirements: [{ id: "R-01", text: "Existing requirement." }],
    });
    seedProposal(project, {
      changeId: "chg-20260523-colliding-add",
      affectedSpecs: ["billing"],
      deltaBlocks: [
        {
          domain: "billing",
          // Note: author embedded an explicit R-01 prefix, which collides.
          addedRequirements: ["R-01 — the system MUST also do new thing."],
        },
      ],
    });

    const r = validateChangeProposal("chg-20260523-colliding-add", { rootDir: project });
    expect(
      r.findings.some(
        (f) =>
          f.severity === "blocking" &&
          f.ruleId === "change-proposal/requirement-id-collision" &&
          f.message.includes("R-01")
      )
    ).toBe(true);
  });

  it("flags breakingChange=true without migrationNote", () => {
    seedContractPage({
      project,
      domain: "billing",
      requirements: [{ id: "R-01", text: "Original." }],
    });
    seedProposal(project, {
      changeId: "chg-20260523-breaking-no-migration",
      affectedSpecs: ["billing"],
      deltaBlocks: [
        {
          domain: "billing",
          removedRequirements: ["R-01"],
          breakingChange: true,
          migrationNote: null, // missing!
        },
      ],
    });

    const r = validateChangeProposal("chg-20260523-breaking-no-migration", {
      rootDir: project,
    });
    expect(
      r.findings.some(
        (f) =>
          f.severity === "blocking" &&
          f.ruleId === "change-proposal/breaking-without-migration"
      )
    ).toBe(true);
  });

  it("flags deltas.toon mirror drift from proposal.md", () => {
    seedContractPage({ project, domain: "billing" });
    // Generate proposal with one delta block but override mirror to claim
    // a different addedReqCount.
    seedProposal(project, {
      changeId: "chg-20260523-mirror-drift",
      affectedSpecs: ["billing"],
      deltaBlocks: [
        {
          domain: "billing",
          addedRequirements: ["The system MUST add A.", "The system MUST add B."],
        },
      ],
      mirrorOverride:
        "deltas[1]{domain,breakingChange,addedReqCount,modifiedReqCount,removedReqCount,addedScenarioCount,modifiedScenarioCount,removedScenarioCount}:\n  billing,false,9,0,0,0,0,0\n",
    });

    const r = validateChangeProposal("chg-20260523-mirror-drift", { rootDir: project });
    expect(
      r.findings.some(
        (f) =>
          f.severity === "blocking" &&
          f.ruleId === "change-proposal/deltas-toon-drift"
      )
    ).toBe(true);
  });

  it("passes a clean, well-formed proposal", () => {
    seedContractPage({
      project,
      domain: "billing",
      requirements: [
        { id: "R-01", text: "Existing one." },
        { id: "R-02", text: "Existing two." },
      ],
    });
    seedProposal(project, {
      changeId: "chg-20260523-happy-path",
      affectedSpecs: ["billing"],
      deltaBlocks: [
        {
          domain: "billing",
          modifiedRequirements: [
            { id: "R-01", before: "Existing one.", after: "Existing one revised." },
          ],
          addedRequirements: ["The system MUST add new behavior under the lifecycle."],
        },
      ],
    });

    const r = validateChangeProposal("chg-20260523-happy-path", { rootDir: project });
    const blocking = r.findings.filter((f) => f.severity === "blocking");
    expect(blocking).toEqual([]);
  });

  it("warns when linkedPlan is set but does not resolve", () => {
    seedContractPage({ project, domain: "billing" });
    seedProposal(project, {
      changeId: "chg-20260523-bad-link",
      affectedSpecs: ["billing"],
      linkedPlan: "PLAN-does-not-exist.md",
      deltaBlocks: [
        {
          domain: "billing",
          addedRequirements: ["The system MUST add a new feature."],
        },
      ],
    });

    const r = validateChangeProposal("chg-20260523-bad-link", { rootDir: project });
    expect(
      r.findings.some(
        (f) => f.severity === "warning" && f.ruleId === "change-proposal/linked-plan-missing"
      )
    ).toBe(true);
  });
});
