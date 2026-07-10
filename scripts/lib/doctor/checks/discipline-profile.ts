/**
 * discipline-profile — reports the configured, resolved, and effective
 * discipline profile for this project (roadmap M-1, C-02).
 *
 * Read-only: resolution logic lives in `hooks/lib/discipline.ts` (the single
 * seam); writing `resolved` is `/loom-doctor --resolve-profile`'s job.
 *
 * Category: `settings` (per `protocols/doctor-report.schema.md`).
 */

import type { Check, CheckCategory, InstallState } from "../check.interface";
import {
  readDisciplineConfig,
  resolveProfile,
  type DisciplineConfig,
} from "../../../../hooks/lib/discipline.js";

type HealthCheck = {
  id: string;
  category: CheckCategory;
  status: "pass" | "warn" | "fail";
  message: string;
  remediation?: string;
};

export interface DisciplineProfileDeps {
  cwd?: string;
  readConfig?: (cwd?: string) => DisciplineConfig;
}

export default class DisciplineProfileCheck implements Check {
  readonly id = "discipline-profile";
  readonly category: CheckCategory = "settings";

  private readonly deps: DisciplineProfileDeps;

  constructor(deps: DisciplineProfileDeps = {}) {
    this.deps = deps;
  }

  async run(_state: InstallState): Promise<HealthCheck> {
    void _state;
    const cwd = this.deps.cwd ?? process.cwd();
    const readConfig = this.deps.readConfig ?? readDisciplineConfig;

    const config = readConfig(cwd);
    const effective = resolveProfile(config, cwd);

    const floors = Object.entries(config.tierOverrides)
      .map(([tier, floor]) => `${tier}→${floor}`)
      .join(", ");

    const parts = [
      `profile=${config.profile}`,
      `resolved=${config.resolved ?? "(none)"}`,
      `effective=${effective}`,
      `tier floors: ${floors || "(none)"}`,
    ];

    if (config.profile === "auto" && !config.resolved) {
      parts.push(
        "defaulting to strict (C-06) — run /loom-doctor --resolve-profile to probe harness capabilities"
      );
    }

    return {
      id: this.id,
      category: this.category,
      status: "pass",
      message: parts.join("; "),
    };
  }
}
