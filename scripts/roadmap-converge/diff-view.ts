/**
 * 30-second diff view for /loom-roadmap sign-off.
 *
 * Renders a unified diff between the roadmap *as it was at the last sign-off*
 * (identified by its sha256 in state.sign_off_diff_hash) and the roadmap on
 * disk right now. The user sees this immediately before being asked to
 * confirm sign-off, so they can audit what changed since the prior approval.
 *
 * The phrase "30-second" in PLAN-roadmap-converge-harness.md is informal
 * framing — there is no literal timer here, the contract is just "show the
 * user the diff before confirmation". Pagination is the caller's concern
 * (sign-off.ts pipes through $PAGER on a TTY).
 *
 * Strategy:
 *   1. First-ever sign-off (oldHash == null) → render the full current file
 *      as an "added" block. No git involvement; that file has never been
 *      signed off, so there is no prior to diff against.
 *   2. Subsequent sign-off → try `git diff --no-index <tmp-old> <current>`.
 *      We do not have the old bytes on hand (we only stored the hash), so
 *      we look up the prior content from git history: walk `git log -p` for
 *      the file and find the commit whose blob matches sign_off_diff_hash.
 *      If the blob is found, write it to a tmp file and produce a unified
 *      diff. If git is unavailable, the blob is not found, or anything else
 *      goes sideways, fall back to a synthetic line-by-line diff between
 *      the empty string and the current file (i.e. show the current content
 *      as all-additions with a warning header).
 *
 * Module is pure — exports a single function. No side effects beyond
 * spawning git in a child process and creating short-lived tmp files which
 * are removed before return.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Render a textual diff of `currentPath` versus the roadmap that hashed to
 * `oldHash` at the last sign-off.
 *
 * `oldHash` is sha256 of the prior content (or null when no prior sign-off).
 * The return value is a printable string suitable for stdout or `less`. It
 * always ends with a trailing newline so paging tools display cleanly.
 */
export function renderDiff(
  oldHash: string | null,
  currentPath: string
): string {
  const currentBytes = readFileSync(currentPath);
  const currentText = currentBytes.toString("utf-8");

  if (oldHash === null || oldHash === "") {
    return renderFirstEverDiff(currentPath, currentText);
  }

  // Quick win: if the current file already matches oldHash, there is no
  // diff to show. Sign-off is presumably re-confirming an unchanged file.
  const currentHash = createHash("sha256").update(currentBytes).digest("hex");
  if (currentHash === oldHash) {
    return `# No changes since last sign-off (sha256 ${shortHash(oldHash)}).\n`;
  }

  // Try to recover prior bytes from git history.
  const priorBytes = findBlobByHash(currentPath, oldHash);
  if (priorBytes === null) {
    return renderFallbackDiff(currentPath, currentText, oldHash);
  }

  return renderGitDiff(priorBytes, currentBytes, currentPath, oldHash);
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function renderFirstEverDiff(currentPath: string, currentText: string): string {
  const header =
    `# Sign-off diff view — first-ever sign-off for ${currentPath}.\n` +
    `# No prior diff hash recorded; showing the full current file as new content.\n`;
  const lines = currentText.split("\n");
  // Drop the trailing empty cell that split() produces for files ending in \n.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const body = lines.map((l) => `+${l}`).join("\n");
  return `${header}\n${body}\n`;
}

function renderFallbackDiff(
  currentPath: string,
  currentText: string,
  oldHash: string
): string {
  const header =
    `# Sign-off diff view — could not recover prior content (sha256 ${shortHash(oldHash)}).\n` +
    `# Showing the current file as all-additions. Audit carefully before confirming.\n`;
  const lines = currentText.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const body = lines.map((l) => `+${l}`).join("\n");
  return `${header}\n${body}\n`;
}

function renderGitDiff(
  priorBytes: Buffer,
  currentBytes: Buffer,
  currentPath: string,
  oldHash: string
): string {
  const tmpDir = mkdtempSync(join(tmpdir(), "roadmap-signoff-diff-"));
  const tmpOld = join(tmpDir, "prior");
  const tmpNew = join(tmpDir, "current");
  try {
    writeFileSync(tmpOld, priorBytes);
    writeFileSync(tmpNew, currentBytes);
    const result = spawnSync(
      "git",
      [
        "diff",
        "--no-index",
        "--no-color",
        `--src-prefix=prior/`,
        `--dst-prefix=current/`,
        tmpOld,
        tmpNew,
      ],
      { encoding: "utf-8" }
    );
    // git diff --no-index returns 1 when files differ; that is not an error.
    if (result.error || (result.status !== 0 && result.status !== 1)) {
      return synthesizeUnifiedDiff(
        priorBytes.toString("utf-8"),
        currentBytes.toString("utf-8"),
        currentPath,
        oldHash
      );
    }
    const header =
      `# Sign-off diff view — prior sha256 ${shortHash(oldHash)} vs ${currentPath}.\n`;
    return header + (result.stdout || "") + "\n";
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; ignore.
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Walk `git log` for `currentPath` and find the commit whose tracked blob
 * hashes to `wantedHash` (sha256 of file bytes). Returns the blob bytes on
 * a hit, or null when git is unavailable or no commit matches.
 *
 * We do this in two steps: list commit SHAs that touched the file, then
 * `git show <sha>:<path>` for each until the sha256 matches. Bounded to
 * the most recent 50 commits — sign-off diffs walk back at most a few
 * rounds of converge before another sign-off resets the hash.
 */
function findBlobByHash(currentPath: string, wantedHash: string): Buffer | null {
  const log = spawnSync(
    "git",
    ["log", "--format=%H", "-n", "50", "--", currentPath],
    { encoding: "utf-8" }
  );
  if (log.error || log.status !== 0) return null;
  const shas = (log.stdout || "")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  // Validate currentPath: colon or newline characters would corrupt the refspec.
  const pathIsSafe = !currentPath.includes(":") && !currentPath.includes("\n");
  for (const sha of shas) {
    const args: string[] = pathIsSafe
      ? ["show", `${sha}:${currentPath}`]
      : ["show", sha, "--", currentPath];
    const show = spawnSync("git", args, {
      encoding: "buffer",
    });
    if (show.error || show.status !== 0) continue;
    const blob = show.stdout as Buffer;
    const hash = createHash("sha256").update(blob).digest("hex");
    if (hash === wantedHash) return blob;
  }
  return null;
}

/**
 * Last-resort unified-diff synthesis when git is unavailable. Produces a
 * line-by-line diff that prefixes removed lines with `-` and added lines
 * with `+`. Not a true Myers diff — just a marker that something changed.
 * Good enough for the sign-off audit because the user is reading text, not
 * applying a patch.
 */
function synthesizeUnifiedDiff(
  oldText: string,
  newText: string,
  currentPath: string,
  oldHash: string
): string {
  const header =
    `# Sign-off diff view — git unavailable, synthesised line diff.\n` +
    `# Prior sha256 ${shortHash(oldHash)} vs ${currentPath}.\n`;
  const oldLines = stripTrailingEmpty(oldText.split("\n"));
  const newLines = stripTrailingEmpty(newText.split("\n"));
  const out: string[] = [];
  for (const l of oldLines) out.push(`-${l}`);
  for (const l of newLines) out.push(`+${l}`);
  return `${header}\n${out.join("\n")}\n`;
}

function stripTrailingEmpty(lines: string[]): string[] {
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    return lines.slice(0, -1);
  }
  return lines;
}

function shortHash(hash: string): string {
  return hash.length > 12 ? hash.slice(0, 12) : hash;
}
