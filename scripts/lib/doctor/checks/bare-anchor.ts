/**
 * bare-anchor — detects legacy pre-PR-8 settings entries whose command field
 * references `scripts/run-hook.sh` (or `hooks/run-hook.sh`) without either
 * canonical anchor variable. These entries break when Claude Code invokes the
 * hook from a different cwd.
 *
 * Severity `warn`. `fixCommand: /loom-doctor --fix`. Category `hook-wiring`.
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

export interface BareAnchorDeps {
  settingsPaths: string[];
  readFile?: (p: string) => string;
  existsSync?: (p: string) => boolean;
}

type SettingsHookEntry = { type?: string; command?: string };
type SettingsHookGroup = { matcher?: string; hooks?: SettingsHookEntry[] };
type SettingsFile = { hooks?: Record<string, SettingsHookGroup[]> };

const ANCHOR_VARS = ["${CLAUDE_PLUGIN_ROOT}", "${CLAUDE_PROJECT_DIR}"];
// Legacy bare patterns observed pre-PR-8.
const BARE_PATTERNS = [
  /(?<![/$}\w])scripts\/run-hook\.sh/,
  /(?<![/$}\w])hooks\/run-hook\.sh/,
];

function hasAnchorVar(cmd: string): boolean {
  return ANCHOR_VARS.some((a) => cmd.includes(a));
}

function isAbsolutePathToRunHook(cmd: string): boolean {
  return /\s\/[^\s"']+\/hooks\/run-hook\.sh/.test(cmd);
}

function isBareAnchor(cmd: string): boolean {
  if (!cmd.includes("run-hook.sh")) return false;
  if (hasAnchorVar(cmd)) return false;
  if (isAbsolutePathToRunHook(cmd)) return false;
  return BARE_PATTERNS.some((re) => re.test(cmd));
}

export default class BareAnchorCheck implements Check {
  readonly id = "bare-anchor";
  readonly category: CheckCategory = "hook-wiring";

  private readonly deps: Required<BareAnchorDeps>;

  constructor(deps: BareAnchorDeps) {
    this.deps = {
      settingsPaths: deps.settingsPaths,
      readFile: deps.readFile ?? ((p) => fsSync.readFileSync(p, "utf8")),
      existsSync: deps.existsSync ?? ((p) => fsSync.existsSync(p)),
    };
  }

  async run(_state: InstallState): Promise<HealthCheck> {
    void _state;
    const offenders: Array<{ path: string; command: string }> = [];

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
            if (isBareAnchor(h.command)) {
              offenders.push({ path: sp, command: h.command });
            }
          }
        }
      }
    }

    if (offenders.length === 0) {
      return {
        id: this.id,
        category: this.category,
        status: "pass",
        message: "No legacy bare-anchor entries detected",
      };
    }

    return {
      id: this.id,
      category: this.category,
      status: "warn",
      message: `${offenders.length} entry/entries use the legacy bare anchor (pre-PR-8)`,
      fixCommand: "/loom-doctor --fix",
      remediation:
        "Re-run /loom-init or /loom-doctor --fix to rewrite entries with the correct anchor variable.",
    };
  }
}
