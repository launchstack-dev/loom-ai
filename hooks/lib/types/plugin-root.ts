/**
 * PluginRootPointer — per-project file at `.loom/plugin-root`.
 *
 * Written by `/loom-init`. Consumed by the F-07a plugin-root resolver
 * (Wave 1) to translate plugin-relative paths into absolute paths.
 *
 * Schema reference: protocols/plugin-root.schema.md
 */

export interface PluginRootPointer {
  /** Absolute path to the installed plugin root; MUST exist and be readable. */
  pluginRoot: string;
  /** Semver `vX.Y.Z` — matches the currently installed version. */
  pluginVersion: string;
  /** ISO 8601 / RFC 3339 datetime `/loom-init` ran. */
  initTimestamp: string;
}
