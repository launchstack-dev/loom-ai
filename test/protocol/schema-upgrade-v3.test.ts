import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  detectInstallStateVersion,
  migrateInstallStateV2ToV3,
  migrateToLatest as migrateInstallStateToLatest,
  MIGRATIONS as INSTALL_STATE_MIGRATIONS,
  CURRENT_VERSION as INSTALL_STATE_CURRENT_VERSION,
  type InstallStateV2,
} from "../../hooks/lib/install-state-migrator.js";

import {
  detectLibraryCatalogVersion,
  migrateLibraryCatalogV2ToV3,
  migrateToLatest as migrateLibraryCatalogToLatest,
  MIGRATIONS as LIBRARY_CATALOG_MIGRATIONS,
  CURRENT_VERSION as LIBRARY_CATALOG_CURRENT_VERSION,
  type LibraryCatalogV2,
} from "../../hooks/lib/library-catalog-migrator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(rel: string): string {
  return readFileSync(resolve(__dirname, rel), "utf-8");
}

const FIXED_NOW = "2026-06-01T00:00:00Z";
const FIXED_SHA = "deadbeef";

// ---------------------------------------------------------------------------
// install-state.toon: detection
// ---------------------------------------------------------------------------

describe("detectInstallStateVersion", () => {
  it("detects v2 as outdated", () => {
    const v2 = loadFixture("../../test-fixtures/install-state-migration/v2-input.toon");
    const result = detectInstallStateVersion(v2);
    expect(result.version).toBe(2);
    expect(result.outdated).toBe(true);
    expect(result.reason).toMatch(/Rule 12/);
  });

  it("detects a complete v3 as current", () => {
    const v3 = loadFixture("../../test-fixtures/install-state-migration/v3-expected.toon");
    const result = detectInstallStateVersion(v3);
    expect(result.version).toBe(3);
    expect(result.outdated).toBe(false);
    expect(result.reason).toBeNull();
  });

  it("flags a v3 file missing required markers as outdated", () => {
    const malformed = `schemaVersion: 3\nlastSynced: 2026-04-15T12:00:00Z\n`;
    const result = detectInstallStateVersion(malformed);
    expect(result.version).toBe(3);
    expect(result.outdated).toBe(true);
    expect(result.reason).toMatch(/missing required markers/);
  });

  it("treats a file with no schemaVersion as v1 (pre-v2)", () => {
    const v1 = `lastSynced: 2026-04-15T12:00:00Z\nitems[0]{name,type}:\n`;
    const result = detectInstallStateVersion(v1);
    expect(result.version).toBe(1);
    expect(result.outdated).toBe(true);
    expect(result.reason).toMatch(/missing schemaVersion/);
  });

  it("flags an unrecognized schemaVersion as outdated", () => {
    const result = detectInstallStateVersion(`schemaVersion: 99\n`);
    expect(result.version).toBe("unknown");
    expect(result.outdated).toBe(true);
    expect(result.reason).toMatch(/unrecognized/);
  });
});

// ---------------------------------------------------------------------------
// install-state.toon: migration v2 → v3
// ---------------------------------------------------------------------------

describe("migrateInstallStateV2ToV3", () => {
  function makeV2(): InstallStateV2 {
    return {
      schemaVersion: 2,
      lastSynced: "2026-04-15T12:00:00Z",
      items: [
        {
          name: "loom-library",
          type: "prompt",
          source: "commands/loom-library.md",
          targetPath: "/Users/example/.claude/commands/loom-library.md",
          installedAt: "2026-04-15T12:00:00Z",
        },
        {
          name: "loom",
          type: "prompt",
          source: "commands/loom.md",
          targetPath: "/Users/example/.claude/commands/loom.md",
          installedAt: "2026-04-15T12:00:00Z",
        },
      ],
    };
  }

  it("produces a fully populated v3 object with default versions", () => {
    const v3 = migrateInstallStateV2ToV3(makeV2(), {
      now: () => FIXED_NOW,
      sha256Resolver: () => FIXED_SHA,
    });

    expect(v3.schemaVersion).toBe(3);
    expect(v3.protocolVersion).toBe(3);
    expect(v3.lastSynced).toBe("2026-04-15T12:00:00Z");
    expect(v3.loomCoreVersion).toBe("0.0.0");
    expect(v3.loomHooksVersion).toBe("0.0.0");
    expect(v3.catalogVersion).toBe(2);
  });

  it("creates a single loom-core component on v2→v3", () => {
    const v3 = migrateInstallStateV2ToV3(makeV2(), {
      now: () => FIXED_NOW,
      sha256Resolver: () => FIXED_SHA,
    });

    expect(v3.components).toHaveLength(1);
    expect(v3.components[0]).toEqual({
      name: "loom-core",
      version: "0.0.0",
      kind: "core",
      pinned: false,
      installedAt: FIXED_NOW,
    });
  });

  it("preserves each item and adds sha256 + component fields", () => {
    const v3 = migrateInstallStateV2ToV3(makeV2(), {
      now: () => FIXED_NOW,
      sha256Resolver: () => FIXED_SHA,
    });

    expect(v3.items).toHaveLength(2);
    for (const item of v3.items) {
      expect(item.sha256).toBe(FIXED_SHA);
      expect(item.component).toBe("loom-core");
    }
    expect(v3.items[0].name).toBe("loom-library");
    expect(v3.items[1].name).toBe("loom");
  });

  it("preserves original installedAt on items (not now())", () => {
    const v3 = migrateInstallStateV2ToV3(makeV2(), {
      now: () => FIXED_NOW,
      sha256Resolver: () => FIXED_SHA,
    });
    for (const item of v3.items) {
      expect(item.installedAt).toBe("2026-04-15T12:00:00Z");
      expect(item.installedAt).not.toBe(FIXED_NOW);
    }
  });

  it("defaults sha256 to empty string when resolver returns null", () => {
    const v3 = migrateInstallStateV2ToV3(makeV2(), {
      now: () => FIXED_NOW,
      sha256Resolver: () => null,
    });
    for (const item of v3.items) {
      expect(item.sha256).toBe("");
    }
  });

  it("respects overridden defaultCoreVersion / defaultHooksVersion", () => {
    const v3 = migrateInstallStateV2ToV3(makeV2(), {
      now: () => FIXED_NOW,
      defaultCoreVersion: "0.1.0",
      defaultHooksVersion: "0.1.2",
    });
    expect(v3.loomCoreVersion).toBe("0.1.0");
    expect(v3.loomHooksVersion).toBe("0.1.2");
    expect(v3.components[0].version).toBe("0.1.0");
  });

  it("handles empty items[] cleanly", () => {
    const empty: InstallStateV2 = {
      schemaVersion: 2,
      lastSynced: "2026-04-15T12:00:00Z",
      items: [],
    };
    const v3 = migrateInstallStateV2ToV3(empty, { now: () => FIXED_NOW });
    expect(v3.items).toEqual([]);
    expect(v3.components).toHaveLength(1);
  });

  it("rejects non-v2 input", () => {
    expect(() =>
      migrateInstallStateV2ToV3({ schemaVersion: 1 } as unknown as InstallStateV2, {})
    ).toThrow(/expected schemaVersion === 2/);
  });
});

// ---------------------------------------------------------------------------
// install-state.toon: idempotency
// ---------------------------------------------------------------------------

describe("install-state idempotency", () => {
  it("a migrated v3 file is detected as current (no further migration needed)", () => {
    const v2: InstallStateV2 = {
      schemaVersion: 2,
      lastSynced: "2026-04-15T12:00:00Z",
      items: [],
    };
    const v3 = migrateInstallStateV2ToV3(v2, { now: () => FIXED_NOW });
    const serialized = JSON.stringify(v3);
    // Render TOON-ish markers to satisfy string-based detector
    const synthetic = [
      `schemaVersion: ${v3.schemaVersion}`,
      `protocolVersion: ${v3.protocolVersion}`,
      `loomCoreVersion: ${v3.loomCoreVersion}`,
      `loomHooksVersion: ${v3.loomHooksVersion}`,
      `catalogVersion: ${v3.catalogVersion}`,
      `components[1]:`,
      serialized,
    ].join("\n");

    const detection = detectInstallStateVersion(synthetic);
    expect(detection.version).toBe(3);
    expect(detection.outdated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// library.yaml: detection
// ---------------------------------------------------------------------------

describe("detectLibraryCatalogVersion", () => {
  it("detects v2 as outdated", () => {
    const v2 = loadFixture("../../test-fixtures/library-catalog-migration/v2-input.yaml");
    const result = detectLibraryCatalogVersion(v2);
    expect(result.version).toBe(2);
    expect(result.outdated).toBe(true);
    expect(result.reason).toMatch(/Rule 13/);
  });

  it("detects a complete v3 as current", () => {
    const v3 = loadFixture("../../test-fixtures/library-catalog-migration/v3-expected.yaml");
    const result = detectLibraryCatalogVersion(v3);
    expect(result.version).toBe(3);
    expect(result.outdated).toBe(false);
    expect(result.reason).toBeNull();
  });

  it("flags v3 declared but missing top-level fields", () => {
    const malformed = `catalog_version: 3\nrepo: https://example.com\n`;
    const result = detectLibraryCatalogVersion(malformed);
    expect(result.version).toBe(3);
    expect(result.outdated).toBe(true);
    expect(result.reason).toMatch(/missing top-level fields/);
  });

  it("treats a file with no catalog_version as v1", () => {
    const result = detectLibraryCatalogVersion(`repo: https://example.com\n`);
    expect(result.version).toBe(1);
    expect(result.outdated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// library.yaml: migration v2 → v3
// ---------------------------------------------------------------------------

describe("migrateLibraryCatalogV2ToV3", () => {
  function makeV2(): LibraryCatalogV2 {
    return {
      catalog_version: 2,
      repo: "https://github.com/launchstack-dev/loom-ai",
      default_dirs: { skills: [] },
      library: { skills: [], agents: [], prompts: [] },
      kits: [
        {
          name: "data-engineering",
          version: "1.1.0",
          minLoomVersion: 3,
        },
      ],
    };
  }

  it("produces a fully populated v3 object with the supplied core/hooks versions", () => {
    const v3 = migrateLibraryCatalogV2ToV3(makeV2(), {
      coreVersion: "0.1.0",
      hooksVersion: "0.1.0",
      initialRelease: { version: "0.1.0", releasedAt: FIXED_NOW },
    });

    expect(v3.catalog_version).toBe(3);
    expect(v3.loomCoreVersion).toBe("0.1.0");
    expect(v3.loomHooksVersion).toBe("0.1.0");
    expect(v3.releases).toHaveLength(1);
  });

  it("synthesizes release URLs derived from the repo URL", () => {
    const v3 = migrateLibraryCatalogV2ToV3(makeV2(), {
      coreVersion: "0.1.0",
      hooksVersion: "0.1.0",
      initialRelease: { version: "0.1.0", releasedAt: FIXED_NOW },
    });

    const release = v3.releases[0];
    expect(release.version).toBe("0.1.0");
    expect(release.coreTarball).toContain("launchstack-dev/loom-ai");
    expect(release.coreTarball).toContain("loom-core-v0.1.0.tar.gz");
    expect(release.cosignSignature).toContain(".tar.gz.sig");
    expect(release.sha256Manifest).toContain("SHA256SUMS");
    expect(release.releasedAt).toBe(FIXED_NOW);
  });

  it("omits releases[] entirely when initialRelease is not provided", () => {
    const v3 = migrateLibraryCatalogV2ToV3(makeV2(), {
      coreVersion: "0.1.0",
      hooksVersion: "0.1.0",
    });
    expect(v3.releases).toEqual([]);
  });

  it("preserves existing kit entries unchanged (v3 kit fields stay optional)", () => {
    const v3 = migrateLibraryCatalogV2ToV3(makeV2(), {
      coreVersion: "0.1.0",
      hooksVersion: "0.1.0",
    });
    expect(v3.kits).toHaveLength(1);
    expect(v3.kits[0].name).toBe("data-engineering");
    expect(v3.kits[0].minLoomVersion).toBe(3);
    expect(v3.kits[0].minCoreVersion).toBeUndefined();
    expect(v3.kits[0].minHooksVersion).toBeUndefined();
  });

  it("handles a v2 catalog with no kits[] (treated as empty)", () => {
    const noKits: LibraryCatalogV2 = {
      catalog_version: 2,
      repo: "https://github.com/launchstack-dev/loom-ai",
      default_dirs: {},
      library: {},
    };
    const v3 = migrateLibraryCatalogV2ToV3(noKits, {
      coreVersion: "0.1.0",
      hooksVersion: "0.1.0",
    });
    expect(v3.kits).toEqual([]);
  });

  it("rejects non-v2 input", () => {
    expect(() =>
      migrateLibraryCatalogV2ToV3(
        { catalog_version: 1 } as unknown as LibraryCatalogV2,
        { coreVersion: "0.1.0", hooksVersion: "0.1.0" }
      )
    ).toThrow(/expected catalog_version === 2/);
  });
});

// ---------------------------------------------------------------------------
// Chained migration walker — install-state
// ---------------------------------------------------------------------------

describe("migrateInstallStateToLatest (chained walker)", () => {
  function makeV2(): InstallStateV2 {
    return {
      schemaVersion: 2,
      lastSynced: "2026-04-15T12:00:00Z",
      items: [],
    };
  }

  it("CURRENT_VERSION matches the schema-versions.toon registry entry", () => {
    expect(INSTALL_STATE_CURRENT_VERSION).toBe(3);
  });

  it("MIGRATIONS exposes 2->3 step", () => {
    expect(INSTALL_STATE_MIGRATIONS["2->3"]).toBeTypeOf("function");
  });

  it("returns input unchanged when fromVersion === targetVersion", () => {
    const v2 = makeV2();
    const result = migrateInstallStateToLatest(v2, 2, {}, 2);
    expect(result).toBe(v2);
  });

  it("walks a single-step chain (v2→v3)", () => {
    const v2 = makeV2();
    const result = migrateInstallStateToLatest(v2, 2, { now: () => FIXED_NOW });
    expect((result as any).schemaVersion).toBe(3);
  });

  it("rejects downgrades", () => {
    const v2 = makeV2();
    expect(() => migrateInstallStateToLatest(v2, 3, {}, 2)).toThrow(/cannot downgrade/);
  });

  it("throws on missing migration step in the chain", () => {
    const v2 = makeV2();
    expect(() => migrateInstallStateToLatest(v2, 2, { now: () => FIXED_NOW }, 5)).toThrow(
      /missing migration step "3->4"/
    );
  });

  it("walks a multi-step chain when v3→v4 stub is registered", () => {
    // Simulate a future v4 by registering a stub. Clean up afterward.
    const v3StubField = "introducedInV4";
    INSTALL_STATE_MIGRATIONS["3->4"] = (input, _opts) => ({
      ...input,
      schemaVersion: 4,
      [v3StubField]: "hello",
    });
    try {
      const v2 = makeV2();
      const result: any = migrateInstallStateToLatest(v2, 2, { now: () => FIXED_NOW }, 4);
      expect(result.schemaVersion).toBe(4);
      expect(result[v3StubField]).toBe("hello");
      expect(result.protocolVersion).toBe(3); // carried through from v2→v3 step
    } finally {
      delete INSTALL_STATE_MIGRATIONS["3->4"];
    }
  });
});

// ---------------------------------------------------------------------------
// Chained migration walker — library-catalog
// ---------------------------------------------------------------------------

describe("migrateLibraryCatalogToLatest (chained walker)", () => {
  function makeV2(): LibraryCatalogV2 {
    return {
      catalog_version: 2,
      repo: "https://github.com/launchstack-dev/loom-ai",
      default_dirs: {},
      library: {},
      kits: [],
    };
  }

  it("CURRENT_VERSION matches the schema-versions.toon registry entry", () => {
    expect(LIBRARY_CATALOG_CURRENT_VERSION).toBe(3);
  });

  it("MIGRATIONS exposes 2->3 step", () => {
    expect(LIBRARY_CATALOG_MIGRATIONS["2->3"]).toBeTypeOf("function");
  });

  it("walks a single-step chain (v2→v3)", () => {
    const result = migrateLibraryCatalogToLatest(makeV2(), 2, {
      coreVersion: "0.1.0",
      hooksVersion: "0.1.0",
    });
    expect((result as any).catalog_version).toBe(3);
  });

  it("rejects downgrades", () => {
    expect(() =>
      migrateLibraryCatalogToLatest(makeV2(), 3, { coreVersion: "0.1.0", hooksVersion: "0.1.0" }, 2)
    ).toThrow(/cannot downgrade/);
  });

  it("throws on missing migration step in the chain", () => {
    expect(() =>
      migrateLibraryCatalogToLatest(
        makeV2(),
        2,
        { coreVersion: "0.1.0", hooksVersion: "0.1.0" },
        5
      )
    ).toThrow(/missing migration step "3->4"/);
  });

  it("walks a multi-step chain when v3→v4 stub is registered", () => {
    LIBRARY_CATALOG_MIGRATIONS["3->4"] = (input, _opts) => ({
      ...input,
      catalog_version: 4,
      newOptionalField: true,
    });
    try {
      const result: any = migrateLibraryCatalogToLatest(
        makeV2(),
        2,
        { coreVersion: "0.1.0", hooksVersion: "0.1.0" },
        4
      );
      expect(result.catalog_version).toBe(4);
      expect(result.newOptionalField).toBe(true);
      expect(result.loomCoreVersion).toBe("0.1.0"); // carried through v2→v3 step
    } finally {
      delete LIBRARY_CATALOG_MIGRATIONS["3->4"];
    }
  });
});
