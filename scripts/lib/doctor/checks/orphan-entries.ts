/**
 * orphan-entries — detects settings.json hook entries that reference hook
 * scripts which no longer exist on disk (e.g. Loom-owned entries left behind
 * after a hook script was removed or renamed).
 *
 * Severity `warn`. `fixCommand: /loom-doctor --fix`. Category `hook-wiring`.
 */

import * as fsSync from "node:fs";
import * as nodePath from "node:path";

import type { Check, CheckCategory, InstallState } from "../check.interface";

type HealthCheck = {
  id: string;
  category: CheckCategory;
  status: "pass" | "warn" | "fail";
  message: string;
  fixCommand?: string | null;
  remediation?: string;
};

export interface OrphanEntriesDeps {
  /** Install root used to resolve `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PROJECT_DIR}` anchors. */
  installRoot: string;
  settingsPaths: string[];
  readFile?: (p: string) => string;
  existsSync?: (p: string) => boolean;
}

type SettingsHookEntry = { type?: string; command?: string };
type SettingsHookGroup = { matcher?: string; hooks?: SettingsHookEntry[] };
type SettingsFile = { hooks?: Record<string, SettingsHookGroup[]> };

function resolveReferencedScripts(command: string, installRoot: string): string[] {
  const out: string[] = [];
  // Variable-anchored paths.
  const reVar = /\$\{(?:CLAUDE_PLUGIN_ROOT|CLAUDE_PROJECT_DIR)\}\/([^"'\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = reVar.exec(command)) !== null) {
    const rel = m[1];
    if (rel.endsWith("run-hook.sh")) continue;
    if (/\.(ts|cjs|sh|js|mjs)$/.test(rel)) {
      out.push(nodePath.join(installRoot, rel));
    }
  }
  // Absolute hook-script paths (curl-anchored case).
  const reAbs = /\s(\/[^"'\s]+\.(?:ts|cjs|sh|js|mjs))/g;
  while ((m = reAbs.exec(command)) !== null) {
    const p = m[1];
    if (p.endsWith("run-hook.sh")) continue;
    out.push(p);
  }
  return out;
}

export default class OrphanEntriesCheck implements Check {
  readonly id = "orphan-entries";
  readonly category: CheckCategory = "hook-wiring";

  private readonly deps: Required<OrphanEntriesDeps>;

  constructor(deps: OrphanEntriesDeps) {
    this.deps = {
      installRoot: deps.installRoot,
      settingsPaths: deps.settingsPaths,
      readFile: deps.readFile ?? ((p) => fsSync.readFileSync(p, "utf8")),
      existsSync: deps.existsSync ?? ((p) => fsSync.existsSync(p)),
    };
  }

  async run(_state: InstallState): Promise<HealthCheck> {
    void _state;
    const orphans: Array<{ settings: string; script: string }> = [];

    for (const sp of this.deps.settingsPaths) {
      if (!this.deps.existsSync(sp)) continue;
      let parsed: SettingsFile;
      try {
        parsed = JSON.parse(this.deps.readFile(sp)) as SettingsFile;
      } catch {
        continue;
      }
      const groups = parsed.hooks ?? {};
      for (const event of Object.keys(groups)) {
        for (const grp of groups[event] ?? []) {
          for (const h of grp.hooks ?? []) {
            if (!h.command) continue;
            for (const script of resolveReferencedScripts(h.command, this.deps.installRoot)) {
              if (!this.deps.existsSync(script)) {
                orphans.push({ settings: sp, script });
              }
            }
          }
        }
      }
    }

    if (orphans.length === 0) {
      return {
        id: this.id,
        category: this.category,
        status: "pass",
        message: "No orphaned settings entries detected",
      };
    }

    return {
      id: this.id,
      category: this.category,
      status: "warn",
      message: `${orphans.length} settings entry/entries reference missing hook scripts`,
      fixCommand: "/loom-doctor --fix",
      remediation: "Remove or restore the referenced hook scripts.",
    };
  }
}
