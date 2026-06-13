/**
 * Tests for hooks/lib/skill-router.ts pure functions.
 *
 * Phase 0 has landed: this module is real. Phase 4 (this file) locks the
 * behavioural surface that `/loom-library use|remove` and the v4 catalog
 * migrator wiring depends on.
 *
 * Maps to spec IDs: ct-4-01, bt-4-01 through bt-4-08
 */

import { describe, it, expect } from "vitest";

// Contract test ct-4-01: must import from hooks/lib/skill-router.ts
// (not from the markdown command file or any mock). Vitest cannot import
// from markdown — the pure-function module is the only legal source.
import {
  buildSkillTargetPath,
  parseIncludeEntry,
  validateInstallPath,
  buildSkillInstallRecord,
  resolveBareNameInclude,
  buildSkillRemovePlan,
} from "../hooks/lib/skill-router.js";

// ---------------------------------------------------------------------------
// Contract tests: all six functions are exported
// ---------------------------------------------------------------------------

describe("skill-router — contract: exports", () => {
  // Spec: ct-0-05 — six required functions exported
  it("buildSkillTargetPath is a function", () => {
    expect(typeof buildSkillTargetPath).toBe("function");
  });

  it("parseIncludeEntry is a function", () => {
    expect(typeof parseIncludeEntry).toBe("function");
  });

  it("validateInstallPath is a function", () => {
    expect(typeof validateInstallPath).toBe("function");
  });

  it("buildSkillInstallRecord is a function", () => {
    expect(typeof buildSkillInstallRecord).toBe("function");
  });

  it("resolveBareNameInclude is a function", () => {
    expect(typeof resolveBareNameInclude).toBe("function");
  });

  it("buildSkillRemovePlan is a function", () => {
    expect(typeof buildSkillRemovePlan).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// buildSkillTargetPath
// ---------------------------------------------------------------------------

describe("buildSkillTargetPath", () => {
  // Spec: bt-4-02
  it('returns "~/.claude/skills/python-conventions/SKILL.md" for "python-conventions"', () => {
    // Spec: bt-4-02
    const result = buildSkillTargetPath("python-conventions");
    expect(result).toBe("~/.claude/skills/python-conventions/SKILL.md");
  });

  it('returns "~/.claude/skills/my-tool/SKILL.md" for "my-tool"', () => {
    // Additional: not in spec, derived from documented return template
    const result = buildSkillTargetPath("my-tool");
    expect(result).toBe("~/.claude/skills/my-tool/SKILL.md");
  });

  it("always uses literal SKILL.md filename (Claude Code activation requirement)", () => {
    // Additional: not in spec — guards against filename drift
    const result = buildSkillTargetPath("any-skill");
    expect(result.endsWith("/SKILL.md")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseIncludeEntry
// ---------------------------------------------------------------------------

describe("parseIncludeEntry", () => {
  // Spec: bt-4-03 — bare string triggers deprecation flag (bare: true).
  // The `bare: true` flag IS the deprecation signal: callers (Phase 2 wiring,
  // Phase 9 add command) MUST emit a DEPRECATION_WARNING when bare === true.
  // `type: null` is the second signal — it tells the caller to invoke
  // `resolveBareNameInclude` to walk the BARE_NAME_PRIORITY chain.
  it('parseIncludeEntry("python-conventions") returns { bare: true, type: null } for a bare string', () => {
    // Spec: bt-4-03
    const result = parseIncludeEntry("python-conventions");
    expect(result.bare).toBe(true);
    expect(result.name).toBe("python-conventions");
    // type === null is the marker that bare-name resolution is still pending.
    expect(result.type).toBeNull();
  });

  // Spec: bt-4-04 — typed form {type:"skill", name:"..."} returns bare: false
  it('parseIncludeEntry({ type: "skill", name: "python-conventions" }) returns { bare: false }', () => {
    // Spec: bt-4-04
    const result = parseIncludeEntry({ type: "skill", name: "python-conventions" });
    expect(result.bare).toBe(false);
    expect(result.name).toBe("python-conventions");
    expect(result.type).toBe("skill");
  });

  it("typed protocol entry returns { type: 'protocol', bare: false }", () => {
    // Additional: not in spec
    const result = parseIncludeEntry({ type: "protocol", name: "execution-protocols" });
    expect(result.type).toBe("protocol");
    expect(result.bare).toBe(false);
  });

  it("typed agent entry returns { type: 'agent', bare: false }", () => {
    // Additional: not in spec
    const result = parseIncludeEntry({ type: "agent", name: "contracts-agent" });
    expect(result.type).toBe("agent");
    expect(result.bare).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateInstallPath
// ---------------------------------------------------------------------------

describe("validateInstallPath", () => {
  // Spec: bt-4-06 — valid path inside ~/.claude/skills/
  it('validates "~/.claude/skills/python-conventions/SKILL.md" as { valid: true }', () => {
    // Spec: bt-4-06
    const result = validateInstallPath("~/.claude/skills/python-conventions/SKILL.md");
    expect(result.valid).toBe(true);
  });

  it('validates "~/.claude/agents/my-agent.md" as { valid: true }', () => {
    // Additional: ~/.claude/agents/ is the other allowed prefix
    const result = validateInstallPath("~/.claude/agents/my-agent.md");
    expect(result.valid).toBe(true);
  });

  it('validates "~/.claude/commands/loom-library.md" as { valid: true } (prompts install here)', () => {
    // Finding #3: ~/.claude/commands/ added as third allowed prefix for prompt files
    const result = validateInstallPath("~/.claude/commands/loom-library.md");
    expect(result.valid).toBe(true);
  });

  // Spec: bt-4-05 — path outside allowed prefixes returns { valid: false } without throwing
  it("returns { valid: false, reason: string } for a path outside allowed prefixes (does not throw)", () => {
    // Spec: bt-4-05
    let result!: ReturnType<typeof validateInstallPath>;
    expect(() => {
      result = validateInstallPath("/tmp/malicious/SKILL.md");
    }).not.toThrow();
    expect(result.valid).toBe(false);
    // Reason MUST be a non-empty string so callers can surface it in a
    // SOURCE_VALIDATION_ERROR envelope without manufacturing one themselves.
    expect(typeof result.reason).toBe("string");
    expect(result.reason!.length).toBeGreaterThan(0);
  });

  it("returns { valid: false } for a path in ~/.config (not an allowed prefix)", () => {
    // Additional: not in spec, derived from boundary rule
    const result = validateInstallPath("~/.config/claude/skills/test/SKILL.md");
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveBareNameInclude — priority order (bt-4-07)
// ---------------------------------------------------------------------------

describe("resolveBareNameInclude", () => {
  // Spec: bt-4-07 — priority: agents → protocols → skills → prompts
  it("resolves by section priority: agents wins over protocols for the same name", () => {
    // Spec: bt-4-07
    // Fixture: same bare name "ambiguous-tool" in both agents and protocols sections
    const catalogWithCollision: any = {
      catalog_version: 4,
      library: {
        protocols: [
          { name: "ambiguous-tool", description: "Protocol entry", source: "agents/p.md" },
        ],
        skills: [],
        agents: [
          { name: "ambiguous-tool", description: "Agent entry", source: "agents/a.md" },
        ],
        prompts: [],
      },
      kits: [],
    };
    const result = resolveBareNameInclude("ambiguous-tool", catalogWithCollision);
    expect(result).not.toBeNull();
    // agents wins over protocols
    expect(result!.type).toBe("agent");
    expect(result!.name).toBe("ambiguous-tool");
  });

  it("resolves to protocols when name is only in protocols section", () => {
    // Additional: verify second tier of priority chain
    const catalog: any = {
      catalog_version: 4,
      library: {
        protocols: [{ name: "some-protocol", description: "P", source: "p.md" }],
        skills: [],
        agents: [],
        prompts: [],
      },
      kits: [],
    };
    const result = resolveBareNameInclude("some-protocol", catalog);
    expect(result!.type).toBe("protocol");
  });

  it("resolves to skill when name is only in skills section", () => {
    // Additional: third tier of priority chain
    const catalog: any = {
      catalog_version: 4,
      library: {
        protocols: [],
        skills: [{ name: "my-skill", description: "S", source: "s.md" }],
        agents: [],
        prompts: [],
      },
      kits: [],
    };
    const result = resolveBareNameInclude("my-skill", catalog);
    expect(result!.type).toBe("skill");
  });

  it("returns null when name is not found in any section", () => {
    // Additional: not in spec, but required for NOT_IN_CATALOG handling
    const emptyCatalog: any = {
      catalog_version: 4,
      library: { protocols: [], skills: [], agents: [], prompts: [] },
      kits: [],
    };
    const result = resolveBareNameInclude("nonexistent", emptyCatalog);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildSkillRemovePlan (bt-4-08)
// ---------------------------------------------------------------------------

describe("buildSkillRemovePlan", () => {
  // Spec: bt-4-08
  it('returns { skillMdPath, parentDir } for "python-conventions"', () => {
    // Spec: bt-4-08
    const result = buildSkillRemovePlan("python-conventions");
    expect(result.skillMdPath).toBe("~/.claude/skills/python-conventions/SKILL.md");
    expect(result.parentDir).toBe("~/.claude/skills/python-conventions/");
  });

  it("parentDir always ends with a trailing slash", () => {
    // Additional: not in spec — guard against missing trailing slash
    const result = buildSkillRemovePlan("any-skill");
    expect(result.parentDir.endsWith("/")).toBe(true);
  });

  it("skillMdPath always ends with /SKILL.md", () => {
    // Additional: SKILL.md literal is required by Claude Code
    const result = buildSkillRemovePlan("any-skill");
    expect(result.skillMdPath.endsWith("/SKILL.md")).toBe(true);
  });

  it("returns pruneIfEmpty: true so the caller cleans up the parent dir after removal", () => {
    // Additional: confirms the third field on SkillRemovePlan so callers
    // (Phase 2 wiring) know they MUST attempt the parent-dir prune.
    const result = buildSkillRemovePlan("python-conventions");
    expect(result.pruneIfEmpty).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildSkillInstallRecord (defensive coverage — install-state items[] writer)
// ---------------------------------------------------------------------------

describe("buildSkillInstallRecord", () => {
  it("returns a record with type: 'skill' and the canonical install path", () => {
    // Phase 2 wiring writes one of these into install-state.toon items[]
    // after every /loom-library use. The type discriminator is locked.
    const record = buildSkillInstallRecord("python-conventions", "abc123");
    expect(record.type).toBe("skill");
    expect(record.name).toBe("python-conventions");
    expect(record.targetPath).toBe("~/.claude/skills/python-conventions/SKILL.md");
    expect(record.sha256).toBe("abc123");
  });

  it("uses caller-provided installedAt timestamp (no module-level Date.now)", () => {
    // Pure-function constraint: callers supply the ISO timestamp so the
    // function performs no I/O / clock reads at module scope.
    const record = buildSkillInstallRecord("any-skill", "deadbeef", {
      installedAt: "2026-06-12T12:00:00Z",
    });
    expect(record.installedAt).toBe("2026-06-12T12:00:00Z");
  });
});

// ---------------------------------------------------------------------------
// resolveBareNameInclude — infrastructure priority (Finding #7)
// ---------------------------------------------------------------------------

describe("resolveBareNameInclude — infrastructure resolution", () => {
  // Finding #7: infrastructure is the 5th tier in BARE_NAME_PRIORITY.
  // A bare name found only in library.infrastructure[] must resolve with
  // { type: "infrastructure", name } rather than returning null.
  it('resolves "some-hook-name" to { type: "infrastructure" } when only in infrastructure section', () => {
    const catalog: any = {
      catalog_version: 4,
      library: {
        protocols: [],
        skills: [],
        agents: [],
        prompts: [],
        infrastructure: [{ name: "some-hook-name", source: "hooks/some-hook.ts" }],
      },
      kits: [],
    };
    const result = resolveBareNameInclude("some-hook-name", catalog);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("infrastructure");
    expect(result!.name).toBe("some-hook-name");
  });
});
