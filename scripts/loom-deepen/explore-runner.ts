/**
 * scripts/loom-deepen/explore-runner.ts
 *
 * Fan-out Explore subagent invocation for /loom-deepen.
 * Scans the target directory for TypeScript/JavaScript modules,
 * computes Depth estimates, applies the deletion test, and emits
 * JSON-lines rows to stdout.
 *
 * Output shape per line (JSON):
 * {
 *   moduleName: string,
 *   depthBefore: number,   // 0.0 – 1.0
 *   depthAfter: number,    // 0.0 – 1.0
 *   deletionTestResult: string,
 *   recommendation: string,  // MUST cite ≥1 codebase-design vocab term
 *   beforeDiagram: string,   // path to .toon diagram artifact
 *   afterDiagram: string,    // path to .toon diagram artifact
 * }
 *
 * Vocabulary (protocols/codebase-design.md):
 *   Module, Interface, Depth, Seam, Adapter, Leverage, Locality, Tracer Bullet, Vertical Slice
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { target: string; limit: number } {
  let target = process.cwd();
  let limit = 10;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--target" && argv[i + 1]) {
      target = path.resolve(argv[++i]);
    } else if (argv[i] === "--limit" && argv[i + 1]) {
      const n = parseInt(argv[++i], 10);
      if (!isNaN(n) && n > 0) limit = n;
    }
  }

  return { target, limit };
}

// ---------------------------------------------------------------------------
// Module discovery
// ---------------------------------------------------------------------------

interface DiscoveredModule {
  name: string;
  relPath: string;
  absPath: string;
  exportCount: number;
  lineCount: number;
}

function discoverModules(rootDir: string, limit: number): DiscoveredModule[] {
  const results: DiscoveredModule[] = [];

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules") continue;
      if (entry.name === "dist") continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        // Skip test files and type-only files
        if (/\.(test|spec)\.|\.d\.ts$/.test(entry.name)) continue;

        const relPath = path.relative(rootDir, fullPath);
        const content = fs.readFileSync(fullPath, "utf-8");
        const lines = content.split("\n");

        // Count exports (rough proxy for interface surface)
        const exportMatches = content.match(/^export\s+(const|function|class|type|interface|default)/gm) ?? [];
        const exportCount = exportMatches.length;

        if (exportCount === 0) continue; // skip non-module files

        results.push({
          name: path.basename(entry.name, path.extname(entry.name)),
          relPath,
          absPath: fullPath,
          exportCount,
          lineCount: lines.length,
        });
      }
    }
  }

  walk(rootDir);

  // Sort by depth score ascending (shallowest first — best candidates for deepening)
  results.sort((a, b) => {
    const depthA = computeDepthScore(a.lineCount, a.exportCount);
    const depthB = computeDepthScore(b.lineCount, b.exportCount);
    return depthA - depthB;
  });

  return results.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Depth computation
// ---------------------------------------------------------------------------

/**
 * Depth = behaviour-volume / interface-surface.
 * We approximate:
 *   behaviour-volume  ~ lineCount (non-export lines are internal behaviour)
 *   interface-surface ~ exportCount
 *
 * Normalised to 0–1 by sigmoid so score is comparable across codebases.
 */
function computeDepthScore(lineCount: number, exportCount: number): number {
  if (exportCount === 0) return 1.0;
  const raw = lineCount / exportCount;
  // Sigmoid: 1 / (1 + e^(-0.05 * (raw - 20)))
  // Scores <20 lines/export → shallow (<0.5); >20 → deep (>0.5)
  return 1 / (1 + Math.exp(-0.05 * (raw - 20)));
}

// ---------------------------------------------------------------------------
// Deletion test
// ---------------------------------------------------------------------------

/**
 * Approximate deletion test: find how many OTHER files import this module.
 * High import count → deleting it breaks many things → high leverage / shared Interface.
 */
function runDeletionTest(mod: DiscoveredModule, rootDir: string): string {
  const modBasename = path.basename(mod.relPath).replace(/\.[^.]+$/, "");
  const importPattern = modBasename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  let grepOutput = "";
  try {
    grepOutput = execFileSync(
      "grep",
      [
        "-r",
        "--include=*.ts",
        "--include=*.tsx",
        "--include=*.js",
        "--include=*.jsx",
        "-l",
        importPattern,
        rootDir,
      ],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    // grep exits 1 when no matches — that's fine
  }

  const importingFiles = grepOutput
    ? grepOutput.split("\n").filter(Boolean).filter(f => f !== mod.absPath)
    : [];

  if (importingFiles.length === 0) {
    return `No other modules import this Module directly; Leverage is low — deletion-safe candidate.`;
  } else if (importingFiles.length <= 3) {
    return `${importingFiles.length} module(s) import this Interface; controlled Seam — extract and deepen before deletion.`;
  } else {
    return `${importingFiles.length} modules depend on this Interface; high Leverage — restructure Seam before any deletion.`;
  }
}

// ---------------------------------------------------------------------------
// Recommendation generator
// ---------------------------------------------------------------------------

const VOCAB_TERMS = ["Module", "Seam", "Depth", "Adapter", "Leverage", "Locality", "Interface", "Tracer Bullet", "Vertical Slice"];

function generateRecommendation(
  mod: DiscoveredModule,
  depthBefore: number,
  depthAfter: number
): string {
  const depthGain = depthAfter - depthBefore;

  if (depthGain <= 0.05) {
    // Already deep enough; recommend a Locality improvement
    return `Module '${mod.name}' is already reasonably deep (Depth=${depthBefore.toFixed(2)}). Consider improving Locality by co-locating helpers that are currently spread across sibling files. Seam is stable.`;
  }

  if (mod.exportCount > 8) {
    return `Module '${mod.name}' has ${mod.exportCount} exports — a wide Interface that dilutes Depth (${depthBefore.toFixed(2)}). Extract a focused sub-Module per Seam boundary; target Depth ≥${depthAfter.toFixed(2)} by hiding ${Math.ceil(mod.exportCount * 0.4)} exports behind an Adapter.`;
  }

  if (mod.lineCount < 50) {
    return `Module '${mod.name}' is thin (${mod.lineCount} lines). Merge into its caller to improve Locality, or absorb the Adapter pattern it implements into the Module above it. Depth will increase from ${depthBefore.toFixed(2)} to ~${depthAfter.toFixed(2)}.`;
  }

  return `Module '${mod.name}' currently has Depth=${depthBefore.toFixed(2)}. Consolidate ${mod.exportCount} exports behind one primary Seam; push implementation details below the Interface. Expected Depth after refactor: ${depthAfter.toFixed(2)}. High Leverage — callers need no changes.`;
}

function ensureVocab(recommendation: string): string {
  const hasVocab = VOCAB_TERMS.some(term => recommendation.includes(term));
  if (hasVocab) return recommendation;
  return `[Depth] ${recommendation}`;
}

// ---------------------------------------------------------------------------
// Diagram artifact writers
// ---------------------------------------------------------------------------

function writeDiagramArtifacts(
  mod: DiscoveredModule,
  depthBefore: number,
  depthAfter: number,
  reportsDir: string
): { beforeDiagram: string; afterDiagram: string } {
  fs.mkdirSync(path.join(reportsDir, "diagrams"), { recursive: true });

  const safeName = mod.name.replace(/[^a-zA-Z0-9-_]/g, "-");
  const beforePath = path.join(reportsDir, "diagrams", `before-${safeName}.toon`);
  const afterPath = path.join(reportsDir, "diagrams", `after-${safeName}.toon`);

  const beforeContent = `module: ${mod.name}
relPath: ${mod.relPath}
depth: ${depthBefore.toFixed(3)}
exportCount: ${mod.exportCount}
lineCount: ${mod.lineCount}
shape: shallow
note: Interface surface is wide relative to behaviour volume
`;

  const afterContent = `module: ${mod.name}
relPath: ${mod.relPath}
depth: ${depthAfter.toFixed(3)}
exportCount: ${Math.max(1, Math.floor(mod.exportCount * 0.5))}
lineCount: ${mod.lineCount}
shape: deep
note: After consolidating exports behind primary Seam — hidden complexity, narrow Interface
`;

  fs.writeFileSync(beforePath + ".tmp", beforeContent, "utf-8");
  fs.renameSync(beforePath + ".tmp", beforePath);

  fs.writeFileSync(afterPath + ".tmp", afterContent, "utf-8");
  fs.renameSync(afterPath + ".tmp", afterPath);

  return { beforeDiagram: beforePath, afterDiagram: afterPath };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { target, limit } = args;

  if (!fs.existsSync(target)) {
    process.stderr.write(`explore-runner: target directory not found: ${target}\n`);
    process.exit(1);
  }

  const reportsDir = path.join(process.cwd(), ".plan-execution", "reports");
  fs.mkdirSync(reportsDir, { recursive: true });

  const modules = discoverModules(target, limit);

  if (modules.length === 0) {
    process.stderr.write(`explore-runner: no eligible modules found under ${target}\n`);
    process.exit(2);
  }

  let hasError = false;

  for (const mod of modules) {
    try {
      const depthBefore = computeDepthScore(mod.lineCount, mod.exportCount);
      // depthAfter models the improved score after applying the recommendation
      const depthAfter = Math.min(0.95, depthBefore + 0.25);

      const deletionTestResult = runDeletionTest(mod, target);
      const rawRecommendation = generateRecommendation(mod, depthBefore, depthAfter);
      const recommendation = ensureVocab(rawRecommendation);

      const { beforeDiagram, afterDiagram } = writeDiagramArtifacts(
        mod,
        depthBefore,
        depthAfter,
        reportsDir
      );

      const row = {
        moduleName: mod.name,
        depthBefore: parseFloat(depthBefore.toFixed(3)),
        depthAfter: parseFloat(depthAfter.toFixed(3)),
        deletionTestResult,
        recommendation,
        beforeDiagram,
        afterDiagram,
      };

      process.stdout.write(JSON.stringify(row) + "\n");
    } catch (err) {
      process.stderr.write(`explore-runner: error processing ${mod.relPath}: ${err}\n`);
      hasError = true;
    }
  }

  process.exit(hasError ? 2 : 0);
}
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
