/**
 * Generates the `converge.config` TOON the `/loom-git review-pr --autoconverge`
 * wrapper hands to `/loom-converge`. Field bindings per
 * `protocols/converge.config.applications.md` § F-04.
 *
 * This module is pure (no I/O). The wrapper is responsible for writing the
 * result atomically; this helper just produces the encoded string + the
 * structured representation for unit tests.
 */

/** Bot adapters supported by the F-04 dispatcher. */
export type BotAdapter = "gemini" | "coderabbit" | "copilot";

/** Inputs for {@link buildWrapperConfig}. */
export interface WrapperConfigInput {
  /** PR number resolved from `gh pr view --json number`. */
  prNumber: number;
  /** Bot adapter to dispatch to. Default: `gemini`. */
  botAdapter?: BotAdapter;
  /** Max iterations. Default: 5 per F-04 spec. */
  maxIterations?: number;
  /**
   * Override the subject path. Default: the F-04 synthetic projection at
   * `.plan-execution/pr-review/pr-state.toon` (OQ-02).
   */
  subject?: string;
  /**
   * Override the harness path. Default: `scripts/pr-review-harness.ts`.
   */
  harness?: string;
  /**
   * Override the integrator agent name. Default: `pr-fixer-agent`.
   */
  integrator?: string;
}

/** Structured form of the F-04 `converge.config`. */
export interface WrapperConfig {
  mode: "document";
  subject: string;
  harness: string;
  integrator: string;
  maxIterations: number;
  snapshotEnabled: true;
  botAdapter: BotAdapter;
  prNumber: number;
}

const DEFAULTS = {
  subject: ".plan-execution/pr-review/pr-state.toon",
  harness: "scripts/pr-review-harness.ts",
  integrator: "pr-fixer-agent",
  maxIterations: 5,
  botAdapter: "gemini" as BotAdapter,
} as const;

/**
 * Build the structured `WrapperConfig` for the F-04 PR-review loop. Throws on
 * invalid `prNumber` or `maxIterations`.
 */
export function buildWrapperConfig(input: WrapperConfigInput): WrapperConfig {
  const {
    prNumber,
    botAdapter = DEFAULTS.botAdapter,
    maxIterations = DEFAULTS.maxIterations,
    subject = DEFAULTS.subject,
    harness = DEFAULTS.harness,
    integrator = DEFAULTS.integrator,
  } = input;

  if (!Number.isInteger(prNumber) || prNumber < 1) {
    throw new Error(
      `wrapper-config: prNumber must be a positive integer (got ${prNumber})`,
    );
  }
  if (!Number.isInteger(maxIterations) || maxIterations < 1) {
    throw new Error(
      `wrapper-config: maxIterations must be a positive integer (got ${maxIterations})`,
    );
  }
  const allowed: BotAdapter[] = ["gemini", "coderabbit", "copilot"];
  if (!allowed.includes(botAdapter)) {
    throw new Error(
      `wrapper-config: botAdapter must be one of ${allowed.join("|")} (got ${botAdapter})`,
    );
  }

  return {
    mode: "document",
    subject,
    harness,
    integrator,
    maxIterations,
    snapshotEnabled: true,
    botAdapter,
    prNumber,
  };
}

/** Encode a {@link WrapperConfig} as TOON (the on-disk form). */
export function encodeWrapperConfigToToon(cfg: WrapperConfig): string {
  return [
    `mode: ${cfg.mode}`,
    `subject: ${cfg.subject}`,
    `harness: ${cfg.harness}`,
    `integrator: ${cfg.integrator}`,
    `maxIterations: ${cfg.maxIterations}`,
    `snapshotEnabled: ${cfg.snapshotEnabled ? "true" : "false"}`,
    `botAdapter: ${cfg.botAdapter}`,
    `prNumber: ${cfg.prNumber}`,
    "",
  ].join("\n");
}
