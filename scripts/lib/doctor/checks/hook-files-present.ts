/**
 * hook-files-present — verifies all hook script files referenced from
 * `hooks/hooks.json` resolve to an existing file on disk under the install
 * root. Severity `fail` if any file is missing.
 *
 * Category: `hook-wiring` (per `protocols/doctor-report.schema.md`).
 */

import * as fsSync from "node:fs";
import * as nodePath from "node:path";

import type { Check, CheckCategory, InstallState } from "../check.interface";

// Local structural HealthCheck mirror — Phase 0B exports `unknown` for now,
// but emitters must produce records that conform to doctor-report.schema.md.
type HealthCheck = {
  id: string;
  category: CheckCategory;
  status: "pass" | "warn" | "fail";
  message: string;
  fixCommand?: string | null;
  remediation?: string;
};

export interface HookFilesPresentDeps {
  /** Absolute path to the directory containing `hooks/hooks.json` (the install root). */
  installRoot: string;
  /** Absolute path to `hooks/hooks.json`. Falls back to `${installRoot}/hooks/hooks.json`. */
  hooksJsonPath?: string;
  readFile?: (p: string) => string;
  existsSync?: (p: string) => boolean;
}

type HooksManifestEntry = {
  type?: string;
  command?: string;
};

type HooksManifestGroup = {
  matcher?: string;
  hooks?: HooksManifestEntry[];
};

type HooksManifest = {
  hooks?: Record<string, HooksManifestGroup[]>;
};

/**
 * Extract referenced hook script paths from command strings.
 *
 * Commands take the form:
 *   sh "${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.sh" "${CLAUDE_PLUGIN_ROOT}/hooks/foo.ts"
 *
 * We pull every `${CLAUDE_PLUGIN_ROOT}/...` (or `${CLAUDE_PROJECT_DIR}/...`)
 * argument that ends in `.ts` / `.cjs` / `.sh`, strip the anchor, and resolve
 * against `installRoot`.
 */
function extractHookScriptPaths(command: string, installRoot: string): string[] {
  const out: string[] = [];
  // Match either anchor.
  const re = /\$\{(?:CLAUDE_PLUGIN_ROOT|CLAUDE_PROJECT_DIR)\}\/([^"'\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(command)) !== null) {
    const rel = m[1];
    // Skip the wrapper itself — its presence is implicit (it's the invoker).
    if (rel.endsWith("run-hook.sh")) continue;
    if (/\.(ts|cjs|sh)$/.test(rel)) {
      out.push(nodePath.join(installRoot, rel));
    }
  }
  return out;
}

export default class HookFilesPresentCheck implements Check {
  readonly id = "hook-files-present";
  readonly category: CheckCategory = "hook-wiring";

  private readonly deps: Required<HookFilesPresentDeps>;

  constructor(deps: HookFilesPresentDeps) {
    this.deps = {
      installRoot: deps.installRoot,
      hooksJsonPath:
        deps.hooksJsonPath ?? nodePath.join(deps.installRoot, "hooks", "hooks.json"),
      readFile: deps.readFile ?? ((p) => fsSync.readFileSync(p, "utf8")),
      existsSync: deps.existsSync ?? ((p) => fsSync.existsSync(p)),
    };
  }

  async run(_state: InstallState): Promise<HealthCheck> {
    void _state;
    let manifest: HooksManifest;
    try {
      manifest = JSON.parse(this.deps.readFile(this.deps.hooksJsonPath)) as HooksManifest;
    } catch (err) {
      return {
        id: this.id,
        category: this.category,
        status: "fail",
        message: `Failed to read or parse ${this.deps.hooksJsonPath}: ${(err as Error).message}`,
        remediation: "Reinstall Loom or restore hooks/hooks.json.",
      };
    }

    const referenced = new Set<string>();
    const groups = manifest.hooks ?? {};
    for (const event of Object.keys(groups)) {
      for (const group of groups[event] ?? []) {
        for (const h of group.hooks ?? []) {
          if (!h.command) continue;
          for (const p of extractHookScriptPaths(h.command, this.deps.installRoot)) {
            referenced.add(p);
          }
        }
      }
    }

    const missing: string[] = [];
    for (const p of referenced) {
      if (!this.deps.existsSync(p)) missing.push(p);
    }

    if (missing.length === 0) {
      return {
        id: this.id,
        category: this.category,
        status: "pass",
        message: `All ${referenced.size} declared hook files exist`,
      };
    }

    return {
      id: this.id,
      category: this.category,
      status: "fail",
      message: `${missing.length} hook file(s) missing: ${missing.join(", ")}`,
      remediation: "Reinstall Loom or run /loom-doctor --fix to restore missing hooks.",
    };
  }
}
