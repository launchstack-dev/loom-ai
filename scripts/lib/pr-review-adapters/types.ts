/**
 * Shared PR-review adapter contract for F-04 (PR-review convergence).
 *
 * Each adapter (Gemini, CodeRabbit, Copilot) implements the {@link PrReviewAdapter}
 * interface so the dispatcher harness (`scripts/pr-review-harness.ts`) can fan
 * out to the per-bot fetcher without per-adapter branching.
 *
 * The output shape mirrors the canonical `ConvergenceFindings` artifact defined
 * in `protocols/findings.schema.md`. Adapters do NOT modify the schema;
 * they populate the F-04 row variant documented in
 * `protocols/findings.applications-rows.md`.
 *
 * Schema version: 1 (registered as `convergence-findings`).
 */

// ---------------------------------------------------------------------------
// Convergence-side severity enum (mirrors findings.schema.md)
// ---------------------------------------------------------------------------

/** Convergence-side severity per `findings.schema.md` § severity enum. */
export type ConvergenceSeverity = "blocking" | "warning" | "info" | "advisory";

// ---------------------------------------------------------------------------
// ConvergenceFindings row + envelope (F-04 row variant)
// ---------------------------------------------------------------------------

/**
 * A single F-04 finding row. Column set is verbatim from
 * `findings.schema.md` § findings[] Row Schema.
 */
export interface ConvergenceFinding {
  /** Sequential id: `F-01`, `F-02`, ... post-dedup. */
  id: string;
  /** Stable per-application token: `pr-review`. */
  dimension: string;
  severity: ConvergenceSeverity;
  /** Repo-relative file path from the bot comment. */
  locationPath: string;
  /** `:{line}` anchor or empty string when whole-file. */
  locationAnchor: string;
  /** First line of the bot comment body (severity tag stripped); <= 200 chars. */
  summary: string;
  /** Optional remainder of the bot comment body; <= 500 chars. */
  suggestion?: string;
  /** Bot adapter name: `gemini` | `coderabbit` | `copilot`. */
  reviewerAgent: string;
}

/**
 * Top-level ConvergenceFindings envelope produced per iteration.
 * Atomically written to `findings.toon` by the dispatcher harness; adapters
 * return the in-memory shape and let the harness encode + write.
 */
export interface ConvergenceFindings {
  /** Mirrors `converge.config.subject` (the `pr-state.toon` projection path for F-04). */
  subject: string;
  /** F-04 harness identifier. */
  harnessName: "pr-review";
  /** 1-indexed iteration number per the driver. */
  iteration: number;
  /** count(findings where severity == blocking). Drives convergence check. */
  blockingCount: number;
  /** count(findings where severity in {warning, info, advisory}). */
  advisoryCount: number;
  /** ISO 8601 with millisecond precision (locked W-01). */
  producedAt: string;
  /** F-04 row variant rows (post-dedup). */
  findings: ConvergenceFinding[];
}

// ---------------------------------------------------------------------------
// Raw bot comment shape (input to every adapter)
// ---------------------------------------------------------------------------

/**
 * The narrow subset of a `gh pr view --json comments` row (or per-bot REST
 * API equivalent) that the adapters consume. Optional fields are tolerated for
 * forward-compatibility with bot API changes.
 */
export interface BotComment {
  /** Repo-relative file path the bot is commenting on. */
  path: string;
  /** Line number in the head commit. */
  line: number;
  /** Comment body — adapters parse severity tag + summary from this. */
  body: string;
  /** Optional comment id (used by harnesses for de-duplication outside the row triple). */
  id?: string;
  /** Optional author handle (e.g., `gemini-bot`). */
  author?: string;
  /** Optional ISO 8601 createdAt timestamp. */
  createdAt?: string;
}

/**
 * Fetcher injection point. Production: shell out to `gh pr view --json comments`
 * or hit the bot's REST API. Tests: read a canned JSON fixture.
 */
export type BotCommentFetcher = (prNumber: number) => Promise<BotComment[]>;

// ---------------------------------------------------------------------------
// Adapter contract
// ---------------------------------------------------------------------------

/** Options accepted by every adapter's `fetchFindings` entry point. */
export interface FetchFindingsOptions {
  /** PR number resolved by the wrapper via `gh pr view`. */
  prNumber: number;
  /** 1-indexed iteration number from the driver. */
  iteration: number;
  /**
   * Path to the prior iteration's `findings.toon` (e.g.,
   * `.plan-execution/convergence/iterations/iter-{N-1}.toon`). When supplied,
   * adapters that implement cross-iteration dedup (Gemini per OQ-04) read this
   * file and suppress matching `(locationPath, locationAnchor, summary)` rows.
   * Omitted on iteration 1 (no prior).
   */
  priorFindingsPath?: string;
  /**
   * Subject path mirrored into the returned envelope's `subject` field. Defaults
   * to `.plan-execution/pr-review/pr-state.toon` (the F-04 synthetic projection
   * per OQ-02) when omitted.
   */
  subject?: string;
  /**
   * Injected bot-comment fetcher. Production callers pass a fetcher that shells
   * out to `gh`; tests pass a fetcher that reads a canned fixture.
   */
  fetcher: BotCommentFetcher;
  /** Optional injected clock for deterministic `producedAt` in tests. */
  now?: () => Date;
}

/**
 * The contract every per-bot adapter implements. The dispatcher harness
 * resolves the right adapter from `converge.config.botAdapter` and invokes
 * `fetchFindings`.
 */
export interface PrReviewAdapter {
  /** Bot adapter name: `gemini` | `coderabbit` | `copilot`. */
  readonly name: string;
  /**
   * Fetch bot comments, parse them into the F-04 row variant, apply dedup if
   * the bot is observed to re-flag stale anchors (Gemini per OQ-04), and return
   * a fully-populated `ConvergenceFindings` envelope.
   */
  fetchFindings(opts: FetchFindingsOptions): Promise<ConvergenceFindings>;
}
