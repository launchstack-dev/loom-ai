/**
 * tests/commands/loom-roadmap-status-html.test.ts
 *
 * S-04 (roadmap variant): loom-roadmap status --html headless fallback prints
 * path and exits 0.
 *
 * Given: A fixture environment where the OS open shim fails (headless).
 * When:  loom-roadmap status --html runs against a fixture project.
 * Then:
 *   1. Exit code MUST be 0.
 *   2. stdout MUST contain the literal line "open this in a browser".
 *   3. An HTML file MUST exist at the documented path.
 *
 * Additional tests:
 *   - HTML file contains ✓/⚠/✗ glyph markup (colour spans).
 *   - --html flag is documented in commands/loom-roadmap/status.md.
 *   - Plain-text default is preserved (--html is strictly additive).
 *
 * Run: bunx vitest run tests/commands/loom-roadmap-status-html.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const REPO_ROOT = resolve(__dirname, "../..");
const RENDERER_SCRIPT = join(
  REPO_ROOT,
  "scripts/html-renderer/loom-roadmap-status.ts",
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "loom-roadmap-status-html-test-"));
}

// ---------------------------------------------------------------------------
// Tests: HTML renderer script structure
// ---------------------------------------------------------------------------

describe("scripts/html-renderer/loom-roadmap-status.ts — structure", () => {
  it("renderer script exists", () => {
    expect(existsSync(RENDERER_SCRIPT)).toBe(true);
  });

  it("renderer script contains main function and exits 0", () => {
    const content = readFileSync(RENDERER_SCRIPT, "utf8");
    expect(content).toContain("function main()");
    expect(content).toContain("process.exit(0)");
  });

  it("renderer script implements the headless fallback message", () => {
    const content = readFileSync(RENDERER_SCRIPT, "utf8");
    expect(content).toContain("open this in a browser");
  });

  it("renderer script performs atomic write", () => {
    const content = readFileSync(RENDERER_SCRIPT, "utf8");
    expect(content).toContain(".tmp");
    expect(content).toContain("renameSync");
  });

  it("renderer script supports --slug argument for roadmap slug", () => {
    const content = readFileSync(RENDERER_SCRIPT, "utf8");
    expect(content).toContain("--slug");
  });

  it("renderer script applies colour spans to ✓/⚠/✗ glyphs", () => {
    const content = readFileSync(RENDERER_SCRIPT, "utf8");
    // Must transform the glyph characters into span elements
    expect(content).toContain("✓");
    expect(content).toContain("✗");
    expect(content).toContain("class=\"pass\"");
    expect(content).toContain("class=\"fail\"");
  });
});

// ---------------------------------------------------------------------------
// Tests: HTML renderer execution (headless)
// ---------------------------------------------------------------------------

describe("scripts/html-renderer/loom-roadmap-status.ts — execution", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("S-04: exits 0 and prints 'open this in a browser' when open shim unavailable", () => {
    const inputFile = join(tmpDir, "digest.txt");
    const outputFile = join(tmpDir, "roadmap-status-test.html");

    writeFileSync(
      inputFile,
      "=== Roadmap Convergence Status: ROADMAP ===\n  ✓ vision\n  ⚠ milestones\n",
    );

    const result = spawnSync(
      "bunx",
      [
        "tsx",
        RENDERER_SCRIPT,
        "--input",
        inputFile,
        "--output",
        outputFile,
        "--slug",
        "ROADMAP",
      ],
      {
        env: { ...process.env, PATH: "/usr/bin:/bin" },
        timeout: 15000,
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    const combinedOutput = (result.stdout ?? "") + (result.stderr ?? "");
    expect(combinedOutput).toContain("open this in a browser");
  });

  it("S-04: HTML file exists at the output path", () => {
    const inputFile = join(tmpDir, "digest.txt");
    const outputFile = join(tmpDir, "roadmap-status-test.html");

    writeFileSync(inputFile, "=== Roadmap Convergence Status: ROADMAP ===\n");

    spawnSync(
      "bunx",
      [
        "tsx",
        RENDERER_SCRIPT,
        "--input",
        inputFile,
        "--output",
        outputFile,
        "--slug",
        "ROADMAP",
      ],
      {
        env: { ...process.env, PATH: "/usr/bin:/bin" },
        timeout: 15000,
        encoding: "utf8",
      },
    );

    expect(existsSync(outputFile)).toBe(true);
  });

  it("HTML file contains the roadmap status content", () => {
    const inputFile = join(tmpDir, "digest.txt");
    const outputFile = join(tmpDir, "roadmap-status-test.html");
    const digestContent =
      "=== Roadmap Convergence Status: ROADMAP ===\n  ✓ vision\n  ✗ milestones\n";

    writeFileSync(inputFile, digestContent);

    spawnSync(
      "bunx",
      [
        "tsx",
        RENDERER_SCRIPT,
        "--input",
        inputFile,
        "--output",
        outputFile,
        "--slug",
        "ROADMAP",
      ],
      {
        env: { ...process.env, PATH: "/usr/bin:/bin" },
        timeout: 15000,
        encoding: "utf8",
      },
    );

    const html = readFileSync(outputFile, "utf8");
    expect(html).toContain("vision");
    expect(html).toContain("milestones");
    // Glyphs should be wrapped in span elements
    expect(html).toContain("class=\"pass\"");
    expect(html).toContain("class=\"fail\"");
  });

  it("HTML file includes the slug in the title", () => {
    const inputFile = join(tmpDir, "digest.txt");
    const outputFile = join(tmpDir, "roadmap-status-test.html");

    writeFileSync(inputFile, "status text");

    spawnSync(
      "bunx",
      [
        "tsx",
        RENDERER_SCRIPT,
        "--input",
        inputFile,
        "--output",
        outputFile,
        "--slug",
        "MY-ROADMAP",
      ],
      {
        env: { ...process.env, PATH: "/usr/bin:/bin" },
        timeout: 15000,
        encoding: "utf8",
      },
    );

    const html = readFileSync(outputFile, "utf8");
    expect(html).toContain("MY-ROADMAP");
  });

  it("HTML file is valid HTML5", () => {
    const inputFile = join(tmpDir, "digest.txt");
    const outputFile = join(tmpDir, "roadmap-status-test.html");

    writeFileSync(inputFile, "status text");

    spawnSync(
      "bunx",
      [
        "tsx",
        RENDERER_SCRIPT,
        "--input",
        inputFile,
        "--output",
        outputFile,
      ],
      {
        env: { ...process.env, PATH: "/usr/bin:/bin" },
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
// Tests: commands/loom-roadmap/status.md --html flag documentation
// ---------------------------------------------------------------------------

describe("commands/loom-roadmap/status.md — --html flag documentation", () => {
  const cmdPath = join(REPO_ROOT, "commands/loom-roadmap/status.md");

  it("commands/loom-roadmap/status.md exists", () => {
    expect(existsSync(cmdPath)).toBe(true);
  });

  it("documents the --html flag in the flags table", () => {
    const content = readFileSync(cmdPath, "utf8");
    expect(content).toContain("--html");
  });

  it("states that plain-text output is preserved with --html", () => {
    const content = readFileSync(cmdPath, "utf8");
    expect(content).toMatch(/plain.?text|TOON/i);
    expect(content).toMatch(/additive|preserved|default/i);
  });

  it("documents the headless fallback behaviour", () => {
    const content = readFileSync(cmdPath, "utf8");
    expect(content).toContain("open this in a browser");
  });

  it("documents incompatibility with --json", () => {
    const content = readFileSync(cmdPath, "utf8");
    expect(content).toMatch(/--json.{0,80}--html|--html.{0,80}--json/i);
  });

  it("references the roadmap renderer script", () => {
    const content = readFileSync(cmdPath, "utf8");
    expect(content).toContain("scripts/html-renderer/loom-roadmap-status.ts");
  });
});
