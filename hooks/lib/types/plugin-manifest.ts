/**
 * PluginManifest — the real Claude Code plugin manifest at
 * `.claude-plugin/plugin.json`. Consumed by the Claude Code plugin loader.
 *
 * Schema reference: protocols/plugin-manifest.schema.md
 * Canonical spec:   https://code.claude.com/docs/en/plugins-reference
 *
 * Format note: per CLAUDE.md, this artifact is exempt from the
 * TOON-everywhere rule because it's consumed by Claude Code's plugin
 * protocol. It ships as JSON.
 */

export interface PluginManifestAuthor {
  /** Author or org display name. */
  name: string;
  /** Optional contact email. */
  email?: string;
  /** Optional author URL. */
  url?: string;
}

export interface PluginManifest {
  /** Plugin id. kebab-case (`^[a-z0-9][a-z0-9-]*$`). The only required field. */
  name: string;
  /** Human-readable label. Requires Claude Code 2.1.143+. */
  displayName?: string;
  /** Semver. Drives `claude plugin tag` and the community pinner. */
  version?: string;
  /** Short paragraph shown in the marketplace browse UI. */
  description?: string;
  /** Author block. Optional, but `name` is required when present. */
  author?: PluginManifestAuthor;
  /** Homepage URL. */
  homepage?: string;
  /** Repository URL. Used by the marketplace to fetch updates. */
  repository?: string;
  /** SPDX license identifier (e.g., `MIT`, `Apache-2.0`). */
  license?: string;
  /** Search/discovery tags. */
  keywords?: string[];
  /** If true, the plugin enables itself on install. Requires Claude Code 2.1.154+. */
  defaultEnabled?: boolean;
}
