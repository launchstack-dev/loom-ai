/**
 * Symlink safety primitives — exercises the lstat-based detection that
 * Rules 12, 13, 14 use to skip writes through user-managed symlinks.
 *
 * All tests use a synthetic `LstatResolver` so we don't need a real
 * filesystem (and don't need to worry about cross-platform symlink
 * support in CI runners).
 */

import { describe, it, expect } from "vitest";

import {
  isSymlink,
  classifyWriteTarget,
  symlinkSkipAdvisory,
  type LstatResolver,
} from "../../hooks/lib/symlink-safety.js";

function mockLstat(state: Record<string, { isLink: boolean }>): LstatResolver {
  return {
    existsSync: (p) => Object.prototype.hasOwnProperty.call(state, p),
    isSymlink: (p) => state[p]?.isLink === true,
  };
}

describe("isSymlink", () => {
  it("returns true for an existing symlink", () => {
    const lstat = mockLstat({ "/foo/bar": { isLink: true } });
    expect(isSymlink("/foo/bar", lstat)).toBe(true);
  });

  it("returns false for an existing regular file", () => {
    const lstat = mockLstat({ "/foo/bar": { isLink: false } });
    expect(isSymlink("/foo/bar", lstat)).toBe(false);
  });

  it("returns false for a non-existent path", () => {
    const lstat = mockLstat({});
    expect(isSymlink("/does/not/exist", lstat)).toBe(false);
  });
});

describe("classifyWriteTarget", () => {
  it("returns write for a regular existing file (requireExisting=true)", () => {
    const lstat = mockLstat({ "/p": { isLink: false } });
    expect(classifyWriteTarget("/p", true, lstat)).toBe("write");
  });

  it("returns write for a missing file (requireExisting=false)", () => {
    const lstat = mockLstat({});
    expect(classifyWriteTarget("/p", false, lstat)).toBe("write");
  });

  it("returns skip-missing for a missing file (requireExisting=true)", () => {
    const lstat = mockLstat({});
    expect(classifyWriteTarget("/p", true, lstat)).toBe("skip-missing");
  });

  it("returns skip-link for a symlinked target (regardless of requireExisting)", () => {
    const lstat = mockLstat({ "/p": { isLink: true } });
    expect(classifyWriteTarget("/p", true, lstat)).toBe("skip-link");
    expect(classifyWriteTarget("/p", false, lstat)).toBe("skip-link");
  });

  it("symlink classification takes priority over missing classification", () => {
    // Symlink to a non-existent target — lstat says it exists (the link
    // does), so the symlink check fires first
    const lstat = mockLstat({ "/p": { isLink: true } });
    expect(classifyWriteTarget("/p", true, lstat)).toBe("skip-link");
  });
});

describe("symlinkSkipAdvisory", () => {
  it("includes the target path and the opt-in command", () => {
    const advisory = symlinkSkipAdvisory("/home/u/.claude/skills/library/library.yaml");
    expect(advisory).toContain("/home/u/.claude/skills/library/library.yaml");
    expect(advisory).toContain("cp --remove-destination");
    expect(advisory).toContain("readlink");
    expect(advisory).toContain("/loom-upgrade");
  });

  it("is shaped as a single-line stderr-friendly message", () => {
    const advisory = symlinkSkipAdvisory("/p");
    // No embedded newlines (status-line + stderr collectors hate multi-line)
    expect(advisory.includes("\n")).toBe(false);
  });
});

describe("real-world scenarios", () => {
  it("dev install — agents/* symlinked to repo checkout — would be skipped", () => {
    // Simulates ~/.claude/agents/contracts-agent.md → ~/.loom-ai/agents/contracts-agent.md
    const lstat = mockLstat({
      "/home/u/.claude/agents/contracts-agent.md": { isLink: true },
    });
    expect(isSymlink("/home/u/.claude/agents/contracts-agent.md", lstat)).toBe(true);
  });

  it("dotfile setup — library.yaml symlinked to dotfiles repo — would be skipped", () => {
    const lstat = mockLstat({
      "/home/u/.claude/skills/library/library.yaml": { isLink: true },
    });
    const c = classifyWriteTarget(
      "/home/u/.claude/skills/library/library.yaml",
      true,
      lstat,
    );
    expect(c).toBe("skip-link");
  });

  it("fresh install — install-state.toon is a real file — would migrate normally", () => {
    const lstat = mockLstat({
      "/home/u/.claude/skills/library/install-state.toon": { isLink: false },
    });
    const c = classifyWriteTarget(
      "/home/u/.claude/skills/library/install-state.toon",
      true,
      lstat,
    );
    expect(c).toBe("write");
  });

  it("Rule 14 — symlinked ROADMAP.md at project root — would be skipped", () => {
    // User maintains ROADMAP.md as ~/dotfiles/projects/foo/ROADMAP.md
    const lstat = mockLstat({
      "/proj/ROADMAP.md": { isLink: true },
    });
    expect(isSymlink("/proj/ROADMAP.md", lstat)).toBe(true);
  });
});
