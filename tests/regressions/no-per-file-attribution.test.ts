/**
 * tests/regressions/no-per-file-attribution.test.ts
 *
 * S-03: No per-file mattpocock attribution exists anywhere in the repo.
 *
 * Scans every file under protocols/, skills/, agents/, and commands/ for
 * banned inline attribution phrases. NOTICE is the sole attribution surface.
 *
 * Banned phrases (case-sensitive):
 *   - "Originally from mattpocock"
 *   - "Adapted from mattpocock"
 *   - "From Matt Pocock"
 *   - "(mattpocock/skills)"
 *
 * Run: bunx vitest run tests/regressions/no-per-file-attribution.test.ts
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

/** Directories to scan (relative to repo root). */
const SCAN_DIRS = ["protocols", "skills", "agents", "commands"] as const;

/** Banned inline attribution phrases. */
const BANNED_PHRASES = [
  "Originally from mattpocock",
  "Adapted from mattpocock",
  "From Matt Pocock",
  "(mattpocock/skills)",
] as const;

interface Match {
  file: string;
  line: number;
  phrase: string;
  text: string;
}

/**
 * Recursively collect all files under a directory.
 */
function collectFiles(dir: string): string[] {
  const files: string[] = [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    // Directory may not exist in all environments — skip gracefully
    return files;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else if (stat.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Scan a file for banned phrases. Returns all matches found.
 */
function scanFile(filePath: string): Match[] {
  const matches: Match[] = [];

  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    // Skip unreadable files (e.g. binary files)
    return matches;
  }

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const phrase of BANNED_PHRASES) {
      if (lines[i].includes(phrase)) {
        matches.push({
          file: filePath,
          line: i + 1,
          phrase,
          text: lines[i].trim(),
        });
      }
    }
  }

  return matches;
}

describe("S-03: no per-file mattpocock attribution", () => {
  it("collects all files in scan directories without throwing", () => {
    for (const dir of SCAN_DIRS) {
      const absDir = join(REPO_ROOT, dir);
      // collectFiles handles missing dirs gracefully
      const files = collectFiles(absDir);
      // At minimum, zero files is acceptable (dir may not exist yet)
      expect(Array.isArray(files)).toBe(true);
    }
  });

  it("zero banned phrases found across protocols/, skills/, agents/, commands/", () => {
    const allMatches: Match[] = [];

    for (const dir of SCAN_DIRS) {
      const absDir = join(REPO_ROOT, dir);
      const files = collectFiles(absDir);
      for (const file of files) {
        const matches = scanFile(file);
        allMatches.push(...matches);
      }
    }

    if (allMatches.length > 0) {
      const report = allMatches
        .map((m) => `  ${m.file}:${m.line} — phrase "${m.phrase}"\n    ${m.text}`)
        .join("\n");
      expect.fail(
        `Found ${allMatches.length} banned per-file attribution phrase(s).\n` +
          `NOTICE is the sole attribution surface — remove these inline attributions:\n${report}`
      );
    }

    expect(allMatches.length).toBe(0);
  });

  it("NOTICE file exists and is the sole attribution surface", () => {
    const noticePath = join(REPO_ROOT, "NOTICE");
    let noticeContent: string;
    try {
      noticeContent = readFileSync(noticePath, "utf-8");
    } catch {
      expect.fail("NOTICE file must exist at the repo root");
      return;
    }
    expect(noticeContent.length).toBeGreaterThan(0);
    expect(noticeContent).toMatch(/mattpocock/i);
  });
});
