/**
 * Vitest coverage for scripts/roadmap-converge/lock.ts.
 *
 * Covers AC bullets: lock acquire/release, lock-conflict abort, lock
 * auto-clear after 10 min.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  acquireLock,
  lockExists,
  readLockFile,
  releaseLock,
  STALE_AFTER_MS,
} from "../../scripts/roadmap-converge/lock.js";

let workdir: string;
let lockPath: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "roadmap-converge-lock-"));
  lockPath = join(workdir, ".lock");
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("acquireLock — happy path", () => {
  it("creates a lock file with pid + started_at", () => {
    const result = acquireLock(lockPath, {
      pid: 4242,
      now: () => Date.parse("2026-06-17T00:00:00.000Z"),
    });
    expect(result.acquired).toBe(true);
    expect(lockExists(lockPath)).toBe(true);
    const parsed = readLockFile(lockPath);
    expect(parsed).toEqual({ pid: 4242, startedAt: "2026-06-17T00:00:00.000Z" });
  });

  it("releases the lock idempotently", () => {
    acquireLock(lockPath, { pid: 1 });
    releaseLock(lockPath);
    expect(lockExists(lockPath)).toBe(false);
    // Second release does not throw.
    expect(() => releaseLock(lockPath)).not.toThrow();
  });
});

describe("acquireLock — fresh conflict", () => {
  it("returns LOCK_CONFLICT without modifying the existing lock", () => {
    const t0 = Date.parse("2026-06-17T00:00:00.000Z");
    acquireLock(lockPath, { pid: 1, now: () => t0 });
    const before = readFileSync(lockPath, "utf-8");

    const result = acquireLock(lockPath, { pid: 2, now: () => t0 + 60_000 });
    expect(result.acquired).toBe(false);
    if (result.acquired === false) {
      expect(result.reason).toBe("LOCK_CONFLICT");
      expect(result.conflict.pid).toBe(1);
      expect(result.ageMs).toBe(60_000);
    }
    expect(readFileSync(lockPath, "utf-8")).toBe(before);
  });
});

describe("acquireLock — stale auto-clear", () => {
  it("clears a lock older than 10 minutes and acquires anew", () => {
    const t0 = Date.parse("2026-06-17T00:00:00.000Z");
    // Hand-write a stale lock at t0
    writeFileSync(lockPath, `pid: 99\nstarted_at: ${new Date(t0).toISOString()}\n`);

    const advisories: string[] = [];
    const result = acquireLock(lockPath, {
      pid: 7,
      now: () => t0 + STALE_AFTER_MS + 1,
      onAdvisory: (m) => advisories.push(m),
    });
    expect(result.acquired).toBe(true);
    expect(advisories.length).toBe(1);
    expect(advisories[0]).toMatch(/stale lock auto-cleared/);
    const parsed = readLockFile(lockPath);
    expect(parsed?.pid).toBe(7);
  });

  it("does NOT clear a lock that is exactly STALE_AFTER_MS old (boundary)", () => {
    const t0 = Date.parse("2026-06-17T00:00:00.000Z");
    acquireLock(lockPath, { pid: 99, now: () => t0 });
    const result = acquireLock(lockPath, {
      pid: 7,
      now: () => t0 + STALE_AFTER_MS,
    });
    expect(result.acquired).toBe(false);
  });
});

describe("acquireLock — --force", () => {
  it("steals a fresh lock when force=true", () => {
    const t0 = Date.parse("2026-06-17T00:00:00.000Z");
    acquireLock(lockPath, { pid: 1, now: () => t0 });
    const advisories: string[] = [];
    const result = acquireLock(lockPath, {
      pid: 2,
      force: true,
      now: () => t0 + 60_000,
      onAdvisory: (m) => advisories.push(m),
    });
    expect(result.acquired).toBe(true);
    expect(readLockFile(lockPath)?.pid).toBe(2);
    expect(advisories[0]).toMatch(/force-clearing/);
  });
});

describe("acquireLock — concurrent O_EXCL safety", () => {
  it("two simultaneous attempts: exactly one succeeds", () => {
    // Sequential proxy for parallel — the O_EXCL semantics are kernel-level
    // and we can't easily race in a single process. This still asserts the
    // EEXIST branch is exercised on the second call.
    const t0 = Date.parse("2026-06-17T00:00:00.000Z");
    const a = acquireLock(lockPath, { pid: 1, now: () => t0 });
    const b = acquireLock(lockPath, { pid: 2, now: () => t0 });
    expect(a.acquired).toBe(true);
    expect(b.acquired).toBe(false);
    if (!b.acquired) expect(b.reason).toBe("LOCK_CONFLICT");
  });
});

describe("existence helpers", () => {
  it("lockExists tracks acquire/release", () => {
    expect(lockExists(lockPath)).toBe(false);
    acquireLock(lockPath, { pid: 1 });
    expect(lockExists(lockPath)).toBe(true);
    releaseLock(lockPath);
    expect(lockExists(lockPath)).toBe(false);
  });

  it("readLockFile returns null for unparseable content", () => {
    writeFileSync(lockPath, "garbage\n");
    expect(readLockFile(lockPath)).toBeNull();
  });

  it("readLockFile returns null when file is missing", () => {
    expect(existsSync(lockPath)).toBe(false);
    expect(readLockFile(lockPath)).toBeNull();
  });
});
