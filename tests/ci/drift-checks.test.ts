/**
 * tests/ci/drift-checks.test.ts — behavioral tests for the Phase 1 CI check
 * scripts (F-01, contract protocols/ci-gates.contract.md):
 *
 *   scripts/ci/check-hook-drift.ts       (check name: hook-drift)
 *   scripts/ci/check-docs-drift.ts       (check name: docs-drift)
 *   scripts/ci/check-library-catalog.ts  (check name: library-catalog)
 *
 * Every test spawns the script as a subprocess (the scripts run main()
 * unconditionally — note 047) and asserts on exit code + output. Adversarial
 * fixtures are built in temp dirs: deliberately divergent hook sources, a
 * deliberately stale generated-docs block, a deliberately broken catalog.
 *
 * Run: bunx vitest run tests/ci/drift-checks.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const HOOK_DRIFT = join(REPO_ROOT, "scripts/ci/check-hook-drift.ts");
const DOCS_DRIFT = join(REPO_ROOT, "scripts/ci/check-docs-drift.ts");
const CATALOG = join(REPO_ROOT, "scripts/ci/check-library-catalog.ts");

/** Prefer bun (repo toolchain); node ≥22.6 also runs these scripts directly. */
const RUNTIME: string = (() => {
  try {
    execFileSync("bun", ["--version"], { stdio: "ignore" });
    return "bun";
  } catch {
    return process.execPath;
  }
})();

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(script: string, args: string[], cwd: string = REPO_ROOT): RunResult {
  const res = spawnSync(RUNTIME, [script, ...args], { cwd, encoding: "utf8" });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/* ── hook-drift fixtures ──────────────────────────────────────────────────── */

interface HookSpec {
  hookName: string;
  event: string;
  matcher?: string;
}

function hooksJsonDoc(specs: HookSpec[]): string {
  const hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>> = {};
  for (const spec of specs) {
    hooks[spec.event] ??= [];
    hooks[spec.event].push({
      matcher: spec.matcher ?? "",
      hooks: [{ command: `sh "$ROOT/hooks/run-hook.sh" "$ROOT/hooks/${spec.hookName}.ts"` }],
    });
  }
  return JSON.stringify({ hooks }, null, 2);
}

function manifestModule(specs: HookSpec[]): string {
  const rows = specs
    .map(
      (s) =>
        `  { hookName: ${JSON.stringify(s.hookName)}, event: ${JSON.stringify(s.event)}, matcher: ${JSON.stringify(s.matcher ?? "")}, timeoutMs: 10000 },`,
    )
    .join("\n");
  return `export const LOOM_HOOKS = [\n${rows}\n];\n`;
}

interface HookFixture {
  dir: string;
  args: string[];
  reportPath: string;
}

function makeHookFixture(
  name: string,
  settings: HookSpec[],
  hooksJson: HookSpec[],
  manifest: HookSpec[],
  hookFiles: string[],
): HookFixture {
  const dir = mkdtempSync(join(tmpdir(), `loom-hook-drift-${name}-`));
  mkdirSync(join(dir, "hooks"), { recursive: true });
  writeFileSync(join(dir, "settings.json"), hooksJsonDoc(settings));
  writeFileSync(join(dir, "hooks.json"), hooksJsonDoc(hooksJson));
  writeFileSync(join(dir, "manifest.ts"), manifestModule(manifest));
  for (const hookFile of hookFiles) {
    writeFileSync(join(dir, "hooks", `${hookFile}.ts`), "// fixture hook\n");
  }
  const reportPath = join(dir, "report", "hook-drift.toon");
  return {
    dir,
    reportPath,
    args: [
      "--settings", join(dir, "settings.json"),
      "--hooks-json", join(dir, "hooks.json"),
      "--manifest", join(dir, "manifest.ts"),
      "--hooks-dir", join(dir, "hooks"),
      "--report", reportPath,
    ],
  };
}

describe("check-hook-drift", () => {
  const tempDirs: string[] = [];
  afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  });

  const alpha: HookSpec = { hookName: "alpha", event: "PreToolUse", matcher: "Write|Edit" };
  const beta: HookSpec = { hookName: "beta", event: "PostToolUse", matcher: "Bash" };
  const gammaPre: HookSpec = { hookName: "gamma", event: "PreToolUse", matcher: "Bash" };
  const gammaPost: HookSpec = { hookName: "gamma", event: "PostToolUse", matcher: "Bash" };
  const delta: HookSpec = { hookName: "delta", event: "Stop" };

  function divergentFixture(name: string): HookFixture {
    // alpha: in all three, consistent            → none
    // beta:  missing from the manifest           → missing-source
    // gamma: event differs in the manifest       → event-mismatch
    // delta: manifest-only AND no hooks/delta.ts → dead-file
    const fixture = makeHookFixture(
      name,
      [alpha, beta, gammaPre],
      [alpha, beta, gammaPre],
      [alpha, gammaPost, delta],
      ["alpha", "beta", "gamma"],
    );
    tempDirs.push(fixture.dir);
    return fixture;
  }

  it("detects a deliberately divergent fixture and exits 1", () => {
    const fixture = divergentFixture("divergent");
    const res = run(HOOK_DRIFT, fixture.args);

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("HOOK_DRIFT_DETECTED");

    const report = readFileSync(fixture.reportPath, "utf8");
    expect(report).toMatch(/alpha,PreToolUse,Write\|Edit,settings\+hooks\.json\+manifest,true,none/);
    expect(report).toMatch(/beta,.*missing-source/);
    expect(report).toMatch(/gamma,.*event-mismatch/);
    expect(report).toMatch(/delta,.*dead-file/);
    expect(report).toContain("driftCount: 3");
    // atomic write: no .tmp residue
    expect(existsSync(`${fixture.reportPath}.tmp`)).toBe(false);
  });

  it("--warn-only reports the same drift but exits 0", () => {
    const fixture = divergentFixture("warnonly");
    const res = run(HOOK_DRIFT, [...fixture.args, "--warn-only"]);

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("HOOK_DRIFT_DETECTED");
    expect(res.stdout).toContain("warnOnly: true");
    expect(readFileSync(fixture.reportPath, "utf8")).toContain("driftCount: 3");
  });

  it("exits 0 with driftCount 0 when the three sources agree", () => {
    const fixture = makeHookFixture(
      "convergent",
      [alpha, beta],
      [alpha, beta],
      [alpha, beta],
      ["alpha", "beta"],
    );
    tempDirs.push(fixture.dir);
    const res = run(HOOK_DRIFT, fixture.args);

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("driftCount: 0");
  });

  it("treats '*' and '' matchers as equivalent (no false event-mismatch)", () => {
    const starred: HookSpec = { hookName: "alpha", event: "SessionStart", matcher: "*" };
    const bare: HookSpec = { hookName: "alpha", event: "SessionStart", matcher: "" };
    const fixture = makeHookFixture("matcher-norm", [starred], [bare], [bare], ["alpha"]);
    tempDirs.push(fixture.dir);
    const res = run(HOOK_DRIFT, fixture.args);

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("driftCount: 0");
  });

  it("exits 3 when a source is unreadable", () => {
    const fixture = divergentFixture("unreadable");
    const args = [...fixture.args];
    args[1] = join(fixture.dir, "does-not-exist.json"); // --settings value
    const res = run(HOOK_DRIFT, args);

    expect(res.status).toBe(3);
    expect(res.stderr).toContain("HOOK_DRIFT_SOURCE_UNREADABLE");
  });

  it("runs warn-only against the real repo sources without crashing", () => {
    const reportPath = join(mkdtempSync(join(tmpdir(), "loom-hook-drift-real-")), "report.toon");
    tempDirs.push(resolve(reportPath, ".."));
    const res = run(HOOK_DRIFT, ["--warn-only", "--report", reportPath]);

    // Sources are known-divergent until Phase 13 (defect 10) — warn-only must
    // still exit 0 so the Phase 1 pr-gate is not red on day one.
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("hookDriftReport:");
    expect(existsSync(reportPath)).toBe(true);
  });
});

/* ── docs-drift fixtures ──────────────────────────────────────────────────── */

const BLOCK_BEGIN = "<!-- loom:generated:commands -->";
const BLOCK_END = "<!-- /loom:generated:commands -->";

function makeDocsFixture(name: string, blockBody: string, manifestChecksumOf: string): string {
  const dir = mkdtempSync(join(tmpdir(), `loom-docs-drift-${name}-`));
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(
    join(dir, "README-fixture.md"),
    `# Fixture\n\nprose stays hand-authored\n\n${BLOCK_BEGIN}${blockBody}${BLOCK_END}\n\ntrailing prose\n`,
  );
  const checksum = createHash("sha256").update(manifestChecksumOf).digest("hex");
  writeFileSync(
    join(dir, "docs", ".generated-manifest.toon"),
    [
      "docsGenerationManifest:",
      "  generatedAt: 2026-07-01T00:00:00Z",
      "sections[1]{section,targetFile,source,checksum,drift}:",
      `  commands,README-fixture.md,commands/*.md frontmatter,${checksum},none`,
      "",
    ].join("\n"),
  );
  return dir;
}

describe("check-docs-drift", () => {
  const tempDirs: string[] = [];
  afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  });

  const cleanBody = "\n| command | description |\n|---|---|\n| /loom-plan | plans |\n";

  function argsFor(dir: string): string[] {
    return ["--check", "--manifest", join(dir, "docs/.generated-manifest.toon"), "--root", dir];
  }

  it("exits 0 when every section checksum matches", () => {
    const dir = makeDocsFixture("clean", cleanBody, cleanBody);
    tempDirs.push(dir);
    const res = run(DOCS_DRIFT, argsFor(dir));

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("staleCount: 0");
    expect(res.stdout).toContain("commands,README-fixture.md,clean");
  });

  it("exits 1 naming the stale section when the generated block was edited", () => {
    // Manifest checksum computed over DIFFERENT content than what is on disk —
    // i.e. someone hand-edited inside the markers (the drift docs-drift exists
    // to catch).
    const dir = makeDocsFixture("stale", cleanBody + "hand-edit\n", cleanBody);
    tempDirs.push(dir);
    const res = run(DOCS_DRIFT, argsFor(dir));

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("DOCS_DRIFT_DETECTED");
    expect(res.stderr).toContain("commands");
    expect(res.stdout).toContain("commands,README-fixture.md,stale");
  });

  it("--warn-only downgrades stale sections to exit 0", () => {
    const dir = makeDocsFixture("stale-warn", cleanBody + "hand-edit\n", cleanBody);
    tempDirs.push(dir);
    const res = run(DOCS_DRIFT, [...argsFor(dir), "--warn-only"]);

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("DOCS_DRIFT_DETECTED");
  });

  it("treats a missing begin/end marker as drift", () => {
    const dir = makeDocsFixture("marker", cleanBody, cleanBody);
    tempDirs.push(dir);
    writeFileSync(join(dir, "README-fixture.md"), "# Fixture with no markers at all\n");
    const res = run(DOCS_DRIFT, argsFor(dir));

    expect(res.status).toBe(1);
    expect(res.stdout).toContain("marker-missing");
  });

  it("exits 3 when the manifest is missing, 0 under --warn-only", () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-docs-drift-nomanifest-"));
    tempDirs.push(dir);
    const args = ["--check", "--manifest", join(dir, "docs/.generated-manifest.toon"), "--root", dir];

    const hard = run(DOCS_DRIFT, args);
    expect(hard.status).toBe(3);
    expect(hard.stderr).toContain("DOCS_MANIFEST_MISSING");

    const soft = run(DOCS_DRIFT, [...args, "--warn-only"]);
    expect(soft.status).toBe(0);
    expect(soft.stdout).toContain("DOCS_MANIFEST_MISSING");
  });
});

/* ── library-catalog fixtures ─────────────────────────────────────────────── */

const VALID_CATALOG = `catalog_version: 4

library:
  agents:
    - name: my-agent
      description: fixture agent
      source: agents/my-agent.md
  protocols:
    - name: my-protocol
      description: fixture protocol
      source: protocols/my-protocol.md
  skills:
    - name: my-skill
      description: fixture skill
      source: skills/my-skill/SKILL.md
      triggers:
        - "**/*.py"
  prompts:
    - name: my-prompt
      description: "fixture prompt: with a colon"
      source: commands/my-prompt.md
  infrastructure:
    - name: my-infra
      description: fixture infrastructure
      source: hooks/my-infra.ts

kits:
  - name: fixture-kit
    description: a valid kit
    version: 1.0.0
    includes:
      - my-agent
      - type: skill
        name: my-skill
`;

function writeCatalog(name: string, content: string): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), `loom-catalog-${name}-`));
  const path = join(dir, "library.yaml");
  writeFileSync(path, content);
  return { dir, path };
}

describe("check-library-catalog", () => {
  const tempDirs: string[] = [];
  afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  });

  it("exits 0 against the current skills/library.yaml (convergence target)", () => {
    const res = run(CATALOG, []);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("findings: 0");
  });

  it("accepts a well-formed fixture catalog", () => {
    const { dir, path } = writeCatalog("valid", VALID_CATALOG);
    tempDirs.push(dir);
    const res = run(CATALOG, ["--catalog", path]);
    expect(res.status).toBe(0);
  });

  it("fails a kit whose bare include resolves nowhere", () => {
    const broken = VALID_CATALOG.replace("- my-agent", "- ghost-resource");
    const { dir, path } = writeCatalog("unresolved", broken);
    tempDirs.push(dir);
    const res = run(CATALOG, ["--catalog", path]);

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("CATALOG_INVALID");
    expect(res.stdout).toContain("include-unresolved");
    expect(res.stdout).toContain("ghost-resource");
  });

  it("fails a typed include pointing at the wrong section", () => {
    const broken = VALID_CATALOG.replace(
      "- type: skill\n        name: my-skill",
      "- type: skill\n        name: my-agent",
    );
    const { dir, path } = writeCatalog("wrong-section", broken);
    tempDirs.push(dir);
    const res = run(CATALOG, ["--catalog", path]);

    expect(res.status).toBe(1);
    expect(res.stdout).toContain("include-unresolved");
    expect(res.stdout).toMatch(/type: skill.*my-agent.*not found in library\.skills/);
  });

  it("tells you to use the typed form for infrastructure-only bare includes", () => {
    const broken = VALID_CATALOG.replace("- my-agent", "- my-infra");
    const { dir, path } = writeCatalog("infra-bare", broken);
    tempDirs.push(dir);
    const res = run(CATALOG, ["--catalog", path]);

    expect(res.status).toBe(1);
    expect(res.stdout).toContain("type: infrastructure, name: my-infra");
  });

  it("fails when catalog_version is missing", () => {
    const broken = VALID_CATALOG.replace("catalog_version: 4\n", "");
    const { dir, path } = writeCatalog("no-version", broken);
    tempDirs.push(dir);
    const res = run(CATALOG, ["--catalog", path]);

    expect(res.status).toBe(1);
    expect(res.stdout).toContain("catalog_version");
  });

  it("fails a kit with an empty includes list", () => {
    const broken = VALID_CATALOG.replace(
      /includes:\n      - my-agent\n      - type: skill\n        name: my-skill\n/,
      "includes: []\n",
    );
    const { dir, path } = writeCatalog("empty-includes", broken);
    tempDirs.push(dir);
    const res = run(CATALOG, ["--catalog", path]);

    expect(res.status).toBe(1);
    expect(res.stdout).toContain("kit-includes");
  });
});
