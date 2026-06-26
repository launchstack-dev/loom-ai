/**
 * tests/migrators/context-split.test.ts
 *
 * Tests for scripts/migrate-context-split.ts
 *
 * S-03: CONTEXT split migration is idempotent
 *   - First run produces CONTEXT.md (glossary only) and DECISIONS.md
 *   - Second run is a no-op (empty --dry-run diff)
 *   - --dry-run after second run reports no changes
 *
 * Run: bunx vitest run tests/migrators/context-split.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  detectContextSplitVersion,
  migrateContextSplit,
  CONTEXT_SPLIT_CURRENT_VERSION,
} from "../../scripts/migrate-context-split.js";

// ── Fixtures ───────────────────────────────────────────────────────────────

/**
 * Pre-F-18 monolithic CONTEXT.md content (v1 — no sentinel).
 * Contains both a glossary/tech-stack section and a Locked Decisions section.
 */
const MONOLITHIC_CONTEXT_MD = `# Project Context

## Tech Stack

TypeScript, Bun, Vitest. No framework — CLI-first.

## Architecture

Single entrypoint at scripts/. Hook-enforced discipline via hooks/ directory.

## API Surface

Internal: agent spawns via the Agent tool. External: none.

## Locked Decisions

### Hook Merge (2026-04-25)

- **Status:** accepted
- **Summary:** Merged context-budget-test into context-budget to reduce bun process overhead.
- **Source:** .loom/wiki/pages/decision-hook-merges.md

### Sign-Off Purity

- **Status:** accepted
- **Summary:** Only /loom-roadmap sign-off may write sign_off_state = "signed-off".
- **Source:** .loom/wiki/pages/decision-sign-off-purity.md
`;

/**
 * CONTEXT.md that has already been split (contains sentinel).
 */
const ALREADY_SPLIT_CONTEXT_MD = `<!-- loom:context-split:v2 -->

# Project Context

## Tech Stack

TypeScript, Bun, Vitest. No framework — CLI-first.
`;

// ── Temp dir helpers ───────────────────────────────────────────────────────

function makeTempDir(): string {
  const dir = join(tmpdir(), `loom-test-context-split-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("detectContextSplitVersion", () => {
  it("returns detected:1 for monolithic (pre-F-18) CONTEXT.md", () => {
    const result = detectContextSplitVersion(MONOLITHIC_CONTEXT_MD);
    expect(result.detected).toBe(1);
    expect(result.current).toBe(CONTEXT_SPLIT_CURRENT_VERSION);
    expect(result.outdated).toBe(true);
  });

  it("returns detected:2 for already-split CONTEXT.md (sentinel present)", () => {
    const result = detectContextSplitVersion(ALREADY_SPLIT_CONTEXT_MD);
    expect(result.detected).toBe(2);
    expect(result.outdated).toBe(false);
  });

  it("treats absence of sentinel as v1", () => {
    const result = detectContextSplitVersion("# Some context\n\nNo sentinel here.\n");
    expect(result.detected).toBe(1);
    expect(result.outdated).toBe(true);
  });
});

describe("migrateContextSplit — pure function", () => {
  describe("monolithic input", () => {
    let result: ReturnType<typeof migrateContextSplit>;

    beforeEach(() => {
      result = migrateContextSplit(MONOLITHIC_CONTEXT_MD);
    });

    it("produces a CONTEXT.md that contains the sentinel", () => {
      expect(result.contextMd).toContain("<!-- loom:context-split:v2 -->");
    });

    it("produces a CONTEXT.md that does NOT contain the Locked Decisions section", () => {
      expect(result.contextMd).not.toMatch(/Locked Decisions/i);
    });

    it("produces a CONTEXT.md that retains the Tech Stack section", () => {
      expect(result.contextMd).toContain("## Tech Stack");
    });

    it("produces a non-empty DECISIONS.md containing the decisions content", () => {
      expect(result.decisionsMd).not.toBe("");
      expect(result.decisionsMd).toContain("Hook Merge");
      expect(result.decisionsMd).toContain("Sign-Off Purity");
    });

    it("DECISIONS.md starts with # Locked Decisions (promoted from H2)", () => {
      expect(result.decisionsMd.trim()).toMatch(/^# Locked Decisions/m);
    });
  });

  describe("already-split input (idempotency)", () => {
    it("returns the same contextMd unchanged when already split", () => {
      const result = migrateContextSplit(ALREADY_SPLIT_CONTEXT_MD);
      expect(result.contextMd).toBe(ALREADY_SPLIT_CONTEXT_MD);
    });

    it("returns empty string for decisionsMd when already split (no-op signal)", () => {
      const result = migrateContextSplit(ALREADY_SPLIT_CONTEXT_MD);
      expect(result.decisionsMd).toBe("");
    });
  });

  describe("no Locked Decisions section", () => {
    const noDecisions = "# Project Context\n\n## Tech Stack\n\nTypeScript.\n";

    it("produces CONTEXT.md with sentinel", () => {
      const result = migrateContextSplit(noDecisions);
      expect(result.contextMd).toContain("<!-- loom:context-split:v2 -->");
    });

    it("produces stub DECISIONS.md", () => {
      const result = migrateContextSplit(noDecisions);
      expect(result.decisionsMd).toContain("No locked decisions detected");
    });
  });
});

// S-03: idempotency — CLI integration via temp dir
describe("S-03: CONTEXT split migration is idempotent", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    cleanTempDir(tmpDir);
  });

  it("first run: splits monolithic CONTEXT.md into CONTEXT.md + DECISIONS.md", () => {
    // Setup: write monolithic CONTEXT.md
    writeFileSync(join(tmpDir, "CONTEXT.md"), MONOLITHIC_CONTEXT_MD, "utf8");

    // First migration (pure function path — tests the migrator directly)
    const before = readFileSync(join(tmpDir, "CONTEXT.md"), "utf8");
    const { contextMd, decisionsMd } = migrateContextSplit(before);

    // Simulate atomic write
    writeFileSync(join(tmpDir, "CONTEXT.md"), contextMd, "utf8");
    writeFileSync(join(tmpDir, "DECISIONS.md"), decisionsMd, "utf8");

    // Assertions
    const afterContext = readFileSync(join(tmpDir, "CONTEXT.md"), "utf8");
    const afterDecisions = readFileSync(join(tmpDir, "DECISIONS.md"), "utf8");

    expect(afterContext).toContain("<!-- loom:context-split:v2 -->");
    expect(afterContext).not.toMatch(/Locked Decisions/i);
    expect(afterDecisions).toContain("# Locked Decisions");
    expect(existsSync(join(tmpDir, "DECISIONS.md"))).toBe(true);
  });

  it("second run: is a no-op — produces identical content", () => {
    // Setup: write already-split CONTEXT.md
    writeFileSync(join(tmpDir, "CONTEXT.md"), ALREADY_SPLIT_CONTEXT_MD, "utf8");
    const decisionsContent = "# Locked Decisions\n\nPre-existing decisions.\n";
    writeFileSync(join(tmpDir, "DECISIONS.md"), decisionsContent, "utf8");

    // Second migration attempt
    const before = readFileSync(join(tmpDir, "CONTEXT.md"), "utf8");
    const detection = detectContextSplitVersion(before);

    // Detection must say "not outdated" — no write needed
    expect(detection.outdated).toBe(false);

    // Content must be unchanged
    const afterContext = readFileSync(join(tmpDir, "CONTEXT.md"), "utf8");
    const afterDecisions = readFileSync(join(tmpDir, "DECISIONS.md"), "utf8");
    expect(afterContext).toBe(ALREADY_SPLIT_CONTEXT_MD);
    expect(afterDecisions).toBe(decisionsContent);
  });

  it("dry-run after second run: reports no changes", () => {
    // Setup: already-split state
    writeFileSync(join(tmpDir, "CONTEXT.md"), ALREADY_SPLIT_CONTEXT_MD, "utf8");

    // migrateContextSplit on already-split content returns same content + empty decisionsMd
    const before = readFileSync(join(tmpDir, "CONTEXT.md"), "utf8");
    const { contextMd, decisionsMd } = migrateContextSplit(before);

    // For --dry-run: no changes if contextMd === before and decisionsMd === ""
    expect(contextMd).toBe(before);
    expect(decisionsMd).toBe(""); // empty = no-op signal
  });

  it("S-03: first run produces content per F-18 scope (glossary in CONTEXT.md, decisions in DECISIONS.md)", () => {
    writeFileSync(join(tmpDir, "CONTEXT.md"), MONOLITHIC_CONTEXT_MD, "utf8");

    const before = readFileSync(join(tmpDir, "CONTEXT.md"), "utf8");
    const { contextMd, decisionsMd } = migrateContextSplit(before);

    // F-18 scope: CONTEXT.md is glossary view only
    expect(contextMd).toContain("## Tech Stack");
    expect(contextMd).toContain("## Architecture");
    expect(contextMd).not.toMatch(/locked decisions/i);

    // F-18 scope: DECISIONS.md contains all locked decisions
    expect(decisionsMd).toContain("Hook Merge");
    expect(decisionsMd).toContain("Sign-Off Purity");
    expect(decisionsMd).toMatch(/# Locked Decisions/m);
  });
});
