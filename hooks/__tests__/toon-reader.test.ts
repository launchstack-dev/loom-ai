import { describe, it, expect } from "vitest";
import { parseToon, parseToonArray, parseToonSimpleArray } from "../lib/toon-reader.js";

describe("parseToon", () => {
  it("parses flat key-value pairs", () => {
    const content = `agent: contracts-agent
wave: 0
status: success
durationMs: 34500`;

    const result = parseToon(content);
    expect(result).toEqual({
      agent: "contracts-agent",
      wave: 0,
      status: "success",
      durationMs: 34500,
    });
  });

  it("parses boolean and null values", () => {
    const content = `enabled: true
disabled: false
missing: null`;

    const result = parseToon(content);
    expect(result).toEqual({
      enabled: true,
      disabled: false,
      missing: null,
    });
  });

  it("parses quoted strings", () => {
    const content = `description: "Build a CLI calculator"
name: simple`;

    const result = parseToon(content);
    expect(result.description).toBe("Build a CLI calculator");
    expect(result.name).toBe("simple");
  });

  it("skips comments and empty lines", () => {
    const content = `# This is a comment
agent: test

# Another comment
wave: 1`;

    const result = parseToon(content);
    expect(result).toEqual({ agent: "test", wave: 1 });
  });

  it("skips array headers", () => {
    const content = `status: running
filesCreated[3]: a.ts,b.ts,c.ts
currentWave: 2`;

    const result = parseToon(content);
    expect(result).toEqual({ status: "running", currentWave: 2 });
    expect(result).not.toHaveProperty("filesCreated[3]");
  });

  it("handles empty input", () => {
    expect(parseToon("")).toEqual({});
    expect(parseToon("   \n\n  ")).toEqual({});
  });

  it("handles values with colons", () => {
    const content = `updatedAt: 2026-04-07T10:00:00Z`;
    const result = parseToon(content);
    expect(result.updatedAt).toBe("2026-04-07T10:00:00Z");
  });
});

describe("parseToonArray", () => {
  it("parses typed object arrays", () => {
    const content = `exportsAdded[2]{name,file,kind}:
  authMiddleware,src/auth/middleware.ts,function
  TokenPayload,src/auth/types.ts,interface`;

    const result = parseToonArray(content, "exportsAdded");
    expect(result).toEqual([
      { name: "authMiddleware", file: "src/auth/middleware.ts", kind: "function" },
      { name: "TokenPayload", file: "src/auth/types.ts", kind: "interface" },
    ]);
  });

  it("returns empty array for [0] count", () => {
    const content = `filesDeleted[0]:
other: value`;

    const result = parseToonArray(content, "filesDeleted");
    expect(result).toEqual([]);
  });

  it("returns empty array for non-existent array", () => {
    const content = `agent: test`;
    const result = parseToonArray(content, "nonexistent");
    expect(result).toEqual([]);
  });

  it("parses arrays with numeric values", () => {
    const content = `stageHistory[2]{stage,status,iteration,agentsUsed}:
  plan-create,succeeded,1,2
  execute,failed,1,5`;

    const result = parseToonArray(content, "stageHistory");
    expect(result).toEqual([
      { stage: "plan-create", status: "succeeded", iteration: 1, agentsUsed: 2 },
      { stage: "execute", status: "failed", iteration: 1, agentsUsed: 5 },
    ]);
  });

  it("handles quoted values with commas", () => {
    const content = `issues[1]{severity,description,file}:
  warning,"Hardcoded value, needs config",src/app.ts`;

    const result = parseToonArray(content, "issues");
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe("Hardcoded value, needs config");
  });

  it("stops at non-indented line", () => {
    const content = `tasks[1]{taskId,status}:
  w1-auth,succeeded
nextField: value`;

    const result = parseToonArray(content, "tasks");
    expect(result).toHaveLength(1);
  });
});

describe("parseToonSimpleArray", () => {
  it("parses comma-separated values", () => {
    const content = `filesCreated[3]: src/a.ts,src/b.ts,src/c.ts`;
    const result = parseToonSimpleArray(content, "filesCreated");
    expect(result).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
  });

  it("returns empty for [0] count", () => {
    const content = `filesDeleted[0]:`;
    const result = parseToonSimpleArray(content, "filesDeleted");
    expect(result).toEqual([]);
  });

  it("returns empty for missing array", () => {
    const result = parseToonSimpleArray("agent: test", "missing");
    expect(result).toEqual([]);
  });
});
