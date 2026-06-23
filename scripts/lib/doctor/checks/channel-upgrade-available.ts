/**
 * channel-upgrade-available check — on a curl-installed host, probes whether
 * the Claude Code plugin marketplace endpoint is reachable. If so, offers an
 * optional channel upgrade. Severity: info, exit code 0.
 *
 * Category: channel
 */
import type { Check, CheckCategory } from "../check.interface";
import type { InstallState as InstallStateEnvelope } from "../../install-state";
import type { HealthCheck } from "./version-drift";

export interface ChannelUpgradeAvailableDeps {
  fetch?: typeof globalThis.fetch;
  /** URL to probe for marketplace reachability. */
  marketplaceUrl?: string;
}

const DEFAULT_MARKETPLACE_URL = "https://claude.ai/api/plugin-marketplace/health";

export default class ChannelUpgradeAvailableCheck implements Check {
  readonly id = "channel-upgrade-available";
  readonly category: CheckCategory = "channel";

  constructor(private readonly deps: ChannelUpgradeAvailableDeps = {}) {}

  async run(state: InstallStateEnvelope): Promise<HealthCheck> {
    const envelope = state as { channel?: string } | null | undefined;
    const channel = envelope?.channel;

    // Only fires on curl installs.
    if (channel !== "curl") {
      return {
        id: this.id,
        category: this.category,
        status: "pass",
        message: `Channel ${channel ?? "unknown"} — channel upgrade probe skipped`,
        fixCommand: null,
        remediation: "none",
      };
    }

    const fetchImpl = this.deps.fetch ?? globalThis.fetch;
    const url = this.deps.marketplaceUrl ?? DEFAULT_MARKETPLACE_URL;
    if (typeof fetchImpl !== "function") {
      return {
        id: this.id,
        category: this.category,
        status: "pass",
        message: "No fetch implementation; marketplace reachability unknown",
        fixCommand: null,
        remediation: "none",
      };
    }

    try {
      const res = await fetchImpl(url, { method: "GET" });
      if (res.ok) {
        return {
          id: this.id,
          category: this.category,
          status: "pass", // info-severity status; aggregator maps to info severity / exit 0
          message:
            "Claude Code plugin marketplace is reachable — you can upgrade to the plugin channel",
          fixCommand: null,
          remediation:
            "Optional: run /loom-uninstall, then `/plugin install loom` from within Claude Code",
        };
      }
      return {
        id: this.id,
        category: this.category,
        status: "pass",
        message: `Marketplace probe returned HTTP ${res.status}; no upgrade offered`,
        fixCommand: null,
        remediation: "none",
      };
    } catch {
      return {
        id: this.id,
        category: this.category,
        status: "pass",
        message: "Marketplace not reachable; staying on curl channel",
        fixCommand: null,
        remediation: "none",
      };
    }
  }
}
