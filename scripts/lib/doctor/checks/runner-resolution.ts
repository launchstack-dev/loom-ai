/**
 * runner-resolution — verifies that `bun` or `node` (the runtimes used by
 * `hooks/run-hook.sh`) resolves under a stripped PATH. Mirrors the
 * `scripts/probe-hook-runtime.sh` shape: invoke `command -v` under
 * `PATH=/usr/bin:/bin` plus the Homebrew dirs prepended by the wrapper.
 *
 * Severity: `warn` if neither bun nor node resolves (matches install.sh's
 * "Neither bun nor node resolved" warning rather than a hard fail; users may
 * deliberately run in a constrained shell).
 *
 * Category: `hook-wiring`.
 */

import { execFileSync } from "node:child_process";

import type { Check, CheckCategory, InstallState } from "../check.interface";

type HealthCheck = {
  id: string;
  category: CheckCategory;
  status: "pass" | "warn" | "fail";
  message: string;
  fixCommand?: string | null;
  remediation?: string;
};

export interface RunnerResolutionDeps {
  /**
   * Probe whether the named runtime resolves on PATH. Defaults to invoking
   * `command -v <name>` via `sh -c` under a stripped PATH that matches the
   * wrapper's salvage paths.
   */
  probe?: (runtime: "bun" | "node") => boolean;
}

const STRIPPED_PATH =
  "/opt/homebrew/bin:/usr/local/bin:/home/linuxbrew/.linuxbrew/bin:/usr/bin:/bin";

function defaultProbe(runtime: "bun" | "node"): boolean {
  try {
    execFileSync("sh", ["-c", `command -v ${runtime} >/dev/null 2>&1`], {
      env: { PATH: STRIPPED_PATH, HOME: process.env.HOME ?? "/tmp" },
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

export default class RunnerResolutionCheck implements Check {
  readonly id = "runner-resolution";
  readonly category: CheckCategory = "hook-wiring";

  private readonly probe: (runtime: "bun" | "node") => boolean;

  constructor(deps: RunnerResolutionDeps = {}) {
    this.probe = deps.probe ?? defaultProbe;
  }

  async run(_state: InstallState): Promise<HealthCheck> {
    void _state;
    const bun = this.probe("bun");
    const node = this.probe("node");

    if (bun || node) {
      const resolved = [bun ? "bun" : null, node ? "node" : null].filter(Boolean).join(", ");
      return {
        id: this.id,
        category: this.category,
        status: "pass",
        message: `Hook runner resolved: ${resolved}`,
      };
    }

    return {
      id: this.id,
      category: this.category,
      status: "warn",
      message: "Neither bun nor node resolves under the wrapper's stripped PATH",
      remediation:
        "Install bun (https://bun.sh) or node, or extend PATH in hooks/run-hook.sh.",
    };
  }
}
