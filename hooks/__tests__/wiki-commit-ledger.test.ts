import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { runHook } from "./helpers/hook-runner.js";

let tmpDir: string;
let realTmpDir: string;
let wikiDir: string;
let pagesDir: string;

function git(cmd: string, cwd: string) {
  execSync(`git ${cmd}`, {
    cwd,
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@test",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@test",
    },
  });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-wiki-ledger-"));
  realTmpDir = fs.realpathSync(tmpDir);
  fs.mkdirSync(path.join(realTmpDir, ".plan-execution", "ephemeral"), {
    recursive: true,
  });
  wikiDir = path.join(realTmpDir, ".loom", "wiki");
  pagesDir = path.join(wikiDir, "pages");
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.writeFileSync(
    path.join(wikiDir, "index.toon"),
    `schemaVersion: 2\nprojectName: test-project\npageCount: 0\n`,
    "utf-8"
  );
  // Initialize a real git repo — the hook calls `git rev-parse HEAD` and
  // `git diff-tree` on the project root, so we need actual commits. We seed an
  // empty commit so that subsequent test commits have a parent (otherwise
  // `git diff-tree --no-commit-id HEAD` returns no files for the root commit).
  git("init --quiet --initial-branch=main", realTmpDir);
  git(`commit --quiet --allow-empty -m "root"`, realTmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function commit(files: Record<string, string>, message: string): string {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(realTmpDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, "utf-8");
    git(`add "${rel}"`, realTmpDir);
  }
  git(`commit --quiet -m "${message}"`, realTmpDir);
  return execSync("git rev-parse HEAD", { cwd: realTmpDir, encoding: "utf-8" }).trim();
}

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

function bashInput(command: string, exitCode = 0) {
  return {
    tool_name: "Bash",
    tool_input: { command },
    tool_response: { exit_code: exitCode },
  };
}

function runLedger(input: object, env: Record<string, string> = {}) {
  return runHook("wiki-commit-ledger.ts", input, {
    cwd: realTmpDir,
    env,
  });
}

function readLedger(): { header: Record<string, string>; rows: string[] } {
  const ledgerPath = path.join(wikiDir, "freshness-ledger.toon");
  if (!fs.existsSync(ledgerPath)) return { header: {}, rows: [] };
  const content = fs.readFileSync(ledgerPath, "utf-8");
  const lines = content.split("\n");
  const header: Record<string, string> = {};
  const rows: string[] = [];
  let inArray = false;
  for (const line of lines) {
    if (/^entries\[/.test(line.trim())) {
      inArray = true;
      continue;
    }
    if (!inArray) {
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (m) header[m[1]] = m[2];
    } else if (line.startsWith("  ") && line.trim()) {
      rows.push(line.trim());
    }
  }
  return { header, rows };
}

describe("wiki-commit-ledger hook", () => {
  it("silent when LOOM_WIKI_HOOKS=0", async () => {
    commit({ "src/a.ts": "x" }, "init");
    const result = await runLedger(bashInput(`git commit -m "x"`), {
      LOOM_WIKI_HOOKS: "0",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(fs.existsSync(path.join(wikiDir, "freshness-ledger.toon"))).toBe(false);
  });

  it("silent when tool_name is not Bash", async () => {
    commit({ "src/a.ts": "x" }, "init");
    const result = await runLedger({
      tool_name: "Write",
      tool_input: { command: `git commit -m "x"` },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(fs.existsSync(path.join(wikiDir, "freshness-ledger.toon"))).toBe(false);
  });

  it("silent for non-commit git commands", async () => {
    commit({ "src/a.ts": "x" }, "init");
    const result = await runLedger(bashInput("git status"));
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(fs.existsSync(path.join(wikiDir, "freshness-ledger.toon"))).toBe(false);
  });

  it("regex excludes `git commit-tree` and `git commit-graph` plumbing", async () => {
    commit({ "src/a.ts": "x" }, "init");
    const tree = await runLedger(bashInput("git commit-tree HEAD^{tree} -m foo"));
    expect(tree.stdout).toBe("");
    const graph = await runLedger(bashInput("git commit-graph write"));
    expect(graph.stdout).toBe("");
    expect(fs.existsSync(path.join(wikiDir, "freshness-ledger.toon"))).toBe(false);
  });

  it("regex matches `git commit` in chained commands", async () => {
    commit({ "src/a.ts": "x" }, "init");
    const result = await runLedger(
      bashInput(`cd somewhere && git commit -m "chained"`)
    );
    expect(result.exitCode).toBe(0);
    const ledger = readLedger();
    expect(ledger.rows.length).toBe(1);
  });

  it("silent when tool_response.exit_code is non-zero", async () => {
    commit({ "src/a.ts": "x" }, "init");
    const result = await runLedger(bashInput(`git commit -m "x"`, /*exit*/ 1));
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(fs.existsSync(path.join(wikiDir, "freshness-ledger.toon"))).toBe(false);
  });

  it("silent when .loom/wiki/ missing", async () => {
    fs.rmSync(wikiDir, { recursive: true, force: true });
    commit({ "src/a.ts": "x" }, "init");
    const result = await runLedger(bashInput(`git commit -m "x"`));
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("writes status='n/a' entry when commit has no wiki impact", async () => {
    writeFlowPage("flow-login", ["src/auth.ts"]);
    commit({ "src/unrelated.ts": "x" }, "no-impact-commit");

    const result = await runLedger(bashInput(`git commit -m "no-impact-commit"`));
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(""); // n/a status emits no message
    const ledger = readLedger();
    expect(ledger.rows.length).toBe(1);
    expect(ledger.rows[0]).toMatch(/,n\/a$/);
    expect(ledger.rows[0]).toContain("src/unrelated.ts");
  });

  it("writes status='debt' entry + emits message when commit touches wiki-referenced files", async () => {
    writeFlowPage("flow-login", ["src/auth.ts"]);
    commit({ "src/auth.ts": "x" }, "impact-commit");

    const result = await runLedger(bashInput(`git commit -m "impact-commit"`));
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("[wiki:ledger]");
    expect(result.stdout).toContain("flow-login");
    expect(result.stdout).toContain("/loom-wiki ingest --diff");

    const ledger = readLedger();
    expect(ledger.rows.length).toBe(1);
    expect(ledger.rows[0]).toMatch(/,debt$/);
    expect(ledger.rows[0]).toContain("flow-login");
    // wikiUpdatedAt is null at commit time (not yet reconciled).
    expect(ledger.rows[0]).toContain(",null,debt");
  });

  it("is idempotent: re-running on the same SHA does not duplicate the entry", async () => {
    writeFlowPage("flow-login", ["src/auth.ts"]);
    commit({ "src/auth.ts": "x" }, "once");

    await runLedger(bashInput(`git commit -m "once"`));
    const first = readLedger();
    expect(first.rows.length).toBe(1);

    // Re-fire without a new commit — same HEAD SHA.
    await runLedger(bashInput(`git commit -m "once"`));
    const second = readLedger();
    expect(second.rows.length).toBe(1);
    expect(second.rows[0]).toBe(first.rows[0]);
  });

  it("round-trips an existing ledger: header preserved, new entry appended", async () => {
    writeFlowPage("flow-login", ["src/auth.ts"]);

    // Pre-seed a ledger with one fresh entry.
    const seed =
      `schemaVersion: 1\n` +
      `projectName: test-project\n` +
      `lastEntry: 2026-01-01T00:00:00.000Z\n` +
      `totalEntries: 1\n` +
      `entries[1]{commitSha,timestamp,filesChanged,impactedPages,wikiUpdatedAt,status}:\n` +
      `  abc1234,2026-01-01T00:00:00.000Z,"old/file.ts","flow-old",2026-01-02T00:00:00.000Z,fresh\n`;
    fs.writeFileSync(
      path.join(wikiDir, "freshness-ledger.toon"),
      seed,
      "utf-8"
    );

    commit({ "src/auth.ts": "x" }, "second");
    await runLedger(bashInput(`git commit -m "second"`));

    const ledger = readLedger();
    expect(ledger.header.schemaVersion).toBe("1");
    expect(ledger.header.projectName).toBe("test-project");
    expect(ledger.header.totalEntries).toBe("2");
    expect(ledger.rows.length).toBe(2);
    // Seeded entry preserved.
    expect(ledger.rows[0]).toContain("abc1234");
    expect(ledger.rows[0]).toMatch(/,fresh$/);
    // New entry appended with debt status.
    expect(ledger.rows[1]).toMatch(/,debt$/);
    expect(ledger.rows[1]).toContain("flow-login");
  });
});
