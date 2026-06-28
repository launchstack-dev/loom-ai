/**
 * test/install-command-coverage.test.ts
 *
 * Regression for the F-18 distribution-gap bug: commands/loom-which.md,
 * commands/loom-deepen.md, and commands/loom-prototype.md shipped to the
 * repo but were never added to install.sh's COMMAND_FILES array — so the
 * curl install and /loom-update silently never copied them to
 * ~/.claude/commands/. End-user symptom: typing /loom-which in Claude Code
 * returned "Unknown command" even though the source file was in the repo.
 *
 * This test enforces that every commands/*.md (and commands/<sub>/*.md)
 * file on disk appears as a source path in install.sh's COMMAND_FILES
 * array. If it doesn't, the test fails and tells the author the exact
 * lines to add.
 *
 * Allow-list: files that intentionally live under commands/ but are NOT
 * meant to be installed (e.g. experimental scratch files) can be added to
 * INSTALL_EXEMPT below. Currently empty — every commands/*.md should ship.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const REPO_ROOT = resolve(__dirname, "..");
const INSTALL_SH = resolve(REPO_ROOT, "install.sh");

/**
 * Files under commands/ that are intentionally excluded from install.sh.
 * Keep this list short and document the reason inline. Currently empty —
 * every commands/*.md ships.
 */
const INSTALL_EXEMPT: ReadonlySet<string> = new Set<string>([
  // example: "commands/_scratch.md", // exploratory, not meant for distribution
]);

/**
 * Walk commands/ via `git ls-files` so the test mirrors what would actually
 * ship in a release tarball. Returns repo-relative paths sorted ASCII.
 */
function listTrackedCommandFiles(): string[] {
  const out = execFileSync(
    "git",
    ["-C", REPO_ROOT, "ls-files", "commands/"],
    { encoding: "utf8", timeout: 10_000, maxBuffer: 10 * 1024 * 1024 },
  );
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.endsWith(".md"))
    .filter((l) => !INSTALL_EXEMPT.has(l))
    .sort();
}

/**
 * Parse install.sh and return the set of source paths that appear inside
 * the COMMAND_FILES array. Each entry has the shape
 *   "commands/<name>.md:${CLAUDE_DIR}/commands/<name>.md"
 * so we extract the literal before the colon.
 *
 * Matches lines like:
 *   "commands/loom-init.md:${CLAUDE_DIR}/commands/loom-init.md"
 *   "commands/loom-plan/create.md:${CLAUDE_DIR}/commands/loom-plan/create.md"
 */
function extractInstallSources(installShContent: string): Set<string> {
  const sources = new Set<string>();
  const declStart = installShContent.indexOf("declare -a COMMAND_FILES=(");
  if (declStart === -1) {
    throw new Error("install.sh: COMMAND_FILES array declaration not found");
  }
  // Find the closing `)` of the array.
  const declEnd = installShContent.indexOf("\n)", declStart);
  if (declEnd === -1) {
    throw new Error("install.sh: COMMAND_FILES array close `)` not found");
  }
  const arrayBody = installShContent.slice(declStart, declEnd);

  const entryRe = /"(commands\/[A-Za-z0-9._/-]+\.md):/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(arrayBody)) !== null) {
    sources.add(m[1]);
  }
  return sources;
}

// Hoist git ls-files call to module scope so both describe blocks share the
// single spawn. Both previously called listTrackedCommandFiles() independently.
const TRACKED_COMMAND_FILES = listTrackedCommandFiles();

describe("install.sh — commands/ distribution coverage", () => {
  it("every commands/*.md tracked in git appears in install.sh COMMAND_FILES", () => {
    const installSh = readFileSync(INSTALL_SH, "utf8");
    const installSources = extractInstallSources(installSh);
    const missing = TRACKED_COMMAND_FILES.filter((p) => !installSources.has(p));
    if (missing.length > 0) {
      const suggestions = missing
        .map((p) => `  "${p}:\${CLAUDE_DIR}/${p}"`)
        .join("\n");
      throw new Error(
        `install.sh is missing ${missing.length} command file(s) ` +
          `that exist under commands/:\n\n` +
          missing.map((p) => `  - ${p}`).join("\n") +
          `\n\nAdd these lines to the COMMAND_FILES array in install.sh:\n` +
          suggestions +
          `\n\nAlso run \`bash scripts/generate-checksums.sh\` (or update ` +
          `checksums.sha256 by hand) so /loom-update's verify_checksum step ` +
          `accepts the manifest.`,
      );
    }
    expect(missing).toEqual([]);
  });

  it("install.sh does not reference command files that do not exist on disk", () => {
    const installSh = readFileSync(INSTALL_SH, "utf8");
    const installSources = extractInstallSources(installSh);
    const trackedSet = new Set(TRACKED_COMMAND_FILES);
    const orphans = [...installSources].filter((p) => !trackedSet.has(p));
    expect(orphans).toEqual([]);
  });

  it("install.sh sources match the commands/ directory exactly (no drift)", () => {
    const installSh = readFileSync(INSTALL_SH, "utf8");
    const installSources = extractInstallSources(installSh);
    const expected = [...TRACKED_COMMAND_FILES].sort();
    const actual = [...installSources].sort();
    expect(actual).toEqual(expected);
  });
});

describe("checksums.sha256 — coverage for installable commands", () => {
  const checksumsPath = resolve(REPO_ROOT, "checksums.sha256");
  let checksummed: Set<string>;

  beforeAll(() => {
    let checksums: string;
    try {
      checksums = readFileSync(checksumsPath, "utf8");
    } catch (err) {
      throw new Error(
        `checksums.sha256 not found at ${checksumsPath} — is this running from the repo root? (${err})`,
      );
    }
    checksummed = new Set<string>();
    for (const line of checksums.split("\n")) {
      // Format: "<64-hex>  <path>"
      const m = /^[0-9a-f]{64}\s+(.+)$/.exec(line.trim());
      if (m) checksummed.add(m[1]);
    }
  });

  it("every installable command file appears in checksums.sha256", () => {
    const missing = TRACKED_COMMAND_FILES.filter((p) => !checksummed.has(p));
    if (missing.length > 0) {
      throw new Error(
        `checksums.sha256 is missing ${missing.length} command file(s):\n` +
          missing.map((p) => `  - ${p}`).join("\n") +
          `\n\nRegenerate: bash scripts/generate-checksums.sh`,
      );
    }
    expect(missing).toEqual([]);
  });

  it("checksums.sha256 has no orphan entries for command files that no longer exist", () => {
    const checksummedCommands = [...checksummed].filter((p) =>
      p.startsWith("commands/"),
    );
    const trackedSet = new Set(TRACKED_COMMAND_FILES);
    const orphans = checksummedCommands.filter((p) => !trackedSet.has(p));
    expect(orphans).toEqual([]);
  });
});
