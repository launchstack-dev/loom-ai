/**
 * install-interrupted check — detects an in-flight or failed installation by
 * inspecting `install.toon.updateInProgress` and `install.toon.installError`.
 * Severity: warn (per registry spec — installer can recover).
 *
 * Category: channel
 */
import type { Check, CheckCategory } from "../check.interface";
import type { InstallState as InstallStateEnvelope } from "../../install-state";
import type { HealthCheck } from "./version-drift";

export default class InstallInterruptedCheck implements Check {
  readonly id = "install-interrupted";
  readonly category: CheckCategory = "channel";

  async run(state: InstallStateEnvelope): Promise<HealthCheck> {
    const envelope = state as {
      updateInProgress?: unknown;
      installError?: unknown;
    } | null | undefined;

    const inProgress = envelope?.updateInProgress ?? null;
    const installError = envelope?.installError ?? null;

    if (inProgress !== null && inProgress !== undefined) {
      const detail =
        inProgress === "failed"
          ? "updateInProgress=failed"
          : typeof inProgress === "object"
            ? `updateInProgress from ${(inProgress as { fromVersion?: string }).fromVersion ?? "?"} -> ${(inProgress as { toVersion?: string }).toVersion ?? "?"}`
            : `updateInProgress=${String(inProgress)}`;
      return {
        id: this.id,
        category: this.category,
        status: "warn",
        message: `Installer marker present: ${detail}`,
        fixCommand: "/loom-upgrade --resume",
        remediation:
          "Run /loom-upgrade --resume to complete the interrupted upgrade, or /loom-doctor --fix to clear the marker",
      };
    }

    if (installError !== null && installError !== undefined) {
      const err = installError as { step?: string; message?: string };
      return {
        id: this.id,
        category: this.category,
        status: "warn",
        message: `Last install failed at step "${err.step ?? "?"}": ${err.message ?? "no message"}`,
        fixCommand: "/loom-upgrade --resume",
        remediation:
          "Inspect ~/.loom/install.toon and re-run the installer; /loom-doctor --fix can clear stale errors",
      };
    }

    return {
      id: this.id,
      category: this.category,
      status: "pass",
      message: "No interrupted install markers detected",
      fixCommand: null,
      remediation: "none",
    };
  }
}
