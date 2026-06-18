/**
 * Check — the contract every Phase 9A2 doctor-check module implements and
 * Phase 9A1's `scripts/lib/doctor/index.ts` dispatches over. Lives in Phase 0
 * so 9A1 and 9A2 can compile in parallel without a sibling dependency.
 *
 * The DoctorReport / HealthCheck schemas live in
 * `agents/protocols/doctor-report.schema.md`. The InstallState schema lives in
 * `agents/protocols/install-state.schema.md` (channel-envelope flavor). First-
 * class TypeScript type modules for either are not yet on disk; once they
 * land, swap the placeholder `unknown` types below.
 */

// TODO: tighten when channel-envelope InstallState types land
//       (replace `unknown` with `import type { InstallState } from '../install-state'`).
export type InstallState = unknown;

// TODO: tighten when doctor-report types land
//       (replace `unknown` with `import type { HealthCheck } from '../../../agents/protocols/doctor-report.types'`).
export type HealthCheck = unknown;

/**
 * Category enum mirrors `agents/protocols/doctor-report.schema.md`'s
 * `checks[].category` field. Kept in sync manually until the schema gains a
 * generator.
 */
export type CheckCategory = 'channel' | 'hook-wiring' | 'settings' | 'tier';

export interface Check {
  /** Stable kebab-case identifier (e.g. `channel-upgrade-available`). */
  id: string;
  /** One of the four registered categories. */
  category: CheckCategory;
  /**
   * Execute the check against the current install state and return a
   * `HealthCheck` record suitable for embedding in `DoctorReport.checks[]`.
   * Must not mutate `state` or write to disk.
   */
  run(state: InstallState): Promise<HealthCheck>;
}
