/**
 * Tests for hooks/lib/dismissal-marker.ts.
 *
 * Covers read/write/freshness for the init-guard dismissal marker. Uses
 * dependency injection for fs/now so tests are pure (no tmpdir setup).
 */

import { describe, it, expect } from "vitest";

import {
  DEFAULT_DISMISSAL_TTL_MS,
  isFresh,
  readDismissalMarker,
  writeDismissalMarker,
} from "./dismissal-marker.js";

interface InMemoryFs {
  files: Record<string, string>;
  dirs: Set<string>;
}

function makeFs(initial: Record<string, string> = {}): InMemoryFs {
  return { files: { ...initial }, dirs: new Set() };
}

function makeDeps(fs: InMemoryFs) {
  return {
    readFile: (p: string) => {
      if (!(p in fs.files)) throw new Error(`ENOENT: ${p}`);
      return fs.files[p];
    },
    writeFile: (p: string, contents: string) => {
      fs.files[p] = contents;
    },
    rename: (from: string, to: string) => {
      if (!(from in fs.files)) throw new Error(`ENOENT: ${from}`);
      fs.files[to] = fs.files[from];
      delete fs.files[from];
    },
    mkdir: (p: string) => {
      fs.dirs.add(p);
    },
    fileExists: (p: string) => p in fs.files,
  };
}

describe("readDismissalMarker", () => {
  it("returns null when marker is missing", () => {
    const fs = makeFs();
    expect(readDismissalMarker("/x/.loom/dismissed-init-prompt", makeDeps(fs))).toBeNull();
  });

  it("parses a valid TOON marker into a DismissalMarker", () => {
    const path = "/x/.loom/dismissed-init-prompt";
    const fs = makeFs({ [path]: "dismissedAt: 2026-06-17T12:34:56.000Z\n" });
    const result = readDismissalMarker(path, makeDeps(fs));
    expect(result).not.toBeNull();
    expect(result!.dismissedAt.toISOString()).toBe("2026-06-17T12:34:56.000Z");
  });

  it("returns null when dismissedAt field is missing", () => {
    const path = "/x/.loom/dismissed-init-prompt";
    const fs = makeFs({ [path]: "# empty marker\n" });
    expect(readDismissalMarker(path, makeDeps(fs))).toBeNull();
  });

  it("returns null when dismissedAt is unparseable", () => {
    const path = "/x/.loom/dismissed-init-prompt";
    const fs = makeFs({ [path]: "dismissedAt: not-a-date\n" });
    expect(readDismissalMarker(path, makeDeps(fs))).toBeNull();
  });

  it("returns null when read throws", () => {
    const path = "/x/.loom/dismissed-init-prompt";
    const result = readDismissalMarker(path, {
      fileExists: () => true,
      readFile: () => {
        throw new Error("EACCES");
      },
    });
    expect(result).toBeNull();
  });
});

describe("writeDismissalMarker", () => {
  it("writes a TOON marker atomically via .tmp + rename", () => {
    const path = "/x/.loom/dismissed-init-prompt";
    const fs = makeFs();
    const now = new Date("2026-06-17T00:00:00.000Z");
    writeDismissalMarker(path, now, makeDeps(fs));
    expect(fs.files[path]).toBe("dismissedAt: 2026-06-17T00:00:00.000Z\n");
    expect(fs.files[`${path}.tmp`]).toBeUndefined();
    expect(fs.dirs.has("/x/.loom")).toBe(true);
  });

  it("round-trips through readDismissalMarker", () => {
    const path = "/x/.loom/dismissed-init-prompt";
    const fs = makeFs();
    const now = new Date("2026-06-17T08:30:00.000Z");
    const deps = makeDeps(fs);
    writeDismissalMarker(path, now, deps);
    const parsed = readDismissalMarker(path, deps);
    expect(parsed!.dismissedAt.toISOString()).toBe(now.toISOString());
  });
});

describe("isFresh", () => {
  const base = new Date("2026-06-17T12:00:00.000Z");

  it("returns false for a null marker", () => {
    expect(isFresh(null, base)).toBe(false);
  });

  it("returns true within the 24h TTL", () => {
    const marker = { dismissedAt: new Date(base.getTime() - 23 * 60 * 60 * 1000) };
    expect(isFresh(marker, base)).toBe(true);
  });

  it("returns false at or beyond the TTL boundary", () => {
    const at = { dismissedAt: new Date(base.getTime() - DEFAULT_DISMISSAL_TTL_MS) };
    expect(isFresh(at, base)).toBe(false);
    const beyond = {
      dismissedAt: new Date(base.getTime() - DEFAULT_DISMISSAL_TTL_MS - 1),
    };
    expect(isFresh(beyond, base)).toBe(false);
  });

  it("honors a custom ttlMs", () => {
    const marker = { dismissedAt: new Date(base.getTime() - 60 * 1000) };
    expect(isFresh(marker, base, 30 * 1000)).toBe(false);
    expect(isFresh(marker, base, 120 * 1000)).toBe(true);
  });

  it("treats future-dated markers (clock skew) as fresh", () => {
    const marker = { dismissedAt: new Date(base.getTime() + 60 * 60 * 1000) };
    expect(isFresh(marker, base)).toBe(true);
  });
});
