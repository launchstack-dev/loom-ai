/**
 * Tests for v3→v4 library catalog migration (Phase 1 deliverable).
 *
 * Covers behavioural assertions for:
 *   - migrateLibraryCatalogV3ToV4 (direct call, error paths, requires-rewrite)
 *   - MIGRATIONS["3->4"] registration in the canonical migration registry
 *   - detectLibraryCatalogVersion v4-awareness
 *   - migrateToLatest single-step (v3→v4), chained walk (v2→v4), idempotency (v4→v4)
 *   - CURRENT_VERSION bump to 4
 *
 * Maps to spec IDs: ct-1-01, ct-2-01, ct-2-02, bt-1-01 through bt-1-12, bt-2-02 through bt-2-08
 * (bt-2-01 / bt-2-07 / bt-2-08 are bun-test gate assertions; exercised by CI)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Contract test ct-2-01: must import from hooks/lib/library-catalog-migrator.ts (not a mock).
import {
  migrateToLatest,
  detectLibraryCatalogVersion,
  MIGRATIONS,
  CURRENT_VERSION,
  migrateLibraryCatalogV3ToV4,
  type AnyLibraryCatalog,
  type LibraryCatalogV3,
  type LibraryCatalogV4,
  type MigrationStep,
} from "../hooks/lib/library-catalog-migrator.js";

import {
  MigrationSchemaVersionMismatchError,
  MigrationDowngradeError,
  MissingMigrationStepError,
} from "../hooks/lib/migration-errors.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Contract test ct-2-02: fixtures loaded from test-fixtures/library-catalog-migration/
// loadFixture returns raw YAML string (for detectLibraryCatalogVersion which takes strings)
function loadFixture(rel: string): string {
  return readFileSync(resolve(__dirname, rel), "utf-8");
}

const FIXTURE_DIR = "../test-fixtures/library-catalog-migration";

// ---------------------------------------------------------------------------
// Inline object fixtures — used for migrator functions that take parsed objects.
// Mirrors the YAML file content without requiring a YAML parser package.
// ---------------------------------------------------------------------------

/** Mirrors v3-input.yaml — v3 catalog with skill:-prefixed requires: (F-002) */
const V3_INPUT_OBJ = {
  catalog_version: 3,
  repo: "https://github.com/launchstack-dev/loom-ai",
  loomCoreVersion: "0.1.0",
  loomHooksVersion: "0.1.0",
  releases: [
    {
      version: "0.1.0",
      coreTarball:
        "https://github.com/launchstack-dev/loom-ai/releases/download/v0.1.0/loom-core-v0.1.0.tar.gz",
      hooksTarball:
        "https://github.com/launchstack-dev/loom-ai/releases/download/v0.1.0/loom-hooks-v0.1.0.tar.gz",
      cosignSignature:
        "https://github.com/launchstack-dev/loom-ai/releases/download/v0.1.0/loom-core-v0.1.0.tar.gz.sig",
      sha256Manifest:
        "https://github.com/launchstack-dev/loom-ai/releases/download/v0.1.0/SHA256SUMS",
      releasedAt: "2026-06-01T00:00:00Z",
    },
  ],
  default_dirs: {
    skills: [{ default: ".claude/skills/" }, { global: "~/.claude/skills/" }],
    agents: [{ default: ".claude/agents/" }, { global: "~/.claude/agents/" }],
    prompts: [{ default: ".claude/commands/" }, { global: "~/.claude/commands/" }],
  },
  library: {
    skills: [
      {
        name: "execution-protocols",
        description: "Inter-agent protocol schemas for the Loom execution pipeline",
        source: "agents/protocols/execution-conventions.md",
      },
      {
        name: "toon-format-protocol",
        description: "TOON format specification for all on-disk artifacts",
        source: "agents/protocols/toon-format.md",
      },
    ],
    agents: [
      {
        name: "contracts-agent",
        description: "Generates contract files and type definitions from plan specs",
        source: "agents/contracts-agent.md",
        requires: ["skill:execution-protocols", "skill:toon-format-protocol"],
      },
    ],
    prompts: [],
  },
  kits: [
    {
      name: "data-engineering",
      description: "Data pipeline quality gates",
      version: "1.1.0",
      minLoomVersion: 3,
      includes: ["data-schema-reviewer"],
      command: "loom-data.md",
    },
  ],
};

/** Mirrors v4-expected.yaml — migrated v4 catalog with protocol: prefix and empty skills[] */
const V4_EXPECTED_OBJ = {
  catalog_version: 4,
  repo: "https://github.com/launchstack-dev/loom-ai",
  loomCoreVersion: "0.1.0",
  loomHooksVersion: "0.1.0",
  releases: [
    {
      version: "0.1.0",
      coreTarball:
        "https://github.com/launchstack-dev/loom-ai/releases/download/v0.1.0/loom-core-v0.1.0.tar.gz",
      hooksTarball:
        "https://github.com/launchstack-dev/loom-ai/releases/download/v0.1.0/loom-hooks-v0.1.0.tar.gz",
      cosignSignature:
        "https://github.com/launchstack-dev/loom-ai/releases/download/v0.1.0/loom-core-v0.1.0.tar.gz.sig",
      sha256Manifest:
        "https://github.com/launchstack-dev/loom-ai/releases/download/v0.1.0/SHA256SUMS",
      releasedAt: "2026-06-01T00:00:00Z",
    },
  ],
  default_dirs: {
    skills: [{ default: ".claude/skills/" }, { global: "~/.claude/skills/" }],
    agents: [{ default: ".claude/agents/" }, { global: "~/.claude/agents/" }],
    prompts: [{ default: ".claude/commands/" }, { global: "~/.claude/commands/" }],
  },
  library: {
    protocols: [
      {
        name: "execution-protocols",
        description: "Inter-agent protocol schemas for the Loom execution pipeline",
        source: "agents/protocols/execution-conventions.md",
      },
      {
        name: "toon-format-protocol",
        description: "TOON format specification for all on-disk artifacts",
        source: "agents/protocols/toon-format.md",
      },
    ],
    skills: [],
    agents: [
      {
        name: "contracts-agent",
        description: "Generates contract files and type definitions from plan specs",
        source: "agents/contracts-agent.md",
        requires: ["protocol:execution-protocols", "protocol:toon-format-protocol"],
      },
    ],
    prompts: [],
  },
  kits: [
    {
      name: "data-engineering",
      description: "Data pipeline quality gates",
      version: "1.1.0",
      minLoomVersion: 3,
      includes: ["data-schema-reviewer"],
      command: "loom-data.md",
    },
  ],
};

/** Mirrors v4-idempotency-input.yaml — already-v4 catalog (round-trip unchanged) */
const V4_IDEMPOTENCY_OBJ = {
  catalog_version: 4,
  repo: "https://github.com/launchstack-dev/loom-ai",
  loomCoreVersion: "0.1.0",
  loomHooksVersion: "0.1.0",
  releases: [],
  default_dirs: {
    skills: [{ default: ".claude/skills/" }, { global: "~/.claude/skills/" }],
    agents: [{ default: ".claude/agents/" }, { global: "~/.claude/agents/" }],
    prompts: [{ default: ".claude/commands/" }, { global: "~/.claude/commands/" }],
  },
  library: {
    protocols: [
      {
        name: "execution-protocols",
        description: "Inter-agent protocol schemas for the Loom execution pipeline",
        source: "agents/protocols/execution-conventions.md",
      },
    ],
    skills: [
      {
        name: "python-conventions",
        description: "Python ecosystem conventions for Loom projects",
        source: "skills/python-conventions/SKILL.md",
        triggers: ["**/*.py", "**/pyproject.toml", "**/requirements.txt"],
      },
    ],
    agents: [],
    prompts: [],
  },
  kits: [
    {
      name: "python-conventions",
      description: "Python conventions kit",
      version: "1.0.0",
      includes: [{ type: "skill", name: "python-conventions" }],
    },
  ],
};

const MOCK_OPTS = { coreVersion: "0.1.0", hooksVersion: "0.1.0" };

// ---------------------------------------------------------------------------
// Phase 1 invariants — CURRENT_VERSION bump and real MIGRATIONS["3->4"] step
// ---------------------------------------------------------------------------

describe("library-catalog-migrator — Phase 1 invariants", () => {
  // Spec: ct-1-01 — CURRENT_VERSION is bumped to 4 after Phase 1 lands.
  it("CURRENT_VERSION equals 4 after Phase 1 bump", () => {
    // Spec: ct-0-06 / ct-1-01
    expect(CURRENT_VERSION).toBe(4);
  });

  // Spec: ct-0-07 / bt-1-01 — MIGRATIONS["3->4"] is now the real migrator (no longer a no-op).
  it('MIGRATIONS["3->4"] is the real migrator and produces v4 output', () => {
    // Spec: ct-0-07, bt-0-02, bt-1-01
    // Phase 1 replaces the Phase 0 no-op passthrough with the real implementation.
    const step = (MIGRATIONS as Record<string, MigrationStep>)["3->4"];
    expect(step).toBeTypeOf("function");
    const v3 = V3_INPUT_OBJ as unknown as LibraryCatalogV3;
    const result: any = step(v3, MOCK_OPTS);
    expect(result.catalog_version).toBe(4);
    expect(result.library.protocols).toBeDefined();
    expect(Array.isArray(result.library.skills)).toBe(true);
    expect(result.library.skills).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Fixture integrity (bt-0-03, bt-0-04)
// ---------------------------------------------------------------------------

describe("library-catalog-migration fixtures", () => {
  // Spec: bt-0-03 — v3-input.yaml contains an agent entry with skill:-prefixed requires:
  it("v3-input.yaml fixture contains agent entry with requires: [skill:...] (F-002 fixture requirement)", () => {
    // Spec: bt-0-03
    // Verified via inline object (mirrors v3-input.yaml; file is also read for string-based tests)
    const agents: any[] = V3_INPUT_OBJ?.library?.agents ?? [];
    const agentWithSkillRequires = agents.find((a: any) =>
      Array.isArray(a.requires) && a.requires.some((r: string) => r.startsWith("skill:"))
    );
    expect(agentWithSkillRequires).toBeDefined();
  });

  // Spec: bt-0-04 — All three fixture files are readable as non-empty strings
  it("v3-input.yaml file exists and is readable", () => {
    // Spec: bt-0-04
    const content = loadFixture(`${FIXTURE_DIR}/v3-input.yaml`);
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain("catalog_version: 3");
  });

  it("v4-expected.yaml file exists and is readable", () => {
    // Spec: bt-0-04
    const content = loadFixture(`${FIXTURE_DIR}/v4-expected.yaml`);
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain("catalog_version: 4");
  });

  it("v4-idempotency-input.yaml file exists and is readable", () => {
    // Spec: bt-0-04
    const content = loadFixture(`${FIXTURE_DIR}/v4-idempotency-input.yaml`);
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain("catalog_version: 4");
  });
});

// ---------------------------------------------------------------------------
// detectLibraryCatalogVersion — v4 detection (bt-1-10, bt-1-11, bt-1-12)
// ---------------------------------------------------------------------------

describe("detectLibraryCatalogVersion — v4 awareness", () => {
  // Spec: bt-1-10 — v4 catalog string returns { version: 4, outdated: false }
  it("returns { version: 4, outdated: false } for a valid v4 catalog string", () => {
    // Spec: bt-1-10
    const v4Content = loadFixture(`${FIXTURE_DIR}/v4-idempotency-input.yaml`);
    const result = detectLibraryCatalogVersion(v4Content);
    // TODO: confirm exact return shape once Phase 1 extends detectLibraryCatalogVersion
    expect(result.version).toBe(4);
    expect(result.outdated).toBe(false);
  });

  // Spec: bt-1-11 — v3 catalog string returns { version: 3, outdated: true }
  it("returns { version: 3, outdated: true } for a v3 catalog string missing library.protocols:", () => {
    // Spec: bt-1-11
    const v3Content = loadFixture(`${FIXTURE_DIR}/v3-input.yaml`);
    const result = detectLibraryCatalogVersion(v3Content);
    expect(result.version).toBe(3);
    expect(result.outdated).toBe(true);
  });

  // Spec: bt-1-12 — line-anchored detection prevents substring smuggling
  it("does not match catalog_version: 34 as v4 (line-anchored regex)", () => {
    // Spec: bt-1-12
    const crafted = `catalog_version: 34\nrepo: https://github.com/launchstack-dev/loom-ai\n`;
    const result = detectLibraryCatalogVersion(crafted);
    expect(result.version).not.toBe(4);
  });
});

// ---------------------------------------------------------------------------
// migrateLibraryCatalogV3ToV4 — direct function (bt-1-01, bt-1-02, bt-1-03, bt-1-04)
// ---------------------------------------------------------------------------

describe("migrateLibraryCatalogV3ToV4", () => {
  // Spec: bt-1-01 — renames library.skills → library.protocols; initializes library.skills: []
  it("renames library.skills to library.protocols and initializes library.skills as empty array", () => {
    // Spec: bt-1-01, bt-2-02 (partial)
    const v3 = V3_INPUT_OBJ as unknown as LibraryCatalogV3;
    const v4: any = migrateLibraryCatalogV3ToV4(v3, MOCK_OPTS);
    expect(v4.library.protocols).toBeDefined();
    expect(Array.isArray(v4.library.skills)).toBe(true);
    expect(v4.library.skills).toHaveLength(0);
    expect(v4.catalog_version).toBe(4);
  });

  // Spec: bt-1-02 — rewrites requires: [skill:*] → requires: [protocol:*] (F-002)
  it("rewrites agent requires: entries prefixed skill: to protocol: (F-002)", () => {
    // Spec: bt-1-02, bt-2-06
    const v3 = V3_INPUT_OBJ as unknown as LibraryCatalogV3;
    const v4: any = migrateLibraryCatalogV3ToV4(v3, MOCK_OPTS);
    const agents: any[] = v4.library.agents ?? [];
    const agentWithRequires = agents.find((a: any) => Array.isArray(a.requires));
    expect(agentWithRequires).toBeDefined();
    const allRequires: string[] = agentWithRequires.requires;
    // No requires: item should still start with "skill:"
    const stillSkillPrefixed = allRequires.filter((r) => r.startsWith("skill:"));
    expect(stillSkillPrefixed).toHaveLength(0);
    // All formerly-skill: items are now protocol:
    const protocolPrefixed = allRequires.filter((r) => r.startsWith("protocol:"));
    expect(protocolPrefixed.length).toBeGreaterThan(0);
  });

  // Spec: bt-1-03 — throws MigrationSchemaVersionMismatchError when catalog_version !== 3
  it("throws MigrationSchemaVersionMismatchError when input catalog_version is not 3", () => {
    // Spec: bt-1-03, bt-2-05
    // v2-shaped input: catalog_version: 2
    const v2Input = {
      catalog_version: 2,
      repo: "https://github.com/launchstack-dev/loom-ai",
      library: {},
      kits: [],
    };
    expect(() => migrateLibraryCatalogV3ToV4(v2Input as any, MOCK_OPTS)).toThrow(
      MigrationSchemaVersionMismatchError
    );
  });

  // Spec: bt-1-04 — throws MigrationSchemaVersionMismatchError with null input
  it("throws MigrationSchemaVersionMismatchError with null input (P1)", () => {
    // Spec: bt-1-04
    expect(() => migrateLibraryCatalogV3ToV4(null as any, MOCK_OPTS)).toThrow(
      MigrationSchemaVersionMismatchError
    );
  });
});

// ---------------------------------------------------------------------------
// Golden-file test: migrateToLatest v3 → v4 (bt-2-02)
// ---------------------------------------------------------------------------

describe("migrateToLatest — v3 → v4 golden file", () => {
  // Spec: bt-2-02 — output deep-equals v4-expected.yaml (ignoring releasedAt)
  it("migrateToLatest(v3Input, 3, opts) output matches v4-expected.yaml (ignoring releasedAt)", () => {
    // Spec: bt-1-05, bt-2-02
    const v3: any = V3_INPUT_OBJ;
    const expected: any = V4_EXPECTED_OBJ;

    // Inject "3->4" step; will use real implementation after Phase 1 lands
    const registry = {
      ...(MIGRATIONS as Record<string, MigrationStep>),
      "3->4": (input: any, opts: any) => migrateLibraryCatalogV3ToV4(input, opts),
    };

    const result: any = migrateToLatest(v3 as AnyLibraryCatalog, 3, MOCK_OPTS, 4, registry as any);
    expect(result.catalog_version).toBe(4);

    // Deep comparison ignoring releasedAt timestamps
    const stripReleasedAt = (obj: any) => {
      if (!obj?.releases) return obj;
      return {
        ...obj,
        releases: obj.releases.map(({ releasedAt: _ra, ...rest }: any) => rest),
      };
    };
    expect(stripReleasedAt(result)).toEqual(stripReleasedAt(expected));
  });
});

// ---------------------------------------------------------------------------
// Idempotency test (bt-2-03)
// ---------------------------------------------------------------------------

describe("migrateToLatest — idempotency", () => {
  // Spec: bt-2-03 — v4 input returns structurally identical output
  it("migrateToLatest(v4Input, 4, opts) returns input unchanged", () => {
    // Spec: bt-1-06, bt-2-03
    const v4: any = V4_IDEMPOTENCY_OBJ;
    const result: any = migrateToLatest(v4 as AnyLibraryCatalog, 4, MOCK_OPTS);
    expect(result).toEqual(v4);
    expect(result.catalog_version).toBe(4);
    expect(result.library.protocols).toBeDefined();
    expect(result.library.skills).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Chained walk test v2 → v4 (bt-2-04)
// ---------------------------------------------------------------------------

describe("migrateToLatest — chained walk v2 → v4", () => {
  // Spec: bt-2-04, bt-1-07 — v2 input chains v2→v3→v4
  it("migrateToLatest(v2Input, 2, opts) chains to v4 shape with correct fields", () => {
    // Spec: bt-1-07, bt-2-04
    // v2-shaped input mirrors v2-input.yaml fixture
    const v2: any = {
      catalog_version: 2,
      repo: "https://github.com/launchstack-dev/loom-ai",
      default_dirs: {
        skills: [{ default: ".claude/skills/" }, { global: "~/.claude/skills/" }],
        agents: [{ default: ".claude/agents/" }, { global: "~/.claude/agents/" }],
        prompts: [{ default: ".claude/commands/" }, { global: "~/.claude/commands/" }],
      },
      library: { skills: [], agents: [], prompts: [] },
      kits: [
        {
          name: "data-engineering",
          description: "Data pipeline quality gates",
          version: "1.1.0",
          minLoomVersion: 3,
          includes: ["data-schema-reviewer"],
          command: "loom-data.md",
        },
      ],
    };

    const registry = {
      ...(MIGRATIONS as Record<string, MigrationStep>),
      "3->4": (input: any, opts: any) => migrateLibraryCatalogV3ToV4(input, opts),
    };

    const result: any = migrateToLatest(v2, 2, MOCK_OPTS, 4, registry as any);
    expect(result.catalog_version).toBe(4);
    expect(result.library.protocols).toBeDefined();
    expect(Array.isArray(result.library.skills)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Error path tests (bt-2-05, bt-1-08, bt-1-09)
// ---------------------------------------------------------------------------

describe("migrateToLatest — error paths", () => {
  // Spec: bt-1-08 — throws MigrationDowngradeError when fromVersion > targetVersion
  it("throws MigrationDowngradeError when fromVersion > targetVersion (P1)", () => {
    // Spec: bt-1-08
    expect(() => migrateToLatest(V4_IDEMPOTENCY_OBJ as AnyLibraryCatalog, 4, MOCK_OPTS, 3)).toThrow(
      MigrationDowngradeError
    );
  });

  // Spec: bt-1-09 — throws MissingMigrationStepError when registry missing step
  it("throws MissingMigrationStepError when registry is missing required step key (P1)", () => {
    // Spec: bt-1-09
    const emptyRegistry = {} as any;
    expect(() => migrateToLatest(V3_INPUT_OBJ as AnyLibraryCatalog, 3, MOCK_OPTS, 4, emptyRegistry)).toThrow(
      MissingMigrationStepError
    );
  });
});

// ---------------------------------------------------------------------------
// requires-rewrite test using v3-input.yaml fixture directly (bt-2-06)
// ---------------------------------------------------------------------------

describe("v3→v4 migration — requires: rewrite via migrateToLatest", () => {
  // Spec: bt-2-06 — skill:-prefixed requires items become protocol: in v4 output
  // Uses the SAME V3_INPUT_OBJ fixture object (mirrors v3-input.yaml) to maximize reuse (spec intent)
  it("agent requires:[skill:some-protocol] in v3-input.yaml becomes requires:[protocol:...] in v4", () => {
    // Spec: bt-2-06
    const registry = {
      ...(MIGRATIONS as Record<string, MigrationStep>),
      "3->4": (input: any, opts: any) => migrateLibraryCatalogV3ToV4(input, opts),
    };
    const result: any = migrateToLatest(V3_INPUT_OBJ as AnyLibraryCatalog, 3, MOCK_OPTS, 4, registry as any);
    const agents: any[] = result.library.agents ?? [];
    for (const agent of agents) {
      if (Array.isArray(agent.requires)) {
        const skillPrefixed = agent.requires.filter((r: string) => r.startsWith("skill:"));
        expect(skillPrefixed).toHaveLength(0);
      }
    }
    // Confirm at least one agent has protocol:-prefixed requires (fixture guarantee)
    const agentWithProtocolRequires = agents.find(
      (a: any) =>
        Array.isArray(a.requires) && a.requires.some((r: string) => r.startsWith("protocol:"))
    );
    expect(agentWithProtocolRequires).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// detectLibraryCatalogVersion — partial-v4 detection (Finding #15)
// ---------------------------------------------------------------------------

describe("detectLibraryCatalogVersion — partial-v4 (missing library markers)", () => {
  // Finding #15: a string that has catalog_version: 4 plus the three v3 top-level
  // markers (loomCoreVersion / loomHooksVersion / releases) but is missing both
  // library.protocols: and library.skills: markers must return
  // { version: 4, outdated: true, reason: /missing library/ }.
  it("returns { version: 4, outdated: true } for a v4 catalog missing library.protocols: and library.skills: markers", () => {
    const partialV4 = [
      "catalog_version: 4",
      "repo: https://github.com/launchstack-dev/loom-ai",
      "loomCoreVersion: 0.1.0",
      "loomHooksVersion: 0.1.0",
      "releases:",
      "  - version: 0.1.0",
      "library:",
      "  agents: []",
    ].join("\n");

    const result = detectLibraryCatalogVersion(partialV4);
    expect(result.version).toBe(4);
    expect(result.outdated).toBe(true);
    // Reason must reference the missing library section markers.
    expect(result.reason).toMatch(/missing library/);
  });
});
