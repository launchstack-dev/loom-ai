/**
 * tests/lib/csv.test.ts — PLAN-exceed-gstack Phase 2a (F-02, defect 8).
 *
 * The shared CSV splitter/joiner is the single source of truth replacing
 * three divergent local implementations. Regression cases below are pinned
 * to each call site:
 *
 *   - hooks/lib/toon-reader.ts:125   (splitCsvRow — LOSES escaped `""`)
 *   - scripts/loom-change/archive.ts:1119 (splitCsvLine — correct reference)
 *   - scripts/materialize-contracts.ts:787 (splitCsv — preserves quote chars)
 *
 * Plus seeded property tests (C-47 class): split(join(fields)) round-trips
 * for generated field arrays with embedded commas, quotes, and newlines.
 *
 * Run: bunx vitest run tests/lib/csv.test.ts
 */

import { describe, it, expect } from "vitest";
import { splitCsvLine, joinCsvLine } from "../../lib/csv.js";

// ---------------------------------------------------------------------------
// Basic splitting
// ---------------------------------------------------------------------------

describe("splitCsvLine — plain fields", () => {
  it("splits unquoted fields on the delimiter", () => {
    expect(splitCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("returns a single empty field for the empty line (CSV semantics)", () => {
    expect(splitCsvLine("")).toEqual([""]);
  });

  it("preserves empty fields between and after delimiters", () => {
    expect(splitCsvLine("a,,b")).toEqual(["a", "", "b"]);
    expect(splitCsvLine("a,")).toEqual(["a", ""]);
    expect(splitCsvLine(",a")).toEqual(["", "a"]);
  });

  it("does not trim whitespace by default", () => {
    expect(splitCsvLine(" a , b ")).toEqual([" a ", " b "]);
  });
});

describe("splitCsvLine — quoted fields", () => {
  it("keeps delimiters inside quoted fields", () => {
    expect(splitCsvLine('a,"b,c",d')).toEqual(["a", "b,c", "d"]);
  });

  it("strips surrounding quotes by default", () => {
    expect(splitCsvLine('"hello"')).toEqual(["hello"]);
  });

  it("keeps literal newlines inside quoted fields", () => {
    expect(splitCsvLine('a,"b\nc"')).toEqual(["a", "b\nc"]);
  });

  it("is lenient on an unterminated quote (runs to end of line, no throw)", () => {
    expect(splitCsvLine('"abc')).toEqual(["abc"]);
    expect(splitCsvLine('a,"b,c')).toEqual(["a", "b,c"]);
  });
});

// ---------------------------------------------------------------------------
// Regression: hooks/lib/toon-reader.ts:125 (the escaped-quote miss)
// ---------------------------------------------------------------------------

describe("regression — hooks/lib/toon-reader.ts:125 escaped double-quotes", () => {
  // splitCsvRow toggled `inQuotes` on EVERY quote char, so `"b""c"` came
  // back as `bc`. The shared splitter must preserve the embedded quote.
  it('parses `""` inside a quoted field as a literal quote (F-02.S-01)', () => {
    expect(splitCsvLine('a,"b""c",d')).toEqual(["a", 'b"c', "d"]);
  });

  it("handles escaped quotes at the end of a field", () => {
    expect(splitCsvLine('"He said ""hi"""')).toEqual(['He said "hi"']);
  });

  it("handles a field that is a single escaped quote", () => {
    expect(splitCsvLine('""""')).toEqual(['"']);
  });

  it("handles escaped quotes combined with embedded delimiters", () => {
    expect(splitCsvLine('"a"",""b",c')).toEqual(['a","b', "c"]);
  });
});

// ---------------------------------------------------------------------------
// Regression: scripts/loom-change/archive.ts:1119 (correct reference impl)
// ---------------------------------------------------------------------------

describe("regression — scripts/loom-change/archive.ts:1119 reference behavior", () => {
  // archive.ts splitCsvLine: collapses `""`, strips quotes, trims fields.
  // (Its trailing `.filter((s) => s.length > 0)` is caller-side policy.)
  it("reproduces the reference behavior via { trim: true }", () => {
    expect(splitCsvLine('given text, "quoted, with comma" ,tail', { trim: true })).toEqual([
      "given text",
      "quoted, with comma",
      "tail",
    ]);
  });

  it("collapses escaped quotes exactly like the reference impl", () => {
    expect(splitCsvLine('x,"He said ""hi""",y', { trim: true })).toEqual([
      "x",
      'He said "hi"',
      "y",
    ]);
  });

  it("supports the caller-side empty-field filter unchanged", () => {
    const fields = splitCsvLine("a,,b, ,c", { trim: true }).filter((s) => s.length > 0);
    expect(fields).toEqual(["a", "b", "c"]);
  });

  it("trims whitespace outside quotes but preserves it inside quotes", () => {
    expect(splitCsvLine(' " a b " ', { trim: true })).toEqual([" a b "]);
  });
});

// ---------------------------------------------------------------------------
// Regression: scripts/materialize-contracts.ts:787 (quote-preservation)
// ---------------------------------------------------------------------------

describe("regression — scripts/materialize-contracts.ts:787 quote preservation", () => {
  // materialize-contracts splitCsv keeps quote chars verbatim in the field
  // so the caller can apply its own stripQuotes.
  it("keeps surrounding quotes verbatim with { preserveQuotes: true }", () => {
    expect(splitCsvLine('a,"b,c",d', { preserveQuotes: true })).toEqual(["a", '"b,c"', "d"]);
  });

  it("keeps escaped quotes verbatim with { preserveQuotes: true }", () => {
    expect(splitCsvLine('"b""c"', { preserveQuotes: true })).toEqual(['"b""c"']);
  });

  it("composes with a caller-side stripQuotes to match the old call site", () => {
    const stripQuotes = (s: string): string =>
      s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
    const fields = splitCsvLine('name,"desc, long",flag', { preserveQuotes: true });
    expect(fields.map(stripQuotes)).toEqual(["name", "desc, long", "flag"]);
  });
});

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

describe("splitCsvLine — delimiter and quote options", () => {
  it("supports a custom delimiter", () => {
    expect(splitCsvLine("a;b;c", { delimiter: ";" })).toEqual(["a", "b", "c"]);
  });

  it("supports a custom quote character", () => {
    expect(splitCsvLine("a,'b,c',d", { quote: "'" })).toEqual(["a", "b,c", "d"]);
    expect(splitCsvLine("'a''b'", { quote: "'" })).toEqual(["a'b"]);
  });
});

// ---------------------------------------------------------------------------
// joinCsvLine — quoting/escaping inverse
// ---------------------------------------------------------------------------

describe("joinCsvLine", () => {
  it("leaves plain fields unquoted", () => {
    expect(joinCsvLine(["a", "b", "c"])).toBe("a,b,c");
  });

  it("quotes fields containing the delimiter", () => {
    expect(joinCsvLine(["a", "b,c"])).toBe('a,"b,c"');
  });

  it("quotes and doubles embedded quote characters", () => {
    expect(joinCsvLine(['b"c'])).toBe('"b""c"');
  });

  it("quotes fields with newlines and leading/trailing whitespace", () => {
    expect(joinCsvLine(["a\nb", " c "])).toBe('"a\nb"," c "');
  });

  it("round-trips hand-picked hard cases through splitCsvLine", () => {
    const cases: string[][] = [
      ["a", "b,c", 'd"e'],
      ['He said "hi"', ""],
      ["line\nbreak", "\r", "  padded  "],
      ['"', '""', '","'],
      [""],
      ["", "", ""],
    ];
    for (const fields of cases) {
      expect(splitCsvLine(joinCsvLine(fields))).toEqual(fields);
    }
  });
});

// ---------------------------------------------------------------------------
// Property tests (seeded, deterministic) — C-47 class
// ---------------------------------------------------------------------------

/** mulberry32 — tiny deterministic PRNG so failures are reproducible by seed. */
function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIELD_CHARS = [
  "a", "b", "z", "A", "0", "9", " ", ",", '"', "'", "\n", "\r", "\t",
  "\\", ";", ":", "-", "_", "é", "★", ".",
];

function genField(rnd: () => number): string {
  const len = Math.floor(rnd() * 10);
  let s = "";
  for (let i = 0; i < len; i++) {
    s += FIELD_CHARS[Math.floor(rnd() * FIELD_CHARS.length)];
  }
  return s;
}

function genFields(rnd: () => number): string[] {
  const n = 1 + Math.floor(rnd() * 6);
  const fields: string[] = [];
  for (let i = 0; i < n; i++) fields.push(genField(rnd));
  return fields;
}

describe("property — splitCsvLine(joinCsvLine(fields)) round-trips", () => {
  it("holds for 500 seeded random field arrays (commas, quotes, newlines)", () => {
    for (let seed = 1; seed <= 500; seed++) {
      const rnd = mulberry32(seed);
      const fields = genFields(rnd);
      const line = joinCsvLine(fields);
      let roundTripped: string[];
      try {
        roundTripped = splitCsvLine(line);
      } catch (e) {
        throw new Error(
          `seed ${seed}: splitCsvLine threw for fields ${JSON.stringify(fields)} ` +
            `(line ${JSON.stringify(line)}): ${String(e)}`
        );
      }
      expect(roundTripped, `seed ${seed}, line ${JSON.stringify(line)}`).toEqual(fields);
    }
  });

  it("joined output never contains an unquoted bare newline outside quotes", () => {
    // Sanity companion: split on real newline boundaries must never be
    // performed by callers on joined output; every newline is inside quotes.
    for (let seed = 1; seed <= 100; seed++) {
      const rnd = mulberry32(seed * 7919);
      const fields = genFields(rnd);
      const line = joinCsvLine(fields);
      // Re-splitting must yield exactly fields.length fields — newlines and
      // commas inside fields never create extra field boundaries.
      expect(splitCsvLine(line).length, `seed ${seed}`).toBe(fields.length);
    }
  });
});
