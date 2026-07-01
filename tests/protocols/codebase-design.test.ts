/**
 * Phase 0 / S-02: protocols/codebase-design.md Section 0 vocabulary-mapping
 * table parses into exactly 10 rows, each with a non-empty "When to use
 * which" column.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DOC_PATH = resolve(__dirname, "../../protocols/codebase-design.md");

interface Row {
  term: string;
  definition: string;
  conflictsWith: string;
  whenToUseWhich: string;
}

/**
 * Extract the first Markdown table that follows the "Section 0" heading,
 * skipping the header + separator rows. Returns one Row per data row.
 */
function parseSection0Table(content: string): Row[] {
  const lines = content.split(/\r?\n/);
  // Locate Section 0 heading.
  let i = lines.findIndex((l) => /^##\s+Section\s+0\b/i.test(l));
  if (i < 0) throw new Error("Section 0 heading not found");
  // Scan forward to first table header row.
  while (i < lines.length && !lines[i].trim().startsWith("| Term")) i++;
  if (i >= lines.length) throw new Error("Section 0 table header not found");
  const headerIdx = i;
  // Skip header + separator.
  let j = headerIdx + 2;
  const rows: Row[] = [];
  while (j < lines.length && lines[j].trim().startsWith("|")) {
    const cells = lines[j]
      .split("|")
      .slice(1, -1) // drop empties from leading/trailing `|`
      .map((c) => c.trim());
    if (cells.length >= 4) {
      rows.push({
        term: cells[0],
        definition: cells[1],
        conflictsWith: cells[2],
        whenToUseWhich: cells[3],
      });
    }
    j++;
  }
  return rows;
}

describe("protocols/codebase-design.md Section 0", () => {
  const content = readFileSync(DOC_PATH, "utf8");
  const rows = parseSection0Table(content);

  it("contains exactly 10 rows (S-02)", () => {
    expect(rows.length).toBe(10);
  });

  it("every row has a non-empty 'When to use which' column (S-02)", () => {
    for (const r of rows) {
      expect(r.whenToUseWhich.length).toBeGreaterThan(0);
      expect(r.whenToUseWhich).not.toBe("—");
    }
  });

  it("covers the seven canonical terms", () => {
    const terms = rows.map((r) => r.term);
    for (const required of [
      "Module",
      "Interface",
      "Depth",
      "Seam",
      "Adapter",
      "Leverage",
      "Locality",
    ]) {
      expect(terms).toContain(required);
    }
  });

  it("defines the deletion-test subsection", () => {
    expect(content).toMatch(/##\s+The deletion test/);
  });

  it("defines the 'interface is the test surface' subsection", () => {
    expect(content).toMatch(/##\s+"Interface is the test surface"/);
  });
});
