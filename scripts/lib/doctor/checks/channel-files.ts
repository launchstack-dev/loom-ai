/**
 * channel-files check — detects mixed-channel state where both curl-installed
 * Loom files and the Claude Code plugin directory (~/.claude/plugins/loom/)
 * coexist on disk. Severity: fail.
 *
 * Category: channel
 */
import * as fsDefault from "node:fs";
import * as pathDefault from "node:path";
import type { Check, CheckCategory } from "../check.interface";
import type { InstallState as InstallStateEnvelope } from "../../install-state";
import type { HealthCheck } from "./version-drift";

export interface ChannelFilesDeps {
  fs?: Pick<typeof fsDefault, "existsSync">;
  /** Absolute path to user home (defaults to process.env.HOME / USERPROFILE). */
  home?: string;
  /** Absolute path to the curl-installed loom dir (defaults to `${home}/.loom`). */
  curlPath?: string;
  /** Absolute path to the plugin-installed loom dir. */
  pluginPath?: string;
}

export default class ChannelFilesCheck implements Check {
  readonly id = "channel-files";
  readonly category: CheckCategory = "channel";

  constructor(private readonly deps: ChannelFilesDeps = {}) {}

  async run(_state: InstallStateEnvelope): Promise<HealthCheck> {
    const fs = this.deps.fs ?? fsDefault;
    const home =
      this.deps.home ?? process.env.HOME ?? process.env.USERPROFILE ?? "";
    const curlPath =
      this.deps.curlPath ?? (home ? pathDefault.join(home, ".loom") : "");
    const pluginPath =
      this.deps.pluginPath ??
      (home ? pathDefault.join(home, ".claude", "plugins", "loom") : "");

    const curlPresent = curlPath ? fs.existsSync(curlPath) : false;
    const pluginPresent = pluginPath ? fs.existsSync(pluginPath) : false;

    if (curlPresent && pluginPresent) {
      return {
        id: this.id,
        category: this.category,
        status: "fail",
        message: `Mixed-channel state: both curl (${curlPath}) and plugin (${pluginPath}) installations detected`,
        fixCommand: "/loom-doctor --fix --reconcile",
        remediation:
          "Run /loom-doctor --fix --reconcile to choose one channel and remove the other",
      };
    }
    return {
      id: this.id,
      category: this.category,
      status: "pass",
      message: "No mixed-channel state detected",
      fixCommand: null,
      remediation: "none",
    };
  }
}
