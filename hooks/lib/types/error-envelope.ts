/**
 * ErrorEnvelope — stderr CLI error envelope emitted by every Loom command.
 *
 * Defined by the API Specification in PLAN-plugin-distribution.md (Error
 * Handling Specification). This is the ONE type without a paired
 * `agents/protocols/*.schema.md` file — it describes a wire format, not a
 * persisted artifact.
 *
 * Format (TOON, written to stderr):
 *
 * ```toon
 * error:
 *   code: SCREAMING_SNAKE_CASE
 *   message: human-readable description
 *   fixCommand: /loom-... | null
 *   docsUrl: https://... | null
 * ```
 */

/** Inner error payload. */
export interface ErrorPayload {
  /** SCREAMING_SNAKE_CASE machine identifier — see PLAN Error Categories table. */
  code: string;
  /** Human-readable description suitable for direct stderr emission. */
  message: string;
  /** Suggested fix command (e.g. `/loom-doctor`) or null. */
  fixCommand: string | null;
  /** Docs URL for deeper context or null. */
  docsUrl: string | null;
}

/** Full stderr envelope. */
export interface ErrorEnvelope {
  error: ErrorPayload;
}
