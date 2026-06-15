/**
 * Cross-application schema regression test (Phase 8, S-01).
 *
 * Re-reads the locked schemas + wrapper command docs from disk and asserts:
 *
 * 1. Each of the 5 application surfaces (plan-creation, F-01, F-02, F-03, F-04)
 *    documents a `converge.config` whose top-level keys are a subset of the
 *    locked `converge.config` schema's allowed keys (plus per-application
 *    extensions in `converge.config.applications.md`).
 * 2. The literal string `customTerminationOutcome` MUST NOT appear in
 *    `convergence-summary.schema.md` nor in any `commands/loom-*.md` wrapper —
 *    this is the OQ-01 regression guard (the decision was NOT to add that
 *    field; this test fires if anyone reintroduces it).
 * 3. Any pre-existing convergence-summary fixtures on disk conform to the
 *    locked key set.
 *
 * Pure doc-as-code: reads files from disk via fs; no script imports.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

// ---------------------------------------------------------------------------
// Helpers — minimal TOON-key extractor for the doc-embedded examples
// ---------------------------------------------------------------------------

function readRepoFile(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8");
}

/**
 * Parse a fenced ```toon ... ``` block and return the set of top-level keys.
 * Top-level = no leading whitespace on the line, of the shape `key:` or
 * `key[N]:` or `key[N]{...}:`.
 */
function topLevelKeysFromToonBlock(block: string): Set<string> {
  const keys = new Set<string>();
  for (const rawLine of block.split("\n")) {
    if (!rawLine.length) continue;
    // Top-level only — skip indented lines (table rows / nested blocks).
    if (/^\s/.test(rawLine)) continue;
    const m = rawLine.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\[[^\]]*\])?(?:\{[^}]*\})?\s*:/);
    if (m) keys.add(m[1]);
  }
  return keys;
}

/**
 * Pull the first fenced ```toon ... ``` block out of a markdown document
 * that contains the literal anchor substring (case-sensitive).
 */
function extractToonBlockNear(doc: string, anchorSubstring: string): string | null {
  const idx = doc.indexOf(anchorSubstring);
  if (idx < 0) return null;
  const fenceStart = doc.indexOf("```toon", idx);
  if (fenceStart < 0) return null;
  const bodyStart = doc.indexOf("\n", fenceStart) + 1;
  const fenceEnd = doc.indexOf("```", bodyStart);
  if (fenceEnd < 0) return null;
  return doc.slice(bodyStart, fenceEnd);
}

// ---------------------------------------------------------------------------
// Schema-derived allowed key sets (parsed once from disk)
// ---------------------------------------------------------------------------

function loadConvergeConfigAllowedKeys(): Set<string> {
  const schemaMd = readRepoFile("agents/protocols/converge.config.schema.md");
  // Extract field rows from the "Field Table" markdown table.
  // Rows look like: `| \`fieldName\` | type | ...`
  const allowed = new Set<string>();
  const re = /^\|\s*`([A-Za-z_][A-Za-z0-9_]*)`\s*\|/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(schemaMd)) !== null) {
    allowed.add(m[1]);
  }
  // Application-extension fields documented in the companion (non-modifying):
  // botAdapter, prNumber, runner are referenced as canonical members per
  // `converge.config.applications.md` (line "All field names referenced
  // below (`mode`, `subject`, ... `runner`) are members of the canonical
  // schema."). They are not in the field table, so we add them explicitly.
  for (const k of ["botAdapter", "prNumber", "runner", "mode"]) allowed.add(k);
  return allowed;
}

function loadConvergenceSummaryAllowedKeys(): Set<string> {
  const schemaMd = readRepoFile("agents/protocols/convergence-summary.schema.md");
  const allowed = new Set<string>();
  const re = /^\|\s*`([A-Za-z_][A-Za-z0-9_]*)`\s*\|/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(schemaMd)) !== null) {
    allowed.add(m[1]);
  }
  return allowed;
}

// ---------------------------------------------------------------------------
// Wrapper-doc anchors per application
// ---------------------------------------------------------------------------

interface AppDescriptor {
  id: string;
  wrapperDoc: string; // repo-relative path to commands/loom-*.md
  anchor: string;     // substring near which the wrapper's example converge.config block lives
}

const APPLICATIONS: AppDescriptor[] = [
  {
    id: "F-01",
    wrapperDoc: "commands/loom-code.md",
    anchor: "Step A — Generate converge.config",
  },
  {
    id: "F-02",
    wrapperDoc: "commands/loom-test.md",
    anchor: "Step 3a: Generate converge.config",
  },
  {
    id: "F-03",
    wrapperDoc: "commands/loom-bugfix.md",
    anchor: "Step A2: Generate the converge.config",
  },
  {
    id: "F-04",
    wrapperDoc: "commands/loom-git.md",
    anchor: "Step 3: Generate the converge.config.",
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("S-01 / cross-application schema conformance", () => {
  const allowedConfigKeys = loadConvergeConfigAllowedKeys();
  const allowedSummaryKeys = loadConvergenceSummaryAllowedKeys();

  it("converge.config.schema.md exposes the expected canonical key set", () => {
    // Sanity: the parser must find the canonical required fields.
    for (const k of [
      "runId",
      "convergenceMode",
      "subject",
      "harness",
      "integrator",
      "maxIterations",
      "agentBudget",
    ]) {
      expect(allowedConfigKeys.has(k)).toBe(true);
    }
  });

  it("convergence-summary.schema.md exposes the expected canonical key set", () => {
    for (const k of [
      "runId",
      "convergenceMode",
      "subject",
      "harnessName",
      "integratorName",
      "status",
      "finalBlockingCount",
      "iterationsRun",
      "startedAt",
      "completedAt",
    ]) {
      expect(allowedSummaryKeys.has(k)).toBe(true);
    }
  });

  for (const app of APPLICATIONS) {
    it(`${app.id}: ${app.wrapperDoc} documents a converge.config whose keys are a subset of the locked schema`, () => {
      const doc = readRepoFile(app.wrapperDoc);
      const block = extractToonBlockNear(doc, app.anchor);
      expect(block, `Could not find a \`\`\`toon block near anchor "${app.anchor}" in ${app.wrapperDoc}`).not.toBeNull();
      const keys = topLevelKeysFromToonBlock(block as string);
      expect(keys.size, `Expected at least one top-level key in ${app.wrapperDoc} converge.config block`).toBeGreaterThan(0);

      for (const k of keys) {
        expect(
          allowedConfigKeys.has(k),
          `${app.id}: key '${k}' in ${app.wrapperDoc} is NOT in the locked converge.config schema. ` +
            `Allowed: ${[...allowedConfigKeys].sort().join(", ")}`,
        ).toBe(true);
      }
    });
  }

  it("plan-creation surface: converge.config schema (locked) is documented and reachable", () => {
    // Plan-creation does not have a dedicated wrapper command in commands/loom-*.md
    // (it predates the convergence-applications work). The acceptance criterion
    // for plan-creation is that the locked schema itself remains valid and that
    // the canonical document-mode example in the schema parses to a subset of
    // its own field table.
    const schemaMd = readRepoFile("agents/protocols/converge.config.schema.md");
    const block = extractToonBlockNear(schemaMd, "TOON Example (document mode)");
    expect(block).not.toBeNull();
    const keys = topLevelKeysFromToonBlock(block as string);
    for (const k of keys) {
      expect(
        allowedConfigKeys.has(k),
        `plan-creation: key '${k}' in canonical schema example is NOT in field table`,
      ).toBe(true);
    }
  });

  it("on-disk convergence-summary.toon fixtures (if any) have keys subset of locked schema", () => {
    // Best-effort scan for fixtures left over from prior wave runs. If none
    // exist, this assertion is a no-op (the contract is "if any fixtures
    // exist, they MUST conform"). This catches drift the moment a fixture
    // captures an out-of-schema key.
    const candidateRoots = [
      "test/fixtures",
      ".plan-execution/convergence",
      ".plan-execution/pr-review",
    ];
    const found: string[] = [];
    for (const root of candidateRoots) {
      const abs = path.join(REPO_ROOT, root);
      if (!fs.existsSync(abs)) continue;
      walk(abs, (p) => {
        if (p.endsWith("convergence-summary.toon")) found.push(p);
      });
    }

    for (const abs of found) {
      const content = fs.readFileSync(abs, "utf8");
      const keys = topLevelKeysFromToonBlock(content);
      for (const k of keys) {
        expect(
          allowedSummaryKeys.has(k),
          `Fixture ${abs}: key '${k}' is NOT in the locked convergence-summary schema`,
        ).toBe(true);
      }
    }
  });
});

describe("OQ-01 regression: customTerminationOutcome MUST NOT exist", () => {
  const filesToScan = [
    "agents/protocols/convergence-summary.schema.md",
    "agents/protocols/converge.config.schema.md",
    "agents/protocols/converge.config.applications.md",
    "agents/protocols/findings.schema.md",
    "agents/protocols/iteration-snapshot.schema.md",
    "commands/loom-code.md",
    "commands/loom-test.md",
    "commands/loom-bugfix.md",
    "commands/loom-git.md",
  ];

  for (const rel of filesToScan) {
    it(`${rel} does not contain 'customTerminationOutcome'`, () => {
      const abs = path.join(REPO_ROOT, rel);
      // If the file doesn't exist, skip rather than fail — keeps the test
      // resilient if a wrapper is renamed.
      if (!fs.existsSync(abs)) return;
      const content = fs.readFileSync(abs, "utf8");
      expect(
        content.includes("customTerminationOutcome"),
        `${rel} contains the forbidden token 'customTerminationOutcome' (OQ-01 was decided NOT to add this field).`,
      ).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function walk(root: string, visit: (absPath: string) => void): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const abs = path.join(root, e.name);
    if (e.isDirectory()) {
      // Avoid descending into node_modules / .git for safety.
      if (e.name === "node_modules" || e.name === ".git") continue;
      walk(abs, visit);
    } else if (e.isFile()) {
      visit(abs);
    }
  }
}
