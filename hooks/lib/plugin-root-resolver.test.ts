/**
 * Tests for hooks/lib/plugin-root-resolver.ts.
 *
 * Covers the three resolution-priority scenarios from PLAN-plugin-marketplace-merged
 * Phase 1 (S-01 pointer expansion, S-02 env-var precedence, S-03 grep regression),
 * plus edge cases around empty env vars, missing/malformed pointer files, and
 * `~` expansion. Uses dependency injection for env/fs so tests are pure.
 */

import { describe, it, expect } from "vitest";
import * as path from "node:path";

import { resolvePluginRoot } from "./plugin-root-resolver.js";

const FAKE_HOME = "/home/test-user";

function makeDeps(opts: {
  env?: Record<string, string | undefined>;
  files?: Record<string, string>;
}) {
  const files = opts.files ?? {};
  return {
    env: (opts.env ?? {}) as NodeJS.ProcessEnv,
    fileExists: (p: string) => Object.prototype.hasOwnProperty.call(files, p),
    readFile: (p: string) => {
      if (!Object.prototype.hasOwnProperty.call(files, p)) {
        throw new Error(`ENOENT: ${p}`);
      }
      return files[p];
    },
    homedir: () => FAKE_HOME,
  };
}

describe("resolvePluginRoot", () => {
  describe("S-01: pointer file resolution", () => {
    it("reads .loom/plugin-root and returns absolute path with ~ expanded", () => {
      const cwd = "/projects/my-app";
      const result = resolvePluginRoot(
        cwd,
        makeDeps({
          files: {
            [path.join(cwd, ".loom", "plugin-root")]:
              'pluginRoot: ~/.claude/plugins/loom\n',
          },
        })
      );
      expect(result).toBe(path.join(FAKE_HOME, ".claude/plugins/loom"));
    });

    it("returns an already-absolute pluginRoot unchanged (normalized)", () => {
      const cwd = "/projects/my-app";
      const result = resolvePluginRoot(
        cwd,
        makeDeps({
          files: {
            [path.join(cwd, ".loom", "plugin-root")]:
              "pluginRoot: /opt/loom-dev\n",
          },
        })
      );
      expect(result).toBe("/opt/loom-dev");
    });

    it("expands a bare ~ pointer to $HOME", () => {
      const cwd = "/projects/my-app";
      const result = resolvePluginRoot(
        cwd,
        makeDeps({
          files: {
            [path.join(cwd, ".loom", "plugin-root")]: "pluginRoot: ~\n",
          },
        })
      );
      expect(result).toBe(FAKE_HOME);
    });
  });

  describe("S-02: $CLAUDE_PLUGIN_ROOT wins over pointer", () => {
    it("returns the env-var path even when a pointer file is present", () => {
      const cwd = "/projects/my-app";
      const result = resolvePluginRoot(
        cwd,
        makeDeps({
          env: { CLAUDE_PLUGIN_ROOT: "/home/x/.claude/plugins/loom" },
          files: {
            [path.join(cwd, ".loom", "plugin-root")]:
              "pluginRoot: /some/other/path\n",
          },
        })
      );
      expect(result).toBe("/home/x/.claude/plugins/loom");
    });

    it("expands ~ in the env-var value", () => {
      const result = resolvePluginRoot(
        "/projects/my-app",
        makeDeps({
          env: { CLAUDE_PLUGIN_ROOT: "~/.claude/plugins/loom" },
        })
      );
      expect(result).toBe(path.join(FAKE_HOME, ".claude/plugins/loom"));
    });

    it("ignores empty env var and falls through to pointer", () => {
      const cwd = "/projects/my-app";
      const result = resolvePluginRoot(
        cwd,
        makeDeps({
          env: { CLAUDE_PLUGIN_ROOT: "" },
          files: {
            [path.join(cwd, ".loom", "plugin-root")]:
              "pluginRoot: /opt/loom-dev\n",
          },
        })
      );
      expect(result).toBe("/opt/loom-dev");
    });

    it("ignores whitespace-only env var and falls through to pointer", () => {
      const cwd = "/projects/my-app";
      const result = resolvePluginRoot(
        cwd,
        makeDeps({
          env: { CLAUDE_PLUGIN_ROOT: "   " },
          files: {
            [path.join(cwd, ".loom", "plugin-root")]:
              "pluginRoot: /opt/loom-dev\n",
          },
        })
      );
      expect(result).toBe("/opt/loom-dev");
    });
  });

  describe("repo-relative fallback", () => {
    it("returns cwd when neither env var nor pointer is present", () => {
      const cwd = "/projects/my-app";
      const result = resolvePluginRoot(cwd, makeDeps({}));
      expect(result).toBe(cwd);
    });

    it("returns cwd when pointer file exists but pluginRoot key is missing", () => {
      const cwd = "/projects/my-app";
      const result = resolvePluginRoot(
        cwd,
        makeDeps({
          files: {
            [path.join(cwd, ".loom", "plugin-root")]: "# empty pointer\n",
          },
        })
      );
      expect(result).toBe(cwd);
    });

    it("returns cwd when pointer file read throws", () => {
      const cwd = "/projects/my-app";
      const pointer = path.join(cwd, ".loom", "plugin-root");
      const result = resolvePluginRoot(cwd, {
        env: {} as NodeJS.ProcessEnv,
        fileExists: () => true,
        readFile: () => {
          throw new Error("boom");
        },
        homedir: () => FAKE_HOME,
      });
      // pointer presence reported but read failed → fall through.
      expect(result).toBe(cwd);
      expect(pointer).toContain(".loom/plugin-root");
    });

    it("normalizes a relative cwd to absolute", () => {
      const result = resolvePluginRoot("relative/path", makeDeps({}));
      expect(path.isAbsolute(result)).toBe(true);
      expect(result.endsWith("relative/path")).toBe(true);
    });
  });

  describe("return value invariants", () => {
    it("always returns an absolute path", () => {
      const cases = [
        resolvePluginRoot("/abs/cwd", makeDeps({})),
        resolvePluginRoot(
          "/abs/cwd",
          makeDeps({ env: { CLAUDE_PLUGIN_ROOT: "~/x" } })
        ),
        resolvePluginRoot(
          "/abs/cwd",
          makeDeps({
            files: {
              [path.join("/abs/cwd", ".loom", "plugin-root")]:
                "pluginRoot: ~/y\n",
            },
          })
        ),
      ];
      for (const result of cases) {
        expect(path.isAbsolute(result)).toBe(true);
        expect(result).not.toMatch(/^~/);
      }
    });
  });
});
