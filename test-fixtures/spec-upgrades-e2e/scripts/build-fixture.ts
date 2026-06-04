#!/usr/bin/env tsx
/**
 * Deterministic builder for the spec-upgrades-e2e fixture.
 *
 * Run from the fixture root:
 *   npx tsx scripts/build-fixture.ts
 *
 * Or from the repo root:
 *   npx tsx test-fixtures/spec-upgrades-e2e/scripts/build-fixture.ts
 *
 * What it does:
 *   1. (Re-)materializes the contract pages from ROADMAP.md + PLAN.md +
 *      .loom/wiki/contract-partition.toon.
 *   2. Builds four example changes under .loom/changes/:
 *        chg-20260524-add-refund-flow                   — archived (full lifecycle)
 *        chg-20260525-deprecate-legacy-status           — in-flight (reviewed, not yet approved)
 *        chg-20260526-rename-customer-table             — rejected (--reason supplied)
 *        chg-20260527-quick-fix-customer-email-validation — archived via quick-archive
 *
 * All timestamps are pinned for byte-identical re-runs.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { materializeContracts } from "../../../scripts/materialize-contracts.js";
import { runInit } from "../../../scripts/loom-change/init.js";
import { runReview } from "../../../scripts/loom-change/review.js";
import { runApprove } from "../../../scripts/loom-change/approve.js";
import { runRun } from "../../../scripts/loom-change/run.js";
import { runArchive } from "../../../scripts/loom-change/archive.js";
import { runReject } from "../../../scripts/loom-change/reject.js";
import {
  runQuickArchive,
  type QuickArchiveDelta,
} from "../../../scripts/loom-change/quick-archive.js";

const FIXTURE_ROOT = path.resolve(__dirname, "..");

function ts(iso: string): Date {
  return new Date(iso);
}

function main() {
  // ── 1. Materialize contract pages ────────────────────────────────────────
  // Use a fixed `now` for deterministic output.
  const materializedAt = ts("2026-05-23T12:00:00Z");
  materializeContracts({
    cwd: FIXTURE_ROOT,
    now: materializedAt,
    actor: "materializer",
  });

  // ── 2. chg-20260524-add-refund-flow — archived ──────────────────────────
  {
    const changeId = "chg-20260524-add-refund-flow";
    runInit({
      title: "Add refund flow",
      changeId,
      rootDir: FIXTURE_ROOT,
      actor: "human:fixture",
      now: ts("2026-05-24T09:00:00Z"),
    });

    // Edit proposal.md to fill scope/approach/affectedSpecs/deltas.
    const propPath = path.join(FIXTURE_ROOT, ".loom", "changes", changeId, "proposal.md");
    fs.writeFileSync(propPath, buildArchivedProposal(changeId, ts("2026-05-24T09:00:00Z")), "utf8");
    // Refresh deltas.toon mirror to match.
    const delPath = path.join(FIXTURE_ROOT, ".loom", "changes", changeId, "deltas.toon");
    fs.writeFileSync(delPath, refundFlowDeltasToon(), "utf8");

    runReview({
      changeId,
      rootDir: FIXTURE_ROOT,
      by: "human:reviewer",
      notes: "Scope is tight; approach is incremental. LGTM.",
      now: ts("2026-05-24T10:00:00Z"),
    });
    runApprove({
      changeId,
      rootDir: FIXTURE_ROOT,
      by: "human:approver",
      now: ts("2026-05-24T10:30:00Z"),
    });
    runRun({
      changeId,
      rootDir: FIXTURE_ROOT,
      by: "human:fixture",
      now: ts("2026-05-24T11:00:00Z"),
    });
    runArchive({
      changeId,
      rootDir: FIXTURE_ROOT,
      by: "human:fixture",
      now: ts("2026-05-24T12:00:00Z"),
    });
  }

  // ── 3. chg-20260525-deprecate-legacy-status — in-flight (reviewed) ──────
  {
    const changeId = "chg-20260525-deprecate-legacy-status";
    runInit({
      title: "Deprecate legacy status",
      changeId,
      rootDir: FIXTURE_ROOT,
      actor: "human:fixture",
      now: ts("2026-05-25T09:00:00Z"),
    });
    const propPath = path.join(FIXTURE_ROOT, ".loom", "changes", changeId, "proposal.md");
    fs.writeFileSync(propPath, buildInFlightProposal(changeId, ts("2026-05-25T09:00:00Z")), "utf8");
    const delPath = path.join(FIXTURE_ROOT, ".loom", "changes", changeId, "deltas.toon");
    fs.writeFileSync(delPath, deprecateStatusDeltasToon(), "utf8");
    runReview({
      changeId,
      rootDir: FIXTURE_ROOT,
      by: "human:reviewer",
      notes: "Reviewing approach; needs second pass before approve.",
      now: ts("2026-05-25T10:00:00Z"),
    });
    // Intentionally stop at `reviewed` — this is the in-flight example.
  }

  // ── 4. chg-20260526-rename-customer-table — rejected ────────────────────
  {
    const changeId = "chg-20260526-rename-customer-table";
    runInit({
      title: "Rename customer table",
      changeId,
      rootDir: FIXTURE_ROOT,
      actor: "human:fixture",
      now: ts("2026-05-26T09:00:00Z"),
    });
    const propPath = path.join(FIXTURE_ROOT, ".loom", "changes", changeId, "proposal.md");
    fs.writeFileSync(propPath, buildRejectedProposal(changeId, ts("2026-05-26T09:00:00Z")), "utf8");
    const delPath = path.join(FIXTURE_ROOT, ".loom", "changes", changeId, "deltas.toon");
    fs.writeFileSync(delPath, renameCustomerDeltasToon(), "utf8");
    runReject({
      changeId,
      rootDir: FIXTURE_ROOT,
      by: "human:reviewer",
      reason: "Renaming the customer table is a breaking schema change with no migration plan.",
      now: ts("2026-05-26T10:00:00Z"),
    });
  }

  // ── 5. chg-20260527-quick-fix-customer-email-validation — quick-archive ──
  {
    const changeId = "chg-20260527-quick-fix-customer-email-validation";
    const deltas: QuickArchiveDelta[] = [
      {
        domain: "customers",
        addedRequirements: [
          "Customer email MUST be normalized to lowercase before duplicate check",
        ],
        modifiedRequirements: [],
        removedRequirements: [],
        addedScenarios: [
          {
            id: "S-10",
            title: "Normalize email case before dedupe",
            given: ['A Customer with email "alice@example.com" exists'],
            when: 'A client POSTs /api/customers with email "Alice@Example.com"',
            whenTriggerType: "api-call",
            then: ["Response status MUST be 409"],
            stateRef: null,
            tags: ["regression", "error"],
            testTier: "integration",
            automatable: true,
          },
        ],
        modifiedScenarios: [],
        removedScenarios: [],
        breakingChange: false,
        migrationNote: null,
        rationale:
          "Production saw two customer rows differing only by case; this fix normalizes the lookup.",
      },
    ];
    runQuickArchive({
      title: "Quick fix customer email validation",
      changeId,
      rootDir: FIXTURE_ROOT,
      deltas,
      rationale:
        "Drive-by fix surfaced by /loom-quick — normalizes email case before the duplicate check.",
      now: ts("2026-05-27T09:00:00Z"),
    });
  }

  process.stdout.write("Fixture rebuilt at " + FIXTURE_ROOT + "\n");
}

// ---------------------------------------------------------------------------
// Proposal builders — these are deliberately verbose so the resulting fixture
// files are easy to inspect by hand.
// ---------------------------------------------------------------------------

function buildArchivedProposal(changeId: string, createdAt: Date): string {
  const stamp = createdAt.toISOString();
  return [
    "```toon",
    `changeId: ${changeId}`,
    `status: proposed`,
    `intent: Add refund flow to the invoicing domain so that issued invoices can be partially or fully refunded with audit logging.`,
    `scope:`,
    `  included[1]: Refund endpoint on /api/refunds for the invoicing domain`,
    `  excluded[1]: Multi-currency refund handling and chargeback workflows`,
    `approach: Extend the invoicing contract with R-NN requirements for refund issuance, add a happy-path scenario, and link to a scoped plan that implements the route.`,
    `affectedSpecs[1]: invoicing`,
    `linkedPlan:`,
    `reviewedBy:`,
    `reviewedAt:`,
    `reviewNotes:`,
    `approvedBy:`,
    `approvedAt:`,
    `createdAt: ${stamp}`,
    `archivedAt:`,
    "```",
    "",
    "# Change Proposal: Add refund flow",
    "",
    "## Intent",
    "",
    "Add refund flow to the invoicing domain so issued invoices can be partially or fully refunded with audit logging.",
    "",
    "## Scope",
    "",
    "Refund endpoint at `/api/refunds`. Multi-currency and chargeback workflows are explicitly out.",
    "",
    "## Approach",
    "",
    "Extend the invoicing contract with refund requirements and a happy-path scenario.",
    "",
    "## Deltas",
    "",
    "### invoicing",
    "",
    "```toon",
    "domain: invoicing",
    "addedRequirements[1]: A refund MUST NOT exceed the original invoice amount",
    "modifiedRequirements[0]{id,before,after}:",
    "removedRequirements[0]:",
    "addedScenarios[0]:",
    "modifiedScenarios[0]{id,before,after}:",
    "removedScenarios[0]:",
    "breakingChange: false",
    "migrationNote:",
    "rationale: Adds partial-refund support — an often-requested billing feature.",
    "```",
    "",
    "## Rationale",
    "",
    "Adds partial-refund support, an often-requested billing feature, with audit logging baked in.",
    "",
  ].join("\n");
}

function refundFlowDeltasToon(): string {
  return [
    "# deltas.toon mirror — refreshed by /loom-change archive on commit. Source of truth is proposal.md.",
    "deltas[1]{domain,breakingChange,addedReqCount,modifiedReqCount,removedReqCount,addedScenarioCount,modifiedScenarioCount,removedScenarioCount}:",
    "  invoicing,false,1,0,0,0,0,0",
    "",
  ].join("\n");
}

function deprecateStatusDeltasToon(): string {
  return [
    "# deltas.toon mirror — refreshed by /loom-change archive on commit. Source of truth is proposal.md.",
    "deltas[1]{domain,breakingChange,addedReqCount,modifiedReqCount,removedReqCount,addedScenarioCount,modifiedScenarioCount,removedScenarioCount}:",
    "  invoicing,false,1,0,0,0,0,0",
    "",
  ].join("\n");
}

function renameCustomerDeltasToon(): string {
  return [
    "# deltas.toon mirror — refreshed by /loom-change archive on commit. Source of truth is proposal.md.",
    "deltas[1]{domain,breakingChange,addedReqCount,modifiedReqCount,removedReqCount,addedScenarioCount,modifiedScenarioCount,removedScenarioCount}:",
    "  customers,true,1,0,0,0,0,0",
    "",
  ].join("\n");
}

function buildInFlightProposal(changeId: string, createdAt: Date): string {
  const stamp = createdAt.toISOString();
  return [
    "```toon",
    `changeId: ${changeId}`,
    `status: proposed`,
    `intent: Deprecate the legacy "paid" status value on Invoice in favor of "settled" to align with finance terminology.`,
    `scope:`,
    `  included[1]: Rename Invoice status enum value paid → settled`,
    `  excluded[1]: Data migration tooling for live databases`,
    `approach: Update the invoicing contract requirement, add a regression scenario, schedule code changes via a follow-up linked plan.`,
    `affectedSpecs[1]: invoicing`,
    `linkedPlan:`,
    `reviewedBy:`,
    `reviewedAt:`,
    `reviewNotes:`,
    `approvedBy:`,
    `approvedAt:`,
    `createdAt: ${stamp}`,
    `archivedAt:`,
    "```",
    "",
    "# Change Proposal: Deprecate legacy status",
    "",
    "## Intent",
    "",
    "Rename the legacy `paid` status value on Invoice to `settled`.",
    "",
    "## Scope",
    "",
    "Contract-only change for now. Live-data migration is scoped to a follow-up.",
    "",
    "## Approach",
    "",
    "Modify the invoicing contract requirement R-01 to use the new value.",
    "",
    "## Deltas",
    "",
    "### invoicing",
    "",
    "```toon",
    "domain: invoicing",
    "addedRequirements[1]: Invoice status SHOULD use the value \"settled\" rather than \"paid\"",
    "modifiedRequirements[0]{id,before,after}:",
    "removedRequirements[0]:",
    "addedScenarios[0]:",
    "modifiedScenarios[0]{id,before,after}:",
    "removedScenarios[0]:",
    "breakingChange: false",
    "migrationNote:",
    "rationale: Aligns Invoice status terminology with finance team conventions for Q1 2026.",
    "```",
    "",
    "## Rationale",
    "",
    "Aligns Invoice status terminology with finance team conventions.",
    "",
  ].join("\n");
}

function buildRejectedProposal(changeId: string, createdAt: Date): string {
  const stamp = createdAt.toISOString();
  return [
    "```toon",
    `changeId: ${changeId}`,
    `status: proposed`,
    `intent: Rename the customer table to "billing_party" to better reflect domain language.`,
    `scope:`,
    `  included[1]: Rename Customer entity to BillingParty across the customers contract`,
    `  excluded[1]: Application code refactor (handled separately if approved)`,
    `approach: Treat as a major rename — add a new entity, deprecate the old, retire after a release.`,
    `affectedSpecs[1]: customers`,
    `linkedPlan:`,
    `reviewedBy:`,
    `reviewedAt:`,
    `reviewNotes:`,
    `approvedBy:`,
    `approvedAt:`,
    `createdAt: ${stamp}`,
    `archivedAt:`,
    "```",
    "",
    "# Change Proposal: Rename customer table",
    "",
    "## Intent",
    "",
    "Rename `customer` to `billing_party` for clarity.",
    "",
    "## Scope",
    "",
    "Contract-only rename. App-side refactor is a separate plan.",
    "",
    "## Approach",
    "",
    "Add the new entity, deprecate the old, retire after a release.",
    "",
    "## Deltas",
    "",
    "### customers",
    "",
    "```toon",
    "domain: customers",
    "addedRequirements[1]: Customer entity SHOULD be referenced as BillingParty in new code",
    "modifiedRequirements[0]{id,before,after}:",
    "removedRequirements[0]:",
    "addedScenarios[0]:",
    "modifiedScenarios[0]{id,before,after}:",
    "removedScenarios[0]:",
    "breakingChange: true",
    "migrationNote: All callers must dual-write Customer and BillingParty for one release cycle.",
    "rationale: Aligns terminology with finance domain language adopted by accounting.",
    "```",
    "",
    "## Rationale",
    "",
    "Aligns terminology with finance domain language.",
    "",
  ].join("\n");
}

main();
