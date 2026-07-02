/**
 * tests/scripts/loom-health-exec.test.ts
 *
 * PLAN-exceed-gstack Phase 4 (F-04, defect 2, site 1) — S-01:
 * Malicious filename does not trigger shell injection.
 *
 * Given: loom-health scans shell files whose names contain shell
 *        metacharacters (`;`, `$(...)`, backticks, single quotes).
 * When:  The shellcheck invocation runs via execFileSync (argv array).
 * Then:  The metacharacters MUST be passed as literal arguments, and
 *        no injected subcommand MUST execute.
 *
 * Strategy (behavioral, no tautologies):
 *   - Build a temp "repo" containing .sh files with adversarial names that
 *     would have broken out of the old `'${f}'` shell-quoted interpolation.
 *   - Put a stub `shellcheck` on PATH that records its exact argv to a file,
 *     so we can observe what the real child process received.
 *   - Run scripts/loom-health.ts as a subprocess with cwd = temp repo.
 *   - Assert: no injection marker files were created, every adversarial
 *     filename arrived as one literal argv entry, and the TOON output still
 *     scores the shell component (behavior preserved).
 *
 * Run: bunx vitest run tests/scripts/loom-health-exec.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";

const SCRIPT = resolve(process.cwd(), "scripts/loom-health.ts");

// Adversarial filenames. The first would have escaped the old single-quote
// wrapping (`'${f}'`) and run `touch INJECTED_SEMI`; the others carry
// command-substitution and backtick payloads.
const EVIL_SEMI = "a'; touch INJECTED_SEMI; 'b.sh";
const EVIL_SUBSHELL = "c$(touch INJECTED_SUB).sh";
const EVIL_BACKTICK = "d`touch INJECTED_TICK`.sh";
const EVIL_NAMES = [EVIL_SEMI, EVIL_SUBSHELL, EVIL_BACKTICK];

let sandbox: string; // parent temp dir
let repo: string; // fake project scanned by loom-health
let bin: string; // dir holding the stub shellcheck
let argsOut: string; // file the stub writes its argv into
let result: ReturnType<typeof spawnSync>;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), "loom-health-exec-"));
  repo = join(sandbox, "repo");
  bin = join(sandbox, "bin");
  argsOut = join(sandbox, "shellcheck-args.txt");
  mkdirSync(repo, { recursive: true });
  mkdirSync(bin, { recursive: true });

  for (const name of EVIL_NAMES) {
    writeFileSync(join(repo, name), "#!/bin/sh\necho ok\n");
  }

  // Stub shellcheck: records each argv entry on its own line, exits clean.
  // This makes the test deterministic (no real shellcheck needed) and lets
  // us prove the filenames crossed the process boundary as literal argv.
  const stub = join(bin, "shellcheck");
  writeFileSync(
    stub,
    '#!/bin/sh\nfor a in "$@"; do printf \'%s\\n\' "$a" >> "$SHELLCHECK_ARGS_OUT"; done\nexit 0\n'
  );
  chmodSync(stub, 0o755);

  result = spawnSync("bun", [SCRIPT], {
    cwd: repo,
    encoding: "utf-8",
    timeout: 60_000,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      SHELLCHECK_ARGS_OUT: argsOut,
      // Keep git from discovering an enclosing repo above the sandbox, so
      // the temp dir is treated as a standalone (non-git) project.
      GIT_CEILING_DIRECTORIES: dirname(sandbox),
    },
  });
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("loom-health shellcheck invocation (F-04 site 1)", () => {
  it("runs to completion on metacharacter filenames without crashing", () => {
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
  });

  it("does not execute injected commands from adversarial filenames", () => {
    // Old code: shellcheck 'a'; touch INJECTED_SEMI; 'b.sh' → marker created.
    // New code: no shell exists to interpret the payloads anywhere.
    const markers = readdirSync(repo).filter((f) => f.startsWith("INJECTED"));
    expect(markers).toEqual([]);
    expect(existsSync(join(sandbox, "INJECTED_SEMI"))).toBe(false);
    expect(existsSync(join(process.cwd(), "INJECTED_SEMI"))).toBe(false);
  });

  it("passes each adversarial filename to shellcheck as one literal argv entry", () => {
    expect(existsSync(argsOut)).toBe(true);
    const argv = readFileSync(argsOut, "utf-8")
      .split("\n")
      .filter((l) => l.length > 0);
    // First arg is the `--` option terminator, guarding filenames that start
    // with `-` from being parsed as shellcheck flags.
    expect(argv[0]).toBe("--");
    const fileArgs = argv.slice(1);
    for (const name of EVIL_NAMES) {
      // find-fallback paths carry a "./" prefix; the name itself must be
      // byte-for-byte intact, quotes and payload included.
      const hit = fileArgs.filter((a) => a === name || a === `./${name}`);
      expect(hit, `expected literal argv for ${name}, got: ${fileArgs.join(" | ")}`).toHaveLength(1);
    }
    // Nothing was split on the metacharacters: argv count matches file count.
    expect(fileArgs).toHaveLength(EVIL_NAMES.length);
  });

  it("preserves TOON output and scores the shell component", () => {
    const stdout = String(result.stdout);
    expect(stdout).toMatch(/^loomHealthScore: \d+(\.\d+)?$/m);
    expect(stdout).toMatch(/breakdown\[\d+\]\{tool,rawScore,weightedContribution\}:/);
    // Stub shellcheck reported zero issues → shell scored 10.0, not skipped.
    expect(stdout).toMatch(/^ {2}shell,10\.0,/m);
  });

  it("source no longer contains any execSync invocation (regression tripwire)", () => {
    const src = readFileSync(SCRIPT, "utf-8");
    expect(src).not.toMatch(/\bexecSync\s*\(/);
    expect(src).toMatch(/\bexecFileSync\s*\(/);
  });
});
