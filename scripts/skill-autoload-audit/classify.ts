/**
 * scripts/skill-autoload-audit/classify.ts
 *
 * Classifies every /loom-* skill as model-invoked vs user-invoked.
 *
 * A skill is "model-invoked" when Claude loads it automatically based on
 * its `description:` frontmatter (the model sees the description and decides
 * to load the skill). A "user-invoked" skill is one where the user explicitly
 * types `/loom-<name>` — the model should NOT auto-load it.
 *
 * Classification heuristic (in priority order):
 *   1. If frontmatter contains `disable-model-invocation: true` → user-invoked.
 *   2. If frontmatter `triggers:` is non-empty → model-invoked (has explicit triggers).
 *   3. If `description:` mentions action verbs that suggest user intent
 *      ("init", "create", "commit", "push", "merge", "run", "start",
 *       "pause", "resume", "upgrade", "add", "remove", "list") → user-invoked.
 *   4. Otherwise → model-invoked (default; skills with descriptions auto-load).
 *
 * Recommendations emitted per skill:
 *   - user-invoked + has description → recommend stripping description OR
 *     setting `disable-model-invocation: true`.
 *   - model-invoked + no description → recommend adding a description so
 *     the model knows when to activate it.
 *
 * Output:
 *   Emits a TOON report at:
 *   .plan-execution/reports/skill-autoload-audit-{YYYY-MM-DD}.toon
 *
 * Usage:
 *   bunx tsx scripts/skill-autoload-audit/classify.ts
 *   bunx tsx scripts/skill-autoload-audit/classify.ts --output <path>
 */

import {
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type InvocationClass = "model-invoked" | "user-invoked";

interface SkillAuditRow {
  file: string;
  skillName: string;
  invocationClass: InvocationClass;
  hasDescription: boolean;
  hasTriggers: boolean;
  disableModelInvocationSet: boolean;
  recommendation: string;
}

// ---------------------------------------------------------------------------
// Frontmatter parser
// ---------------------------------------------------------------------------

interface Frontmatter {
  description: string;
  triggers: string[];
  disableModelInvocation: boolean;
  [key: string]: unknown;
}

function parseFrontmatter(content: string): Frontmatter {
  const result: Frontmatter = {
    description: "",
    triggers: [],
    disableModelInvocation: false,
  };

  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") return result;

  const endIdx = lines.indexOf("---", 1);
  if (endIdx === -1) return result;

  const fmLines = lines.slice(1, endIdx);

  for (const line of fmLines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();

    if (key === "description") {
      // Strip surrounding quotes
      result.description = value.replace(/^["']|["']$/g, "");
    } else if (key === "triggers") {
      // Inline array: triggers: [foo, bar] or triggers: foo, bar
      const inner = value.replace(/^\[|\]$/g, "");
      result.triggers = inner
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (key === "disable-model-invocation") {
      result.disableModelInvocation = value === "true";
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const USER_INVOKED_VERBS = [
  "init",
  "create",
  "commit",
  "push",
  "merge",
  "run",
  "start",
  "pause",
  "resume",
  "upgrade",
  "add",
  "remove",
  "list",
  "delete",
  "deploy",
  "install",
  "uninstall",
];

function classify(fm: Frontmatter): InvocationClass {
  if (fm.disableModelInvocation) return "user-invoked";
  if (fm.triggers.length > 0) return "model-invoked";

  const descLower = fm.description.toLowerCase();
  for (const verb of USER_INVOKED_VERBS) {
    // Match as standalone word or at start of description
    if (
      new RegExp(`\\b${verb}\\b`).test(descLower) ||
      descLower.startsWith(verb)
    ) {
      return "user-invoked";
    }
  }

  return "model-invoked";
}

function recommend(row: Omit<SkillAuditRow, "recommendation">): string {
  if (row.invocationClass === "user-invoked" && row.hasDescription) {
    return row.disableModelInvocationSet
      ? "OK — disable-model-invocation already set"
      : "Set disable-model-invocation: true in frontmatter (or strip description to suppress auto-load)";
  }
  if (row.invocationClass === "model-invoked" && !row.hasDescription) {
    return "Add a description: field so the model knows when to activate this skill";
  }
  return "no action needed";
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

function findSkillFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git") continue;
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      results.push(...findSkillFiles(full));
    } else if (entry === "SKILL.md") {
      results.push(full);
    }
  }
  return results;
}

function relPath(absPath: string): string {
  return absPath.startsWith(REPO_ROOT)
    ? absPath.slice(REPO_ROOT.length + 1)
    : absPath;
}

function skillName(filePath: string): string {
  // e.g. skills/shell-conventions/SKILL.md → shell-conventions
  const rel = relPath(filePath);
  const parts = rel.split("/");
  // index of SKILL.md
  const idx = parts.indexOf("SKILL.md");
  return idx > 0 ? parts[idx - 1] : rel;
}

// ---------------------------------------------------------------------------
// TOON serialisation
// ---------------------------------------------------------------------------

function toToon(rows: SkillAuditRow[], generatedAt: string): string {
  const modelInvoked = rows.filter((r) => r.invocationClass === "model-invoked").length;
  const userInvoked = rows.filter((r) => r.invocationClass === "user-invoked").length;
  const needsAction = rows.filter(
    (r) => r.recommendation !== "no action needed" && !r.recommendation.startsWith("OK"),
  ).length;

  const rowLines = rows
    .map(
      (r) =>
        `  ${r.file},${r.skillName},${r.invocationClass},${r.hasDescription},${r.hasTriggers},${r.disableModelInvocationSet},"${r.recommendation}"`,
    )
    .join("\n");

  return [
    `generatedAt: ${generatedAt}`,
    `totalSkills: ${rows.length}`,
    `modelInvoked: ${modelInvoked}`,
    `userInvoked: ${userInvoked}`,
    `needsAction: ${needsAction}`,
    ``,
    `rows[${rows.length}]{file,skillName,invocationClass,hasDescription,hasTriggers,disableModelInvocationSet,recommendation}:`,
    rowLines,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);

  let outputPath: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--output" && args[i + 1]) {
      outputPath = args[++i];
    }
  }

  const generatedAt = new Date().toISOString();
  const dateSlug = generatedAt.slice(0, 10); // YYYY-MM-DD

  const defaultOutputPath = join(
    REPO_ROOT,
    ".plan-execution",
    "reports",
    `skill-autoload-audit-${dateSlug}.toon`,
  );
  const finalOutputPath = outputPath
    ? resolve(outputPath)
    : defaultOutputPath;

  console.log("[skill-autoload-audit] Scanning for SKILL.md files...");

  const skillsDir = join(REPO_ROOT, "skills");
  const skillFiles = findSkillFiles(skillsDir);

  if (skillFiles.length === 0) {
    console.warn(
      "[skill-autoload-audit] WARNING: No SKILL.md files found under skills/",
    );
  }

  const rows: SkillAuditRow[] = [];

  for (const filePath of skillFiles) {
    let content: string;
    try {
      content = readFileSync(filePath, "utf8");
    } catch (err) {
      console.warn(`[skill-autoload-audit] Could not read ${filePath}: ${err}`);
      continue;
    }

    const fm = parseFrontmatter(content);
    const name = skillName(filePath);
    const invocationClass = classify(fm);
    const hasDescription = fm.description.length > 0;
    const hasTriggers = fm.triggers.length > 0;
    const disableModelInvocationSet = fm.disableModelInvocation;

    const partial: Omit<SkillAuditRow, "recommendation"> = {
      file: relPath(filePath),
      skillName: name,
      invocationClass,
      hasDescription,
      hasTriggers,
      disableModelInvocationSet,
    };

    rows.push({ ...partial, recommendation: recommend(partial) });

    console.log(
      `  ${name}: ${invocationClass}${invocationClass === "user-invoked" && hasDescription && !disableModelInvocationSet ? " ← ACTION NEEDED" : ""}`,
    );
  }

  console.log(
    `[skill-autoload-audit] ${rows.length} skills audited. Writing report...`,
  );

  const toonContent = toToon(rows, generatedAt);

  mkdirSync(dirname(finalOutputPath), { recursive: true });
  const tmpPath = finalOutputPath + ".tmp";
  writeFileSync(tmpPath, toonContent, "utf8");
  renameSync(tmpPath, finalOutputPath);

  console.log(`[skill-autoload-audit] Report written to: ${finalOutputPath}`);
}

main();
