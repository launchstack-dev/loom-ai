---
schemaVersion: 1
name: migration-runner
description: Type-level contract for `runMigration()` exported by `scripts/lib/migration-runner.ts` (Wave 2). Wave 2 vitest type-check asserts the implementation conforms.
---

# Migration Runner Schema

Type-level contract for the shared migration entry point imported by **both** `hooks/loom-migration.ts` (SessionStart hook) and `scripts/loom-doctor.ts --fix` (manual remediation). This dual-consumer split eliminates the "doctor imports stdin-reading hook" coupling called out as HF-07.

## TOON Exemplar

```toon
runMigrationInput:
  settingsPath: /Users/alice/proj/.claude/settings.local.json
  dryRun: false
  # `force` is INTENTIONALLY OMITTED — no --force override exists per MF-03

runMigrationResult:
  outcome: applied
  rewriteCount: 2
  evidence:
    schemaVersion: 1
    recordedAt: 2026-06-17T12:34:56Z
    # ... full MigrationEvidence (see migration-evidence.schema.md)
  diagnostics[1]: "rewrote 2 bare-anchor entries to ${CLAUDE_PLUGIN_ROOT}"
```

## TypeScript Interface

This contract is consumed by TypeScript code. The Wave 2 implementation MUST export interfaces structurally equivalent to:

```ts
import type { MigrationEvidence } from "./migration-evidence";

export interface RunMigrationInput {
  /** Absolute path to the settings file to inspect/rewrite. */
  settingsPath: string;
  /** When true, compute the diff but do not write. */
  dryRun: boolean;
  /**
   * INTENTIONALLY ABSENT: there is no `force` flag.
   * Ownership-guard divergence MUST surface MIGRATION_OWNERSHIP_DIVERGED
   * and require manual remediation (MF-03).
   */
}

export type MigrationOutcome =
  | "applied"
  | "not-needed"
  | "refused-ownership-guard"
  | "failed";

export interface RunMigrationResult {
  outcome: MigrationOutcome;
  /** Number of settings entries actually rewritten. 0 when outcome != "applied". */
  rewriteCount: number;
  /** Evidence record appended to .claude/loom-migration.log.toon. */
  evidence: MigrationEvidence;
  /** Human-readable progress lines (rendered to stderr by callers). */
  diagnostics: string[];
}

export function runMigration(input: RunMigrationInput): Promise<RunMigrationResult>;
```

## Invariants

1. **No `force` parameter.** The ownership guard is absolute. Callers handling divergence must surface `MIGRATION_OWNERSHIP_DIVERGED` to the user.
2. **Pure function w/ IO.** `runMigration` MAY read/write the filesystem but MUST NOT read stdin or process arguments. SessionStart-hook stdin reading happens in `hooks/loom-migration.ts`, which wraps `runMigration`.
3. **Idempotent.** Calling `runMigration` twice with the same `settingsPath` against an unchanged file MUST yield `outcome: not-needed` on the second call.
4. **Atomic writes.** When `outcome === "applied"`, the settings file write and the evidence-log append MUST both succeed; on partial failure, `outcome` becomes `failed` and neither side-effect is observable.

## Wave 2 Type-Check Assertion

`test/migration-runner.test.ts` MUST include a type-only assertion:

```ts
import type { RunMigrationInput, RunMigrationResult } from "../scripts/lib/migration-runner";
// Force structural conformance with this schema via tsc --noEmit.
const _input: RunMigrationInput = { settingsPath: "", dryRun: false };
const _resultShape: RunMigrationResult = {
  outcome: "applied",
  rewriteCount: 0,
  evidence: {} as any,
  diagnostics: [],
};
```

## Consumer Cross-Reference

```toon
consumers[1]{wave,agent,role}:
  wave-2,wave-2-doctor-agent,implements-runMigration-in-scripts/lib/migration-runner.ts-and-imports-from-hooks/loom-migration.ts-plus-scripts/loom-doctor.ts
```

## Cross-References

- `migration-evidence.schema.md` — `evidence` field structure.
- `doctor-report.schema.md` — `--fix` workflow returns through `runMigration`, then re-emits a DoctorReport.
- `hook-manifest.schema.md` — canonical anchors are the only valid rewrite targets.
