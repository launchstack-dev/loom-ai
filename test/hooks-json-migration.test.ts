import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = path.resolve(__dirname, "..");
const hooksJsonPath = path.join(repoRoot, "hooks", "hooks.json");

describe("hooks/hooks.json loom-migration SessionStart entry", () => {
  const raw = fs.readFileSync(hooksJsonPath, "utf8");
  const parsed = JSON.parse(raw) as {
    hooks: {
      SessionStart?: Array<{
        matcher?: string;
        hooks: Array<{ type: string; command: string; timeout?: number }>;
      }>;
    };
  };

  it("includes a SessionStart array", () => {
    expect(parsed.hooks.SessionStart).toBeDefined();
    expect(Array.isArray(parsed.hooks.SessionStart)).toBe(true);
    expect(parsed.hooks.SessionStart!.length).toBeGreaterThan(0);
  });

  it("registers a loom-migration command anchored at ${CLAUDE_PLUGIN_ROOT}", () => {
    const allCommands = (parsed.hooks.SessionStart ?? []).flatMap((entry) =>
      entry.hooks.map((h) => h.command),
    );
    const migrationCmd = allCommands.find((c) => c.includes("loom-migration"));
    expect(migrationCmd, "expected SessionStart hook to reference loom-migration").toBeDefined();
    expect(migrationCmd).toContain("${CLAUDE_PLUGIN_ROOT}");
    expect(migrationCmd).toContain("hooks/run-hook.sh");
  });
});
