import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runHook } from "./helpers/hook-runner.js";

let tmpDir: string;
let wikiDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-wiki-session-"));
  // Mark as a Loom-aware project root so findProjectRoot() halts here.
  fs.mkdirSync(path.join(tmpDir, ".plan-execution", "ephemeral"), { recursive: true });
  wikiDir = path.join(tmpDir, ".loom", "wiki");
  fs.mkdirSync(wikiDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeIndex(pageCount: number, pageRows: string[] = []) {
  const header = pageRows.length > 0
    ? `pages[${pageRows.length}]{pageId,title,category,staleness}:`
    : "";
  const rows = pageRows.map((r) => `  ${r}`).join("\n");
  const content =
    `schemaVersion: 2\npageCount: ${pageCount}\n` +
    (header ? `${header}\n${rows}\n` : "");
  fs.writeFileSync(path.join(wikiDir, "index.toon"), content, "utf-8");
}

function writeLog(daysAgo: number) {
  const ts = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  fs.writeFileSync(
    path.join(wikiDir, "log.toon"),
    `lastEntry: ${ts}\n`,
    "utf-8"
  );
}

function writeLedger(debtEntries: number, freshEntries: number = 0) {
  const total = debtEntries + freshEntries;
  const rows: string[] = [];
  for (let i = 0; i < debtEntries; i++) {
    rows.push(`  abc${i.toString().padStart(4, "0")},2026-01-01T00:00:00Z,"f.ts","p-${i}",null,debt`);
  }
  for (let i = 0; i < freshEntries; i++) {
    rows.push(`  fed${i.toString().padStart(4, "0")},2026-01-01T00:00:00Z,"f.ts","p-${i}",2026-01-02T00:00:00Z,fresh`);
  }
  const content =
    `schemaVersion: 1\nentries[${total}]{commitSha,timestamp,filesChanged,impactedPages,wikiUpdatedAt,status}:\n` +
    rows.join("\n") +
    "\n";
  fs.writeFileSync(path.join(wikiDir, "freshness-ledger.toon"), content, "utf-8");
}

function writeOrchestration(wikiBlock: string) {
  const claudeDir = path.join(tmpDir, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(
    path.join(claudeDir, "orchestration.toml"),
    `[wiki]\n${wikiBlock}\n`,
    "utf-8"
  );
}

describe("wiki-session-status hook", () => {
  it("silent when LOOM_WIKI_HOOKS=0", async () => {
    writeIndex(10);
    writeLog(0);
    const result = await runHook("wiki-session-status.ts", {}, {
      cwd: tmpDir,
      env: { LOOM_WIKI_HOOKS: "0" },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("silent when .loom/wiki/ missing", async () => {
    fs.rmSync(wikiDir, { recursive: true, force: true });
    const result = await runHook("wiki-session-status.ts", {}, { cwd: tmpDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("silent when index.toon missing", async () => {
    const result = await runHook("wiki-session-status.ts", {}, { cwd: tmpDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("emits empty-wiki message when pageCount=0", async () => {
    writeIndex(0);
    const result = await runHook("wiki-session-status.ts", {}, { cwd: tmpDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("[wiki] empty wiki");
    expect(result.stdout).toContain("/loom-wiki ingest --full");
  });

  it("silent when fully healthy (M=0, D<7, debt=0)", async () => {
    writeIndex(10, ["p1,Page 1,concept,fresh"]);
    writeLog(2);
    const result = await runHook("wiki-session-status.ts", {}, { cwd: tmpDir });
    expect(result.exitCode).toBe(0);
    // No status line — but context-loader may emit a block when N>=10, so check
    // we don't see [wiki:attention] or the subdued one-line.
    expect(result.stdout).not.toContain("[wiki:attention]");
    expect(result.stdout).not.toMatch(/\[wiki\] \d+ pages — last ingest/);
  });

  it("subdued one-line when M=0 and 7<=D<14", async () => {
    writeIndex(5, ["p1,Page 1,concept,fresh"]);
    writeLog(10);
    const result = await runHook("wiki-session-status.ts", {}, { cwd: tmpDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/\[wiki\] 5 pages — last ingest 10d ago/);
    expect(result.stdout).not.toContain("[wiki:attention]");
  });

  it("attention block when M>0 with stale remediation hint", async () => {
    writeIndex(8, [
      "p1,Page 1,concept,stale",
      "p2,Page 2,concept,stale",
      "p3,Page 3,concept,fresh",
    ]);
    writeLog(3);
    const result = await runHook("wiki-session-status.ts", {}, { cwd: tmpDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("[wiki:attention]");
    expect(result.stdout).toContain("2 stale");
    expect(result.stdout).toContain("/loom-wiki ingest --diff");
  });

  it("attention block when D>=14 even with no stale pages", async () => {
    writeIndex(3, ["p1,Page 1,concept,fresh"]);
    writeLog(20);
    const result = await runHook("wiki-session-status.ts", {}, { cwd: tmpDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("[wiki:attention]");
    expect(result.stdout).toContain("20d ago");
  });

  it("surfaces freshness-ledger debt count", async () => {
    writeIndex(3, ["p1,Page 1,concept,fresh"]);
    writeLog(1);
    writeLedger(4, /*fresh=*/ 1);
    const result = await runHook("wiki-session-status.ts", {}, { cwd: tmpDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("[wiki:ledger] 4 commits");
  });

  it("writes wiki-lint-pending marker when D>14", async () => {
    writeIndex(3, ["p1,Page 1,concept,fresh"]);
    writeLog(20);
    await runHook("wiki-session-status.ts", {}, { cwd: tmpDir });
    const markerPath = path.join(
      tmpDir,
      ".plan-execution",
      "ephemeral",
      "wiki-lint-pending.toon"
    );
    expect(fs.existsSync(markerPath)).toBe(true);
    const body = fs.readFileSync(markerPath, "utf-8");
    expect(body).toContain("reason: D>14");
  });

  it("resets per-session dedup state on every fire", async () => {
    writeIndex(3, ["p1,Page 1,concept,fresh"]);
    writeLog(1);
    const ephemeralDir = path.join(tmpDir, ".plan-execution", "ephemeral");
    // Seed a stale session state — hook should clobber it.
    fs.writeFileSync(
      path.join(ephemeralDir, "wiki-impact-session.toon"),
      `sessionId: stale-session\nfiles[2]: a.ts, b.ts\n`,
      "utf-8"
    );
    await runHook("wiki-session-status.ts", {}, { cwd: tmpDir });
    const after = fs.readFileSync(
      path.join(ephemeralDir, "wiki-impact-session.toon"),
      "utf-8"
    );
    expect(after).not.toContain("stale-session");
    expect(after).toContain("files[0]:");
  });

  it("sessionStatusEnabled=false suppresses output (kill switch)", async () => {
    writeIndex(8, [
      "p1,Page 1,concept,stale",
      "p2,Page 2,concept,stale",
    ]);
    writeLog(20);
    writeLedger(3);
    writeOrchestration(`sessionStatusEnabled = false`);
    const result = await runHook("wiki-session-status.ts", {}, { cwd: tmpDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("sessionStatusEnabled=true (default) honors normal output", async () => {
    writeIndex(5, ["p1,Page 1,concept,stale"]);
    writeLog(3);
    writeOrchestration(`sessionStatusEnabled = true`);
    const result = await runHook("wiki-session-status.ts", {}, { cwd: tmpDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("[wiki:attention]");
  });

  describe("pause/resume Tier 3 wiki context restoration", () => {
    function writePage(id: string, title: string, category: string) {
      fs.mkdirSync(path.join(wikiDir, "pages"), { recursive: true });
      fs.writeFileSync(
        path.join(wikiDir, "pages", `${id}.md`),
        `# ${title}\n\nBody summary.\n`,
        "utf-8",
      );
    }

    function writeContinueHere(wikiContextIds: string[]) {
      fs.writeFileSync(
        path.join(tmpDir, ".plan-execution", "continue-here.toon"),
        `pausedAt: 2026-06-09T12:00:00Z\n` +
          `command: execute-plan\n` +
          `phase: wave-2\n` +
          `wikiContext[${wikiContextIds.length}]: ${wikiContextIds.join(", ")}\n`,
        "utf-8",
      );
    }

    it("restores pages listed in continue-here.toon wikiContext as Tier 3", async () => {
      // Wiki has 12 pages so the hook engages full context loading
      const rows: string[] = [];
      for (let i = 0; i < 12; i++) {
        rows.push(`p${i},Page ${i},concept,fresh`);
        writePage(`p${i}`, `Page ${i}`, "concept");
      }
      writeIndex(12, rows);
      writeLog(0);
      writeContinueHere(["p3", "p7"]);
      writeOrchestration(`sessionStatusEnabled = true\nsessionContext = "full"`);

      const result = await runHook("wiki-session-status.ts", {}, { cwd: tmpDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("From resumed session:");
      expect(result.stdout).toContain("p3");
      expect(result.stdout).toContain("p7");
    });

    it("Tier 3 is empty when no continue-here.toon present", async () => {
      const rows: string[] = [];
      for (let i = 0; i < 12; i++) {
        rows.push(`p${i},Page ${i},concept,fresh`);
        writePage(`p${i}`, `Page ${i}`, "concept");
      }
      writeIndex(12, rows);
      writeLog(0);
      writeOrchestration(`sessionStatusEnabled = true\nsessionContext = "full"`);

      const result = await runHook("wiki-session-status.ts", {}, { cwd: tmpDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain("From resumed session:");
    });

    it("writes wiki-injected.toon marker for /loom-pause to consume", async () => {
      const rows: string[] = [];
      for (let i = 0; i < 12; i++) {
        rows.push(`p${i},Page ${i},decision,fresh`);
        writePage(`p${i}`, `Page ${i}`, "decision");
      }
      writeIndex(12, rows);
      writeLog(0);
      writeOrchestration(`sessionStatusEnabled = true\nsessionContext = "full"`);

      const result = await runHook("wiki-session-status.ts", {}, { cwd: tmpDir });
      expect(result.exitCode).toBe(0);

      const markerPath = path.join(tmpDir, ".plan-execution", "ephemeral", "wiki-injected.toon");
      expect(fs.existsSync(markerPath)).toBe(true);
      const marker = fs.readFileSync(markerPath, "utf-8");
      expect(marker).toMatch(/pageIds\[\d+\]: /);
      expect(marker).toContain("injectedAt:");
    });

    it("round-trip: marker from session A round-trips through continue-here.toon to Tier 3 of session B", async () => {
      // Session A: hook runs, writes wiki-injected.toon
      const rows: string[] = [];
      for (let i = 0; i < 12; i++) {
        rows.push(`d${i},Decision ${i},decision,fresh`);
        writePage(`d${i}`, `Decision ${i}`, "decision");
      }
      writeIndex(12, rows);
      writeLog(0);
      writeOrchestration(`sessionStatusEnabled = true\nsessionContext = "full"`);

      const sessionA = await runHook("wiki-session-status.ts", {}, { cwd: tmpDir });
      expect(sessionA.exitCode).toBe(0);

      // Simulate /loom-pause: read marker, write continue-here.toon
      const markerPath = path.join(tmpDir, ".plan-execution", "ephemeral", "wiki-injected.toon");
      const marker = fs.readFileSync(markerPath, "utf-8");
      const m = marker.match(/^pageIds\[\d+\]: (.+)$/m);
      expect(m).not.toBeNull();
      const pageIds = m![1].split(",").map((s) => s.trim());
      writeContinueHere(pageIds.slice(0, 3));

      // Session B: hook runs again, should see Tier 3 with those pages
      const sessionB = await runHook("wiki-session-status.ts", {}, { cwd: tmpDir });
      expect(sessionB.exitCode).toBe(0);
      expect(sessionB.stdout).toContain("From resumed session:");
      for (const id of pageIds.slice(0, 3)) {
        expect(sessionB.stdout).toContain(id);
      }
    });
  });
});
