/**
 * scripts/loom-prototype/completion-ceremony.ts
 *
 * Completion ceremony for /loom-prototype.
 *
 * Writes a one-line TOON answer to `prototypes/{name}/answer.toon`.
 * If --adr was passed, appends a `prototypeAnswer:` line to the referenced ADR.
 *
 * Usage:
 *   bunx tsx scripts/loom-prototype/completion-ceremony.ts \
 *     --name <prototype-name> \
 *     --answer "<one-line finding>" \
 *     [--adr <ADR-NNNN>]
 *
 * Exit codes:
 *   0 — success
 *   1 — answer.toon already exists (duplicate completion attempt)
 *   2 — ADR file not found
 *   3 — prototype directory not found
 */

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

interface CeremonyArgs {
  name: string;
  answer: string;
  adr: string | null;
}

function parseArgs(argv: string[]): CeremonyArgs {
  let name = "";
  let answer = "";
  let adr: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--name" && argv[i + 1]) {
      name = argv[++i];
    } else if (argv[i] === "--answer" && argv[i + 1]) {
      answer = argv[++i];
    } else if (argv[i] === "--adr" && argv[i + 1]) {
      adr = argv[++i];
    }
  }

  if (!name) {
    process.stderr.write("completion-ceremony: --name <prototype-name> is required\n");
    process.exit(1);
  }
  if (!answer) {
    process.stderr.write("completion-ceremony: --answer \"<one-line finding>\" is required\n");
    process.exit(1);
  }

  return { name, answer, adr };
}

// ---------------------------------------------------------------------------
// ADR resolver
// ---------------------------------------------------------------------------

/**
 * Find the ADR file under docs/adr/ matching the slug (e.g., ADR-0001).
 * Matches files like `0001-*.md` or `ADR-0001-*.md`.
 */
function resolveAdrFile(adrSlug: string, cwd: string): string | null {
  const adrDir = path.join(cwd, "docs", "adr");

  if (!fs.existsSync(adrDir)) {
    return null;
  }

  // Normalise slug: extract numeric part
  const numericMatch = adrSlug.match(/(\d+)/);
  if (!numericMatch) return null;
  const numericId = numericMatch[1].padStart(4, "0");

  let entries: string[];
  try {
    entries = fs.readdirSync(adrDir);
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (entry.endsWith(".md") && entry.includes(numericId)) {
      return path.join(adrDir, entry);
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  // Locate prototype directory
  const protoDir = path.join(cwd, "prototypes", args.name);
  if (!fs.existsSync(protoDir)) {
    process.stderr.write(
      `completion-ceremony: prototype directory not found: ${protoDir}\n` +
      `Run /loom-prototype ${args.name} --branch <logic|ui> first.\n`
    );
    process.exit(3);
  }

  // Guard against duplicate completion
  const answerPath = path.join(protoDir, "answer.toon");
  if (fs.existsSync(answerPath)) {
    process.stderr.write(
      `completion-ceremony: answer.toon already exists at ${answerPath}\n` +
      `Prototype '${args.name}' was already completed. Delete answer.toon to re-complete.\n`
    );
    process.exit(1);
  }

  // Resolve ADR file (if --adr was passed)
  let adrFilePath: string | null = null;
  if (args.adr) {
    adrFilePath = resolveAdrFile(args.adr, cwd);
    if (!adrFilePath) {
      process.stderr.write(
        `completion-ceremony: ADR file not found for '${args.adr}' under docs/adr/\n`
      );
      process.exit(2);
    }
  }

  // Write answer.toon (one-line summary per spec)
  const nowIso = new Date().toISOString();
  const answerContent =
    `prototypeName: ${args.name}\n` +
    `answer: ${args.answer}\n` +
    `completedAt: ${nowIso}\n` +
    (args.adr ? `adrRef: ${args.adr}\n` : "");

  const answerTmp = answerPath + ".tmp";
  fs.writeFileSync(answerTmp, answerContent, "utf-8");
  fs.renameSync(answerTmp, answerPath);

  process.stdout.write(`answer.toon written to ${answerPath}\n`);

  // Append prototypeAnswer: to the ADR (if --adr was passed)
  if (adrFilePath) {
    const adrContent = fs.readFileSync(adrFilePath, "utf-8");

    // Guard: if a prototypeAnswer: line already exists, skip (idempotent)
    if (adrContent.includes("prototypeAnswer:")) {
      process.stderr.write(
        `completion-ceremony: ADR at ${adrFilePath} already contains a prototypeAnswer: line — skipping append.\n`
      );
    } else {
      const appendLine = `\nprototypeAnswer: ${args.answer}\n`;
      const updatedContent = adrContent.trimEnd() + appendLine;

      const adrTmp = adrFilePath + ".tmp";
      fs.writeFileSync(adrTmp, updatedContent, "utf-8");
      fs.renameSync(adrTmp, adrFilePath);

      process.stdout.write(`${args.adr} updated with prototypeAnswer at ${adrFilePath}\n`);
    }
  }

  process.exit(0);
}

main();
