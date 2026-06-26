/**
 * scripts/html-renderer/loom-roadmap-status.ts
 *
 * Plain-template HTML renderer for `loom-roadmap status` output.
 * Called by commands/loom-roadmap/status.md when --html flag is set.
 *
 * Usage:
 *   bunx tsx scripts/html-renderer/loom-roadmap-status.ts [--input <path>] [--output <path>] [--slug <slug>]
 *
 * Behaviour:
 *   - Reads plain-text / TOON roadmap status digest from stdin or --input file.
 *   - Writes an HTML file to --output path (default:
 *     .plan-execution/reports/loom-roadmap-status-{slug}-{ISO8601}.html).
 *   - Attempts to open the file in the OS browser via `open` / `xdg-open`.
 *   - Headless fallback: if the open shim fails, prints
 *     "open this in a browser: {path}" to stdout and exits 0.
 *   - Exit code is always 0 when the HTML file was written successfully.
 *
 * No third-party dependencies — plain Node built-ins + bun compatibility.
 */

import {
  writeFileSync,
  renameSync,
  mkdirSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tryOpen } from "./open-shim.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): {
  inputPath: string | null;
  outputPath: string | null;
  slug: string;
} {
  let inputPath: string | null = null;
  let outputPath: string | null = null;
  let slug = "ROADMAP";

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input" && argv[i + 1]) {
      inputPath = argv[++i];
    } else if (argv[i] === "--output" && argv[i + 1]) {
      outputPath = argv[++i];
    } else if (argv[i] === "--slug" && argv[i + 1]) {
      slug = argv[++i];
    }
  }
  return { inputPath, outputPath, slug };
}

// ---------------------------------------------------------------------------
// HTML template
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render the roadmap status digest as HTML.
 * Highlights ✓/⚠/✗ glyphs with colour if present.
 */
function renderHtml(statusText: string, generatedAt: string, slug: string): string {
  // Escape raw text, then re-inject coloured spans for status glyphs
  const escaped = escapeHtml(statusText)
    .replace(/✓/g, '<span class="pass">✓</span>')
    .replace(/⚠/g, '<span class="warn">⚠</span>')
    .replace(/✗/g, '<span class="fail">✗</span>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Roadmap Status — ${escapeHtml(slug)} — ${escapeHtml(generatedAt)}</title>
  <style>
    body {
      font-family: 'SFMono-Regular', 'Consolas', 'Liberation Mono', 'Menlo', monospace;
      background: #0d1117;
      color: #c9d1d9;
      margin: 0;
      padding: 2rem;
      line-height: 1.6;
    }
    h1 {
      color: #58a6ff;
      font-size: 1.25rem;
      border-bottom: 1px solid #30363d;
      padding-bottom: 0.5rem;
      margin-bottom: 1rem;
    }
    pre {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 1rem;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .meta {
      color: #8b949e;
      font-size: 0.85rem;
      margin-bottom: 1rem;
    }
    .pass { color: #3fb950; }
    .warn { color: #d29922; }
    .fail { color: #f85149; }
  </style>
</head>
<body>
  <h1>Roadmap Convergence Status — ${escapeHtml(slug)}</h1>
  <p class="meta">Generated: ${escapeHtml(generatedAt)}</p>
  <pre>${escaped}</pre>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  const { inputPath, outputPath, slug } = parseArgs(args);

  // Read status text
  let statusText: string;
  if (inputPath) {
    if (!existsSync(inputPath)) {
      console.error(
        `[loom-roadmap-status html] Input file not found: ${inputPath}`,
      );
      process.exit(1);
    }
    statusText = readFileSync(inputPath, "utf8");
  } else {
    try {
      statusText = readFileSync("/dev/stdin", "utf8");
    } catch {
      statusText =
        "(no status data — pass --input <path> or pipe content)";
    }
  }

  const generatedAt = new Date().toISOString();
  const htmlContent = renderHtml(statusText, generatedAt, slug);

  // Determine output path
  const safeDate = generatedAt.replace(/[:.]/g, "-");
  const safeSlug = slug.replace(/[^a-zA-Z0-9-_]/g, "_");
  const defaultOutputPath = join(
    REPO_ROOT,
    ".plan-execution",
    "reports",
    `loom-roadmap-status-${safeSlug}-${safeDate}.html`,
  );
  const finalOutputPath = outputPath
    ? resolve(outputPath)
    : defaultOutputPath;

  // Ensure parent dir
  mkdirSync(dirname(finalOutputPath), { recursive: true });

  // Atomic write
  const tmpPath = finalOutputPath + ".tmp";
  writeFileSync(tmpPath, htmlContent, "utf8");
  renameSync(tmpPath, finalOutputPath);

  // Try to open in browser; headless fallback if it fails
  const opened = tryOpen(finalOutputPath);
  if (!opened) {
    console.log(`open this in a browser: ${finalOutputPath}`);
  }

  // Always exit 0 when HTML file was written
  process.exit(0);
}
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
