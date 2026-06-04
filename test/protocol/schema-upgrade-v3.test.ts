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
  validateRepoUrl,
  validateSemver,
  type LibraryCatalogV2,
} from "../../hooks/lib/library-catalog-migrator.js";

import {
  MigrationDowngradeError,
  MigrationSchemaVersionMismatchError,
  MigrationValidationError,
  MissingMigrationStepError,
} from "../../hooks/lib/migration-errors.js";

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

  it("invokes onWarning for each unreadable sha256 target", () => {
    const warnings: string[] = [];
    migrateInstallStateV2ToV3(makeV2(), {
      now: () => FIXED_NOW,
      sha256Resolver: () => null,
      onWarning: (msg) => warnings.push(msg),
    });
    // makeV2() has 2 items; both should produce warnings.
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/sha256Resolver returned null/);
    expect(warnings[0]).toContain("loom-library.md");
  });

  it("does NOT invoke onWarning when sha256Resolver returns valid hashes", () => {
    const warnings: string[] = [];
    migrateInstallStateV2ToV3(makeV2(), {
      now: () => FIXED_NOW,
      sha256Resolver: () => FIXED_SHA,
      onWarning: (msg) => warnings.push(msg),
    });
    expect(warnings).toHaveLength(0);
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

  it("rejects non-v2 input with MigrationSchemaVersionMismatchError", () => {
    try {
      migrateInstallStateV2ToV3({ schemaVersion: 1 } as unknown as InstallStateV2, {});
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MigrationSchemaVersionMismatchError);
      expect((err as MigrationSchemaVersionMismatchError).expected).toBe(2);
      expect((err as MigrationSchemaVersionMismatchError).actual).toBe(1);
    }
  });

  it("rejects null/undefined input with MigrationSchemaVersionMismatchError", () => {
    expect(() =>
      migrateInstallStateV2ToV3(null as unknown as InstallStateV2, {})
    ).toThrow(MigrationSchemaVersionMismatchError);
    expect(() =>
      migrateInstallStateV2ToV3(undefined as unknown as InstallStateV2, {})
    ).toThrow(MigrationSchemaVersionMismatchError);
    expect(() =>
      migrateInstallStateV2ToV3({} as unknown as InstallStateV2, {})
    ).toThrow(MigrationSchemaVersionMismatchError);
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

  it("rejects non-v2 input with MigrationSchemaVersionMismatchError", () => {
    try {
      migrateLibraryCatalogV2ToV3(
        { catalog_version: 1 } as unknown as LibraryCatalogV2,
        { coreVersion: "0.1.0", hooksVersion: "0.1.0" }
      );
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MigrationSchemaVersionMismatchError);
      expect((err as MigrationSchemaVersionMismatchError).expected).toBe(2);
      expect((err as MigrationSchemaVersionMismatchError).actual).toBe(1);
    }
  });

  it("rejects null/undefined catalog input with MigrationSchemaVersionMismatchError", () => {
    expect(() =>
      migrateLibraryCatalogV2ToV3(null as unknown as LibraryCatalogV2, {
        coreVersion: "0.1.0",
        hooksVersion: "0.1.0",
      })
    ).toThrow(MigrationSchemaVersionMismatchError);
    expect(() =>
      migrateLibraryCatalogV2ToV3({} as unknown as LibraryCatalogV2, {
        coreVersion: "0.1.0",
        hooksVersion: "0.1.0",
      })
    ).toThrow(MigrationSchemaVersionMismatchError);
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

  it("rejects downgrades with MigrationDowngradeError", () => {
    const v2 = makeV2();
    try {
      migrateInstallStateToLatest(v2, 3, {}, 2);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MigrationDowngradeError);
      expect((err as MigrationDowngradeError).fromVersion).toBe(3);
      expect((err as MigrationDowngradeError).toVersion).toBe(2);
    }
  });

  it("throws MissingMigrationStepError with structured props on chain gap", () => {
    const v2 = makeV2();
    try {
      migrateInstallStateToLatest(v2, 2, { now: () => FIXED_NOW }, 5);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MissingMigrationStepError);
      expect((err as MissingMigrationStepError).key).toBe("3->4");
      expect((err as MissingMigrationStepError).fromVersion).toBe(2);
      expect((err as MissingMigrationStepError).toVersion).toBe(5);
    }
  });

  it("freezes the built-in MIGRATIONS map", () => {
    expect(Object.isFrozen(INSTALL_STATE_MIGRATIONS)).toBe(true);
    expect(() => {
      (INSTALL_STATE_MIGRATIONS as Record<string, unknown>)["evil"] = () => null;
    }).toThrow(TypeError);
  });

  it("walks a multi-step chain via registry override (no global mutation)", () => {
    const v3StubField = "introducedInV4";
    const testRegistry = {
      ...INSTALL_STATE_MIGRATIONS,
      "3->4": (input: any, _opts: any) => ({
        ...input,
        schemaVersion: 4,
        [v3StubField]: "hello",
      }),
    };
    const v2 = makeV2();
    const result: any = migrateInstallStateToLatest(
      v2,
      2,
      { now: () => FIXED_NOW },
      4,
      testRegistry
    );
    expect(result.schemaVersion).toBe(4);
    expect(result[v3StubField]).toBe("hello");
    expect(result.protocolVersion).toBe(3); // carried through from v2→v3 step
    // Built-in registry untouched — proves no module-state pollution.
    expect("3->4" in INSTALL_STATE_MIGRATIONS).toBe(false);
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

  it("rejects downgrades with MigrationDowngradeError", () => {
    try {
      migrateLibraryCatalogToLatest(
        makeV2(),
        3,
        { coreVersion: "0.1.0", hooksVersion: "0.1.0" },
        2
      );
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MigrationDowngradeError);
    }
  });

  it("throws MissingMigrationStepError on chain gap", () => {
    try {
      migrateLibraryCatalogToLatest(
        makeV2(),
        2,
        { coreVersion: "0.1.0", hooksVersion: "0.1.0" },
        5
      );
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MissingMigrationStepError);
      expect((err as MissingMigrationStepError).key).toBe("3->4");
    }
  });

  it("freezes the built-in MIGRATIONS map", () => {
    expect(Object.isFrozen(LIBRARY_CATALOG_MIGRATIONS)).toBe(true);
  });

  it("walks a multi-step chain via registry override (no global mutation)", () => {
    const testRegistry = {
      ...LIBRARY_CATALOG_MIGRATIONS,
      "3->4": (input: any, _opts: any) => ({
        ...input,
        catalog_version: 4,
        newOptionalField: true,
      }),
    };
    const result: any = migrateLibraryCatalogToLatest(
      makeV2(),
      2,
      { coreVersion: "0.1.0", hooksVersion: "0.1.0" },
      4,
      testRegistry
    );
    expect(result.catalog_version).toBe(4);
    expect(result.newOptionalField).toBe(true);
    expect(result.loomCoreVersion).toBe("0.1.0");
    expect("3->4" in LIBRARY_CATALOG_MIGRATIONS).toBe(false);
  });

  it("length-0 chain (fromVersion === targetVersion) returns input unchanged", () => {
    const v2 = makeV2();
    const result = migrateLibraryCatalogToLatest(
      v2,
      3,
      { coreVersion: "0.1.0", hooksVersion: "0.1.0" },
      3
    );
    expect(result).toBe(v2);
  });
});

// ---------------------------------------------------------------------------
// Security — URL + semver validation (Commit 1)
// ---------------------------------------------------------------------------

describe("validateRepoUrl", () => {
  it("accepts a clean github.com https URL and returns it unchanged", () => {
    const url = "https://github.com/launchstack-dev/loom-ai";
    expect(validateRepoUrl(url)).toBe(url);
  });

  it("strips trailing slash to prevent //releases double-slash", () => {
    expect(validateRepoUrl("https://github.com/launchstack-dev/loom-ai/")).toBe(
      "https://github.com/launchstack-dev/loom-ai"
    );
    expect(validateRepoUrl("https://github.com/launchstack-dev/loom-ai///")).toBe(
      "https://github.com/launchstack-dev/loom-ai"
    );
  });

  it("rejects javascript: scheme", () => {
    expect(() => validateRepoUrl("javascript:alert(1)")).toThrow(MigrationValidationError);
  });

  it("rejects file:// scheme", () => {
    expect(() => validateRepoUrl("file:///etc/passwd")).toThrow(MigrationValidationError);
  });

  it("rejects http (non-https)", () => {
    expect(() => validateRepoUrl("http://github.com/x/y")).toThrow(MigrationValidationError);
  });

  it("rejects URL with userinfo (user:pass@)", () => {
    expect(() => validateRepoUrl("https://evil:pwd@github.com/x/y")).toThrow(
      MigrationValidationError
    );
  });

  it("rejects URL with fragment (#)", () => {
    expect(() => validateRepoUrl("https://github.com/x/y#evil")).toThrow(MigrationValidationError);
  });

  it("rejects URL on a non-allowlisted host", () => {
    expect(() => validateRepoUrl("https://evil.com/x/y")).toThrow(MigrationValidationError);
  });

  it("rejects empty string + non-string inputs", () => {
    expect(() => validateRepoUrl("")).toThrow(MigrationValidationError);
    expect(() => validateRepoUrl(null)).toThrow(MigrationValidationError);
    expect(() => validateRepoUrl(123)).toThrow(MigrationValidationError);
  });

  it("rejects malformed URLs", () => {
    expect(() => validateRepoUrl("not a url")).toThrow(MigrationValidationError);
  });
});

describe("validateSemver", () => {
  it("accepts plain semver", () => {
    expect(validateSemver("0.1.0")).toBe("0.1.0");
    expect(validateSemver("12.34.56")).toBe("12.34.56");
  });

  it("accepts semver with prerelease tag", () => {
    expect(validateSemver("1.0.0-alpha.1")).toBe("1.0.0-alpha.1");
    expect(validateSemver("0.1.0-beta")).toBe("0.1.0-beta");
  });

  it("rejects path-traversal payloads", () => {
    expect(() => validateSemver("../../../etc/passwd")).toThrow(MigrationValidationError);
    expect(() => validateSemver("0.1.0/../evil")).toThrow(MigrationValidationError);
  });

  it("rejects partial versions", () => {
    expect(() => validateSemver("1.0")).toThrow(MigrationValidationError);
    expect(() => validateSemver("1")).toThrow(MigrationValidationError);
  });

  it("rejects non-string", () => {
    expect(() => validateSemver(undefined)).toThrow(MigrationValidationError);
    expect(() => validateSemver(0.1)).toThrow(MigrationValidationError);
  });
});

describe("migrateLibraryCatalogV2ToV3 — repo validation at boundary", () => {
  function makeV2WithRepo(repo: string): LibraryCatalogV2 {
    return {
      catalog_version: 2,
      repo,
      default_dirs: {},
      library: {},
      kits: [],
    };
  }

  it("rejects a v2 with malicious repo URL before migrating", () => {
    expect(() =>
      migrateLibraryCatalogV2ToV3(makeV2WithRepo("javascript:alert(1)"), {
        coreVersion: "0.1.0",
        hooksVersion: "0.1.0",
      })
    ).toThrow(MigrationValidationError);
  });

  it("rejects a v2 with malicious release.version", () => {
    expect(() =>
      migrateLibraryCatalogV2ToV3(makeV2WithRepo("https://github.com/launchstack-dev/loom-ai"), {
        coreVersion: "0.1.0",
        hooksVersion: "0.1.0",
        initialRelease: { version: "../../../etc/passwd", releasedAt: FIXED_NOW },
      })
    ).toThrow(MigrationValidationError);
  });

  it("normalizes trailing-slash repo into release URLs without double-slash", () => {
    const v3 = migrateLibraryCatalogV2ToV3(
      makeV2WithRepo("https://github.com/launchstack-dev/loom-ai/"),
      {
        coreVersion: "0.1.0",
        hooksVersion: "0.1.0",
        initialRelease: { version: "0.1.0", releasedAt: FIXED_NOW },
      }
    );
    expect(v3.repo).toBe("https://github.com/launchstack-dev/loom-ai");
    expect(v3.releases[0].coreTarball).not.toContain("loom-ai//releases");
    expect(v3.releases[0].coreTarball).toBe(
      "https://github.com/launchstack-dev/loom-ai/releases/download/v0.1.0/loom-core-v0.1.0.tar.gz"
    );
  });
});

// ---------------------------------------------------------------------------
// Security — install-state detector hardening against string smuggling
// ---------------------------------------------------------------------------

describe("detectInstallStateVersion — line-anchored regex", () => {
  it("is not fooled by `schemaVersion: 3` smuggled inside an item value", () => {
    const malicious = [
      `schemaVersion: 2`,
      `lastSynced: 2026-04-15T12:00:00Z`,
      ``,
      `items[1]{name,type,source,targetPath,installedAt}:`,
      `  evil schemaVersion: 3 protocolVersion: 3 loomCoreVersion: x loomHooksVersion: x catalogVersion: 3 components[1]: x,prompt,a,/b,2026-04-15T12:00:00Z`,
    ].join("\n");
    const result = detectInstallStateVersion(malicious);
    expect(result.version).toBe(2);
    expect(result.outdated).toBe(true);
  });

  it("rejects fractional `schemaVersion: 3.9` instead of silently truncating to 3", () => {
    const result = detectInstallStateVersion(`schemaVersion: 3.9\n`);
    // No line matches /^schemaVersion:\s*(\d+)\s*$/m so it's treated as v1.
    expect(result.outdated).toBe(true);
    expect(result.version).not.toBe(3);
  });

  it("rejects mid-line schemaVersion (must be at start of line)", () => {
    const result = detectInstallStateVersion(`  # schemaVersion: 3 in a comment\n`);
    expect(result.outdated).toBe(true);
    expect(result.version).not.toBe(3);
  });
});

describe("detectLibraryCatalogVersion — line-anchored + integer-only", () => {
  it("rejects fractional `catalog_version: 3.9`", () => {
    const result = detectLibraryCatalogVersion(`catalog_version: 3.9\n`);
    expect(result.outdated).toBe(true);
    expect(result.version).not.toBe(3);
  });

  it("rejects smuggled catalog_version inside a value", () => {
    const malicious = `repo: https://example.com\n# catalog_version: 3 (commented)\nkits: []\n`;
    const result = detectLibraryCatalogVersion(malicious);
    expect(result.version).toBe(1); // line-anchored regex never matches the comment
  });
});
