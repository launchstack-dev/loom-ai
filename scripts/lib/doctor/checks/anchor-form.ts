/**
 * anchor-form — validates that settings.json hook entries use the canonical
 * anchor for their install source:
 *   - plugin install → `${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.sh`
 *   - curl install   → `${CLAUDE_PROJECT_DIR}/hooks/run-hook.sh` or absolute path
 *
 * Severity `fail` on mismatch. Category `hook-wiring`.
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

export type InstallSource = "plugin" | "curl";

export interface AnchorFormDeps {
  installSource: InstallSource;
  settingsPaths: string[];
  readFile?: (p: string) => string;
  existsSync?: (p: string) => boolean;
}

type SettingsHookEntry = { type?: string; command?: string };
type SettingsHookGroup = { matcher?: string; hooks?: SettingsHookEntry[] };
type SettingsFile = {
  hooks?: Record<string, SettingsHookGroup[]>;
};

const PLUGIN_ANCHOR = "${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.sh";
const CURL_ANCHOR_VAR = "${CLAUDE_PROJECT_DIR}/hooks/run-hook.sh";

function isPluginAnchor(cmd: string): boolean {
  return cmd.includes(PLUGIN_ANCHOR);
}

function isCurlAnchor(cmd: string): boolean {
  if (cmd.includes(CURL_ANCHOR_VAR)) return true;
  // absolute path to run-hook.sh (e.g. /Users/.../hooks/run-hook.sh)
  return /\s\/[^\s"']+\/hooks\/run-hook\.sh/.test(cmd);
}

export default class AnchorFormCheck implements Check {
  readonly id = "anchor-form";
  readonly category: CheckCategory = "hook-wiring";

  private readonly deps: Required<AnchorFormDeps>;

  constructor(deps: AnchorFormDeps) {
    this.deps = {
      installSource: deps.installSource,
      settingsPaths: deps.settingsPaths,
      readFile: deps.readFile ?? ((p) => fsSync.readFileSync(p, "utf8")),
      existsSync: deps.existsSync ?? ((p) => fsSync.existsSync(p)),
    };
  }

  async run(_state: InstallState): Promise<HealthCheck> {
    void _state;
    const mismatches: Array<{ path: string; command: string }> = [];

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
            const cmd = h.command;
            if (!cmd) continue;
            // Only inspect entries that look like Loom run-hook.sh invocations.
            if (!cmd.includes("run-hook.sh")) continue;
            const ok =
              this.deps.installSource === "plugin"
                ? isPluginAnchor(cmd)
                : isCurlAnchor(cmd);
            if (!ok) mismatches.push({ path: sp, command: cmd });
          }
        }
      }
    }

    if (mismatches.length === 0) {
      return {
        id: this.id,
        category: this.category,
        status: "pass",
        message: `All settings entries use the correct ${this.deps.installSource} anchor`,
      };
    }

    const expected =
      this.deps.installSource === "plugin" ? PLUGIN_ANCHOR : CURL_ANCHOR_VAR;
    return {
      id: this.id,
      category: this.category,
      status: "fail",
      message: `${mismatches.length} settings entry/entries use the wrong anchor for installSource=${this.deps.installSource}`,
      remediation: `Update commands to use ${expected} (or run /loom-doctor --fix).`,
    };
  }
}
