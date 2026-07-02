/**
 * scripts/ci/changed-files-vitest.ts — CI check `changed-file-tests` (frozen
 * name, see protocols/ci-gates.contract.md).
 *
 * Maps the PR diff to test files and runs only those under vitest. Mapping is
 * deterministic, in order:
 *   1. a changed file that is itself a test file runs directly
 *   2. sibling convention        {dir}/{name}.ts        → {dir}/{name}.test.ts
 *   3. __tests__ convention      {dir}/{name}.ts        → {dir}/__tests__/{name}.test.ts
 *   4. tests/ mirror             scripts/ci/{name}.ts   → tests/ci/{name}.test.ts,
 *                                {top}/…/{name}.ts      → tests/{top}/{name}.test.ts
 *   5. content scan — any test file that references the changed file's
 *      basename (e.g. a behavioral test spawning `scripts/ci/check-hook-drift.ts`)
 * Changes to test infrastructure (vitest.config.ts, package.json, bun.lock)
 * escalate to the full suite; the nightly tier remains the backstop for
 * anything this mapping misses (C-01).
 *
 * Flags:
 *   --base <ref>    diff base (default origin/main)
 *   --dry-run       print the resolved test list only (TOON), do not run
 *   --files <csv>   explicit changed-file list — bypasses git (tests/local use)
 *   --root <dir>    repo root (default cwd)
 *
 * Exit codes: 0 all resolved tests pass (or none resolved); 1 test failure;
 * 3 git diff unavailable.
 *
 * Node-runnable (erasable TS only); also runs under bun. No lib/ runtime
 * imports (Phase 2a/2b land those in this same wave).
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

interface CliOptions {
  base: string;
  dryRun: boolean;
  files: string[] | null;
  root: string;
}

/** Files whose change invalidates the mapping itself → run the full suite. */
const FULL_SUITE_TRIGGERS = new Set(["vitest.config.ts", "package.json", "bun.lock"]);

/** Directories scanned for test files during the content-scan pass. */
const TEST_SCAN_ROOTS = ["tests", "test", "hooks/__tests__", "scripts/lib/__tests__"];

const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|mjs|cjs)$/;
const SOURCE_FILE_RE = /\.(ts|tsx|js|mjs|cjs)$/;

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    base: "origin/main",
    dryRun: false,
    files: null,
    root: process.cwd(),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--base") opts.base = argv[++i] ?? opts.base;
    else if (a === "--files") {
      opts.files = (argv[++i] ?? "")
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean);
    } else if (a === "--root") opts.root = argv[++i] ?? opts.root;
    else {
      process.stderr.write(`error: CHANGED_FILES_USAGE\nmessage: unknown flag ${a}\n`);
      process.exit(1);
    }
  }
  return opts;
}

function changedFilesFromGit(root: string, base: string): string[] {
  const attempts: string[][] = [
    ["diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`],
    ["diff", "--name-only", "--diff-filter=ACMR", base],
  ];
  let lastError: Error | null = null;
  for (const args of attempts) {
    try {
      const out = execFileSync("git", args, { cwd: root, encoding: "utf8" });
      return out.split("\n").map((l) => l.trim()).filter(Boolean);
    } catch (err) {
      lastError = err as Error;
    }
  }
  process.stderr.write(
    `error: GIT_DIFF_UNAVAILABLE\nbase: ${base}\nmessage: ${lastError?.message ?? "git diff failed"}\n`,
  );
  process.exit(3);
}

function walkTestFiles(root: string): string[] {
  const found: string[] = [];
  const visit = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      const stats = statSync(full);
      if (stats.isDirectory()) visit(full);
      else if (TEST_FILE_RE.test(entry)) found.push(relative(root, full));
    }
  };
  for (const scanRoot of TEST_SCAN_ROOTS) {
    const abs = resolve(root, scanRoot);
    if (existsSync(abs)) visit(abs);
  }
  return found;
}

interface MappingResult {
  mode: "mapped" | "full-suite" | "no-tests";
  resolvedTests: string[];
  unmapped: string[];
}

/** Pure mapping: changed repo-relative paths → repo-relative test files.
 * NOT exported: this script runs main() unconditionally (note 047 — argv
 * entry guards fail open), so it must only be exercised as a subprocess. */
function mapChangedFilesToTests(root: string, changedFiles: string[]): MappingResult {
  if (changedFiles.some((f) => FULL_SUITE_TRIGGERS.has(f))) {
    return { mode: "full-suite", resolvedTests: [], unmapped: [] };
  }

  const allTestFiles = walkTestFiles(root);
  const testContents = new Map<string, string>();
  const contentOf = (testFile: string): string => {
    let content = testContents.get(testFile);
    if (content === undefined) {
      try {
        content = readFileSync(resolve(root, testFile), "utf8");
      } catch {
        content = "";
      }
      testContents.set(testFile, content);
    }
    return content;
  };

  const resolved = new Set<string>();
  const unmapped: string[] = [];

  for (const changed of changedFiles) {
    if (TEST_FILE_RE.test(changed)) {
      if (existsSync(resolve(root, changed))) resolved.add(changed);
      continue;
    }
    if (!SOURCE_FILE_RE.test(changed)) continue; // non-code files carry no tests

    const dir = dirname(changed);
    const name = basename(changed).replace(SOURCE_FILE_RE, "");
    const candidates = [
      join(dir, `${name}.test.ts`),
      join(dir, "__tests__", `${name}.test.ts`),
    ];
    const segments = changed.split("/");
    if (segments.length >= 2) {
      const top = segments[0];
      const rest = segments.slice(1, -1);
      // scripts/ci/x.ts → tests/ci/x.test.ts (scripts/ prefix stripped) …
      if (top === "scripts" && rest.length > 0) {
        candidates.push(join("tests", ...rest, `${name}.test.ts`));
      }
      // … and the direct mirror {top}/…/x.ts → tests/{top}/…/x.test.ts, tests/{top}/x.test.ts
      candidates.push(join("tests", top, ...rest, `${name}.test.ts`));
      candidates.push(join("tests", top, `${name}.test.ts`));
    }

    let mappedAny = false;
    for (const candidate of candidates) {
      if (existsSync(resolve(root, candidate))) {
        resolved.add(candidate.split("\\").join("/"));
        mappedAny = true;
      }
    }

    // Content scan: behavioral tests reference the file they spawn/import.
    const needle = basename(changed);
    for (const testFile of allTestFiles) {
      if (contentOf(testFile).includes(needle)) {
        resolved.add(testFile.split("\\").join("/"));
        mappedAny = true;
      }
    }

    if (!mappedAny) unmapped.push(changed);
  }

  if (resolved.size === 0) {
    return { mode: "no-tests", resolvedTests: [], unmapped };
  }
  return { mode: "mapped", resolvedTests: [...resolved].sort(), unmapped };
}

function renderToon(opts: CliOptions, changedFiles: string[], result: MappingResult): string {
  const inline = (items: string[]): string => (items.length ? ` ${items.join(", ")}` : "");
  return [
    "changedFilesVitest:",
    `  base: ${opts.base}`,
    `  mode: ${result.mode}`,
    `changedFiles[${changedFiles.length}]:${inline(changedFiles)}`,
    `resolvedTests[${result.resolvedTests.length}]:${inline(result.resolvedTests)}`,
    `unmapped[${result.unmapped.length}]:${inline(result.unmapped)}`,
  ].join("\n") + "\n";
}

/** Prefer bunx, fall back to npx (CLAUDE.md toolchain convention). */
function resolveRunner(): [string, string[]] {
  try {
    execFileSync("bunx", ["--version"], { stdio: "ignore" });
    return ["bunx", ["vitest", "run"]];
  } catch {
    return ["npx", ["--yes", "vitest", "run"]];
  }
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const changedFiles = opts.files ?? changedFilesFromGit(opts.root, opts.base);
  const result = mapChangedFilesToTests(opts.root, changedFiles);

  process.stdout.write(renderToon(opts, changedFiles, result));
  if (opts.dryRun) process.exit(0);

  if (result.mode === "no-tests") {
    process.stdout.write("note: no tests resolved for this diff — nightly full-suite is the backstop\n");
    process.exit(0);
  }

  const [runner, baseArgs] = resolveRunner();
  const args = result.mode === "full-suite" ? baseArgs : [...baseArgs, ...result.resolvedTests];
  try {
    execFileSync(runner, args, { cwd: opts.root, stdio: "inherit" });
  } catch {
    process.stderr.write(`error: CHANGED_FILE_TESTS_FAILED\nmode: ${result.mode}\n`);
    process.exit(1);
  }
  process.exit(0);
}

main();
