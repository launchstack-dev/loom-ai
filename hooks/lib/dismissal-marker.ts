/**
 * Dismissal marker for the first-invocation init-guard.
 *
 * When a user runs a `/loom-*` command in an uninitialized project (no
 * `.loom/plugin-root` pointer), the init-guard prints a one-line prompt
 * directing them to `/loom-init` and writes a dismissal marker at
 * `.loom/dismissed-init-prompt`. Repeat invocations within the TTL window
 * (default 24h) silently no-op, so the guard doesn't become noise.
 *
 * The marker file is TOON with a single `dismissedAt` ISO-8601 timestamp.
 * Writes are atomic: write to `{path}.tmp`, then `rename` to `{path}`.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { parseToon } from "./toon-reader.js";

/** Default TTL: 24 hours, in milliseconds. */
export const DEFAULT_DISMISSAL_TTL_MS = 24 * 60 * 60 * 1000;

/** Parsed dismissal marker shape. */
export interface DismissalMarker {
  dismissedAt: Date;
}

/** Optional injection seam for tests. */
export interface MarkerDeps {
  readFile?: (p: string) => string;
  writeFile?: (p: string, contents: string) => void;
  rename?: (from: string, to: string) => void;
  mkdir?: (p: string) => void;
  fileExists?: (p: string) => boolean;
}

/**
 * Read a dismissal marker from disk.
 *
 * Returns `null` when the file does not exist, cannot be read, or contains
 * no parseable `dismissedAt` field. Callers treat `null` as "not dismissed".
 */
export function readDismissalMarker(
  markerPath: string,
  deps: MarkerDeps = {}
): DismissalMarker | null {
  const readFile = deps.readFile ?? defaultReadFile;
  const fileExists = deps.fileExists ?? defaultFileExists;

  if (!fileExists(markerPath)) return null;

  let content: string;
  try {
    content = readFile(markerPath);
  } catch {
    return null;
  }

  const parsed = parseToon(content);
  const raw = parsed.dismissedAt;
  if (typeof raw !== "string" || raw.trim() === "") return null;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;

  return { dismissedAt: date };
}

/**
 * Write a dismissal marker atomically.
 *
 * Creates the parent directory if missing. Writes to `{path}.tmp` then renames
 * to `{path}`, so a partial write never leaves a corrupt marker.
 */
export function writeDismissalMarker(
  markerPath: string,
  now: Date,
  deps: MarkerDeps = {}
): void {
  const writeFile = deps.writeFile ?? defaultWriteFile;
  const rename = deps.rename ?? defaultRename;
  const mkdir = deps.mkdir ?? defaultMkdir;

  mkdir(path.dirname(markerPath));

  const body = `dismissedAt: ${now.toISOString()}\n`;
  const tmp = `${markerPath}.tmp`;
  writeFile(tmp, body);
  rename(tmp, markerPath);
}

/**
 * Is the marker still inside the TTL window relative to `now`?
 *
 * Returns `false` for a missing marker (callers should treat that as "must
 * prompt"), and `false` once `now - dismissedAt >= ttlMs`.
 */
export function isFresh(
  marker: DismissalMarker | null,
  now: Date,
  ttlMs: number = DEFAULT_DISMISSAL_TTL_MS
): boolean {
  if (marker === null) return false;
  const delta = now.getTime() - marker.dismissedAt.getTime();
  if (delta < 0) {
    // Clock skew or future-dated marker — still treat as fresh.
    return true;
  }
  return delta < ttlMs;
}

function defaultReadFile(p: string): string {
  return fs.readFileSync(p, "utf8");
}

function defaultWriteFile(p: string, contents: string): void {
  fs.writeFileSync(p, contents, "utf8");
}

function defaultRename(from: string, to: string): void {
  fs.renameSync(from, to);
}

function defaultMkdir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function defaultFileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
