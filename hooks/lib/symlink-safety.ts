/**
 * Symlink safety — defensive lstat-based detection.
 *
 * Rules 12, 13, and 14 of the schema upgrade protocol all write through
 * filesystem paths the user may have symlinked elsewhere — dev installs
 * (`~/.claude/agents/* → repo checkout`), dotfile setups
 * (`~/.dotfiles/loom/*`), cross-machine portability shims, etc.
 * Writing through a symlinked target silently corrupts the link's
 * destination. The defensive pattern is: lstat the target, and if it's
 * a symlink (any symlink, regardless of where it points), skip the
 * write with a `[link]` classification.
 *
 * Same logic already applies in `/loom-library sync` (after the
 * post-merge-fixes PR). This module factors it out so Rules 12/13/14
 * can use the same primitive.
 *
 * Pure with an injectable `LstatResolver` so tests don't need a real
 * filesystem.
 */

import * as fs from "node:fs";

export interface LstatResolver {
  /**
   * Returns whether the path exists at all (without following symlinks).
   * Returns `false` for paths that don't exist.
   */
  existsSync(p: string): boolean;
  /**
   * Returns whether the path is a symbolic link (without following).
   * Returns `false` for paths that don't exist or aren't symlinks.
   * MUST use lstat semantics, not stat — stat follows the link.
   */
  isSymlink(p: string): boolean;
}

const defaultLstat: LstatResolver = {
  existsSync: (p) => {
    try {
      fs.lstatSync(p);
      return true;
    } catch {
      return false;
    }
  },
  isSymlink: (p) => {
    try {
      return fs.lstatSync(p).isSymbolicLink();
    } catch {
      return false;
    }
  },
};

/**
 * True iff the path exists AND is a symbolic link.
 *
 * Use this BEFORE writing to a path that the user might have set up as
 * a dev-install symlink, dotfile target, or other intentional symlink.
 * If it returns true, classify the write as `[link]` and skip — the
 * symlink's existence is the signal that the user is managing the path
 * themselves; defer to them.
 */
export function isSymlink(p: string, resolver: LstatResolver = defaultLstat): boolean {
  if (!resolver.existsSync(p)) return false;
  return resolver.isSymlink(p);
}

/**
 * Classification of a candidate write target.
 *
 *   - "write"   → safe to proceed, target is a normal file or absent
 *   - "skip-link" → target is a symlink, defer to the user
 *   - "skip-missing" → target absent AND caller wanted to update in place
 */
export type WriteClassification = "write" | "skip-link" | "skip-missing";

/**
 * Classify a target path for a write/migration step.
 *
 * @param target the path the migration would write to
 * @param requireExisting if true, missing files are classified as "skip-missing"
 *                        (use for update-in-place rules like 12/13);
 *                        if false, missing files classify as "write"
 *                        (use for create-or-update rules like Rule 14's relocations)
 */
export function classifyWriteTarget(
  target: string,
  requireExisting: boolean,
  resolver: LstatResolver = defaultLstat,
): WriteClassification {
  if (isSymlink(target, resolver)) return "skip-link";
  if (requireExisting && !resolver.existsSync(target)) return "skip-missing";
  return "write";
}

/**
 * Human-readable advisory for a `skip-link` classification.
 *
 * Used by `/loom-upgrade` to report each skipped target to the user.
 * The advisory explains why the link was skipped and how to opt in
 * to having sync/upgrade update it.
 */
export function symlinkSkipAdvisory(target: string): string {
  return (
    `[link] ${target} — symlinked, skipped. ` +
    `If you want /loom-upgrade to update this path, convert it to a real file first: ` +
    `\`cp --remove-destination "$(readlink "${target}")" "${target}"\` ` +
    `and re-run /loom-upgrade.`
  );
}
