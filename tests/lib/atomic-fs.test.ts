/**
 * tests/lib/atomic-fs.test.ts — PLAN-exceed-gstack Phase 2b (F-02, defect 8).
 *
 * Behavioral crash-safety tests for the single sanctioned atomic writer that
 * consolidates the four copy-pasted implementations:
 *
 *   - scripts/loom-browser-daemon.ts:32  (atomicWrite)
 *   - scripts/loom-install.ts:80         (atomicWrite)
 *   - scripts/loom-version-slot.ts:216   (writeAtomic)
 *   - scripts/loom-change/init.ts:318    (atomicWriteText)
 *
 * The invariant under test: a reader (or a killed process) observes either
 * the OLD file or the NEW file, never a partial — and no `.tmp` debris
 * survives either success or failure.
 *
 * Run: bunx vitest run tests/lib/atomic-fs.test.ts
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { atomicWrite, atomicWriteText } from "../../lib/index.js";
import * as atomicFsModule from "../../lib/atomic-fs.js";
import * as barrel from "../../lib/index.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-fs-test-"));
});

afterEach(() => {
  // Undo any read-only chmod so cleanup succeeds.
  try {
    for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (entry.isDirectory()) {
        fs.chmodSync(path.join(entry.parentPath, entry.name), 0o755);
      }
    }
  } catch {
    /* best effort */
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("barrel resolution (C-02: one import surface, no duplication)", () => {
  it("lib/index.js re-exports the exact same function objects as lib/atomic-fs.js", () => {
    // A hook importing the barrel and a script importing the module get the
    // SAME implementation — not a duplicated copy.
    expect(barrel.atomicWrite).toBe(atomicFsModule.atomicWrite);
    expect(barrel.atomicWriteText).toBe(atomicFsModule.atomicWriteText);
  });
});

describe("atomicWrite — happy path", () => {
  it("writes string data readable back verbatim", () => {
    const target = path.join(dir, "state.toon");
    atomicWrite(target, "phase: implementing\npercentComplete: 60\n");
    expect(fs.readFileSync(target, "utf8")).toBe(
      "phase: implementing\npercentComplete: 60\n",
    );
  });

  it("creates missing parent directories recursively (legacy mkdir -p union behavior)", () => {
    const target = path.join(dir, "deeply", "nested", "progress", "task.toon");
    atomicWrite(target, "ok: true\n");
    expect(fs.readFileSync(target, "utf8")).toBe("ok: true\n");
  });

  it("replaces an existing file's content completely", () => {
    const target = path.join(dir, "config.toon");
    fs.writeFileSync(target, "old content that is much longer than the new one");
    atomicWrite(target, "new");
    expect(fs.readFileSync(target, "utf8")).toBe("new");
  });

  it("leaves no temp file behind after a successful write (readdir check)", () => {
    const target = path.join(dir, "clean.toon");
    atomicWrite(target, "a: 1\n");
    expect(fs.readdirSync(dir)).toEqual(["clean.toon"]);
  });

  it("writes Buffer data byte-for-byte (binary safe)", () => {
    const target = path.join(dir, "blob.bin");
    const bytes = Buffer.from([0x00, 0xff, 0x10, 0x80, 0x7f]);
    atomicWrite(target, bytes);
    expect(fs.readFileSync(target).equals(bytes)).toBe(true);
  });
});

describe("atomicWrite — options", () => {
  it("honors the encoding option for string data", () => {
    const target = path.join(dir, "latin.txt");
    atomicWrite(target, "café", { encoding: "latin1" });
    // latin1 encodes é as a single byte — utf8 would use two.
    expect(fs.statSync(target).size).toBe(4);
    expect(fs.readFileSync(target, "latin1")).toBe("café");
  });

  it("applies the exact mode to the final path (not umask-masked)", () => {
    const target = path.join(dir, "secret.toon");
    atomicWrite(target, "token: xyz\n", { mode: 0o600 });
    expect(fs.statSync(target).mode & 0o777).toBe(0o600);
  });

  it("uses a custom tmpSuffix for the staging file", () => {
    const target = path.join(dir, "custom.toon");
    // Force a rename failure via a non-empty directory squatting on the
    // target path, then check the CUSTOM-suffixed temp file was cleaned up.
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "occupant"), "x");
    expect(() => atomicWrite(target, "data", { tmpSuffix: ".staging" })).toThrow();
    expect(fs.existsSync(`${target}.staging`)).toBe(false);
    expect(fs.existsSync(`${target}.tmp`)).toBe(false);
  });

  it("fsync: true still produces a correct, debris-free write", () => {
    const target = path.join(dir, "durable.toon");
    atomicWrite(target, "durable: yes\n", { fsync: true });
    expect(fs.readFileSync(target, "utf8")).toBe("durable: yes\n");
    expect(fs.readdirSync(dir)).toEqual(["durable.toon"]);
  });
});

describe("atomicWrite — crash safety (old file or new file, never partial)", () => {
  it("recovers from a previous crashed run's stranded .tmp file", () => {
    const target = path.join(dir, "recover.toon");
    // Simulate a process killed between the tmp write and the rename.
    fs.writeFileSync(`${target}.tmp`, "PARTIAL GARBAGE FROM DEAD PROCESS");
    atomicWrite(target, "fresh: true\n");
    expect(fs.readFileSync(target, "utf8")).toBe("fresh: true\n");
    expect(fs.readdirSync(dir)).toEqual(["recover.toon"]);
  });

  it("when the rename step fails, no partial target appears and the tmp file is cleaned up", () => {
    const target = path.join(dir, "blocked.toon");
    // A non-empty directory at the target path makes renameSync throw on
    // every platform — a deterministic stand-in for a mid-write crash.
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "occupant"), "keep");
    expect(() => atomicWrite(target, "never lands")).toThrow();
    // Old state fully intact…
    expect(fs.readFileSync(path.join(target, "occupant"), "utf8")).toBe("keep");
    // …and no partial/tmp debris.
    expect(fs.existsSync(`${target}.tmp`)).toBe(false);
  });

  it("when the tmp write itself fails, the OLD file survives untouched", () => {
    const roDir = path.join(dir, "readonly");
    const target = path.join(roDir, "old.toon");
    fs.mkdirSync(roDir);
    fs.writeFileSync(target, "old: intact\n");
    fs.chmodSync(roDir, 0o555); // writeFileSync(tmp) → EACCES
    try {
      expect(() => atomicWrite(target, "new: lost\n")).toThrow();
      expect(fs.readFileSync(target, "utf8")).toBe("old: intact\n");
    } finally {
      fs.chmodSync(roDir, 0o755);
    }
  });
});

describe("atomicWriteText", () => {
  it("is a string wrapper with identical on-disk behavior to atomicWrite", () => {
    const viaText = path.join(dir, "via-text.toon");
    const viaWrite = path.join(dir, "via-write.toon");
    atomicWriteText(viaText, "same: bytes\n");
    atomicWrite(viaWrite, "same: bytes\n");
    expect(fs.readFileSync(viaText)).toEqual(fs.readFileSync(viaWrite));
  });

  it("forwards options (mode) to atomicWrite", () => {
    const target = path.join(dir, "text-mode.toon");
    atomicWriteText(target, "x: 1\n", { mode: 0o640 });
    expect(fs.statSync(target).mode & 0o777).toBe(0o640);
  });

  it("creates missing parent directories like the stranded init.ts atomicWriteText did", () => {
    const target = path.join(dir, "changes", "CH-001", "proposal.md");
    atomicWriteText(target, "# Proposal\n");
    expect(fs.readFileSync(target, "utf8")).toBe("# Proposal\n");
  });
});
