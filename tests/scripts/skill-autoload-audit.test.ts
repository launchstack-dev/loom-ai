/**
 * tests/scripts/skill-autoload-audit.test.ts
 *
 * S-05: Skill autoload audit emits deprecation notice for changed triggers.
 *
 * Given: A skill whose autoload trigger changes during the audit pass.
 * When:  The audit script applies the recommended classification.
 * Then:
 *   1. A /loom-doctor advisory entry MUST be appended to the doctor advisory file.
 *   2. The advisory text MUST cite both the prior trigger AND the new invocation path.
 *
 * Additional tests:
 *   - classify.ts produces a TOON report with correct schema.
 *   - classify.ts correctly classifies model-invoked vs user-invoked skills.
 *   - deprecation-notice.ts deduplicates by skill name.
 *   - classify.ts recommends disable-model-invocation for user-invoked skills with descriptions.
 *
 * Run: bunx vitest run tests/scripts/skill-autoload-audit.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const REPO_ROOT = resolve(__dirname, "../..");
const CLASSIFY_SCRIPT = join(
  REPO_ROOT,
  "scripts/skill-autoload-audit/classify.ts",
);
const NOTICE_SCRIPT = join(
  REPO_ROOT,
  "scripts/skill-autoload-audit/deprecation-notice.ts",
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "skill-autoload-test-"));
}

/** Write a minimal SKILL.md with given frontmatter. */
function writeSkillMd(dir: string, skillName: string, frontmatter: string, body = "Some body content here.\nMore content."): string {
  const skillDir = join(dir, "skills", skillName);
  mkdirSync(skillDir, { recursive: true });
  const filePath = join(skillDir, "SKILL.md");
  writeFileSync(filePath, `---\n${frontmatter}\n---\n\n${body}`);
  return filePath;
}

// ---------------------------------------------------------------------------
// Tests: script existence
// ---------------------------------------------------------------------------

describe("scripts/skill-autoload-audit — file existence", () => {
  it("classify.ts exists", () => {
    expect(existsSync(CLASSIFY_SCRIPT)).toBe(true);
  });

  it("deprecation-notice.ts exists", () => {
    expect(existsSync(NOTICE_SCRIPT)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: classify.ts structure
// ---------------------------------------------------------------------------

describe("scripts/skill-autoload-audit/classify.ts — structure", () => {
  it("contains classification logic (model-invoked vs user-invoked)", () => {
    const content = readFileSync(CLASSIFY_SCRIPT, "utf8");
    expect(content).toContain("model-invoked");
    expect(content).toContain("user-invoked");
  });

  it("reads disable-model-invocation frontmatter flag", () => {
    const content = readFileSync(CLASSIFY_SCRIPT, "utf8");
    expect(content).toContain("disable-model-invocation");
  });

  it("emits TOON output to .plan-execution/reports/", () => {
    const content = readFileSync(CLASSIFY_SCRIPT, "utf8");
    expect(content).toContain(".plan-execution");
    expect(content).toContain("skill-autoload-audit-");
    expect(content).toContain(".toon");
  });

  it("performs atomic write", () => {
    const content = readFileSync(CLASSIFY_SCRIPT, "utf8");
    expect(content).toContain(".tmp");
    expect(content).toContain("renameSync");
  });

  it("classifies user-invoked skills using action verb heuristic", () => {
    const content = readFileSync(CLASSIFY_SCRIPT, "utf8");
    // Should list common user-invoked action verbs
    expect(content).toContain("init");
    expect(content).toContain("create");
    expect(content).toContain("commit");
  });

  it("recommends setting disable-model-invocation for user-invoked skills with descriptions", () => {
    const content = readFileSync(CLASSIFY_SCRIPT, "utf8");
    expect(content).toMatch(/disable-model-invocation.*true/i);
  });
});

// ---------------------------------------------------------------------------
// Tests: deprecation-notice.ts structure
// ---------------------------------------------------------------------------

describe("scripts/skill-autoload-audit/deprecation-notice.ts — structure", () => {
  it("exports emitDeprecationNotice function", () => {
    const content = readFileSync(NOTICE_SCRIPT, "utf8");
    expect(content).toContain("export function emitDeprecationNotice");
  });

  it("advisory entry contains priorTrigger field", () => {
    const content = readFileSync(NOTICE_SCRIPT, "utf8");
    expect(content).toContain("priorTrigger");
  });

  it("advisory entry contains newInvocationPath field", () => {
    const content = readFileSync(NOTICE_SCRIPT, "utf8");
    expect(content).toContain("newInvocationPath");
  });

  it("deduplicates by skillName using filter", () => {
    const content = readFileSync(NOTICE_SCRIPT, "utf8");
    // Must filter out existing entries for the same skill before appending
    // The implementation filters with: existing.filter((e) => e.skillName !== skillName)
    expect(content).toContain(".filter(");
    expect(content).toContain("skillName");
    // The dedup comment must be present
    expect(content).toMatch(/deduplicat/i);
  });

  it("uses atomic write pattern", () => {
    const content = readFileSync(NOTICE_SCRIPT, "utf8");
    expect(content).toContain(".tmp");
    expect(content).toContain("renameSync");
  });

  it("advisory file goes to .plan-execution/reports/", () => {
    const content = readFileSync(NOTICE_SCRIPT, "utf8");
    expect(content).toContain("skill-autoload-advisories.toon");
    expect(content).toContain(".plan-execution");
  });
});

// ---------------------------------------------------------------------------
// Tests: S-05 — deprecation notice emission
// ---------------------------------------------------------------------------

describe("S-05 — deprecation notice emitted with prior trigger and new invocation path", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("S-05: emits advisory entry when skill trigger changes", () => {
    const advisoryFile = join(tmpDir, "advisories.toon");

    const result = spawnSync(
      "bunx",
      [
        "tsx",
        NOTICE_SCRIPT,
        "--skill",
        "shell-conventions",
        "--prior-trigger",
        "model-invoked via description",
        "--new-invocation-path",
        "/loom-shell-conventions",
        "--advisory-file",
        advisoryFile,
      ],
      { timeout: 15000, encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(existsSync(advisoryFile)).toBe(true);
  });

  it("S-05: advisory text cites the prior trigger", () => {
    const advisoryFile = join(tmpDir, "advisories.toon");

    spawnSync(
      "bunx",
      [
        "tsx",
        NOTICE_SCRIPT,
        "--skill",
        "shell-conventions",
        "--prior-trigger",
        "model-invoked via description",
        "--new-invocation-path",
        "/loom-shell-conventions",
        "--advisory-file",
        advisoryFile,
      ],
      { timeout: 15000, encoding: "utf8" },
    );

    const content = readFileSync(advisoryFile, "utf8");
    expect(content).toContain("model-invoked via description");
  });

  it("S-05: advisory text cites the new invocation path", () => {
    const advisoryFile = join(tmpDir, "advisories.toon");

    spawnSync(
      "bunx",
      [
        "tsx",
        NOTICE_SCRIPT,
        "--skill",
        "shell-conventions",
        "--prior-trigger",
        "model-invoked via description",
        "--new-invocation-path",
        "/loom-shell-conventions",
        "--advisory-file",
        advisoryFile,
      ],
      { timeout: 15000, encoding: "utf8" },
    );

    const content = readFileSync(advisoryFile, "utf8");
    expect(content).toContain("/loom-shell-conventions");
  });

  it("S-05: advisory file uses TOON format with entries[] typed array", () => {
    const advisoryFile = join(tmpDir, "advisories.toon");

    spawnSync(
      "bunx",
      [
        "tsx",
        NOTICE_SCRIPT,
        "--skill",
        "test-skill",
        "--prior-trigger",
        "prior-trigger-value",
        "--new-invocation-path",
        "/loom-test-skill",
        "--advisory-file",
        advisoryFile,
      ],
      { timeout: 15000, encoding: "utf8" },
    );

    const content = readFileSync(advisoryFile, "utf8");
    expect(content).toMatch(/entries\[\d+\]\{/);
    expect(content).toContain("skillName");
    expect(content).toContain("priorTrigger");
    expect(content).toContain("newInvocationPath");
    expect(content).toContain("emittedAt");
  });

  it("S-05: running notice twice for same skill deduplicates (no duplicate entries)", () => {
    const advisoryFile = join(tmpDir, "advisories.toon");
    const commonArgs = [
      "--skill",
      "shell-conventions",
      "--prior-trigger",
      "model-invoked via description",
      "--new-invocation-path",
      "/loom-shell-conventions",
      "--advisory-file",
      advisoryFile,
    ];

    // Run twice
    spawnSync("bunx", ["tsx", NOTICE_SCRIPT, ...commonArgs], {
      timeout: 15000,
      encoding: "utf8",
    });
    spawnSync("bunx", ["tsx", NOTICE_SCRIPT, ...commonArgs], {
      timeout: 15000,
      encoding: "utf8",
    });

    const content = readFileSync(advisoryFile, "utf8");
    // Should only contain one row for shell-conventions
    const occurrences = (content.match(/shell-conventions/g) ?? []).length;
    // Appears in the row itself (once or twice due to field names) but NOT duplicated
    // We check the entries count is 1
    const entryCountMatch = content.match(/entries\[(\d+)\]/);
    expect(entryCountMatch).not.toBeNull();
    const entryCount = parseInt(entryCountMatch![1], 10);
    expect(entryCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: classify.ts execution
// ---------------------------------------------------------------------------

describe("classify.ts — execution against real skills directory", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("produces a TOON report in the reports directory", () => {
    const reportFile = join(tmpDir, "skill-audit-test.toon");
    // Use --output to redirect report to tmp dir
    const result = spawnSync(
      "bunx",
      ["tsx", CLASSIFY_SCRIPT, "--output", reportFile],
      { timeout: 20000, encoding: "utf8", cwd: REPO_ROOT },
    );

    // Should exit 0 even if no skills or with skills
    expect(result.status).toBe(0);
    expect(existsSync(reportFile)).toBe(true);
  });

  it("TOON report contains required schema fields", () => {
    const reportFile = join(tmpDir, "skill-audit-test.toon");
    spawnSync(
      "bunx",
      ["tsx", CLASSIFY_SCRIPT, "--output", reportFile],
      { timeout: 20000, encoding: "utf8", cwd: REPO_ROOT },
    );

    if (existsSync(reportFile)) {
      const content = readFileSync(reportFile, "utf8");
      expect(content).toContain("generatedAt:");
      expect(content).toContain("totalSkills:");
      expect(content).toContain("modelInvoked:");
      expect(content).toContain("userInvoked:");
    }
  });
});
