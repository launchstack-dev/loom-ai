/**
 * tier-ambiguous check — detects when Loom hook entries appear in BOTH
 * `.claude/settings.json` and `.claude/settings.local.json`. Severity: fail.
 *
 * fixCommand is intentionally null — the user must re-run register with an
 * explicit --tier flag (we cannot guess intent).
 *
 * Category: tier
 */
import * as fsDefault from "node:fs";
import * as pathDefault from "node:path";
import type { Check, CheckCategory } from "../check.interface";
import type { InstallState as InstallStateEnvelope } from "../../install-state";
import type { HealthCheck } from "./version-drift";

export interface TierAmbiguousDeps {
  fs?: Pick<typeof fsDefault, "existsSync" | "readFileSync">;
  /** Project directory (defaults to process.cwd()). */
  projectDir?: string;
  /** Predicate to decide whether a parsed settings object contains Loom hook entries. */
  hasLoomEntries?: (parsed: unknown) => boolean;
}

const DEFAULT_HAS_LOOM_ENTRIES = (parsed: unknown): boolean => {
  if (!parsed || typeof parsed !== "object") return false;
  const text = JSON.stringify(parsed);
  // Loom-owned hook entries reference run-hook.sh or the loom plugin anchor.
  return /run-hook\.sh|\$\{CLAUDE_PLUGIN_ROOT\}\/hooks|loom/i.test(text);
};

export default class TierAmbiguousCheck implements Check {
  readonly id = "tier-ambiguous";
  readonly category: CheckCategory = "tier";

  constructor(private readonly deps: TierAmbiguousDeps = {}) {}

  async run(_state: InstallStateEnvelope): Promise<HealthCheck> {
    const fs = this.deps.fs ?? fsDefault;
    const projectDir = this.deps.projectDir ?? process.cwd();
    const hasLoomEntries = this.deps.hasLoomEntries ?? DEFAULT_HAS_LOOM_ENTRIES;

    const projectPath = pathDefault.join(projectDir, ".claude", "settings.json");
    const localPath = pathDefault.join(
      projectDir,
      ".claude",
      "settings.local.json",
    );

    const projectHasLoom = fileHasLoom(fs, projectPath, hasLoomEntries);
    const localHasLoom = fileHasLoom(fs, localPath, hasLoomEntries);

    if (projectHasLoom && localHasLoom) {
      return {
        id: this.id,
        category: this.category,
        status: "fail",
        message:
          "Loom hook entries detected in BOTH .claude/settings.json (project tier) and .claude/settings.local.json (local tier) — tier is ambiguous",
        fixCommand: null,
        remediation:
          "Re-run the installer with an explicit --tier flag (--tier project or --tier local) to pick one source of truth, then remove Loom entries from the other file",
      };
    }
    return {
      id: this.id,
      category: this.category,
      status: "pass",
      message: "No tier ambiguity detected",
      fixCommand: null,
      remediation: "none",
    };
  }
}

function fileHasLoom(
  fs: Pick<typeof fsDefault, "existsSync" | "readFileSync">,
  filePath: string,
  predicate: (parsed: unknown) => boolean,
): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const text = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(text);
    return predicate(parsed);
  } catch {
    return false;
  }
}
