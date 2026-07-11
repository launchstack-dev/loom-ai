import { describe, it, expect } from "vitest";
import { encodeToonCell, serializeToonTable } from "../lib/toon-writer.js";
import { parseToon, parseToonArray } from "../lib/toon-reader.js";

describe("encodeToonCell", () => {
  it("passes plain strings through bare", () => {
    expect(encodeToonCell("debt")).toBe("debt");
    expect(encodeToonCell("2026-07-11T00:00:00.000Z")).toBe("2026-07-11T00:00:00.000Z");
    expect(encodeToonCell("a.ts + b.ts")).toBe("a.ts + b.ts");
  });

  it("encodes non-strings as bare tokens", () => {
    expect(encodeToonCell(null)).toBe("null");
    expect(encodeToonCell(true)).toBe("true");
    expect(encodeToonCell(0)).toBe("0");
  });

  it("quotes strings that would re-parse as another type", () => {
    expect(encodeToonCell("null")).toBe('"null"');
    expect(encodeToonCell("true")).toBe('"true"');
    expect(encodeToonCell("42")).toBe('"42"');
  });

  it("quotes strings containing commas, quotes, or edge whitespace", () => {
    expect(encodeToonCell("a,b")).toBe('"a,b"');
    expect(encodeToonCell('say "hi"')).toBe('"say ""hi"""');
    expect(encodeToonCell(" padded ")).toBe('" padded "');
    expect(encodeToonCell("")).toBe('""');
  });
});

describe("serializeToonTable", () => {
  const header = {
    schemaVersion: 1,
    projectName: "loom-ai",
    lastEntry: "2026-07-11T01:02:03.000Z",
    totalEntries: 2,
  };
  const columns = ["commitSha", "timestamp", "filesChanged", "impactedPages", "wikiUpdatedAt", "status"];
  const rows = [
    {
      commitSha: "abc1234",
      timestamp: "2026-07-11T01:00:00.000Z",
      filesChanged: "hooks/a.ts + hooks/b.ts",
      impactedPages: "page-one + page-two",
      wikiUpdatedAt: null,
      status: "debt",
    },
    {
      commitSha: "def5678",
      timestamp: "2026-07-11T01:02:03.000Z",
      filesChanged: 'weird,"name".ts',
      impactedPages: "",
      wikiUpdatedAt: "2026-07-11T01:05:00.000Z",
      status: "n/a",
    },
  ];

  it("round-trips the header through parseToon", () => {
    const out = serializeToonTable(header, "entries", columns, rows);
    const parsed = parseToon(out);
    expect(parsed["schemaVersion"]).toBe(1);
    expect(parsed["projectName"]).toBe("loom-ai");
    expect(parsed["lastEntry"]).toBe("2026-07-11T01:02:03.000Z");
    expect(parsed["totalEntries"]).toBe(2);
  });

  it("round-trips rows through parseToonArray, preserving cells with commas and quotes", () => {
    const out = serializeToonTable(header, "entries", columns, rows);
    const parsed = parseToonArray(out, "entries");
    expect(parsed.length).toBe(2);
    expect(parsed[0]["commitSha"]).toBe("abc1234");
    expect(parsed[0]["filesChanged"]).toBe("hooks/a.ts + hooks/b.ts");
    expect(parsed[1]["filesChanged"]).toBe('weird,"name".ts');
    expect(parsed[1]["status"]).toBe("n/a");
  });

  it("emits the freshness-ledger shape (typed table header, 2-space rows)", () => {
    const out = serializeToonTable(header, "entries", columns, rows);
    expect(out).toContain("entries[2]{commitSha,timestamp,filesChanged,impactedPages,wikiUpdatedAt,status}:");
    expect(out.endsWith("\n")).toBe(true);
    const rowLines = out.split("\n").filter((l) => l.startsWith("  "));
    expect(rowLines.length).toBe(2);
  });
});
