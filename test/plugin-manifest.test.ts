import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = path.resolve(__dirname, "..");
const manifestPath = path.join(repoRoot, ".claude-plugin", "plugin.json");
const hooksManifestPath = path.join(repoRoot, "hooks", "hooks.json");
const schemaPath = path.join(
  repoRoot,
  "protocols",
  "upstream",
  "plugin.schema.json",
);

function readJson(p: string): unknown {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

interface PluginManifest {
  name: string;
  version: string;
  description: string;
  license?: string;
  keywords?: unknown[];
  author?: Record<string, unknown>;
  repository?: string;
  agents?: unknown;
  commands?: unknown;
  skills?: unknown;
  hooks?: string;
  permissions?: string[];
  [k: string]: unknown;
}

interface HookCommand {
  type: string;
  command: string;
}
interface HookEntry {
  matcher?: string;
  hooks: HookCommand[];
}
interface HooksManifest {
  hooks: Record<string, HookEntry[]>;
}

interface JsonSchema {
  type?: string;
  required?: string[];
  properties?: Record<string, { type?: string }>;
  additionalProperties?: boolean;
}

/**
 * Minimal JSON Schema draft-07 type-check sufficient for the local snapshot:
 * required + property types (string/array/object). additionalProperties=true
 * means unknown fields are allowed, so we don't need full ajv here.
 */
function validateAgainstSnapshot(
  instance: Record<string, unknown>,
  schema: JsonSchema,
): string[] {
  const errs: string[] = [];
  if (schema.type === "object" && typeof instance !== "object") {
    errs.push("instance must be object");
    return errs;
  }
  for (const req of schema.required ?? []) {
    if (!(req in instance)) errs.push(`missing required: ${req}`);
  }
  for (const [key, spec] of Object.entries(schema.properties ?? {})) {
    if (!(key in instance)) continue;
    const val = instance[key];
    const ty = spec.type;
    if (!ty) continue;
    if (ty === "string" && typeof val !== "string")
      errs.push(`${key}: expected string`);
    else if (ty === "array" && !Array.isArray(val))
      errs.push(`${key}: expected array`);
    else if (
      ty === "object" &&
      (typeof val !== "object" || Array.isArray(val) || val === null)
    )
      errs.push(`${key}: expected object`);
  }
  return errs;
}

describe("plugin.json", () => {
  it("validates against protocols/upstream/plugin.schema.json", () => {
    const manifest = readJson(manifestPath) as PluginManifest;
    const schema = readJson(schemaPath) as JsonSchema;
    const errors = validateAgainstSnapshot(
      manifest as Record<string, unknown>,
      schema,
    );
    expect(errors).toEqual([]);
  });

  it("declares the required permissions field per Wave 0 contract", () => {
    const manifest = readJson(manifestPath) as PluginManifest;
    expect(Array.isArray(manifest.permissions)).toBe(true);
    expect(manifest.permissions!.length).toBeGreaterThan(0);
    for (const p of manifest.permissions!) {
      expect(typeof p).toBe("string");
    }
  });

  it("ships hooks/hooks.json at the convention path Claude Code auto-discovers", () => {
    // Claude Code auto-loads hooks/hooks.json from the plugin root; declaring
    // it in manifest.hooks causes a duplicate-load failure (the manifest field
    // is reserved for *additional* hook files outside the standard path).
    // The contract is therefore "hooks/hooks.json must exist on disk" rather
    // than "manifest declares the hook path".
    expect(fs.existsSync(hooksManifestPath)).toBe(true);
    const manifest = readJson(manifestPath) as PluginManifest;
    expect(manifest.hooks).toBeUndefined();
  });
});

describe("hooks.json", () => {
  const hooksManifest = readJson(hooksManifestPath) as HooksManifest;

  it("registers SessionStart, PreToolUse, PostToolUse, Stop", () => {
    expect(Object.keys(hooksManifest.hooks).sort()).toEqual([
      "PostToolUse",
      "PreToolUse",
      "SessionStart",
      "Stop",
    ]);
  });

  it("PreToolUse and PostToolUse use Write|Edit matchers", () => {
    expect(hooksManifest.hooks.PreToolUse[0].matcher).toBe("Write|Edit");
    expect(hooksManifest.hooks.PostToolUse[0].matcher).toBe("Write|Edit");
  });

  it("every hook command anchors to ${CLAUDE_PLUGIN_ROOT}", () => {
    const allCommands: string[] = [];
    for (const entries of Object.values(hooksManifest.hooks)) {
      for (const entry of entries) {
        for (const h of entry.hooks) {
          allCommands.push(h.command);
        }
      }
    }
    expect(allCommands.length).toBeGreaterThan(0);
    for (const cmd of allCommands) {
      expect(cmd).toContain("${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.sh");
      expect(cmd).not.toContain("${CLAUDE_PROJECT_DIR}");
      // Reject bare/relative invocations.
      expect(cmd).not.toMatch(/(^|\s)hooks\/run-hook\.sh/);
    }
  });

  it("every referenced hook script exists on disk", () => {
    const refs = new Set<string>();
    for (const entries of Object.values(hooksManifest.hooks)) {
      for (const entry of entries) {
        for (const h of entry.hooks) {
          const matches = h.command.match(
            /\$\{CLAUDE_PLUGIN_ROOT\}\/(hooks\/[A-Za-z0-9_.\-]+\.ts)/g,
          );
          if (matches) for (const m of matches) refs.add(m.replace(/^\$\{CLAUDE_PLUGIN_ROOT\}\//, ""));
        }
      }
    }
    for (const rel of refs) {
      const abs = path.join(repoRoot, rel);
      expect(fs.existsSync(abs), `missing hook script: ${rel}`).toBe(true);
    }
  });
});
