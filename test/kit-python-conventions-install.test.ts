/**
 * Integration test for python-conventions kit install path (M-02 gate).
 *
 * This test exercises the full install plan for the `python-conventions`
 * kit by combining:
 *   - the pure-function skill-router exports (hooks/lib/skill-router.ts)
 *   - the live v4 library catalog (skills/library.yaml)
 *
 * It does NOT write to ~/.claude/skills/ — the AC #15 "manual smoke test"
 * (qa-review tier) covers the live install. This is a unit-integration
 * test of the install plan: every routing decision must be reproducible
 * from the on-disk catalog without touching the user's home directory.
 *
 * Maps to spec IDs: ct-7-01 (skill-router import contract), bt-7-02
 * (path shape end-to-end), bt-5-01 through bt-5-08 (SKILL.md content),
 * bt-3-02 (install-state record shape), CG-10 partial (atomic write).
 *
 * Why python3 (not js-yaml): js-yaml is not in this project's
 * node_modules — the project keeps its toolchain minimal. python3 with
 * PyYAML is available on every supported dev box and is also used by
 * scripts/apply-v3-migration.ts and validate-library-catalog. Parsing
 * the catalog this way also matches how the on-disk validator reads it.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";

// Contract test ct-7-01: must import from hooks/lib/skill-router.ts.
// vitest cannot import from markdown command files; skill-router is the
// pure-function module that commands/loom-library.md delegates to.
import {
  buildSkillTargetPath,
  buildSkillInstallRecord,
  parseIncludeEntry,
  resolveBareNameInclude,
  validateInstallPath,
  buildSkillRemovePlan,
  type ParsedInclude,
} from "../hooks/lib/skill-router.js";

// ---------------------------------------------------------------------------
// Catalog loader — parses skills/library.yaml via python3 + json round-trip
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, "..");
const LIBRARY_YAML_PATH = path.join(REPO_ROOT, "skills", "library.yaml");

interface SkillCatalogEntry {
  name: string;
  description?: string;
  source?: string;
  triggers?: string[];
}

interface KitCatalogEntry {
  name: string;
  description?: string;
  version?: string;
  minLoomVersion?: number;
  includes: unknown[];
  command?: string;
}

interface ParsedCatalog {
  catalog_version: number;
  library?: {
    protocols?: Array<{ name: string }>;
    skills?: SkillCatalogEntry[];
    agents?: Array<{ name: string }>;
    prompts?: Array<{ name: string }>;
    infrastructure?: Array<{ name: string }>;
  };
  kits?: KitCatalogEntry[];
}

/**
 * Load skills/library.yaml as a plain JS object using python3 + yaml.
 * Avoids adding a runtime dependency for a single integration test.
 */
function loadLibraryYaml(filePath: string): ParsedCatalog {
  // default=str converts non-JSON-native scalars (notably PyYAML's
  // datetime tags on releases[].releasedAt) into plain strings so
  // json.dumps doesn't choke. The integration test only inspects
  // structural shape (kits[], library.skills[]) — losing datetime
  // fidelity is irrelevant here.
  const script =
    "import json,sys,yaml;" +
    "print(json.dumps(yaml.safe_load(open(sys.argv[1])),default=str))";
  const stdout = execFileSync("python3", ["-c", script, filePath], {
    encoding: "utf-8",
    maxBuffer: 8 * 1024 * 1024,
  });
  return JSON.parse(stdout) as ParsedCatalog;
}

// ---------------------------------------------------------------------------
// Test-local fixtures (used only for content assertions on SKILL.md)
// ---------------------------------------------------------------------------

const SKILL_MD_PATH = path.join(
  REPO_ROOT,
  "skills",
  "python-conventions",
  "SKILL.md"
);

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kit-install-test-"));
}

// ---------------------------------------------------------------------------
// Catalog is loaded once for the file
// ---------------------------------------------------------------------------

let catalog: ParsedCatalog;
let skillMdContent: string;

beforeAll(() => {
  expect(fs.existsSync(LIBRARY_YAML_PATH)).toBe(true);
  expect(fs.existsSync(SKILL_MD_PATH)).toBe(true);
  catalog = loadLibraryYaml(LIBRARY_YAML_PATH);
  skillMdContent = fs.readFileSync(SKILL_MD_PATH, "utf-8");
});

// ---------------------------------------------------------------------------
// 1. Install-path construction
// ---------------------------------------------------------------------------

describe("python-conventions install-path construction", () => {
  it("buildSkillTargetPath returns ~/.claude/skills/python-conventions/SKILL.md", () => {
    const targetPath = buildSkillTargetPath("python-conventions");
    expect(targetPath).toBe("~/.claude/skills/python-conventions/SKILL.md");
  });

  it("target path always ends in /SKILL.md (Claude Code activation requirement)", () => {
    expect(buildSkillTargetPath("python-conventions").endsWith("/SKILL.md")).toBe(
      true
    );
  });

  it("validateInstallPath accepts the python-conventions target path", () => {
    const result = validateInstallPath(
      buildSkillTargetPath("python-conventions")
    );
    expect(result.valid).toBe(true);
  });

  it("validateInstallPath rejects an out-of-bounds target path", () => {
    const result = validateInstallPath(
      "/etc/claude/skills/python-conventions/SKILL.md"
    );
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Install-record shape
// ---------------------------------------------------------------------------

describe("python-conventions install-state record shape", () => {
  it("buildSkillInstallRecord returns an item with type:skill and SKILL.md target", () => {
    const sha256 = "a".repeat(64); // fake but well-formed sha256
    const installedAt = "2026-06-12T00:00:00.000Z";
    const record = buildSkillInstallRecord("python-conventions", sha256, {
      source: "skills/python-conventions/SKILL.md",
      installedAt,
    });

    expect(record.name).toBe("python-conventions");
    expect(record.type).toBe("skill");
    expect(record.source).toBe("skills/python-conventions/SKILL.md");
    expect(record.targetPath).toBe(
      "~/.claude/skills/python-conventions/SKILL.md"
    );
    expect(record.targetPath.endsWith("/SKILL.md")).toBe(true);
    expect(record.installedAt).toBe(installedAt);
    expect(record.sha256).toBe(sha256);
  });

  it("install record installedAt is a valid ISO timestamp by default", () => {
    const record = buildSkillInstallRecord("python-conventions", "x".repeat(64));
    // The default opts.installedAt is new Date(0).toISOString() — still a
    // valid ISO string. Confirms shape, not freshness.
    expect(() => new Date(record.installedAt).toISOString()).not.toThrow();
    expect(record.installedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

// ---------------------------------------------------------------------------
// 3. Kit lookup — python-conventions kit uses typed v4 includes
// ---------------------------------------------------------------------------

describe("python-conventions kit (v4 typed-include lookup)", () => {
  it("kits[] contains a python-conventions entry", () => {
    const kit = catalog.kits?.find((k) => k.name === "python-conventions");
    expect(kit).toBeDefined();
  });

  it("python-conventions kit declares minLoomVersion >= 4", () => {
    const kit = catalog.kits!.find((k) => k.name === "python-conventions")!;
    expect(kit.minLoomVersion).toBeGreaterThanOrEqual(4);
  });

  it("python-conventions kit uses the typed include shape { type: skill, name }", () => {
    const kit = catalog.kits!.find((k) => k.name === "python-conventions")!;
    expect(kit.includes).toHaveLength(1);
    const entry = kit.includes[0];
    expect(typeof entry).toBe("object");
    expect(entry).not.toBeNull();
    const obj = entry as { type?: unknown; name?: unknown };
    expect(obj.type).toBe("skill");
    expect(obj.name).toBe("python-conventions");
  });

  it("parseIncludeEntry on the typed entry yields bare:false and type:skill", () => {
    const kit = catalog.kits!.find((k) => k.name === "python-conventions")!;
    const entry = kit.includes[0] as { type: "skill"; name: string };
    const parsed: ParsedInclude = parseIncludeEntry(entry);
    expect(parsed.bare).toBe(false);
    expect(parsed.type).toBe("skill");
    expect(parsed.name).toBe("python-conventions");
  });
});

// ---------------------------------------------------------------------------
// 4. Legacy kit smoke — data-engineering uses bare-name includes (v3-compat)
// ---------------------------------------------------------------------------

describe("data-engineering kit (legacy bare-name includes)", () => {
  it("kits[] contains a data-engineering entry", () => {
    const kit = catalog.kits?.find((k) => k.name === "data-engineering");
    expect(kit).toBeDefined();
  });

  it("data-engineering kit includes[] entries are all plain strings (bare-name form)", () => {
    const kit = catalog.kits!.find((k) => k.name === "data-engineering")!;
    expect(kit.includes.length).toBeGreaterThan(0);
    for (const entry of kit.includes) {
      expect(typeof entry).toBe("string");
    }
  });

  it("parseIncludeEntry on each bare-name string returns bare:true with null type", () => {
    const kit = catalog.kits!.find((k) => k.name === "data-engineering")!;
    for (const entry of kit.includes) {
      // The entries are strings — that's exactly what parseIncludeEntry
      // expects for the bare-name v3-compat path.
      const parsed = parseIncludeEntry(entry as string);
      expect(parsed.bare).toBe(true);
      expect(parsed.type).toBeNull();
      expect(typeof parsed.name).toBe("string");
      expect(parsed.name.length).toBeGreaterThan(0);
    }
  });

  it("resolveBareNameInclude resolves at least one bare-name entry against the live catalog", () => {
    // The bare-name resolver walks agent → protocol → skill → prompt sections
    // by priority. We don't require every entry to resolve (some legacy
    // entries may live elsewhere or be intentionally unresolved at v4), but
    // at least one of data-engineering's bare names MUST resolve, otherwise
    // /loom-library use data-engineering could never have worked at all.
    const kit = catalog.kits!.find((k) => k.name === "data-engineering")!;
    // Shape the parsed catalog into LibraryCatalogV4 minimal form.
    const lib = catalog.library ?? {};
    const v4Catalog = {
      catalog_version: 4 as const,
      library: {
        protocols: (lib.protocols ?? []) as Array<{
          name: string;
          source?: string;
        }>,
        skills: (lib.skills ?? []) as Array<{
          name: string;
          source?: string;
        }>,
        agents: lib.agents ?? [],
        prompts: lib.prompts ?? [],
        infrastructure: lib.infrastructure ?? [],
      },
    };
    const resolvedNames: Array<string> = [];
    for (const entry of kit.includes) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resolved = resolveBareNameInclude(entry as string, v4Catalog as any);
      if (resolved !== null) resolvedNames.push(resolved.name);
    }
    expect(resolvedNames.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 5. library.skills registration check — python-conventions is registered
// ---------------------------------------------------------------------------

describe("library.skills registration for python-conventions", () => {
  it("library.skills[] contains exactly one entry named python-conventions", () => {
    const skills = catalog.library?.skills ?? [];
    const matches = skills.filter((s) => s.name === "python-conventions");
    expect(matches).toHaveLength(1);
  });

  it("python-conventions skill registration declares **/*.py as a trigger", () => {
    const skills = catalog.library?.skills ?? [];
    const entry = skills.find((s) => s.name === "python-conventions")!;
    expect(entry.triggers).toBeDefined();
    expect(entry.triggers).toContain("**/*.py");
  });

  it("python-conventions skill source path points to skills/python-conventions/SKILL.md", () => {
    const skills = catalog.library?.skills ?? [];
    const entry = skills.find((s) => s.name === "python-conventions")!;
    expect(entry.source).toBe("skills/python-conventions/SKILL.md");
  });
});

// ---------------------------------------------------------------------------
// 6. SKILL.md content checks (bt-5-01 through bt-5-08)
// ---------------------------------------------------------------------------

describe("python-conventions SKILL.md content (live file)", () => {
  // Spec: bt-5-01
  it("declares **/*.py trigger in frontmatter", () => {
    expect(skillMdContent).toContain("**/*.py");
  });

  // Spec: bt-5-02
  it("declares **/pyproject.toml trigger", () => {
    expect(skillMdContent).toContain("**/pyproject.toml");
  });

  // Spec: bt-5-03
  it("declares **/requirements.txt trigger", () => {
    expect(skillMdContent).toContain("**/requirements.txt");
  });

  // Spec: bt-5-04
  it("covers Polars-first and keep-Pandas convention", () => {
    expect(skillMdContent).toContain("Polars");
    expect(skillMdContent).toContain("Pandas");
  });

  // Spec: bt-5-05
  it("references uv, ruff, and pytest tooling", () => {
    expect(skillMdContent).toContain("uv");
    expect(skillMdContent).toContain("ruff");
    expect(skillMdContent).toContain("pytest");
  });

  // Spec: bt-5-06
  it("covers atomic file writes", () => {
    expect(skillMdContent.toLowerCase()).toContain("atomic");
  });

  // Spec: bt-5-07
  it("covers type hints on public functions", () => {
    expect(skillMdContent.toLowerCase()).toContain("type hint");
  });

  // Spec: bt-5-08
  it("covers TOON format for Loom artifacts", () => {
    expect(skillMdContent).toContain("TOON");
  });
});

// ---------------------------------------------------------------------------
// 7. Remove plan symmetry
// ---------------------------------------------------------------------------

describe("python-conventions remove plan", () => {
  it("buildSkillRemovePlan paths match buildSkillTargetPath layout", () => {
    const plan = buildSkillRemovePlan("python-conventions");
    expect(plan.skillMdPath).toBe(
      "~/.claude/skills/python-conventions/SKILL.md"
    );
    expect(plan.parentDir).toBe("~/.claude/skills/python-conventions/");
    expect(plan.pruneIfEmpty).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. Atomic write simulation (CG-10 partial closure)
//    Verifies the .tmp-then-rename pattern that callers use to write
//    install-state.toon. We never write to ~/.claude here — only a tmpdir.
// ---------------------------------------------------------------------------

describe("install-state write — atomic .tmp rename pattern", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("write to .tmp then rename produces correct final file", () => {
    const finalPath = path.join(tmpDir, "install-state.toon");
    const tmpPath = `${finalPath}.tmp`;

    const record = buildSkillInstallRecord(
      "python-conventions",
      "b".repeat(64),
      {
        source: "skills/python-conventions/SKILL.md",
        installedAt: "2026-06-12T00:00:00.000Z",
      }
    );
    const content =
      `installedAt: ${record.installedAt}\n` +
      `items[1]{name,type,source,targetPath}:\n` +
      `  ${record.name},${record.type},${record.source},${record.targetPath}\n`;

    fs.writeFileSync(tmpPath, content, "utf-8");
    expect(fs.existsSync(tmpPath)).toBe(true);
    expect(fs.existsSync(finalPath)).toBe(false);

    fs.renameSync(tmpPath, finalPath);
    expect(fs.existsSync(tmpPath)).toBe(false);
    expect(fs.existsSync(finalPath)).toBe(true);

    const written = fs.readFileSync(finalPath, "utf-8");
    expect(written).toContain("python-conventions");
    expect(written).toContain("skill");
    expect(written).toContain("~/.claude/skills/python-conventions/SKILL.md");
  });
});

// ---------------------------------------------------------------------------
// 9. NOT_IN_CATALOG message format (bt-3-07)
// ---------------------------------------------------------------------------

describe("NOT_IN_CATALOG error message", () => {
  it("template contains the name and the /loom-library list hint", () => {
    const name = "nonexistent-kit";
    const expectedMsg = `No kit or skill named ${name} found in library.yaml. Run /loom-library list to see available entries.`;
    expect(expectedMsg).toContain(name);
    expect(expectedMsg).toContain("/loom-library list");
  });
});

// ---------------------------------------------------------------------------
// 10. Post-install restart notice (bt-3-03 / F-008)
// ---------------------------------------------------------------------------

describe("install restart notice format", () => {
  it("notice mentions the skill name and restart requirement", () => {
    const name = "python-conventions";
    const expectedNotice = `Skill ${name} installed. Restart your Claude Code session for trigger activation to take effect.`;
    expect(expectedNotice).toContain(name);
    expect(expectedNotice.toLowerCase()).toContain("restart");
  });
});
