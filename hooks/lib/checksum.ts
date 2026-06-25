/**
 * Shared SHA-256 + canonical-body utilities for contract pages.
 *
 * This module is the single source of truth for the canonical-body algorithm
 * used by:
 *   - `contract-page-writer.ts` (Phase 4) — computes and stores
 *     `contentChecksum` on every authorized write.
 *   - `hooks/lib/spec-validators/contract-page-drift.ts` (Phase 7) — recomputes
 *     and compares the checksum against the stored value to detect manual
 *     edits.
 *
 * Both consumers MUST import {@link canonicalBodyChecksum} from here. Forking
 * the algorithm would silently allow drift between the writer and the drift
 * validator, which is exactly what the checksum is meant to prevent.
 *
 * Canonical-body algorithm — per
 * `protocols/contract-page-extensions.schema.md` `## Drift Detection`:
 *   1. Extract the body (everything after the closing TOON frontmatter fence).
 *   2. Normalize line endings to `\n`.
 *   3. Strip trailing whitespace per line.
 *   4. Strip leading and trailing blank lines.
 *   5. Compute `sha256(canonicalBody)` as lowercase hex.
 *   6. Return `sha256:{hex}`.
 */

import { createHash } from "node:crypto";

/** Prefix used on the stored checksum value (`sha256:<hex>`). */
export const CHECKSUM_PREFIX = "sha256:";

/**
 * Normalize a body string to its canonical form per the algorithm in
 * `contract-page-extensions.schema.md` `## Canonical Body for Checksum`.
 *
 * The body is everything *after* the closing fence of the TOON frontmatter
 * block. Callers that have the full page on hand should use
 * {@link extractBodyFromPage} first.
 */
export function canonicalizeBody(body: string): string {
  // Step 2 — normalize line endings to `\n`.
  const normalized = body.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Step 3 — strip trailing whitespace per line.
  const trimmedLines = normalized.split("\n").map((line) => line.replace(/[ \t]+$/, ""));

  // Step 4 — strip leading and trailing blank lines.
  let start = 0;
  let end = trimmedLines.length;
  while (start < end && trimmedLines[start].length === 0) start++;
  while (end > start && trimmedLines[end - 1].length === 0) end--;

  return trimmedLines.slice(start, end).join("\n");
}

/**
 * Compute the canonical-body checksum for a contract page body string.
 *
 * Returns the value to be stored in the `contentChecksum` frontmatter field —
 * the `sha256:<hex>` prefix is included so consumers can do a single equality
 * comparison without re-prefixing.
 */
export function canonicalBodyChecksum(body: string): string {
  const canonical = canonicalizeBody(body);
  const digest = createHash("sha256").update(canonical, "utf8").digest("hex");
  return `${CHECKSUM_PREFIX}${digest}`;
}

/**
 * Extract the body portion of a contract page (everything after the closing
 * ```` ``` ```` of the TOON frontmatter block).
 *
 * If no frontmatter fence pair is found, the whole input is treated as body.
 * If the closing fence is missing, returns the empty string — better to flag
 * an empty body via downstream validators than to checksum a malformed page.
 */
export function extractBodyFromPage(pageContent: string): string {
  const normalized = pageContent.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  // Find the opening ```toon fence.
  let openIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^```\s*toon\s*$/.test(lines[i])) {
      openIdx = i;
      break;
    }
  }

  if (openIdx === -1) {
    // No frontmatter fence — treat the whole content as body.
    return normalized;
  }

  // Find the matching closing fence.
  let closeIdx = -1;
  for (let i = openIdx + 1; i < lines.length; i++) {
    if (/^```\s*$/.test(lines[i])) {
      closeIdx = i;
      break;
    }
  }

  if (closeIdx === -1) {
    // Malformed — opening fence with no close. Empty body is safer than
    // accidentally checksumming the frontmatter.
    return "";
  }

  return lines.slice(closeIdx + 1).join("\n");
}

/**
 * Convenience wrapper: extract the body from a full contract page string and
 * return its canonical-body checksum.
 */
export function canonicalBodyChecksumFromPage(pageContent: string): string {
  return canonicalBodyChecksum(extractBodyFromPage(pageContent));
}
