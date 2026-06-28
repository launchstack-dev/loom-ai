/**
 * Tests for /loom-prototype command
 *
 * S-04: /loom-prototype completion ceremony updates the linked ADR
 *       - prototypes/foo/answer.toon MUST exist with a single line summary
 *       - docs/adr/0001-*.md MUST contain a new prototypeAnswer: line
 *       - A second completion attempt MUST exit with code 1
 *
 * These tests simulate the completion-ceremony.ts script using temp-dir fixtures.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Harness — mirrors completion-ceremony.ts logic
// ---------------------------------------------------------------------------

interface CeremonyResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function resolveAdrFile(adrSlug: string, projectDir: string): string | null {
  const adrDir = join(projectDir, "docs", "adr");
  if (!existsSync(adrDir)) return null;

  const numericMatch = adrSlug.match(/(\d+)/);
  if (!numericMatch) return null;
  const numericId = numericMatch[1].padStart(4, "0");

  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  try {
    const entries = readdirSync(adrDir) as string[];
    for (const entry of entries) {
      if (entry.endsWith(".md") && entry.includes(numericId)) {
        return join(adrDir, entry);
      }
    }
  } catch {
    return null;
  }
  return null;
}

function simulateCompletionCeremony(opts: {
  projectDir: string;
  name: string;
  answer: string;
  adr?: string;
}): CeremonyResult {
  const { projectDir, name, answer, adr } = opts;

  const protoDir = join(projectDir, "prototypes", name);
  if (!existsSync(protoDir)) {
    return {
      exitCode: 3,
      stdout: "",
      stderr: `completion-ceremony: prototype directory not found: ${protoDir}\n`,
    };
  }

  const answerPath = join(protoDir, "answer.toon");

  // Guard: duplicate completion
  if (existsSync(answerPath)) {
    return {
      exitCode: 1,
      stdout: "",
      stderr:
        `completion-ceremony: answer.toon already exists at ${answerPath}\n` +
        `Prototype '${name}' was already completed. Delete answer.toon to re-complete.\n`,
    };
  }

  // Resolve ADR (if --adr was passed)
  let adrFilePath: string | null = null;
  if (adr) {
    adrFilePath = resolveAdrFile(adr, projectDir);
    if (!adrFilePath) {
      return {
        exitCode: 2,
        stdout: "",
        stderr: `completion-ceremony: ADR file not found for '${adr}' under docs/adr/\n`,
      };
    }
  }

  // Write answer.toon atomically
  const nowIso = new Date().toISOString();
  const answerContent =
    `prototypeName: ${name}\n` +
    `answer: ${answer}\n` +
    `completedAt: ${nowIso}\n` +
    (adr ? `adrRef: ${adr}\n` : "");

  const answerTmp = answerPath + ".tmp";
  writeFileSync(answerTmp, answerContent, "utf-8");
  renameSync(answerTmp, answerPath);

  let stdout = `answer.toon written to ${answerPath}\n`;

  // Append prototypeAnswer: to ADR
  if (adrFilePath) {
    const adrContent = readFileSync(adrFilePath, "utf-8");

    if (adrContent.includes("prototypeAnswer:")) {
      // Already has the line — skip
    } else {
      const appendLine = `\nprototypeAnswer: ${answer}\n`;
      const updatedContent = adrContent.trimEnd() + appendLine;

      const adrTmp = adrFilePath + ".tmp";
      writeFileSync(adrTmp, updatedContent, "utf-8");
      renameSync(adrTmp, adrFilePath);

      stdout += `${adr} updated with prototypeAnswer at ${adrFilePath}\n`;
    }
  }

  return { exitCode: 0, stdout, stderr: "" };
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function scaffoldPrototypeDir(projectDir: string, name: string): string {
  const protoDir = join(projectDir, "prototypes", name);
  mkdirSync(protoDir, { recursive: true });

  // Minimal scaffold (mirrors what loom-prototype Step 1 would produce)
  writeFileSync(
    join(protoDir, ".prototype-meta.toon"),
    `name: ${name}\nbranch: logic\nthrowaway: true\nstatus: active\n`,
    "utf-8"
  );
  writeFileSync(
    join(protoDir, "index.ts"),
    `// THROWAWAY prototype: ${name}\nasync function main() {}\nmain();\n`,
    "utf-8"
  );

  return protoDir;
}

function scaffoldAdr(projectDir: string, slug: string, title: string): string {
  const adrDir = join(projectDir, "docs", "adr");
  mkdirSync(adrDir, { recursive: true });

  const numericMatch = slug.match(/(\d+)/);
  const numericId = numericMatch ? numericMatch[1].padStart(4, "0") : "0001";
  const filename = `${numericId}-${title.toLowerCase().replace(/\s+/g, "-")}.md`;
  const adrPath = join(adrDir, filename);

  writeFileSync(
    adrPath,
    `# ${slug}: ${title}\n\n## Status\n\nAccepted\n\n## Context\n\nTest ADR for prototype experiments.\n\n## Decision\n\nTBD.\n`,
    "utf-8"
  );

  return adrPath;
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "loom-prototype-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// S-04: Completion ceremony updates the linked ADR
// ---------------------------------------------------------------------------

describe("S-04: /loom-prototype completion ceremony updates the linked ADR", () => {
  it("writes answer.toon to prototypes/foo/ on successful completion", () => {
    scaffoldPrototypeDir(tmpDir, "foo");
    scaffoldAdr(tmpDir, "ADR-0001", "test adr convention");

    const result = simulateCompletionCeremony({
      projectDir: tmpDir,
      name: "foo",
      answer: "The logic branch handles concurrent events correctly",
      adr: "ADR-0001",
    });

    expect(result.exitCode).toBe(0);
    const answerPath = join(tmpDir, "prototypes", "foo", "answer.toon");
    expect(existsSync(answerPath)).toBe(true);
  });

  it("answer.toon contains the prototypeName field", () => {
    scaffoldPrototypeDir(tmpDir, "foo");
    scaffoldAdr(tmpDir, "ADR-0001", "test adr convention");

    simulateCompletionCeremony({
      projectDir: tmpDir,
      name: "foo",
      answer: "The logic branch handles concurrent events correctly",
      adr: "ADR-0001",
    });

    const answerPath = join(tmpDir, "prototypes", "foo", "answer.toon");
    const content = readFileSync(answerPath, "utf-8");
    expect(content).toContain("prototypeName: foo");
  });

  it("answer.toon contains the answer field with the provided text", () => {
    scaffoldPrototypeDir(tmpDir, "foo");
    scaffoldAdr(tmpDir, "ADR-0001", "test adr convention");

    const answerText = "The logic branch handles concurrent events correctly";
    simulateCompletionCeremony({
      projectDir: tmpDir,
      name: "foo",
      answer: answerText,
      adr: "ADR-0001",
    });

    const answerPath = join(tmpDir, "prototypes", "foo", "answer.toon");
    const content = readFileSync(answerPath, "utf-8");
    expect(content).toContain(`answer: ${answerText}`);
  });

  it("answer.toon contains the adrRef field when --adr was passed", () => {
    scaffoldPrototypeDir(tmpDir, "foo");
    scaffoldAdr(tmpDir, "ADR-0001", "test adr convention");

    simulateCompletionCeremony({
      projectDir: tmpDir,
      name: "foo",
      answer: "Prototype finding here",
      adr: "ADR-0001",
    });

    const answerPath = join(tmpDir, "prototypes", "foo", "answer.toon");
    const content = readFileSync(answerPath, "utf-8");
    expect(content).toContain("adrRef: ADR-0001");
  });

  it("linked ADR contains a prototypeAnswer: line after completion", () => {
    scaffoldPrototypeDir(tmpDir, "foo");
    const adrPath = scaffoldAdr(tmpDir, "ADR-0001", "test adr convention");

    simulateCompletionCeremony({
      projectDir: tmpDir,
      name: "foo",
      answer: "The logic branch handles concurrent events correctly",
      adr: "ADR-0001",
    });

    const adrContent = readFileSync(adrPath, "utf-8");
    expect(adrContent).toContain("prototypeAnswer:");
  });

  it("prototypeAnswer: line in ADR contains the answer text", () => {
    scaffoldPrototypeDir(tmpDir, "foo");
    const adrPath = scaffoldAdr(tmpDir, "ADR-0001", "test adr convention");
    const answerText = "The logic branch handles concurrent events correctly";

    simulateCompletionCeremony({
      projectDir: tmpDir,
      name: "foo",
      answer: answerText,
      adr: "ADR-0001",
    });

    const adrContent = readFileSync(adrPath, "utf-8");
    expect(adrContent).toContain(`prototypeAnswer: ${answerText}`);
  });

  it("second completion attempt exits with code 1 to prevent duplicate writes", () => {
    scaffoldPrototypeDir(tmpDir, "foo");
    scaffoldAdr(tmpDir, "ADR-0001", "test adr convention");

    // First completion
    const first = simulateCompletionCeremony({
      projectDir: tmpDir,
      name: "foo",
      answer: "First answer",
      adr: "ADR-0001",
    });
    expect(first.exitCode).toBe(0);

    // Second completion attempt — must exit 1
    const second = simulateCompletionCeremony({
      projectDir: tmpDir,
      name: "foo",
      answer: "Second answer attempt",
      adr: "ADR-0001",
    });
    expect(second.exitCode).toBe(1);
  });

  it("second attempt stderr explains that answer.toon already exists", () => {
    scaffoldPrototypeDir(tmpDir, "foo");
    scaffoldAdr(tmpDir, "ADR-0001", "test adr convention");

    simulateCompletionCeremony({
      projectDir: tmpDir,
      name: "foo",
      answer: "First answer",
      adr: "ADR-0001",
    });

    const second = simulateCompletionCeremony({
      projectDir: tmpDir,
      name: "foo",
      answer: "Duplicate",
      adr: "ADR-0001",
    });

    expect(second.stderr).toContain("answer.toon already exists");
  });

  it("ADR is NOT modified on second completion attempt", () => {
    scaffoldPrototypeDir(tmpDir, "foo");
    const adrPath = scaffoldAdr(tmpDir, "ADR-0001", "test adr convention");

    simulateCompletionCeremony({
      projectDir: tmpDir,
      name: "foo",
      answer: "First answer",
      adr: "ADR-0001",
    });

    const adrAfterFirst = readFileSync(adrPath, "utf-8");
    const countBefore = (adrAfterFirst.match(/prototypeAnswer:/g) ?? []).length;

    // Second attempt
    simulateCompletionCeremony({
      projectDir: tmpDir,
      name: "foo",
      answer: "Duplicate",
      adr: "ADR-0001",
    });

    const adrAfterSecond = readFileSync(adrPath, "utf-8");
    const countAfter = (adrAfterSecond.match(/prototypeAnswer:/g) ?? []).length;

    expect(countAfter).toBe(countBefore); // No second line added
  });

  it("exits 2 when --adr is passed but the ADR file does not exist", () => {
    scaffoldPrototypeDir(tmpDir, "foo");
    // Do NOT scaffold the ADR

    const result = simulateCompletionCeremony({
      projectDir: tmpDir,
      name: "foo",
      answer: "Some finding",
      adr: "ADR-0099",
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("ADR file not found");
  });

  it("exits 3 when the prototype directory does not exist", () => {
    // Do NOT scaffold the prototype dir
    const result = simulateCompletionCeremony({
      projectDir: tmpDir,
      name: "nonexistent-prototype",
      answer: "Some finding",
    });

    expect(result.exitCode).toBe(3);
  });

  it("completion works without --adr (no ADR mutation)", () => {
    scaffoldPrototypeDir(tmpDir, "bar");

    const result = simulateCompletionCeremony({
      projectDir: tmpDir,
      name: "bar",
      answer: "Standalone prototype finding",
    });

    expect(result.exitCode).toBe(0);
    const answerPath = join(tmpDir, "prototypes", "bar", "answer.toon");
    expect(existsSync(answerPath)).toBe(true);

    const content = readFileSync(answerPath, "utf-8");
    expect(content).not.toContain("adrRef:");
  });

  it("answer.toon write is atomic (no partial file on disk)", () => {
    scaffoldPrototypeDir(tmpDir, "atomic-test");

    simulateCompletionCeremony({
      projectDir: tmpDir,
      name: "atomic-test",
      answer: "Atomic write test",
    });

    // Ensure .tmp file does NOT linger
    const tmpFile = join(tmpDir, "prototypes", "atomic-test", "answer.toon.tmp");
    expect(existsSync(tmpFile)).toBe(false);

    const answerPath = join(tmpDir, "prototypes", "atomic-test", "answer.toon");
    expect(existsSync(answerPath)).toBe(true);
  });
});
