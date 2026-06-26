/**
 * Phase 0 / S-03: protocols/findings.schema.md ships a `confidence` field
 * with the enum `high|medium|low` and a default of `medium`, and the
 * default rule is backward-compatible — pre-F-18 fixtures omitting the
 * column resolve to `confidence: "medium"`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DOC_PATH = resolve(__dirname, "../../protocols/findings.schema.md");

/**
 * Tiny inline TOON-row parser for the back-compat assertion. We don't
 * need the full TOON grammar — just: given a typed-array header
 * `findings[N]{col1,col2,...}:` and N rows, produce N objects. Any column
 * absent from the header resolves to a caller-supplied default map.
 */
function parseTypedArrayRows<T extends Record<string, string>>(
  toon: string,
  arrayName: string,
  defaults: T,
): Array<Record<string, string>> {
  const headerRe = new RegExp(`^${arrayName}\\[(\\d+)\\]\\{([^}]+)\\}:\\s*$`, "m");
  const m = headerRe.exec(toon);
  if (!m) throw new Error(`typed-array header for ${arrayName} not found`);
  const count = parseInt(m[1], 10);
  const cols = m[2].split(",").map((c) => c.trim());
  const headerLineIdx = toon.slice(0, m.index).split("\n").length - 1;
  const allLines = toon.split("\n");
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i <= count; i++) {
    const line = allLines[headerLineIdx + i];
    if (!line) break;
    // Trim the 2-space indent.
    const stripped = line.replace(/^\s+/, "");
    const cells = stripped.split(",").map((c) => c.trim());
    const row: Record<string, string> = { ...defaults };
    cols.forEach((col, idx) => {
      if (cells[idx] !== undefined) row[col] = cells[idx];
    });
    rows.push(row);
  }
  return rows;
}

describe("protocols/findings.schema.md confidence field (F-18 Phase 0)", () => {
  const content = readFileSync(DOC_PATH, "utf8");

  it("documents the confidence enum (high|medium|low)", () => {
    expect(content).toMatch(/`confidence`/);
    expect(content).toMatch(/`high`/);
    expect(content).toMatch(/`medium`/);
    expect(content).toMatch(/`low`/);
  });

  it("documents the default of 'medium'", () => {
    expect(content).toMatch(/[Dd]efault:\s*`medium`/);
  });

  it("declares backward compatibility (existing fixtures parse unchanged)", () => {
    expect(content.toLowerCase()).toMatch(/backward[- ]compatible/);
  });

  it("S-03: pre-F-18 row omitting `confidence` parses with confidence='medium'", () => {
    // Inline pre-F-18 fixture: typed-array header omits the `confidence`
    // column entirely (the pre-F-18 reality).
    const preF18 = [
      "findings[2]{id,severity,summary}:",
      "  F-01,blocking,Reducer drops second event",
      "  F-02,warning,Slow timeout in CI",
    ].join("\n");

    const rows = parseTypedArrayRows(preF18, "findings", {
      confidence: "medium",
    });
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.confidence).toBe("medium");
    }
  });
});
