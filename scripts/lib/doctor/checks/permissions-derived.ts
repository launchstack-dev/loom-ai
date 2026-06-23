/**
 * permissions-derived — validates that `.claude-plugin/plugin.json`'s
 * `permissions[]` array equals the canonical derivation from
 * `hooks/hooks.json`: the union of `hooks:<EventName>` strings for every event
 * declared in `hooks.json#hooks`, plus any tool names appearing in matcher
 * fields (e.g. `tools:Write`, `tools:Edit`).
 *
 * Severity `fail` on mismatch. Category `settings`. Emits
 * `DOCTOR_PERMISSIONS_MISMATCH` per the M-07 error code set.
 */

import * as fsSync from "node:fs";

import type { Check, CheckCategory, InstallState } from "../check.interface";

type HealthCheck = {
  id: string;
  category: CheckCategory;
  status: "pass" | "warn" | "fail";
  message: string;
  fixCommand?: string | null;
  remediation?: string;
};

export interface PermissionsDerivedDeps {
  pluginJsonPath: string;
  hooksJsonPath: string;
  readFile?: (p: string) => string;
  existsSync?: (p: string) => boolean;
}

type PluginManifest = {
  permissions?: string[];
};

type HooksManifestGroup = { matcher?: string; hooks?: Array<{ command?: string }> };
type HooksManifest = { hooks?: Record<string, HooksManifestGroup[]> };

/**
 * Derive the canonical permissions set from hooks.json.
 *   - one `hooks:<EventName>` per declared event
 *   - one `tools:<ToolName>` per distinct tool referenced in a matcher
 *     (matcher syntax is a pipe-separated list, e.g. `"Write|Edit"`)
 */
export function derivePermissions(manifest: HooksManifest): string[] {
  const out = new Set<string>();
  const groups = manifest.hooks ?? {};
  for (const event of Object.keys(groups)) {
    out.add(`hooks:${event}`);
    for (const grp of groups[event] ?? []) {
      if (!grp.matcher) continue;
      for (const tool of grp.matcher.split("|")) {
        const t = tool.trim();
        if (t && /^[A-Za-z][\w]*$/.test(t)) out.add(`tools:${t}`);
      }
    }
  }
  return [...out].sort();
}

function setDiff(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((x) => !b.has(x)).sort();
}

export default class PermissionsDerivedCheck implements Check {
  readonly id = "permissions-derived";
  readonly category: CheckCategory = "settings";

  private readonly deps: Required<PermissionsDerivedDeps>;

  constructor(deps: PermissionsDerivedDeps) {
    this.deps = {
      pluginJsonPath: deps.pluginJsonPath,
      hooksJsonPath: deps.hooksJsonPath,
      readFile: deps.readFile ?? ((p) => fsSync.readFileSync(p, "utf8")),
      existsSync: deps.existsSync ?? ((p) => fsSync.existsSync(p)),
    };
  }

  async run(_state: InstallState): Promise<HealthCheck> {
    void _state;
    if (!this.deps.existsSync(this.deps.pluginJsonPath)) {
      return {
        id: this.id,
        category: this.category,
        status: "fail",
        message: `plugin.json not found at ${this.deps.pluginJsonPath}`,
        remediation: "Reinstall Loom to restore .claude-plugin/plugin.json.",
      };
    }
    if (!this.deps.existsSync(this.deps.hooksJsonPath)) {
      return {
        id: this.id,
        category: this.category,
        status: "fail",
        message: `hooks.json not found at ${this.deps.hooksJsonPath}`,
        remediation: "Reinstall Loom to restore hooks/hooks.json.",
      };
    }

    let plugin: PluginManifest;
    let hooks: HooksManifest;
    try {
      plugin = JSON.parse(this.deps.readFile(this.deps.pluginJsonPath)) as PluginManifest;
      hooks = JSON.parse(this.deps.readFile(this.deps.hooksJsonPath)) as HooksManifest;
    } catch (err) {
      return {
        id: this.id,
        category: this.category,
        status: "fail",
        message: `Failed to parse plugin.json or hooks.json: ${(err as Error).message}`,
        remediation: "Validate JSON syntax in both manifests.",
      };
    }

    const declared = new Set(plugin.permissions ?? []);
    const derived = new Set(derivePermissions(hooks));

    const missing = setDiff(derived, declared); // expected but absent
    const extra = setDiff(declared, derived);   // present but not derived

    if (missing.length === 0 && extra.length === 0) {
      return {
        id: this.id,
        category: this.category,
        status: "pass",
        message: `plugin.json#permissions[] matches hooks.json derivation (${derived.size} entries)`,
      };
    }

    const parts: string[] = [];
    if (missing.length > 0) parts.push(`missing: ${missing.join(", ")}`);
    if (extra.length > 0) parts.push(`extra: ${extra.join(", ")}`);
    return {
      id: this.id,
      category: this.category,
      status: "fail",
      message: `plugin.json#permissions[] diverges from hooks.json derivation (${parts.join("; ")})`,
      remediation:
        "Regenerate plugin.json#permissions[] from hooks.json (union of hooks:<event> plus tools:<name> from matchers).",
    };
  }
}
