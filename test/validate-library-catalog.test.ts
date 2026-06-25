/**
 * Fixture-driven tests for scripts/validate-library-catalog.js.
 *
 * Exercises v4 validator behaviours: typed-object kit includes, protocol/infrastructure
 * requires prefixes, path-traversal blocking, malformed includes, and unknown prefix rejection.
 *
 * Each test writes a minimal valid catalog wrapper around a fixture YAML string
 * to a temp dir and runs the validator via execSync / spawnSync.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const VALIDATOR = path.resolve(__dirname, "..", "scripts", "validate-library-catalog.js");

/**
 * Build a minimal valid catalog YAML with the given library and kits content
 * injected into the appropriate sections. The fixture catalog writes its
 * source files relative to scratchDir so the existence check passes.
 */
function buildCatalog(opts: {
  skills?: string;
  agents?: string;
  prompts?: string;
  protocols?: string;
  infrastructure?: string;
  kits?: string;
}): string {
  const parts = [
    "catalog_version: 4",
    "repo: https://github.com/example/loom-ai",
    "library:",
  ];

  if (opts.skills) {
    parts.push("  skills:", opts.skills);
  }
  if (opts.agents) {
    parts.push("  agents:", opts.agents);
  }
  if (opts.prompts) {
    parts.push("  prompts:", opts.prompts);
  }
  if (opts.protocols) {
    parts.push("  protocols:", opts.protocols);
  }
  if (opts.infrastructure) {
    parts.push("  infrastructure:", opts.infrastructure);
  }
  if (opts.kits) {
    parts.push("kits:", opts.kits);
  }

  return parts.join("\n") + "\n";
}

/** Run the validator against a catalog written to a temp file. */
function runValidator(
  catalogContent: string,
  scratchDir: string
): { code: number; stdout: string; stderr: string } {
  const catalogPath = path.join(scratchDir, "library.yaml");
  fs.writeFileSync(catalogPath, catalogContent, "utf-8");

  const result = spawnSync("node", [VALIDATOR], {
    cwd: scratchDir,
    encoding: "utf-8",
    env: {
      ...process.env,
      // Override the validator's catalog path detection by running it from
      // scratchDir — the validator resolves CATALOG_PATH relative to __dirname
      // (scripts/). We pass the path directly as an environment variable used
      // in a wrapper approach, OR we invoke with the path as CLI arg if supported.
      // Since the validator hard-codes the path via __dirname, we instead create
      // the expected directory structure so path.resolve works:
      //   REPO_ROOT = dirname(dirname(VALIDATOR)) = loom-ai/
      //   CATALOG_PATH = REPO_ROOT/skills/library.yaml
      // The scratchDir IS our fake repo root for this purpose.
    },
  });

  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/**
 * Run the validator with a catalog file at the real expected path
 * (scripts/ sibling of skills/library.yaml).
 */
function runValidatorInDir(
  catalogContent: string,
  fakeRepoRoot: string
): { code: number; stdout: string; stderr: string } {
  // The validator resolves: CATALOG_PATH = path.resolve(__dirname, "..", "skills", "library.yaml")
  // where __dirname is the scripts/ dir inside fakeRepoRoot.
  // So we need: fakeRepoRoot/scripts/validate-library-catalog.js (symlink or copy)
  //           + fakeRepoRoot/skills/library.yaml
  const catalogPath = path.join(fakeRepoRoot, "skills", "library.yaml");
  fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
  fs.writeFileSync(catalogPath, catalogContent, "utf-8");

  // Copy the real validator into fakeRepoRoot/scripts/ so __dirname resolves correctly.
  const fakeScriptsDir = path.join(fakeRepoRoot, "scripts");
  fs.mkdirSync(fakeScriptsDir, { recursive: true });
  const fakeValidatorPath = path.join(fakeScriptsDir, "validate-library-catalog.js");
  fs.copyFileSync(VALIDATOR, fakeValidatorPath);

  const result = spawnSync("node", [fakeValidatorPath], {
    cwd: fakeRepoRoot,
    encoding: "utf-8",
  });

  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

// ---------------------------------------------------------------------------

describe("validate-library-catalog.js — v4 behaviour", () => {
  let scratchDir: string;

  beforeEach(() => {
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-validator-test-"));
  });

  afterEach(() => {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Test 1: Accepts protocol: and infrastructure: prefixes in requires:
  // -------------------------------------------------------------------------

  it("accepts protocol: and infrastructure: prefixes in requires: (exit 0)", () => {
    // Create the source files the catalog entries point to.
    const scriptsDir = path.join(scratchDir, "scripts");
    const protocolsDir = path.join(scratchDir, "protocols");
    const hooksDir = path.join(scratchDir, "hooks");
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.mkdirSync(protocolsDir, { recursive: true });
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(protocolsDir, "execution-protocols.md"), "# proto\n");
    fs.writeFileSync(path.join(hooksDir, "some-hook.sh"), "#!/bin/sh\n");
    fs.writeFileSync(path.join(protocolsDir, "my-agent.md"), "# agent\n");

    const catalog = buildCatalog({
      protocols: [
        "    - name: execution-protocols",
        "      description: Execution protocol spec",
        "      source: protocols/execution-protocols.md",
      ].join("\n"),
      infrastructure: [
        "    - name: some-hook",
        "      description: A hook script",
        "      source: hooks/some-hook.sh",
        "      target: ~/.claude/some-hook.sh",
      ].join("\n"),
      agents: [
        "    - name: my-agent",
        "      description: An agent that uses protocols",
        "      source: protocols/my-agent.md",
        "      requires: [protocol:execution-protocols, infrastructure:some-hook]",
      ].join("\n"),
    });

    const result = runValidatorInDir(catalog, scratchDir);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("OK");
  });

  // -------------------------------------------------------------------------
  // Test 2: Walks typed-object kit.includes (exit 0)
  // -------------------------------------------------------------------------

  it("walks typed-object kit includes and exits 0 when the entry exists", () => {
    const skillsDir = path.join(scratchDir, "skills", "foo");
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(path.join(skillsDir, "SKILL.md"), "# skill\n");

    const catalog = buildCatalog({
      skills: [
        "    - name: foo",
        "      description: A test skill",
        "      source: skills/foo/SKILL.md",
      ].join("\n"),
      kits: [
        "  - name: test-kit",
        "    description: A test kit",
        "    version: 1.0.0",
        "    includes:",
        "      - type: skill",
        "        name: foo",
      ].join("\n"),
    });

    const result = runValidatorInDir(catalog, scratchDir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("OK");
  });

  // -------------------------------------------------------------------------
  // Test 3: Rejects malformed typed include (missing name) → warning
  // -------------------------------------------------------------------------

  it("emits a warning (not error) for a malformed typed include missing name, exits 0", () => {
    // The validator emits a warning for malformed includes (not an error),
    // so exit code is still 0 but stderr contains the warning.
    const skillsDir = path.join(scratchDir, "skills", "foo");
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(path.join(skillsDir, "SKILL.md"), "# skill\n");

    const catalog = buildCatalog({
      skills: [
        "    - name: foo",
        "      description: A test skill",
        "      source: skills/foo/SKILL.md",
      ].join("\n"),
      kits: [
        "  - name: test-kit",
        "    description: A test kit",
        "    version: 1.0.0",
        "    includes:",
        "      - type: skill",
      ].join("\n"),
    });

    const result = runValidatorInDir(catalog, scratchDir);
    // Malformed includes produce a warning, not an error — exit is still 0.
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("malformed");
  });

  // -------------------------------------------------------------------------
  // Test 4: Rejects unknown requires: prefix → exit 1
  // -------------------------------------------------------------------------

  it("rejects unknown requires: prefix foo:bar and exits 1 with error about valid prefixes", () => {
    const agentsDir = path.join(scratchDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "my-agent.md"), "# agent\n");

    const catalog = buildCatalog({
      agents: [
        "    - name: my-agent",
        "      description: An agent with bad requires",
        "      source: agents/my-agent.md",
        "      requires: [foo:bar]",
      ].join("\n"),
    });

    const result = runValidatorInDir(catalog, scratchDir);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/skill.*agent.*prompt.*protocol.*infrastructure|must use/i);
  });

  // -------------------------------------------------------------------------
  // Test 5: Rejects path-traversal source: field → exit 1 with traversal message
  // -------------------------------------------------------------------------

  it("rejects path-traversal source field and emits traversal-blocked error, exits 1", () => {
    const catalog = buildCatalog({
      agents: [
        "    - name: evil-agent",
        "      description: Tries to escape the repo",
        "      source: ../../etc/passwd",
      ].join("\n"),
    });

    const result = runValidatorInDir(catalog, scratchDir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("path traversal blocked");
  });
});
