import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runHook } from "./helpers/hook-runner.js";

let tmpDir: string;
let realTmpDir: string;
let wikiDir: string;
let pagesDir: string;

// macOS tmp paths are under /var which symlinks to /private/var. The hook
// canonicalizes file paths via fs.realpathSync, so test assertions must use the
// resolved path too — otherwise the projectRoot-resolved page-touches path will
// match while the input file_path won't.
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-wiki-impact-"));
  realTmpDir = fs.realpathSync(tmpDir);
  fs.mkdirSync(path.join(realTmpDir, ".plan-execution", "ephemeral"), {
    recursive: true,
  });
  wikiDir = path.join(realTmpDir, ".loom", "wiki");
  pagesDir = path.join(wikiDir, "pages");
  fs.mkdirSync(pagesDir, { recursive: true });
  // Minimal index.toon — impact-warner only reads it for summary lookups.
  fs.writeFileSync(
    path.join(wikiDir, "index.toon"),
    `schemaVersion: 2\npageCount: 0\n`,
    "utf-8"
  );
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFlowPage(pageId: string, touches: string[]) {
  const rows = touches
    .map((f, i) => `  ${i + 1},step-${i + 1},user,${f},ok,,`)
    .join("\n");
  const body =
    `pageId: ${pageId}\ntitle: ${pageId}\ncategory: flow\n` +
    `steps[${touches.length}]{order,name,actor,touches,outcome,nextOnFail,errorExits}:\n` +
    rows +
    "\n";
  fs.writeFileSync(path.join(pagesDir, `${pageId}.md`), body, "utf-8");
}

function writeContractPage(pageId: string, opts: {
  authorityFile?: string;
  shapeFiles?: string[];
}) {
  const lines = [
    `pageId: ${pageId}`,
    `title: ${pageId}`,
    `category: contract`,
  ];
  if (opts.authorityFile) lines.push(`authorityFile: ${opts.authorityFile}`);
  if (opts.shapeFiles?.length) {
    lines.push(`shapeFiles[${opts.shapeFiles.length}]: ${opts.shapeFiles.join(", ")}`);
  }
  fs.writeFileSync(
    path.join(pagesDir, `${pageId}.md`),
    lines.join("\n") + "\n",
    "utf-8"
  );
}

function writeOrchestration(wikiBlock: string) {
  const claudeDir = path.join(realTmpDir, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(
    path.join(claudeDir, "orchestration.toml"),
    `[wiki]\n${wikiBlock}\n`,
    "utf-8"
  );
}

function preToolUse(filePath: string) {
  return { tool_name: "Write", tool_input: { file_path: filePath } };
}

const TEST_SESSION_ID = "test-session-deadbeef";

function runWithSession(input: object, env: Record<string, string> = {}) {
  return runHook("wiki-impact-warner.ts", input, {
    cwd: realTmpDir,
    env: { LOOM_SESSION_ID: TEST_SESSION_ID, ...env },
  });
}

describe("wiki-impact-warner hook", () => {
  it("silent when no file_path provided", async () => {
    writeFlowPage("flow-login", ["src/auth.ts"]);
    const result = await runWithSession({ tool_name: "Write", tool_input: {} });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("silent when LOOM_WIKI_HOOKS=0", async () => {
    writeFlowPage("flow-login", ["src/auth.ts"]);
    const target = path.join(realTmpDir, "src/auth.ts");
    const result = await runWithSession(preToolUse(target), {
      LOOM_WIKI_HOOKS: "0",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("silent when .loom/wiki/ missing", async () => {
    fs.rmSync(wikiDir, { recursive: true, force: true });
    const result = await runWithSession(
      preToolUse(path.join(realTmpDir, "src/auth.ts"))
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("silent when file has no flow/contract impact", async () => {
    writeFlowPage("flow-login", ["src/auth.ts"]);
    const result = await runWithSession(
      preToolUse(path.join(realTmpDir, "src/unrelated.ts"))
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("emits [wiki:impact] when file appears in flow.steps.touches", async () => {
    writeFlowPage("flow-login", ["src/auth.ts"]);
    const result = await runWithSession(
      preToolUse(path.join(realTmpDir, "src/auth.ts"))
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("[wiki:impact]");
    expect(result.stdout).toContain("flow-login");
    expect(result.stdout).toContain("auth.ts");
  });

  it("emits [wiki:impact] when file is contract.authorityFile", async () => {
    writeContractPage("contract-user-shape", {
      authorityFile: "src/types/user.ts",
    });
    const result = await runWithSession(
      preToolUse(path.join(realTmpDir, "src/types/user.ts"))
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("[wiki:impact]");
    expect(result.stdout).toContain("contract-user-shape");
  });

  it("emits [wiki:impact] when file appears in contract.shapeFiles", async () => {
    writeContractPage("contract-api-resp", {
      shapeFiles: ["src/api/response.ts", "src/api/error.ts"],
    });
    const result = await runWithSession(
      preToolUse(path.join(realTmpDir, "src/api/error.ts"))
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("[wiki:impact]");
    expect(result.stdout).toContain("contract-api-resp");
  });

  it("dedups per-file-per-session when impactDedup=true (default)", async () => {
    writeFlowPage("flow-login", ["src/auth.ts"]);
    const target = path.join(realTmpDir, "src/auth.ts");
    const first = await runWithSession(preToolUse(target));
    expect(first.stdout).toContain("[wiki:impact]");

    const second = await runWithSession(preToolUse(target));
    expect(second.exitCode).toBe(0);
    // Second call to same file within same session: silent.
    expect(second.stdout).toBe("");
  });

  it("does NOT dedup when impactDedup=false", async () => {
    writeFlowPage("flow-login", ["src/auth.ts"]);
    writeOrchestration(`impactDedup = false`);
    const target = path.join(realTmpDir, "src/auth.ts");
    const first = await runWithSession(preToolUse(target));
    expect(first.stdout).toContain("[wiki:impact]");

    const second = await runWithSession(preToolUse(target));
    expect(second.stdout).toContain("[wiki:impact]");
  });

  it("collapses to '+N additional signal' after throttle threshold (2 recent signals)", async () => {
    writeFlowPage("flow-a", ["src/a.ts"]);
    writeFlowPage("flow-b", ["src/b.ts"]);
    writeFlowPage("flow-c", ["src/c.ts"]);

    // First two unique files: full messages, each adds a signal to throttle list.
    await runWithSession(preToolUse(path.join(realTmpDir, "src/a.ts")));
    await runWithSession(preToolUse(path.join(realTmpDir, "src/b.ts")));

    // Third unique file: recentSignals >= 2 → throttle path triggers.
    const third = await runWithSession(
      preToolUse(path.join(realTmpDir, "src/c.ts"))
    );
    expect(third.exitCode).toBe(0);
    expect(third.stdout).toContain("[wiki] +1 additional signal");
    expect(third.stdout).not.toContain("[wiki:impact]");
  });

  it("impactAck='require' switches prefix and adds confirm line", async () => {
    writeFlowPage("flow-login", ["src/auth.ts"]);
    writeOrchestration(`impactAck = "require"`);
    const result = await runWithSession(
      preToolUse(path.join(realTmpDir, "src/auth.ts"))
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("[wiki:impact:ack-required]");
    expect(result.stdout).toContain("confirm with the user");
  });

  it("session ID change resets dedup set", async () => {
    writeFlowPage("flow-login", ["src/auth.ts"]);
    const target = path.join(realTmpDir, "src/auth.ts");
    const first = await runWithSession(preToolUse(target));
    expect(first.stdout).toContain("[wiki:impact]");

    // Different LOOM_SESSION_ID — should fire again.
    const second = await runHook("wiki-impact-warner.ts", preToolUse(target), {
      cwd: realTmpDir,
      env: { LOOM_SESSION_ID: "different-session-id" },
    });
    expect(second.stdout).toContain("[wiki:impact]");
  });
});
