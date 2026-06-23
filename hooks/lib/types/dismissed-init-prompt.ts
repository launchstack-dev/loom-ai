/**
 * DismissedInitPrompt — per-project file at `.loom/dismissed-init-prompt`.
 *
 * Suppresses the pre-init `/loom-*` no-op prompt (F-02) for 24h after the
 * user dismisses it. After 24h the suppression expires and the prompt is
 * shown again.
 *
 * Schema reference: agents/protocols/dismissed-init-prompt.schema.md
 */

export interface DismissedInitPrompt {
  /**
   * ISO 8601 / RFC 3339 datetime the user dismissed the prompt.
   * Suppression window is `dismissedAt + 24h`.
   */
  dismissedAt: string;
}
