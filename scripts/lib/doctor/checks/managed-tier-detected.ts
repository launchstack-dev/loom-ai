/**
 * managed-tier-detected check — detects Loom hook entries in
 * `managed-settings.json` (MDM-managed). Severity: info. Does NOT trigger
 * tier-ambiguous: managed-tier entries are immutable and intentional.
 *
 * Category: tier
 */
import * as fsDefault from "node:fs";
import * as pathDefault from "node:path";
import type { Check, CheckCategory } from "../check.interface";
import type { InstallState as InstallStateEnvelope } from "../../install-state";
import type { HealthCheck } from "./version-drift";

export interface ManagedTierDetectedDeps {
  fs?: Pick<typeof fsDefault, "existsSync" | "readFileSync">;
  /**
   * Candidate absolute paths to managed-settings.json. The first one that
   * exists wins. Defaults to platform-typical locations.
   */
  candidatePaths?: string[];
  hasLoomEntries?: (parsed: unknown) => boolean;
}

const DEFAULT_HAS_LOOM_ENTRIES = (parsed: unknown): boolean => {
  if (!parsed || typeof parsed !== "object") return false;
  const text = JSON.stringify(parsed);
  return /run-hook\.sh|\$\{CLAUDE_PLUGIN_ROOT\}\/hooks|loom/i.test(text);
};

function defaultCandidatePaths(): string[] {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const cwd = process.cwd();
  const list: string[] = [];
  if (home) {
    list.push(pathDefault.join(home, ".claude", "managed-settings.json"));
  }
  list.push(pathDefault.join(cwd, ".claude", "managed-settings.json"));
  // macOS / Linux MDM-managed locations.
  list.push("/Library/Application Support/Claude/managed-settings.json");
  list.push("/etc/claude/managed-settings.json");
  return list;
}

export default class ManagedTierDetectedCheck implements Check {
  readonly id = "managed-tier-detected";
  readonly category: CheckCategory = "tier";

  constructor(private readonly deps: ManagedTierDetectedDeps = {}) {}

  async run(_state: InstallStateEnvelope): Promise<HealthCheck> {
    const fs = this.deps.fs ?? fsDefault;
    const candidates = this.deps.candidatePaths ?? defaultCandidatePaths();
    const hasLoomEntries = this.deps.hasLoomEntries ?? DEFAULT_HAS_LOOM_ENTRIES;

    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue;
      try {
        const text = fs.readFileSync(candidate, "utf8");
        const parsed = JSON.parse(text);
        if (hasLoomEntries(parsed)) {
          return {
            id: this.id,
            category: this.category,
            status: "pass", // info-severity status; aggregator surfaces as info
            message: `Managed Loom hook entries detected at ${candidate} — managed tier is immutable`,
            fixCommand: null,
            remediation:
              "Loom will not modify managed-settings.json. Contact your administrator if changes are needed.",
          };
        }
      } catch {
        // Ignore unreadable / unparseable managed settings.
      }
    }

    return {
      id: this.id,
      category: this.category,
      status: "pass",
      message: "No managed-tier Loom entries detected",
      fixCommand: null,
      remediation: "none",
    };
  }
}
