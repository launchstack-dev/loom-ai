/**
 * version-drift check — compares the installed Loom version against the latest
 * published GitHub release. Graceful degradation: network failure yields
 * `warn`, not `fail`.
 *
 * Category: channel
 */
import type { Check, CheckCategory } from "../check.interface";
import type { InstallState as InstallStateEnvelope } from "../../install-state";

// Inline structural HealthCheck type — Phase 0B left HealthCheck as `unknown`.
// Mirrors `protocols/doctor-report.schema.md`.
export interface HealthCheck {
  id: string;
  category: CheckCategory;
  status: "pass" | "warn" | "fail";
  message: string;
  fixCommand?: string | null;
  remediation?: string;
}

export interface VersionDriftDeps {
  /** Injected fetch implementation. Defaults to global `fetch`. */
  fetch?: typeof globalThis.fetch;
  /** Override the GitHub release URL (test seam). */
  releaseUrl?: string;
}

const DEFAULT_RELEASE_URL =
  "https://api.github.com/repos/launchstack-dev/loom-ai/releases/latest";

export default class VersionDriftCheck implements Check {
  readonly id = "version-drift";
  readonly category: CheckCategory = "channel";

  constructor(private readonly deps: VersionDriftDeps = {}) {}

  async run(state: InstallStateEnvelope): Promise<HealthCheck> {
    const envelope = state as { installedVersion?: string } | null | undefined;
    const installed = envelope?.installedVersion ?? "unknown";
    const fetchImpl = this.deps.fetch ?? globalThis.fetch;
    const url = this.deps.releaseUrl ?? DEFAULT_RELEASE_URL;

    if (typeof fetchImpl !== "function") {
      return {
        id: this.id,
        category: this.category,
        status: "warn",
        message: "No fetch implementation available; skipping version-drift check",
        fixCommand: null,
        remediation: "Upgrade Node.js to a version with global fetch, or inject a fetch shim",
      };
    }

    try {
      const res = await fetchImpl(url, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "loom-doctor",
        },
      });
      if (!res.ok) {
        return {
          id: this.id,
          category: this.category,
          status: "warn",
          message: `Could not query latest release (HTTP ${res.status}); skipping drift check`,
          fixCommand: null,
          remediation: "Retry later; this is a graceful degradation",
        };
      }
      const body = (await res.json()) as { tag_name?: string; name?: string };
      const latest = (body.tag_name ?? body.name ?? "").replace(/^v/, "");
      if (!latest) {
        return {
          id: this.id,
          category: this.category,
          status: "warn",
          message: "Release feed returned no tag_name; skipping drift check",
          fixCommand: null,
          remediation: "Retry later; this is a graceful degradation",
        };
      }
      if (latest === installed) {
        return {
          id: this.id,
          category: this.category,
          status: "pass",
          message: `Installed version ${installed} matches latest ${latest}`,
          fixCommand: null,
          remediation: "none",
        };
      }
      // Distinguish "we don't know what's installed" from "we know and it's stale".
      // The former is a bootstrap gap (plugin.json never landed); the latter is a
      // legitimate drift signal. Conflating them was the original UX bug — the
      // warning read like a version mismatch even when the real problem was an
      // unpopulated install envelope.
      if (installed === "unknown") {
        return {
          id: this.id,
          category: this.category,
          status: "warn",
          message: `Installed version unknown (plugin.json not bootstrapped); latest is ${latest}`,
          fixCommand: "/loom-update",
          remediation: `Run /loom-update to re-bootstrap install state, or re-run install.sh to repair the plugin.json artifact`,
        };
      }
      return {
        id: this.id,
        category: this.category,
        status: "warn",
        message: `Installed ${installed} differs from latest ${latest}`,
        fixCommand: "/loom-update",
        remediation: `Run /loom-update to install ${latest} (channel-aware, atomic, rollback-capable)`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        id: this.id,
        category: this.category,
        status: "warn",
        message: `Network error querying latest release: ${msg}`,
        fixCommand: null,
        remediation: "Retry later; this is a graceful degradation",
      };
    }
  }
}
