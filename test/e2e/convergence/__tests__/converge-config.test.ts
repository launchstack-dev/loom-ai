import { describe, it, expect } from "vitest";
import { parseConvergeConfig, serializeConvergeConfig } from "../src/lib/converge-config.js";

const SAMPLE_CONFIG = `targets[3]{id,name,comparisonMethod,tolerance,baselinePath,actualPath}:
  get-api-users,GET /api/users,json-deep-equal,1.0,targets/api-users.json,actual/api-users.json
  login-page,Login page,text-diff,0.95,targets/login.txt,actual/login.txt
  config,App config,json-deep-equal,1.0,targets/config.json,actual/config.json

options.get-api-users.ignoreFields: timestamp,requestId
options.get-api-users.numericTolerance: 0.001
options.login-page.ignoreWhitespace: true
`;

describe("parseConvergeConfig", () => {
  it("parses target array from TOON format", () => {
    const config = parseConvergeConfig(SAMPLE_CONFIG);
    expect(config.targets).toHaveLength(3);
  });

  it("extracts target fields correctly", () => {
    const config = parseConvergeConfig(SAMPLE_CONFIG);
    const t = config.targets[0];
    expect(t.id).toBe("get-api-users");
    expect(t.name).toBe("GET /api/users");
    expect(t.comparisonMethod).toBe("json-deep-equal");
    expect(t.tolerance).toBe(1.0);
    expect(t.baselinePath).toBe("targets/api-users.json");
    expect(t.actualPath).toBe("actual/api-users.json");
  });

  it("parses tolerance as float", () => {
    const config = parseConvergeConfig(SAMPLE_CONFIG);
    expect(config.targets[1].tolerance).toBe(0.95);
    expect(typeof config.targets[1].tolerance).toBe("number");
  });

  it("attaches ignoreFields options to correct target", () => {
    const config = parseConvergeConfig(SAMPLE_CONFIG);
    expect(config.targets[0].options?.ignoreFields).toEqual(["timestamp", "requestId"]);
    expect(config.targets[1].options?.ignoreFields).toBeUndefined();
  });

  it("attaches numericTolerance option", () => {
    const config = parseConvergeConfig(SAMPLE_CONFIG);
    expect(config.targets[0].options?.numericTolerance).toBe(0.001);
  });

  it("attaches ignoreWhitespace option", () => {
    const config = parseConvergeConfig(SAMPLE_CONFIG);
    expect(config.targets[1].options?.ignoreWhitespace).toBe(true);
  });

  it("leaves targets without options as undefined", () => {
    const config = parseConvergeConfig(SAMPLE_CONFIG);
    expect(config.targets[2].options).toBeUndefined();
  });

  it("handles empty config", () => {
    const config = parseConvergeConfig("targets[0]{id,name,comparisonMethod,tolerance,baselinePath,actualPath}:\n");
    expect(config.targets).toHaveLength(0);
  });

  it("handles single target", () => {
    const toon = `targets[1]{id,name,comparisonMethod,tolerance,baselinePath,actualPath}:
  t1,Test,json-deep-equal,1.0,b.json,a.json
`;
    const config = parseConvergeConfig(toon);
    expect(config.targets).toHaveLength(1);
    expect(config.targets[0].id).toBe("t1");
  });
});

describe("serializeConvergeConfig", () => {
  it("round-trips through parseConvergeConfig", () => {
    const original = parseConvergeConfig(SAMPLE_CONFIG);
    const serialized = serializeConvergeConfig(original);
    const parsed = parseConvergeConfig(serialized);

    expect(parsed.targets).toHaveLength(original.targets.length);
    for (let i = 0; i < original.targets.length; i++) {
      expect(parsed.targets[i].id).toBe(original.targets[i].id);
      expect(parsed.targets[i].comparisonMethod).toBe(original.targets[i].comparisonMethod);
      expect(parsed.targets[i].tolerance).toBe(original.targets[i].tolerance);
      expect(parsed.targets[i].baselinePath).toBe(original.targets[i].baselinePath);
      expect(parsed.targets[i].actualPath).toBe(original.targets[i].actualPath);
    }
  });

  it("preserves options through round-trip", () => {
    const original = parseConvergeConfig(SAMPLE_CONFIG);
    const serialized = serializeConvergeConfig(original);
    const parsed = parseConvergeConfig(serialized);

    expect(parsed.targets[0].options?.ignoreFields).toEqual(["timestamp", "requestId"]);
    expect(parsed.targets[0].options?.numericTolerance).toBe(0.001);
    expect(parsed.targets[1].options?.ignoreWhitespace).toBe(true);
  });
});
