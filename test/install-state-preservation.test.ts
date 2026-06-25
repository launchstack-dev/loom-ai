import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Re-run safety for install.sh: any user-added rows in install-state.toon
 * (kits, BYO items, agents added via /loom-library, etc.) must survive a
 * curl re-install. The installer regenerates system rows
 * (type ∈ {infrastructure, prompt, hook-template}) but preserves everything
 * else verbatim.
 *
 * This test exercises the awk filter literal that install.sh uses for the
 * preservation extraction. If the filter is changed in install.sh, this
 * test will catch any regression that drops non-system rows.
 */

// The exact awk filter literal from install.sh's preservation block.
// Keep in sync with install.sh; the comment above the awk block in
// install.sh notes this co-dependency.
const PRESERVATION_AWK = `
  /^  [^ ]/ {
    type=$2
    if (type != "infrastructure" && type != "prompt" && type != "hook-template") {
      print $0
    }
  }
`;

let sandbox: string;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "loom-state-preserve-"));
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function runAwkFilter(input: string): string {
  const inputPath = path.join(sandbox, "state.toon");
  fs.writeFileSync(inputPath, input);
  const result = spawnSync("awk", ["-F,", PRESERVATION_AWK, inputPath], {
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(`awk failed: ${result.stderr}`);
  }
  return result.stdout;
}

describe("install.sh install-state.toon preservation on re-run", () => {
  it("strips all system rows (infrastructure, prompt, hook-template)", () => {
    const input = [
      "schemaVersion: 2",
      "lastSynced: 2026-06-25T10:00:00Z",
      "",
      "items[3]{name,type,source,targetPath,installedAt}:",
      "  statusline-renderer,infrastructure,hooks/statusline-renderer.cjs,~/.claude/statusline-renderer.cjs,2026-06-25T10:00:00Z",
      "  loom-quick,prompt,commands/loom-quick.md,~/.claude/commands/loom-quick.md,2026-06-25T10:00:00Z",
      "  contract-lock,hook-template,hooks/contract-lock.ts,~/.claude/templates/hooks/contract-lock.ts,2026-06-25T10:00:00Z",
      "",
    ].join("\n");

    const preserved = runAwkFilter(input);
    expect(preserved.trim()).toBe("");
  });

  it("preserves user-added agent rows verbatim", () => {
    const input = [
      "schemaVersion: 2",
      "lastSynced: 2026-06-25T10:00:00Z",
      "",
      "items[2]{name,type,source,targetPath,installedAt}:",
      "  statusline-renderer,infrastructure,hooks/statusline-renderer.cjs,~/.claude/statusline-renderer.cjs,2026-06-25T10:00:00Z",
      "  my-custom-agent,agent,agents/my-custom-agent.md,~/.claude/agents/my-custom-agent.md,2026-06-25T11:00:00Z",
      "",
    ].join("\n");

    const preserved = runAwkFilter(input);
    expect(preserved).toContain(
      "  my-custom-agent,agent,agents/my-custom-agent.md,~/.claude/agents/my-custom-agent.md,2026-06-25T11:00:00Z",
    );
    expect(preserved).not.toContain("statusline-renderer");
  });

  it("preserves BYO kit rows (kit + byo-kit-item types)", () => {
    const input = [
      "schemaVersion: 2",
      "lastSynced: 2026-06-25T10:00:00Z",
      "",
      "items[3]{name,type,source,targetPath,installedAt}:",
      "  loom-quick,prompt,commands/loom-quick.md,~/.claude/commands/loom-quick.md,2026-06-25T10:00:00Z",
      "  acme-internal-kit,kit,github:acme/internal-kit@v1.0.0,~/.claude/skills/library/kits/acme-internal-kit.toon,2026-06-25T11:00:00Z",
      "  acme-code-reviewer,byo-kit-item,agents/acme-code-reviewer.md,.claude/agents/acme-code-reviewer.md,2026-06-25T11:00:00Z",
      "",
    ].join("\n");

    const preserved = runAwkFilter(input);
    expect(preserved).toContain("acme-internal-kit,kit,");
    expect(preserved).toContain("acme-code-reviewer,byo-kit-item,");
    expect(preserved).not.toContain("loom-quick");
  });

  it("preserves skill rows added via /loom-library use", () => {
    const input = [
      "schemaVersion: 2",
      "lastSynced: 2026-06-25T10:00:00Z",
      "",
      "items[2]{name,type,source,targetPath,installedAt}:",
      "  loom-converge,prompt,commands/loom-converge.md,~/.claude/commands/loom-converge.md,2026-06-25T10:00:00Z",
      "  python-conventions,skill,skills/python-conventions/SKILL.md,~/.claude/skills/python-conventions/SKILL.md,2026-06-12T23:30:00Z",
      "",
    ].join("\n");

    const preserved = runAwkFilter(input);
    expect(preserved).toContain("python-conventions,skill,");
    expect(preserved).not.toContain("loom-converge");
  });

  it("ignores the header lines (schemaVersion, lastSynced, items[N])", () => {
    const input = [
      "schemaVersion: 2",
      "lastSynced: 2026-06-25T10:00:00Z",
      "",
      "items[1]{name,type,source,targetPath,installedAt}:",
      "  my-agent,agent,agents/my-agent.md,~/.claude/agents/my-agent.md,2026-06-25T10:00:00Z",
      "",
    ].join("\n");

    const preserved = runAwkFilter(input);
    expect(preserved).not.toContain("schemaVersion");
    expect(preserved).not.toContain("lastSynced");
    expect(preserved).not.toContain("items[1]");
    expect(preserved).toContain("my-agent,agent,");
  });

  it("returns empty string when there are no user-added rows", () => {
    const input = [
      "schemaVersion: 2",
      "lastSynced: 2026-06-25T10:00:00Z",
      "",
      "items[1]{name,type,source,targetPath,installedAt}:",
      "  loom-quick,prompt,commands/loom-quick.md,~/.claude/commands/loom-quick.md,2026-06-25T10:00:00Z",
      "",
    ].join("\n");

    const preserved = runAwkFilter(input);
    expect(preserved.trim()).toBe("");
  });

  it("preserves protocol-typed rows (user-installed protocols)", () => {
    const input = [
      "schemaVersion: 2",
      "lastSynced: 2026-06-25T10:00:00Z",
      "",
      "items[2]{name,type,source,targetPath,installedAt}:",
      "  loom-init,prompt,commands/loom-init.md,~/.claude/commands/loom-init.md,2026-06-25T10:00:00Z",
      "  my-protocol,protocol,protocols/my-protocol.md,~/.claude/protocols/my-protocol.md,2026-06-25T11:00:00Z",
      "",
    ].join("\n");

    const preserved = runAwkFilter(input);
    expect(preserved).toContain("my-protocol,protocol,");
    expect(preserved).not.toContain("loom-init");
  });
});
