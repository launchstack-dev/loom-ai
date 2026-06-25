/**
 * MigrationRunner — the contract that Phase 9A1's `--fix` dispatch consumes and
 * Phase 9B's `scripts/lib/migration-runner.ts` implements. Lives in Phase 0 so
 * both phases can compile against it in parallel without a sibling dependency.
 *
 * The schema for `MigrationEvidence` is documented in
 * `protocols/migration-evidence.schema.md`. A first-class TypeScript
 * type module (`migration-evidence.types.ts`) does not exist yet; once Phase 9B
 * lands it, swap the `unknown` return type for the real type.
 */

// TODO: tighten when Phase 9B lands migration-evidence types
//       (replace `unknown` with `import type { MigrationEvidence } from ...`).
export type MigrationEvidence = unknown;

/**
 * The install channel a host has migrated *from* or *to*.
 * - `curl`: legacy single-file install via `curl | bash`.
 * - `plugin`: managed install under `~/.claude/plugins/loom/` (Claude Code plugin runtime).
 */
export type Channel = 'curl' | 'plugin';

export interface MigrationRunner {
  /**
   * Execute the migration end-to-end and return a structured evidence record.
   * Implementations must be idempotent: re-invoking after a partial failure
   * resumes from the last durable checkpoint.
   */
  run(): Promise<MigrationEvidence>;

  /**
   * Reconcile the on-disk install state with the declared `channel`. Used by
   * `/loom-doctor --fix` when a host straddles both channels (e.g. plugin
   * installed but legacy `~/.loom` artifacts still present).
   */
  reconcile(channel: Channel): Promise<void>;

  /**
   * Clear cached evidence for the given doctor-check id, forcing the next
   * `run()` to re-collect from scratch. Used when an operator overrides a
   * stuck check.
   */
  resetEvidence(checkId: string): Promise<void>;
}
