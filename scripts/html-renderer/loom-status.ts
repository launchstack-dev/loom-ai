/**
 * scripts/html-renderer/loom-status.ts
 *
 * Plain-template HTML renderer for `loom-status` output.
 * Called by commands/loom-status.md when --html flag is set.
 *
 * Usage:
 *   bunx tsx scripts/html-renderer/loom-status.ts [--input <toon-or-text>] [--output <path>]
 *
 * Behaviour:
 *   - Reads plain-text / TOON status from stdin or --input file.
 *   - Writes an HTML file to --output path (default:
 *     .plan-execution/reports/loom-status-{ISO8601}.html).
 *   - Attempts to open the file in the OS browser via `open` / `xdg-open`.
 *   - Headless fallback: if the open shim fails (non-TTY or command not found),
 *     prints "open this in a browser: {path}" to stdout and exits 0.
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
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): {
  inputPath: string | null;
  outputPath: string | null;
} {
  let inputPath: string | null = null;
  let outputPath: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input" && argv[i + 1]) {
      inputPath = argv[++i];
    } else if (argv[i] === "--output" && argv[i + 1]) {
      outputPath = argv[++i];
    }
  }
  return { inputPath, outputPath };
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

function renderHtml(statusText: string, generatedAt: string): string {
  const escaped = escapeHtml(statusText);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Loom Status — ${escapeHtml(generatedAt)}</title>
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
  </style>
</head>
<body>
  <h1>Loom Status</h1>
  <p class="meta">Generated: ${escapeHtml(generatedAt)}</p>
  <pre>${escaped}</pre>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Open shim
// ---------------------------------------------------------------------------

/**
 * Attempt to open a file in the OS default browser.
 * Returns true on success, false on failure (headless / command not found).
 */
function tryOpen(filePath: string): boolean {
  if (process.env.LOOM_HEADLESS === "1") return false;
  const openers = ["open", "xdg-open", "start"];
  for (const opener of openers) {
    try {
      execSync(`${opener} "${filePath}"`, { stdio: "ignore", timeout: 5000 });
      return true;
    } catch {
      // try next
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  const { inputPath, outputPath } = parseArgs(args);

  // Read status text
  let statusText: string;
  if (inputPath) {
    if (!existsSync(inputPath)) {
      console.error(`[loom-status html] Input file not found: ${inputPath}`);
      process.exit(1);
    }
    statusText = readFileSync(inputPath, "utf8");
  } else {
    // Read from stdin (pipe usage)
    try {
      statusText = readFileSync("/dev/stdin", "utf8");
    } catch {
      statusText = "(no status data — pass --input <path> or pipe content)";
    }
  }

  const generatedAt = new Date().toISOString();
  const htmlContent = renderHtml(statusText, generatedAt);

  // Determine output path
  const safeDate = generatedAt.replace(/[:.]/g, "-");
  const defaultOutputPath = join(
    REPO_ROOT,
    ".plan-execution",
    "reports",
    `loom-status-${safeDate}.html`,
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
