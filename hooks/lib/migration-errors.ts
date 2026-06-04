/**
 * Structured error subclasses for the schema migration system.
 *
 * Tests assert on `instanceof` + properties instead of error-message regexes,
 * so refactoring the human-readable message text never silently breaks tests.
 * Production callers can pattern-match by class to drive recovery paths.
 */

/** Base class for all migration-related errors. */
export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** A migration chain step is missing from the registry. */
export class MissingMigrationStepError extends MigrationError {
  constructor(
    readonly key: string,
    readonly fromVersion: number,
    readonly toVersion: number
  ) {
    super(`Missing migration step "${key}" (chain ${fromVersion}→${toVersion})`);
  }
}

/** Caller asked to downgrade — never supported; use rollback instead. */
export class MigrationDowngradeError extends MigrationError {
  constructor(readonly fromVersion: number, readonly toVersion: number) {
    super(`Cannot downgrade from v${fromVersion} to v${toVersion} — use snapshot rollback`);
  }
}

/** Input handed to a migrator function didn't match its expected source version. */
export class MigrationSchemaVersionMismatchError extends MigrationError {
  constructor(readonly expected: number, readonly actual: unknown) {
    super(`Expected schemaVersion === ${expected}, got ${String(actual)}`);
  }
}

/** Input failed validation (URL, semver, etc.) before migration could proceed. */
export class MigrationValidationError extends MigrationError {
  constructor(
    readonly field: string,
    readonly value: unknown,
    readonly reason: string
  ) {
    super(`Invalid ${field} ${JSON.stringify(value)}: ${reason}`);
  }
}
