/**
 * Tests for scripts/roadmap-converge/slug.ts.
 *
 * Covers:
 *   S-15: slug derivation from roadmap path
 *   S-16: slug collision detection (SLUG_COLLISION)
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  clearSlugRegistry,
  deriveSlug,
  registerSlug,
  slugFor,
} from "../../scripts/roadmap-converge/slug.js";

afterEach(() => {
  // Reset registry between tests.
  clearSlugRegistry();
});

describe("deriveSlug", () => {
  it("S-15-a: strips extension and returns basename for simple path", () => {
    expect(deriveSlug("planning/ROADMAP.md")).toBe("ROADMAP");
  });

  it("S-15-b: strips extension from nested path", () => {
    expect(deriveSlug("planning/feature/sub-roadmap.md")).toBe("sub-roadmap");
  });

  it("S-15-c: replaces spaces with dashes", () => {
    expect(deriveSlug("planning/Some File.md")).toBe("Some-File");
  });

  it("S-15-d: collapses consecutive dashes", () => {
    // e.g. 'my  file.md' → 'my--file' → 'my-file'
    expect(deriveSlug("planning/my  file.md")).toBe("my-file");
  });

  it("S-15-e: replaces non-alphanumeric characters with dashes", () => {
    expect(deriveSlug("planning/some_feature.md")).toBe("some-feature");
  });

  it("S-15-f: strips leading and trailing dashes", () => {
    // e.g. '_roadmap_.md' → '-roadmap-' → 'roadmap'
    expect(deriveSlug("planning/_roadmap_.md")).toBe("roadmap");
  });

  it("S-15-g: works with absolute paths", () => {
    expect(deriveSlug("/home/user/project/planning/ROADMAP.md")).toBe("ROADMAP");
  });

  it("S-15-h: handles file without directory prefix", () => {
    expect(deriveSlug("ROADMAP.md")).toBe("ROADMAP");
  });

  it("S-15-i: handles feature-x style names", () => {
    expect(deriveSlug("planning/feature-x.md")).toBe("feature-x");
  });
});

describe("registerSlug — S-16 collision detection", () => {
  it("S-16-a: allows first registration", () => {
    const errors: string[] = [];
    registerSlug("ROADMAP", "planning/ROADMAP.md", (l) => errors.push(l));
    expect(errors).toHaveLength(0);
  });

  it("S-16-b: allows same path to re-register same slug (idempotent)", () => {
    const errors: string[] = [];
    registerSlug("ROADMAP", "planning/ROADMAP.md", (l) => errors.push(l));
    registerSlug("ROADMAP", "planning/ROADMAP.md", (l) => errors.push(l));
    expect(errors).toHaveLength(0);
  });

  it("S-16-c: SLUG_COLLISION when two different paths claim same slug", () => {
    const errors: string[] = [];
    registerSlug("ROADMAP", "planning/ROADMAP.md", (l) => errors.push(l));
    expect(() => {
      registerSlug("ROADMAP", "planning/sub/ROADMAP.md", (l) => errors.push(l));
    }).toThrow(/SLUG_COLLISION/);
    expect(errors.some((e) => e.includes("SLUG_COLLISION"))).toBe(true);
  });

  it("S-16-d: SLUG_COLLISION error message includes both paths", () => {
    const errors: string[] = [];
    registerSlug("ROADMAP", "planning/ROADMAP.md", (l) => errors.push(l));
    try {
      registerSlug("ROADMAP", "planning/sub/ROADMAP.md", (l) => errors.push(l));
    } catch {
      // expected
    }
    const msg = errors[0];
    expect(msg).toContain("planning/ROADMAP.md");
    expect(msg).toContain("planning/sub/ROADMAP.md");
  });
});

describe("slugFor — combined derive + register", () => {
  it("derives and registers in one call", () => {
    const slug = slugFor("planning/ROADMAP.md");
    expect(slug).toBe("ROADMAP");
  });

  it("detects collision via slugFor", () => {
    slugFor("planning/ROADMAP.md");
    expect(() => slugFor("planning/sub/ROADMAP.md")).toThrow(/SLUG_COLLISION/);
  });

  it("--roadmap routing: different paths with different slugs do not collide", () => {
    const s1 = slugFor("planning/ROADMAP.md");
    const s2 = slugFor("planning/feature-x.md");
    expect(s1).toBe("ROADMAP");
    expect(s2).toBe("feature-x");
  });
});
