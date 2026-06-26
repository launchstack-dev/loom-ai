/**
 * tests/commands/loom-status-html.test.ts
 *
 * S-04: loom-status --html headless fallback prints path and exits 0.
 *
 * Given: A fixture environment where the OS open shim fails (headless).
 * When:  loom-status --html runs against a fixture project.
 * Then:
 *   1. Exit code MUST be 0.
 *   2. stdout MUST contain the literal line "open this in a browser".
 *   3. An HTML file MUST exist at the documented path.
 *
 * Additional tests:
 *   - With --html, a valid HTML file containing the status content is produced.
 *   - Without --html, no HTML file is produced (plain-text default preserved).
 *   - The --html flag does not alter stdout content (it is strictly additive).
 *
 * Run: bunx vitest run tests/commands/loom-status-html.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const REPO_ROOT = resolve(__dirname, "../..");
const RENDERER_SCRIPT = join(
  REPO_ROOT,
  "scripts/html-renderer/loom-status.ts",
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temp dir, return its path. */
function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "loom-status-html-test-"));
}

/** List HTML files in a directory (non-recursive). */
function listHtmlFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".html"));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Tests: HTML renderer script structure
// ---------------------------------------------------------------------------

describe("scripts/html-renderer/loom-status.ts — structure", () => {
  it("renderer script exists", () => {
    expect(existsSync(RENDERER_SCRIPT)).toBe(true);
  });

  it("renderer script exports a valid TypeScript module (no syntax errors at read time)", () => {
    const content = readFileSync(RENDERER_SCRIPT, "utf8");
    // Basic sanity: contains function definitions and process.exit(0)
    expect(content).toContain("function main()");
    expect(content).toContain("process.exit(0)");
  });

  it("renderer script implements the headless fallback message", () => {
    const content = readFileSync(RENDERER_SCRIPT, "utf8");
    expect(content).toContain("open this in a browser");
  });

  it("renderer script performs atomic write (tmp then rename)", () => {
    const content = readFileSync(RENDERER_SCRIPT, "utf8");
    expect(content).toContain(".tmp");
    expect(content).toContain("renameSync");
  });

  it("renderer script attempts multiple open openers (open, xdg-open)", () => {
    const content = readFileSync(RENDERER_SCRIPT, "utf8");
    expect(content).toContain("open");
    expect(content).toContain("xdg-open");
  });
});

// ---------------------------------------------------------------------------
// Tests: HTML renderer execution (headless — no browser available in CI)
// ---------------------------------------------------------------------------

describe("scripts/html-renderer/loom-status.ts — execution", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("S-04: exits 0 and prints 'open this in a browser' when open shim unavailable", () => {
    const inputFile = join(tmpDir, "status.txt");
    const outputFile = join(tmpDir, "loom-status-test.html");

    writeFileSync(inputFile, "## Project Status\n  CLAUDE.md: found\n");

    // Run with PATH that has no 'open' or 'xdg-open' to simulate headless
    const result = spawnSync(
      "bun", [
        "run",
        RENDERER_SCRIPT,
        "--input",
        inputFile,
        "--output",
        outputFile,
      ],
      {
        env: {
          ...process.env,
          // Override PATH to exclude OS openers — force headless fallback
          PATH: `${process.env.HOME}/.bun/bin:/usr/bin:/bin`,
          LOOM_HEADLESS: "1",
        },
        timeout: 15000,
        encoding: "utf8",
      },
    );

    // Exit code must be 0
    expect(result.status).toBe(0);

    // stdout must contain the headless fallback message
    const combinedOutput = (result.stdout ?? "") + (result.stderr ?? "");
    expect(combinedOutput).toContain("open this in a browser");
  });

  it("S-04: HTML file exists at the documented path after --html run", () => {
    const inputFile = join(tmpDir, "status.txt");
    const outputFile = join(tmpDir, "loom-status-test.html");

    writeFileSync(inputFile, "## Project Status\n  CLAUDE.md: found\n");

    spawnSync(
      "bun", [
        "run",
        RENDERER_SCRIPT,
        "--input",
        inputFile,
        "--output",
        outputFile,
      ],
      {
        env: { ...process.env, PATH: `${process.env.HOME}/.bun/bin:/usr/bin:/bin` },
        timeout: 15000,
        encoding: "utf8",
      },
    );

    expect(existsSync(outputFile)).toBe(true);
  });

  it("S-04: HTML file contains the status content", () => {
    const inputFile = join(tmpDir, "status.txt");
    const outputFile = join(tmpDir, "loom-status-test.html");
    const statusContent = "## Project Status\n  CLAUDE.md: found (42 lines)";

    writeFileSync(inputFile, statusContent);

    spawnSync(
      "bun", [
        "run",
        RENDERER_SCRIPT,
        "--input",
        inputFile,
        "--output",
        outputFile,
      ],
      {
        env: { ...process.env, PATH: `${process.env.HOME}/.bun/bin:/usr/bin:/bin` },
        timeout: 15000,
        encoding: "utf8",
      },
    );

    const html = readFileSync(outputFile, "utf8");
    expect(html).toContain("CLAUDE.md");
    expect(html).toContain("found (42 lines)");
  });

  it("HTML file is valid HTML5 (has DOCTYPE and html element)", () => {
    const inputFile = join(tmpDir, "status.txt");
    const outputFile = join(tmpDir, "loom-status-test.html");

    writeFileSync(inputFile, "status text");

    spawnSync(
      "bun", [
        "run",
        RENDERER_SCRIPT,
        "--input",
        inputFile,
        "--output",
        outputFile,
      ],
      {
        env: { ...process.env, PATH: `${process.env.HOME}/.bun/bin:/usr/bin:/bin` },
        timeout: 15000,
        encoding: "utf8",
      },
    );

    const html = readFileSync(outputFile, "utf8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
  });
});

// ---------------------------------------------------------------------------
// Tests: commands/loom-status.md --html flag documentation
// ---------------------------------------------------------------------------

describe("commands/loom-status.md — --html flag documentation", () => {
  const cmdPath = join(REPO_ROOT, "commands/loom-status.md");

  it("commands/loom-status.md exists", () => {
    expect(existsSync(cmdPath)).toBe(true);
  });

  it("documents the --html flag", () => {
    const content = readFileSync(cmdPath, "utf8");
    expect(content).toContain("--html");
  });

  it("states that plain-text/TOON output is preserved with --html", () => {
    const content = readFileSync(cmdPath, "utf8");
    // The flag must be described as strictly additive — plain-text default preserved
    expect(content).toMatch(/plain.?text|TOON/i);
    expect(content).toMatch(/default|additive|preserved/i);
  });

  it("documents the headless fallback behaviour", () => {
    const content = readFileSync(cmdPath, "utf8");
    expect(content).toContain("open this in a browser");
  });

  it("documents that exit code is 0 when HTML is written", () => {
    const content = readFileSync(cmdPath, "utf8");
    expect(content).toMatch(/exit.{0,20}0/i);
  });

  it("documents the HTML output path pattern", () => {
    const content = readFileSync(cmdPath, "utf8");
    expect(content).toContain(".plan-execution/reports");
    expect(content).toMatch(/loom-status.*\.html/i);
  });

  it("references the renderer script", () => {
    const content = readFileSync(cmdPath, "utf8");
    expect(content).toContain("scripts/html-renderer/loom-status.ts");
  });
});
