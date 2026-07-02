/**
 * tests/lib/toon-roundtrip.test.ts — PLAN-exceed-gstack Phase 2a (F-02).
 *
 * Round-trip suite for lib/toon.ts:
 *   - Fixture docs covering every grammar form in the CLAUDE.md quick
 *     reference (flat scalar, inline array, typed table, nested block).
 *   - F-02.S-01 regression: a typed-table cell containing an escaped `""`
 *     sequence preserves the embedded quote (the hooks/lib/toon-reader.ts:125
 *     class of defect, fixed via the shared lib/csv.ts splitter).
 *   - ToonParseError contract: line/col-carrying errors on invalid input.
 *   - Seeded PROPERTY tests (C-47 class): parseToon(serializeToon(x))
 *     deep-equals x for generated arbitrary ToonValue, and serialization is
 *     canonically stable (serialize ∘ parse ∘ serialize === serialize).
 *
 * Run: bunx vitest run tests/lib/toon-roundtrip.test.ts
 */

import { describe, it, expect } from "vitest";
import { parseToon, serializeToon, ToonParseError } from "../../lib/toon.js";
import type { ToonValue } from "../../lib/types.js";

// ---------------------------------------------------------------------------
// Grammar fixtures (CLAUDE.md quick reference)
// ---------------------------------------------------------------------------

describe("parseToon — CLAUDE.md quick-reference grammar", () => {
  const doc = [
    "key: value",
    "arrayName[3]: item1, item2, item3",
    "tableName[2]{col1,col2,col3}:",
    "  val1a,val1b,val1c",
    "  val2a,val2b,val2c",
    "blockName:",
    "  nestedKey: value",
    "",
  ].join("\n");

  const expected = {
    key: "value",
    arrayName: ["item1", "item2", "item3"],
    tableName: [
      { col1: "val1a", col2: "val1b", col3: "val1c" },
      { col1: "val2a", col2: "val2b", col3: "val2c" },
    ],
    blockName: { nestedKey: "value" },
  };

  it("parses all four grammar forms", () => {
    expect(parseToon(doc)).toEqual(expected);
  });

  it("serializes back to the exact canonical text", () => {
    expect(serializeToon(expected)).toBe(doc);
  });

  it("round-trips", () => {
    expect(parseToon(serializeToon(parseToon(doc)))).toEqual(expected);
  });

  it("parses CRLF line endings identically", () => {
    expect(parseToon(doc.replace(/\n/g, "\r\n"))).toEqual(expected);
  });
});

describe("parseToon — repo-convention fixtures", () => {
  it("parses an AgentResult-style envelope", () => {
    const doc = [
      "agent: implementer-agent",
      "wave: 1",
      "taskId: w1-p2a-parsers",
      "status: success",
      "filesCreated[2]: lib/toon.ts, lib/csv.ts",
      "filesDeleted[0]:",
      "issues[1]{severity,description,file,line}:",
      '  info,"Spec ambiguity, resolved",lib/toon.ts,1',
      "durationMs: 1234",
    ].join("\n");
    expect(parseToon(doc)).toEqual({
      agent: "implementer-agent",
      wave: 1,
      taskId: "w1-p2a-parsers",
      status: "success",
      filesCreated: ["lib/toon.ts", "lib/csv.ts"],
      filesDeleted: [],
      issues: [
        {
          severity: "info",
          description: "Spec ambiguity, resolved",
          file: "lib/toon.ts",
          line: 1,
        },
      ],
      durationMs: 1234,
    });
  });

  it("parses a progress-heartbeat document with typed values", () => {
    const doc = [
      "taskId: w1-p2a-parsers",
      "percentComplete: 55",
      "done: false",
      "blockedBy: null",
      "checkpointCount: 3",
    ].join("\n");
    expect(parseToon(doc)).toEqual({
      taskId: "w1-p2a-parsers",
      percentComplete: 55,
      done: false,
      blockedBy: null,
      checkpointCount: 3,
    });
  });
});

// ---------------------------------------------------------------------------
// F-02.S-01 — escaped double-quotes in table cells
// ---------------------------------------------------------------------------

describe("F-02.S-01 — escaped double-quotes survive table-cell parsing", () => {
  it('preserves the embedded quote character from `""`', () => {
    const doc = ['rows[1]{name,desc}:', '  x,"He said ""hi"""'].join("\n");
    expect(parseToon(doc)).toEqual({
      rows: [{ name: "x", desc: 'He said "hi"' }],
    });
  });

  it("round-trips quoted cells containing commas and quotes", () => {
    const value = {
      rows: [
        { name: "a,b", desc: 'quote " inside' },
        { name: "plain", desc: "" },
      ],
    };
    expect(parseToon(serializeToon(value))).toEqual(value);
  });

  it("round-trips inline-array items containing commas and quotes", () => {
    const value = { items: ['a"b', "c,d", "", "  padded  "] };
    expect(parseToon(serializeToon(value))).toEqual(value);
  });
});

// ---------------------------------------------------------------------------
// Canonical-form distinctions and edge fixtures
// ---------------------------------------------------------------------------

describe("canonical distinctions", () => {
  it("`key:` with no children is an empty object; `key: \"\"` is an empty string", () => {
    expect(parseToon("key:")).toEqual({ key: {} });
    expect(parseToon('key: ""')).toEqual({ key: "" });
    expect(serializeToon({ key: {} })).toBe("key:\n");
    expect(serializeToon({ key: "" })).toBe('key: ""\n');
  });

  it("`key[0]:` is an empty array", () => {
    expect(parseToon("key[0]:")).toEqual({ key: [] });
    expect(serializeToon({ key: [] })).toBe("key[0]:\n");
  });

  it("empty document parses to {}", () => {
    expect(parseToon("")).toEqual({});
    expect(parseToon("   \n\n  \n")).toEqual({});
    expect(serializeToon({})).toBe("");
  });
});

describe("edge fixtures round-trip", () => {
  const fixtures: ToonValue[] = [
    // deep nesting
    { a: { b: { c: { d: [1, 2, { e: "f" }] } } } },
    // mixed array → general list form
    { mixed: [1, "two", null, [3, 4], { k: "v" }, {}, []] },
    // strings that look like other tokens
    { s1: "true", s2: "42", s3: "null", s4: "NaN", s5: "-0", s6: "1e5", s7: "007" },
    // whitespace-significant and control-char strings
    { pad: "  x  ", nl: "line\nbreak", tab: "a\tb", cr: "a\rb", bs: "back\\slash" },
    // strings resembling TOON syntax
    { t1: "key: value", t2: "[3]: x", t3: "- item", t4: "{col1,col2}", t5: "a[2]" },
    // non-bare-safe keys (quoted-key form)
    { "": 1, " spaced key ": 2, 'q"k': 3, "colon:key": 4, "arr[2]": 5, "0": 6 },
    // numbers incl. specials
    { z: 0, nz: -0, f: 3.14, neg: -2.5, big: 1e21, tiny: 5e-7, nan: NaN, inf: Infinity, ninf: -Infinity },
    // unicode
    { "café": "crème brûlée ★", emoji: "🚀" },
    // scalar and array top-levels (serializeToon is total over ToonValue)
    "plain scalar",
    "a: b",
    "a[3]",
    "",
    42,
    -0,
    null,
    true,
    [],
    [1, "two", { three: 3 }],
    [{ id: 1, ok: true }, { id: 2, ok: false }],
  ];

  it.each(fixtures.map((f, i) => [i, f] as const))(
    "fixture %#: parseToon(serializeToon(x)) deep-equals x",
    (_i, fixture) => {
      expect(parseToon(serializeToon(fixture))).toEqual(fixture);
    }
  );

  it("serialization is canonically stable across a parse cycle", () => {
    for (const fixture of fixtures) {
      const once = serializeToon(fixture);
      expect(serializeToon(parseToon(once))).toBe(once);
    }
  });
});

// ---------------------------------------------------------------------------
// Prototype-pollution safety
// ---------------------------------------------------------------------------

describe("parseToon — __proto__ safety", () => {
  it("stores __proto__ as an own property and never mutates the prototype", () => {
    const result = parseToon('"__proto__": 1') as { [key: string]: ToonValue };
    expect(Object.getOwnPropertyDescriptor(result, "__proto__")?.value).toBe(1);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ToonParseError contract
// ---------------------------------------------------------------------------

describe("parseToon — ToonParseError with line/col", () => {
  const expectError = (text: string, lineNo: number): ToonParseError => {
    let caught: unknown;
    try {
      parseToon(text);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ToonParseError);
    const err = caught as ToonParseError;
    expect(err.name).toBe("ToonParseError");
    expect(err.line).toBe(lineNo);
    expect(err.col).toBeGreaterThanOrEqual(1);
    return err;
  };

  it("rejects tab indentation", () => {
    expectError("a: 1\n\tb: 2", 2);
  });

  it("rejects an indented document root", () => {
    expectError("  a: 1", 1);
  });

  it("rejects duplicate keys", () => {
    expectError("a: 1\na: 2", 2);
  });

  it("rejects a table row count mismatch", () => {
    expectError("t[2]{a,b}:\n  1,2", 1);
  });

  it("rejects a table cell count mismatch", () => {
    expectError("t[1]{a,b}:\n  1,2,3", 2);
  });

  it("rejects an inline array count mismatch", () => {
    expectError("a[3]: x, y", 1);
  });

  it("rejects unexpected indentation", () => {
    expectError("a: 1\n    b: 2", 2);
  });

  it("rejects a non-entry line inside a multi-line document", () => {
    expectError("a: 1\njust text", 2);
  });

  it("rejects a list item count mismatch", () => {
    expectError("a[2]:\n  - 1", 1);
  });

  it("includes line and col in the message", () => {
    const err = expectError("a: 1\na: 2", 2);
    expect(err.message).toContain("line 2");
    expect(err.message).toContain("col");
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

function pick<T>(rnd: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rnd() * arr.length)];
}

const STRING_CHARS = [
  "a", "b", "Z", "0", "9", " ", ",", '"', "\\", "\n", "\r", "\t",
  ":", "[", "]", "{", "}", "-", "#", ".", "é", "★", "_", "'",
];

const SPECIAL_STRINGS = [
  "", " ", "true", "false", "null", "NaN", "Infinity", "-0", "042", "1e5",
  "a,b", 'quote"inside', "line\nbreak", "back\\slash", "  padded  ",
  "key: value", "[3]: x", "- item", "a[2]", "{cols}", "café ★",
];

const SPECIAL_NUMBERS = [
  0, -0, 1, -1, 42, 3.14, -2.5, 1e21, 5e-7, NaN, Infinity, -Infinity, 123456789.25,
];

const KEY_POOL = [
  "alpha", "b2", "snake_case", "kebab-case", "dot.key", "$dollar",
  "", " ", "with space", 'q"k', "colon:key", "arr[2]", "__proto__", "0", "-dash", "é",
];

function genString(rnd: () => number): string {
  if (rnd() < 0.35) return pick(rnd, SPECIAL_STRINGS);
  const len = Math.floor(rnd() * 10);
  let s = "";
  for (let i = 0; i < len; i++) s += pick(rnd, STRING_CHARS);
  return s;
}

function genScalar(rnd: () => number): ToonValue {
  const r = rnd();
  if (r < 0.35) return genString(rnd);
  if (r < 0.55) return pick(rnd, SPECIAL_NUMBERS);
  if (r < 0.7) return Math.floor(rnd() * 2000) - 1000;
  if (r < 0.8) return rnd() * 100 - 50;
  if (r < 0.9) return rnd() < 0.5;
  return null;
}

function defineOwn(obj: { [key: string]: ToonValue }, key: string, value: ToonValue): void {
  // defineProperty so generated keys like "__proto__" become own properties.
  Object.defineProperty(obj, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function genObject(rnd: () => number, depth: number): { [key: string]: ToonValue } {
  const obj: { [key: string]: ToonValue } = {};
  const n = Math.floor(rnd() * 5);
  for (let i = 0; i < n; i++) {
    const key = rnd() < 0.6 ? pick(rnd, KEY_POOL) + i : genString(rnd);
    if (Object.prototype.hasOwnProperty.call(obj, key)) continue;
    defineOwn(obj, key, genValue(rnd, depth - 1));
  }
  return obj;
}

function genArray(rnd: () => number, depth: number): ToonValue[] {
  const r = rnd();
  if (r < 0.15) return [];
  if (r < 0.5) {
    // all-scalar → inline form
    const n = 1 + Math.floor(rnd() * 5);
    return Array.from({ length: n }, () => genScalar(rnd));
  }
  if (r < 0.7) {
    // uniform flat rows → typed-table form
    const n = 1 + Math.floor(rnd() * 4);
    return Array.from({ length: n }, () => {
      const row: { [key: string]: ToonValue } = {};
      defineOwn(row, "id", Math.floor(rnd() * 100));
      defineOwn(row, "name", genString(rnd));
      defineOwn(row, "ok", rnd() < 0.5);
      return row;
    });
  }
  // mixed → general list form
  const n = 1 + Math.floor(rnd() * 4);
  return Array.from({ length: n }, () => genValue(rnd, depth - 1));
}

function genValue(rnd: () => number, depth: number): ToonValue {
  if (depth <= 0) return genScalar(rnd);
  const r = rnd();
  if (r < 0.5) return genScalar(rnd);
  if (r < 0.75) return genArray(rnd, depth);
  return genObject(rnd, depth);
}

/** Top-level generator: mostly objects (the realistic document shape). */
function genTopLevel(rnd: () => number, seed: number): ToonValue {
  switch (seed % 6) {
    case 0:
    case 1:
    case 2:
      return genObject(rnd, 3);
    case 3:
      return genArray(rnd, 3);
    case 4:
      return genScalar(rnd);
    default:
      return genValue(rnd, 3);
  }
}

describe("property — parseToon(serializeToon(x)) deep-equals x", () => {
  it("holds for 250 seeded arbitrary ToonValue documents", () => {
    for (let seed = 1; seed <= 250; seed++) {
      const rnd = mulberry32(seed);
      const value = genTopLevel(rnd, seed);
      let text: string;
      let roundTripped: ToonValue;
      try {
        text = serializeToon(value);
        roundTripped = parseToon(text);
      } catch (e) {
        throw new Error(
          `seed ${seed}: threw for value ${JSON.stringify(value)}: ${String(e)}`
        );
      }
      expect(
        roundTripped,
        `seed ${seed}, doc:\n${text}\nvalue: ${JSON.stringify(value)}`
      ).toEqual(value);
    }
  });

  it("serialization is canonically stable for 250 seeded documents", () => {
    for (let seed = 1; seed <= 250; seed++) {
      const rnd = mulberry32(seed * 104729);
      const value = genTopLevel(rnd, seed);
      const once = serializeToon(value);
      expect(serializeToon(parseToon(once)), `seed ${seed}, doc:\n${once}`).toBe(once);
    }
  });
});
