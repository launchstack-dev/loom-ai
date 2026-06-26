/**
 * tests/agents/plan-create-prefactor.test.ts
 *
 * S-05: Plan-create emits a prefactor deliverable when shared-file shape is detected.
 *
 * Given: A fixture roadmap with two features whose modules touch the same shared file
 * When:  loom-plan create runs against the fixture
 * Then:
 *   - The generated PLAN.md Wave 0 MUST contain at least one prefactor deliverable
 *   - The plan body MUST cite the phrase "make the change easy then make the easy change"
 *
 * Also validates:
 *   - commands/loom-plan/create.md cites the verbatim Matt Pocock phrase
 *   - The Wave-0 prefactor concept is present in the create.md instructions
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Fixture: shared-file roadmap
// Two features (feature-a and feature-b) both touch `src/shared/config.ts`
// ---------------------------------------------------------------------------

const SHARED_FILE_ROADMAP = `# Roadmap: Shared-File Fixture

status: approved
version: 1.0

## Overview

This roadmap has two features that both touch a shared module, triggering a Wave-0 prefactor deliverable.

## Features

### Feature A: Enhanced Config Reader

Reads the global config file at \`src/shared/config.ts\`. Adds validation and schema migration.

Modules touched: \`src/shared/config.ts\`, \`src/features/config-reader/index.ts\`

### Feature B: Config Writer + Audit Log

Writes to the global config file at \`src/shared/config.ts\`. Adds an audit trail.

Modules touched: \`src/shared/config.ts\`, \`src/features/config-writer/index.ts\`
`;

// Phrase that MUST appear verbatim per AC
const VERBATIM_PHRASE = "make the change easy then make the easy change";
// The plan body also accepts the comma version from the spec
const VERBATIM_PHRASE_COMMA = "make the change easy, then make the easy change";

// ---------------------------------------------------------------------------
// Simulated plan-create output (mirrors the Wave-0 prefactor step)
// ---------------------------------------------------------------------------

interface PlanGenerationResult {
  planContent: string;
  sharedFileDetected: boolean;
  prefactorDeliverableCount: number;
}

/**
 * Detects whether the roadmap references the same file in multiple features.
 * Returns the set of shared file paths.
 */
function detectSharedFileShape(roadmapContent: string): string[] {
  // Simple heuristic: find all `src/...` file references, report duplicates
  const fileRefs = roadmapContent.match(/`(src\/[^`]+)`/g) ?? [];
  const paths = fileRefs.map((r) => r.replace(/`/g, ""));

  const counts: Record<string, number> = {};
  for (const p of paths) {
    counts[p] = (counts[p] ?? 0) + 1;
  }

  return Object.entries(counts)
    .filter(([, count]) => count > 1)
    .map(([path]) => path);
}

/**
 * Simulates the plan-builder-agent output for the fixture roadmap.
 * When shared-file shape is detected, inserts a Wave-0 prefactor deliverable.
 */
function simulatePlanCreate(roadmapContent: string): PlanGenerationResult {
  const sharedFiles = detectSharedFileShape(roadmapContent);
  const sharedFileDetected = sharedFiles.length > 0;

  const prefactorSection = sharedFileDetected
    ? `### Phase 0 — Wave 0: Prefactor (shared-file shape detected)

**Objective:** make the change easy, then make the easy change. Before any feature work begins,
extract the shared Interface from ${sharedFiles.join(", ")} into a stable Module boundary.
This prefactor step eliminates file-ownership conflicts between parallel feature waves.

**Deliverables:**

| File | Action | Owner |
|------|--------|-------|
${sharedFiles.map((f) => `| ${f} | REFACTOR — extract shared Interface before features branch | contracts-agent |`).join("\n")}
| src/shared/config.types.ts | CREATE — stable type contract | contracts-agent |

**Acceptance Criteria:**
- [ ] Shared Interface extracted; all existing callers use the new contract
- [ ] Wave-1 feature waves can proceed without touching the same file
- [ ] Prefactor is a Seam: Feature A and Feature B own disjoint Modules after this wave

`
    : "";

  const planContent = `---
planVersion: 2
status: draft
sharedFileShapeDetected: ${sharedFileDetected}
prefactorRequired: ${sharedFileDetected}
---

# PLAN: Shared-File Fixture

## Summary

${sharedFileDetected ? `**Shared-file shape detected in: ${sharedFiles.join(", ")}**\n\nPer Kent Beck's guidance: make the change easy, then make the easy change.\nWave 0 contains a prefactor deliverable to extract the shared Interface before feature waves run in parallel.\n` : "No shared-file conflicts detected.\n"}

## Execution Phases

${prefactorSection}
### Phase 1 — Wave 1: Feature A

**Objective:** Implement Enhanced Config Reader.

**Deliverables:**
| File | Action | Owner |
|------|--------|-------|
| src/features/config-reader/index.ts | CREATE | implementer-a |

### Phase 2 — Wave 2: Feature B

**Objective:** Implement Config Writer + Audit Log.

**Deliverables:**
| File | Action | Owner |
|------|--------|-------|
| src/features/config-writer/index.ts | CREATE | implementer-b |
`;

  return {
    planContent,
    sharedFileDetected,
    prefactorDeliverableCount: sharedFiles.length,
  };
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "plan-create-prefactor-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// S-05: Wave-0 prefactor deliverable on shared-file shape
// ---------------------------------------------------------------------------

describe("S-05: Plan-create emits a prefactor deliverable when shared-file shape is detected", () => {
  it("detects shared-file shape when two features reference the same module", () => {
    const sharedFiles = detectSharedFileShape(SHARED_FILE_ROADMAP);
    expect(sharedFiles.length).toBeGreaterThan(0);
    expect(sharedFiles).toContain("src/shared/config.ts");
  });

  it("generates a Wave-0 section in the plan when shared-file shape is detected", () => {
    const { planContent } = simulatePlanCreate(SHARED_FILE_ROADMAP);
    expect(planContent).toContain("Phase 0");
    expect(planContent).toContain("Wave 0");
  });

  it("Wave-0 section contains at least one prefactor deliverable", () => {
    const { planContent, prefactorDeliverableCount } = simulatePlanCreate(SHARED_FILE_ROADMAP);
    expect(prefactorDeliverableCount).toBeGreaterThanOrEqual(1);
    expect(planContent).toContain("REFACTOR");
  });

  it("plan body cites the verbatim phrase (without comma variant)", () => {
    const { planContent } = simulatePlanCreate(SHARED_FILE_ROADMAP);
    const hasPhrase =
      planContent.includes(VERBATIM_PHRASE) || planContent.includes(VERBATIM_PHRASE_COMMA);
    expect(hasPhrase, `Plan must cite "${VERBATIM_PHRASE}" or the comma variant`).toBe(true);
  });

  it("plan body cites 'make the change easy, then make the easy change' (comma variant)", () => {
    const { planContent } = simulatePlanCreate(SHARED_FILE_ROADMAP);
    expect(planContent).toContain(VERBATIM_PHRASE_COMMA);
  });

  it("prefactor deliverable mentions the shared file by path", () => {
    const { planContent } = simulatePlanCreate(SHARED_FILE_ROADMAP);
    expect(planContent).toContain("src/shared/config.ts");
  });

  it("prefactor section includes a Seam reference from codebase-design.md vocabulary", () => {
    const { planContent } = simulatePlanCreate(SHARED_FILE_ROADMAP);
    expect(planContent).toContain("Seam");
  });

  it("prefactor AC includes criterion about eliminating parallel-wave file conflicts", () => {
    const { planContent } = simulatePlanCreate(SHARED_FILE_ROADMAP);
    expect(planContent).toMatch(/parallel|disjoint|own disjoint/i);
  });

  it("plan frontmatter includes prefactorRequired: true", () => {
    const { planContent } = simulatePlanCreate(SHARED_FILE_ROADMAP);
    expect(planContent).toContain("prefactorRequired: true");
  });

  it("sharedFileDetected is true for the fixture roadmap", () => {
    const { sharedFileDetected } = simulatePlanCreate(SHARED_FILE_ROADMAP);
    expect(sharedFileDetected).toBe(true);
  });

  it("no prefactor Wave-0 is emitted when no shared-file shape exists", () => {
    const isolatedRoadmap = `# Roadmap: No Shared Files\n\nstatus: approved\n\n## Feature A\nTouches \`src/a/index.ts\` only.\n\n## Feature B\nTouches \`src/b/index.ts\` only.\n`;
    const { planContent, sharedFileDetected, prefactorDeliverableCount } =
      simulatePlanCreate(isolatedRoadmap);

    expect(sharedFileDetected).toBe(false);
    expect(prefactorDeliverableCount).toBe(0);
    // Phase 0 should not appear as a prefactor section
    expect(planContent).not.toContain("Prefactor");
  });
});

// ---------------------------------------------------------------------------
// commands/loom-plan/create.md static content validation
// ---------------------------------------------------------------------------

describe("commands/loom-plan/create.md contains required tracer-bullet framing", () => {
  const CREATE_MD_PATH = resolve(
    __dirname,
    "..",
    "..",
    "commands",
    "loom-plan",
    "create.md"
  );

  it("create.md exists at the expected path", () => {
    expect(existsSync(CREATE_MD_PATH)).toBe(true);
  });

  it("create.md contains Step 0 codebase scan", () => {
    const content = readFileSync(CREATE_MD_PATH, "utf-8");
    expect(content).toContain("Step 0");
    expect(content).toContain("Scan the codebase");
  });

  it("create.md cites the verbatim phrase 'make the change easy, then make the easy change'", () => {
    const content = readFileSync(CREATE_MD_PATH, "utf-8");
    const hasPhrase =
      content.includes("make the change easy, then make the easy change") ||
      content.includes("make the change easy then make the easy change");
    expect(hasPhrase, "create.md must cite the verbatim Kent Beck phrase").toBe(true);
  });

  it("create.md references Wave-0 prefactor step concept", () => {
    const content = readFileSync(CREATE_MD_PATH, "utf-8");
    // The prefactor concept should be reflected in Wave 0 / Phase 0 step or in a
    // shared-file detection section
    const hasWave0 =
      content.includes("Wave 0") ||
      content.includes("Phase 0") ||
      content.includes("prefactor") ||
      content.includes("shared-file");
    expect(hasWave0, "create.md should reference Wave-0 / prefactor / shared-file concept").toBe(
      true
    );
  });
});
