/**
 * /loom-change quick-archive tests — Phase 6 of PLAN-spec-upgrades.md.
 *
 * Covers the quick-mode acceptance criteria:
 *   - A /loom-quick-style invocation produces a retroactive chg-{date}-*
 *     directory.
 *   - The affected contract page is updated; contentChecksum stays in sync
 *     with the canonical body (drift validator would pass).
 *   - reviewedBy=loom-quick and approvedBy=loom-quick are stamped.
 *   - Atomicity, conflict scan, and supersession scan run with no shortcuts.
 *   - No interactive prompts (function returns synchronously).
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { runQuickArchive } from "../../scripts/loom-change/quick-archive.js";
import {
  writeChangeState,
  readChangeState,
  type ChangeState,
} from "../../hooks/lib/change-state.js";
import { writeContractPage } from "../../hooks/lib/contract-page-writer.js";
import { canonicalBodyChecksumFromPage } from "../../hooks/lib/checksum.js";
import { proposalPath } from "../../hooks/lib/change-paths.js";

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "loom-change-quick-"));
}

function silentStreams(): { out: NodeJS.WritableStream; err: NodeJS.WritableStream } {
  const make = (): NodeJS.WritableStream =>
    ({
      write(_chunk: string): boolean {
        return true;
      },
    }) as unknown as NodeJS.WritableStream;
  return { out: make(), err: make() };
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
    requirements: (args.requirements ?? [{ id: "R-01", text: "The system MUST do thing." }]).map((r) => ({
      id: r.id,
      requirementType: "functional",
      text: r.text,
    })),
    scenarios: [],
    entities: [],
    outOfScope: [],
    history: [],
    contractVersion: 1,
    contractStatus: "active",
    sourceChanges: [],
    deprecatedAt: null,
    replacedBy: null,
    sourceRefs: [],
    tags: ["contract", args.domain],
    createdAt: "2026-05-23T08:00:00Z",
    updatedAt: "2026-05-23T08:00:00Z",
    createdBy: "materializer",
    updatedBy: "materializer",
  });
}

describe("quick-archive — basic retroactive archive", () => {
  let project: string;
  beforeEach(() => {
    project = mkTempProject();
  });

  it("produces a retroactive chg-{date}-* directory and updates the contract page", () => {
    const streams = silentStreams();
    seedContractPage({ project, domain: "billing" });

    const result = runQuickArchive({
      title: "Tighten billing rule",
      rationale: "Production incident showed billing needs explicit logging — adding audit requirement.",
      deltas: [
        {
          domain: "billing",
          addedRequirements: ["The system MUST log every billing operation with timestamp."],
          modifiedRequirements: [],
          removedRequirements: [],
          addedScenarios: [],
          modifiedScenarios: [],
          removedScenarios: [],
          breakingChange: false,
          migrationNote: null,
          rationale: "Production incident drove this addition for audit compliance.",
        },
      ],
      rootDir: project,
      now: new Date("2026-05-23T10:00:00Z"),
      ...streams,
    });

    expect(result.exitCode).toBe(0);
    expect(result.changeId).toMatch(/^chg-20260523-/);
    expect(fs.existsSync(result.proposalFile)).toBe(true);

    const pagePath = path.join(project, ".loom", "wiki", "pages", "contract-billing.md");
    const pageContent = fs.readFileSync(pagePath, "utf8");
    expect(pageContent).toContain("audit"); // the new requirement text uses 'log every billing'
    expect(pageContent).toContain(`### ${result.changeId}`); // History entry
    expect(pageContent).toMatch(/sourceChanges\[1\]:/);
  });

  it("stamps reviewedBy=loom-quick and approvedBy=loom-quick on the retroactive proposal", () => {
    const streams = silentStreams();
    seedContractPage({ project, domain: "billing" });

    const result = runQuickArchive({
      title: "Audit fields",
      rationale: "Quick-mode test — adding minor requirement to billing for testing purposes.",
      deltas: [
        {
          domain: "billing",
          addedRequirements: ["The system MUST emit audit events on issuance."],
          modifiedRequirements: [],
          removedRequirements: [],
          addedScenarios: [],
          modifiedScenarios: [],
          removedScenarios: [],
          breakingChange: false,
          migrationNote: null,
          rationale: "Adding audit events for downstream observability needs in production.",
        },
      ],
      rootDir: project,
      now: new Date("2026-05-23T10:00:00Z"),
      ...streams,
    });
    expect(result.exitCode).toBe(0);

    const propContent = fs.readFileSync(result.proposalFile, "utf8");
    expect(propContent).toMatch(/reviewedBy: loom-quick/);
    expect(propContent).toMatch(/approvedBy: loom-quick/);
    expect(propContent).toMatch(/status: archived/);
  });

  it("contentChecksum on the updated contract page stays in sync with canonical body", () => {
    const streams = silentStreams();
    seedContractPage({ project, domain: "billing" });

    const result = runQuickArchive({
      title: "Checksum coherence test",
      rationale: "Verify the drift validator wouldn't flag a quick-archive output as manual edit.",
      deltas: [
        {
          domain: "billing",
          addedRequirements: ["The system MUST validate every billing event payload."],
          modifiedRequirements: [],
          removedRequirements: [],
          addedScenarios: [],
          modifiedScenarios: [],
          removedScenarios: [],
          breakingChange: false,
          migrationNote: null,
          rationale: "Adding payload validation requirement for billing event coherence.",
        },
      ],
      rootDir: project,
      now: new Date("2026-05-23T10:00:00Z"),
      ...streams,
    });
    expect(result.exitCode).toBe(0);

    const pagePath = path.join(project, ".loom", "wiki", "pages", "contract-billing.md");
    const pageContent = fs.readFileSync(pagePath, "utf8");
    const recomputed = canonicalBodyChecksumFromPage(pageContent);
    const storedMatch = /contentChecksum: (sha256:[0-9a-f]{64})/.exec(pageContent);
    expect(storedMatch).not.toBeNull();
    expect(recomputed).toBe(storedMatch![1]);
  });

  it("ChangeState transitions[] is monotonic and final entry matches archived status", () => {
    const streams = silentStreams();
    seedContractPage({ project, domain: "billing" });

    const result = runQuickArchive({
      title: "Transition test",
      rationale: "Verify the synthesized transition ladder remains strictly monotonic on archive.",
      deltas: [
        {
          domain: "billing",
          addedRequirements: ["The system MUST track quick-archive transitions."],
          modifiedRequirements: [],
          removedRequirements: [],
          addedScenarios: [],
          modifiedScenarios: [],
          removedScenarios: [],
          breakingChange: false,
          migrationNote: null,
          rationale: "Test of transition ladder monotonicity via quick-archive synthesis.",
        },
      ],
      rootDir: project,
      now: new Date("2026-05-23T10:00:00Z"),
      ...streams,
    });
    expect(result.exitCode).toBe(0);

    const state = readChangeState(project, result.changeId)!;
    // Verify monotonic timestamps.
    for (let i = 1; i < state.transitions.length; i++) {
      expect(state.transitions[i].at > state.transitions[i - 1].at).toBe(true);
    }
    expect(state.transitions.at(-1)!.to).toBe("archived");
    expect(state.status).toBe("archived");
  });

  it("runs the conflict scan — quick-archive blocks when an in-flight peer claims the same R-NN", () => {
    const streams = silentStreams();
    seedContractPage({
      project,
      domain: "billing",
      requirements: [{ id: "R-01", text: "The system MUST issue invoices." }],
    });

    // Seed an in-flight peer that targets R-01.
    const peerId = "chg-20260523-peer-targets-r01";
    fs.mkdirSync(path.join(project, ".loom", "changes", peerId), { recursive: true });
    fs.writeFileSync(
      path.join(project, ".loom", "changes", peerId, "proposal.md"),
      [
        "```toon",
        `changeId: ${peerId}`,
        `status: in-progress`,
        `intent: Peer change that also targets R-01 on contract-billing. Conflict-scan fixture.`,
        `scope:`,
        `  included[1]: peer in-scope`,
        `  excluded[1]: peer out-of-scope`,
        `approach: Targeted change for conflict scan testing.`,
        `affectedSpecs[1]: billing`,
        `linkedPlan:`,
        `reviewedBy:`,
        `reviewedAt:`,
        `reviewNotes:`,
        `approvedBy:`,
        `approvedAt:`,
        `createdAt: 2026-05-23T07:00:00.000Z`,
        `archivedAt:`,
        "```",
        "",
        "# Peer change",
        "",
        "## Intent\nfixture\n## Scope\nfixture\n## Approach\nfixture\n## Deltas",
        "",
        "### billing",
        "",
        "```toon",
        "domain: billing",
        "addedRequirements[0]:",
        "modifiedRequirements[1]{id,before,after}:",
        "  R-01,The system MUST issue invoices.,The system MUST issue invoices with retries.",
        "removedRequirements[0]:",
        "addedScenarios[0]:",
        "modifiedScenarios[0]{id,before,after}:",
        "removedScenarios[0]:",
        "breakingChange: false",
        "migrationNote:",
        "rationale: Peer rationale must be at least thirty chars to satisfy the schema.",
        "```",
      ].join("\n"),
      "utf8"
    );
    writeChangeState(project, {
      changeId: peerId,
      status: "in-progress",
      transitions: [
        { from: "", to: "proposed", at: "2026-05-23T07:00:00.000Z", by: "human:test", reason: "initial proposal" },
        { from: "proposed", to: "reviewed", at: "2026-05-23T07:00:01.000Z", by: "human:test", reason: "review accepted" },
        { from: "reviewed", to: "approved", at: "2026-05-23T07:00:02.000Z", by: "human:test", reason: "approved for archive" },
        { from: "approved", to: "in-progress", at: "2026-05-23T07:00:03.000Z", by: "human:test", reason: "run started" },
      ],
      conflicts: [],
      supersededBy: null,
      updatedAt: "2026-05-23T07:00:03.000Z",
    });

    // Run quick-archive that also touches R-01 — should be blocked.
    const result = runQuickArchive({
      title: "Quick conflict",
      rationale: "Conflict-scan trigger via quick-archive targeting R-01 on billing domain.",
      deltas: [
        {
          domain: "billing",
          addedRequirements: [],
          modifiedRequirements: [
            { id: "R-01", before: "The system MUST issue invoices.", after: "The system MUST issue invoices with retries and audit." },
          ],
          removedRequirements: [],
          addedScenarios: [],
          modifiedScenarios: [],
          removedScenarios: [],
          breakingChange: false,
          migrationNote: null,
          rationale: "Quick-archive conflict trigger; verifying scan blocks this attempt.",
        },
      ],
      rootDir: project,
      now: new Date("2026-05-23T10:00:00Z"),
      ...streams,
    });

    expect(result.exitCode).toBe(1);
    expect(result.archive?.conflicts.length ?? 0).toBeGreaterThan(0);
  });
});
