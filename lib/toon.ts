/**
 * lib/toon.ts — SharedCoreModule "toon" (PLAN-exceed-gstack Phase 2a, C-02).
 *
 * TOON (Token-Oriented Object Notation) parse + serialize, covering the full
 * grammar from the CLAUDE.md quick reference:
 *
 *   key: value                          flat scalar
 *   arrayName[N]: item1, item2, item3   inline array (all-scalar)
 *   arrayName[N]{col1,col2}:            typed array (table)
 *     val1a,val1b                         one row per line, 2-space indent
 *   blockName:                          nested block (object)
 *     nestedKey: value                    2-space indent
 *
 * Plus the canonical extensions required to make `serializeToon` total over
 * `ToonValue` (so `parseToon(serializeToon(x))` deep-equals `x` for ANY x):
 *
 *   key[N]:                             general list (arrays not expressible
 *     - scalarItem                        inline or as a table: mixed types,
 *     -                                   nested arrays/objects). A bare `-`
 *       nestedKey: value                  is followed by an indented
 *     -                                   anonymous object, or an anonymous
 *       [2]: 1, 2                         `[N]…` array line, or nothing ({}).
 *
 *   "quoted key": value                 keys that aren't bare-safe
 *   [N]: …                              anonymous array at document root
 *   scalar-token                        single-scalar document
 *
 * Canonical form rules (what `serializeToon` emits):
 * - 2-space indentation per level; stable key order (insertion order).
 * - Empty array → `key[0]:`. Empty object → `key:` with no children.
 *   Empty string → `key: ""` (always quoted, so it can't collide with {}).
 * - Strings are quoted iff needed: empty, leading/trailing whitespace, or
 *   containing `"` `\` `,` or control chars, or when the bare token would
 *   re-parse as null/boolean/number.
 * - Inside quotes: embedded `"` doubles to `""` (CSV convention, shared with
 *   lib/csv.ts); `\` `\n` `\r` `\t` and other control chars use backslash
 *   escapes (`\\`, `\n`, `\r`, `\t`, `\uXXXX`) so every value stays on one
 *   physical line.
 * - Table form is chosen for non-empty arrays of flat objects sharing the
 *   same bare-safe key sequence with all-scalar values; rows reuse the
 *   shared CSV conventions and are parsed with lib/csv.ts `splitCsvLine`
 *   (single source of truth — defect 8).
 *
 * `parseToon` throws `ToonParseError` (with 1-based line/col) on grammar
 * violations: tab indentation, inconsistent indent, duplicate keys,
 * count/row/cell mismatches, malformed entries.
 *
 * Library only — no CLI entry point (shared-core.schema.md).
 */

import type { ToonScalar, ToonValue } from "./types.js";
import { splitCsvLine } from "./csv.js";

/** Runtime error thrown by `parseToon` on invalid input (line/col are 1-based). */
export class ToonParseError extends Error {
  readonly line: number;
  readonly col: number;

  constructor(message: string, line: number, col: number) {
    super(`${message} (line ${line}, col ${col})`);
    this.name = "ToonParseError";
    this.line = line;
    this.col = col;
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * Shared scalar-token encoding/decoding
 * ──────────────────────────────────────────────────────────────────────── */

const NUMBER_RE = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const BARE_KEY_RE = /^[A-Za-z_$][A-Za-z0-9_$.-]*$/;

/** Interpret an UNQUOTED token: keywords and numbers, else the verbatim string. */
function parseUnquotedToken(token: string): ToonScalar {
  if (token === "null") return null;
  if (token === "true") return true;
  if (token === "false") return false;
  if (token === "NaN") return NaN;
  if (token === "Infinity") return Infinity;
  if (token === "-Infinity") return -Infinity;
  if (NUMBER_RE.test(token)) return Number(token);
  return token;
}

/** True when a string cannot survive as a bare (unquoted) token. */
function needsQuoting(s: string): boolean {
  if (s === "") return true;
  if (s !== s.trim()) return true;
  // eslint-disable-next-line no-control-regex
  if (/["\\,\u0000-\u001f]/.test(s)) return true;
  return typeof parseUnquotedToken(s) !== "string";
}

/** Wrap a string in quotes: backslash-escape control chars, double embedded quotes. */
function quoteString(s: string): string {
  let escaped = s
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  escaped = escaped.replace(/"/g, '""');
  return '"' + escaped + '"';
}

/** Inverse of the backslash escapes applied by `quoteString`. */
function backslashDecode(s: string): string {
  if (!s.includes("\\")) return s;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = s[i + 1];
    if (next === "\\") {
      out += "\\";
      i++;
    } else if (next === "n") {
      out += "\n";
      i++;
    } else if (next === "r") {
      out += "\r";
      i++;
    } else if (next === "t") {
      out += "\t";
      i++;
    } else if (next === "u" && /^[0-9a-fA-F]{4}$/.test(s.slice(i + 2, i + 6))) {
      out += String.fromCharCode(parseInt(s.slice(i + 2, i + 6), 16));
      i += 5;
    } else {
      out += ch; // lone backslash: keep verbatim (lenient for hand-authored files)
    }
  }
  return out;
}

function encodeNumber(n: number): string {
  if (Number.isNaN(n)) return "NaN";
  if (n === Infinity) return "Infinity";
  if (n === -Infinity) return "-Infinity";
  if (Object.is(n, -0)) return "-0";
  return String(n);
}

/** Serialize one scalar to a single-line token. */
function encodeScalar(v: ToonScalar): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return encodeNumber(v);
  return needsQuoting(v) ? quoteString(v) : v;
}

/** Decode one scalar token (possibly quoted). Inverse of `encodeScalar`. */
function decodeScalarToken(token: string): ToonScalar {
  if (token.length >= 2 && token[0] === '"' && token[token.length - 1] === '"') {
    const inner = token.slice(1, -1).replace(/""/g, '"');
    return backslashDecode(inner);
  }
  return parseUnquotedToken(token);
}

/* ────────────────────────────────────────────────────────────────────────
 * Value classification
 * ──────────────────────────────────────────────────────────────────────── */

function isScalar(v: ToonValue): v is ToonScalar {
  return (
    v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean"
  );
}

function isPlainObject(v: ToonValue): v is { [key: string]: ToonValue } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Columns for typed-table form, or null when the array isn't table-eligible.
 * Eligible: non-empty, every item a flat object with the SAME key sequence,
 * every key bare-safe, every value scalar.
 */
function tableColumns(arr: ToonValue[]): string[] | null {
  if (arr.length === 0) return null;
  const first = arr[0];
  if (!isPlainObject(first)) return null;
  const cols = Object.keys(first);
  if (cols.length === 0) return null;
  if (!cols.every((c) => BARE_KEY_RE.test(c))) return null;
  for (const item of arr) {
    if (!isPlainObject(item)) return null;
    const keys = Object.keys(item);
    if (keys.length !== cols.length) return null;
    for (let i = 0; i < cols.length; i++) {
      if (keys[i] !== cols[i]) return null;
      if (!isScalar(item[cols[i]])) return null;
    }
  }
  return cols;
}

/* ────────────────────────────────────────────────────────────────────────
 * serializeToon
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Serialize any `ToonValue` to canonical TOON text.
 * Guarantee: `parseToon(serializeToon(x))` deep-equals `x`.
 */
export function serializeToon(value: ToonValue): string {
  const lines: string[] = [];
  if (isPlainObject(value)) {
    emitObjectEntries(value, 0, lines);
  } else if (Array.isArray(value)) {
    emitArray(null, value, 0, lines);
  } else if (isScalar(value)) {
    lines.push(encodeTopLevelScalar(value));
  } else {
    throw new TypeError(`serializeToon: not a ToonValue: ${String(value)}`);
  }
  return lines.length === 0 ? "" : lines.join("\n") + "\n";
}

/**
 * A top-level scalar occupies the whole document. Bare strings that would
 * re-parse as an object entry or an anonymous array get force-quoted.
 */
function encodeTopLevelScalar(v: ToonScalar): string {
  const token = encodeScalar(v);
  if (typeof v === "string" && token === v && (v.includes(":") || v.includes("["))) {
    return quoteString(v);
  }
  return token;
}

function encodeKey(key: string): string {
  return BARE_KEY_RE.test(key) ? key : quoteString(key);
}

function emitObjectEntries(
  obj: { [key: string]: ToonValue },
  indent: number,
  lines: string[]
): void {
  const pad = " ".repeat(indent);
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    const k = encodeKey(key);
    if (isPlainObject(v)) {
      lines.push(pad + k + ":");
      emitObjectEntries(v, indent + 2, lines);
    } else if (Array.isArray(v)) {
      emitArray(k, v, indent, lines);
    } else if (isScalar(v)) {
      lines.push(pad + k + ": " + encodeScalar(v));
    } else {
      throw new TypeError(`serializeToon: not a ToonValue at key "${key}": ${String(v)}`);
    }
  }
}

/** Emit an array. `key` is null for anonymous arrays (document root / list items). */
function emitArray(
  key: string | null,
  arr: ToonValue[],
  indent: number,
  lines: string[]
): void {
  const pad = " ".repeat(indent);
  const prefix = pad + (key ?? "");

  if (arr.length === 0) {
    lines.push(prefix + "[0]:");
    return;
  }

  if (arr.every(isScalar)) {
    lines.push(prefix + `[${arr.length}]: ` + arr.map(encodeScalar).join(", "));
    return;
  }

  const cols = tableColumns(arr);
  if (cols !== null) {
    lines.push(prefix + `[${arr.length}]{${cols.join(",")}}:`);
    for (const row of arr) {
      const cells = cols.map((c) =>
        encodeScalar((row as { [key: string]: ToonValue })[c] as ToonScalar)
      );
      lines.push(pad + "  " + cells.join(","));
    }
    return;
  }

  // General list form.
  lines.push(prefix + `[${arr.length}]:`);
  for (const item of arr) {
    if (isScalar(item)) {
      lines.push(pad + "  - " + encodeScalar(item));
    } else if (Array.isArray(item)) {
      lines.push(pad + "  -");
      emitArray(null, item, indent + 4, lines);
    } else if (isPlainObject(item)) {
      lines.push(pad + "  -");
      emitObjectEntries(item, indent + 4, lines); // no-op for {}
    } else {
      throw new TypeError(`serializeToon: not a ToonValue in array: ${String(item)}`);
    }
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * parseToon
 * ──────────────────────────────────────────────────────────────────────── */

interface SourceLine {
  /** Content with indentation removed and trailing whitespace trimmed. */
  content: string;
  indent: number;
  /** 1-based line number in the original text. */
  lineNo: number;
}

const ARRAY_HEADER_RE = /^\[(\d+)\](?:\{([^}]*)\})?:(?:\s*(.*))?$/;

function toSourceLines(text: string): SourceLine[] {
  const out: SourceLine[] = [];
  const raw = text.split(/\r\n|\n|\r/);
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i];
    if (line.trim() === "") continue;
    let indent = 0;
    while (indent < line.length && line[indent] === " ") indent++;
    if (line[indent] === "\t") {
      throw new ToonParseError("Tab indentation is not supported", i + 1, indent + 1);
    }
    out.push({ content: line.slice(indent).trimEnd(), indent, lineNo: i + 1 });
  }
  return out;
}

/**
 * Parse TOON text into a `ToonValue`.
 * An empty/whitespace-only document parses to `{}`.
 * Throws `ToonParseError` on invalid input.
 */
export function parseToon(text: string): ToonValue {
  const lines = toSourceLines(text);
  if (lines.length === 0) return {};
  const first = lines[0];
  if (first.indent !== 0) {
    throw new ToonParseError("Unexpected indentation at document root", first.lineNo, 1);
  }

  const p = new Parser(lines);
  let value: ToonValue;
  if (ARRAY_HEADER_RE.test(first.content)) {
    value = p.parseArrayHeader(first);
  } else if (lines.length === 1 && !p.looksLikeEntry(first.content)) {
    value = decodeScalarToken(first.content);
    p.pos = 1;
  } else {
    value = p.parseObject(0);
  }

  if (p.pos < lines.length) {
    const extra = lines[p.pos];
    throw new ToonParseError("Unexpected content after document", extra.lineNo, extra.indent + 1);
  }
  return value;
}

class Parser {
  pos = 0;

  constructor(private readonly lines: SourceLine[]) {}

  private peek(): SourceLine | undefined {
    return this.lines[this.pos];
  }

  /** Does this root line read as a `key: …` / `key[N]…:` entry (vs a bare scalar)? */
  looksLikeEntry(content: string): boolean {
    if (content.startsWith('"')) {
      const end = this.scanQuotedToken(content);
      if (end === -1) return false;
      const next = content[end + 1];
      return next === ":" || next === "[";
    }
    for (let j = 0; j < content.length; j++) {
      const c = content[j];
      if (c === ":" || c === "[") return j > 0;
    }
    return false;
  }

  /** Index of the closing quote of a quoted token starting at 0, or -1. */
  private scanQuotedToken(content: string): number {
    for (let j = 1; j < content.length; j++) {
      if (content[j] === '"') {
        if (content[j + 1] === '"') {
          j++; // escaped quote, keep scanning
        } else {
          return j;
        }
      }
    }
    return -1;
  }

  /** Parse consecutive entries at exactly `indent` into an object. */
  parseObject(indent: number): { [key: string]: ToonValue } {
    const obj: { [key: string]: ToonValue } = {};
    while (this.pos < this.lines.length) {
      const ln = this.lines[this.pos];
      if (ln.indent < indent) break;
      if (ln.indent > indent) {
        throw new ToonParseError("Unexpected indentation", ln.lineNo, ln.indent + 1);
      }
      const { key, rest } = this.parseKey(ln);
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        throw new ToonParseError(`Duplicate key "${key}"`, ln.lineNo, ln.indent + 1);
      }
      const value = this.parseEntryValue(ln, rest);
      // defineProperty so keys like "__proto__" become own properties
      // instead of mutating the prototype (round-trip + pollution safety).
      Object.defineProperty(obj, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return obj;
  }

  /** Split an entry line into its key and the rest (starting at `:` or `[`). */
  private parseKey(ln: SourceLine): { key: string; rest: string } {
    const { content } = ln;
    if (content.startsWith('"')) {
      const end = this.scanQuotedToken(content);
      if (end === -1) {
        throw new ToonParseError("Unterminated quoted key", ln.lineNo, ln.indent + 1);
      }
      const next = content[end + 1];
      if (next !== ":" && next !== "[") {
        throw new ToonParseError(
          "Expected ':' or '[N]' after quoted key",
          ln.lineNo,
          ln.indent + end + 2
        );
      }
      const inner = content.slice(1, end).replace(/""/g, '"');
      return { key: backslashDecode(inner), rest: content.slice(end + 1) };
    }
    let idx = -1;
    for (let j = 0; j < content.length; j++) {
      const c = content[j];
      if (c === ":" || c === "[") {
        idx = j;
        break;
      }
    }
    if (idx <= 0) {
      throw new ToonParseError("Expected 'key:' entry", ln.lineNo, ln.indent + 1);
    }
    return { key: content.slice(0, idx).trimEnd(), rest: content.slice(idx) };
  }

  /** Parse what follows a key: scalar, nested block, or one of the array forms. */
  private parseEntryValue(ln: SourceLine, rest: string): ToonValue {
    if (rest.startsWith("[")) {
      return this.parseArrayHeader(ln, rest);
    }
    // rest starts with ":"
    const valueStr = rest.slice(1).trim();
    if (valueStr !== "") {
      this.pos++;
      return decodeScalarToken(valueStr);
    }
    // `key:` with nothing after — nested block or empty object.
    this.pos++;
    const next = this.peek();
    if (next !== undefined && next.indent > ln.indent) {
      return this.parseObject(next.indent);
    }
    return {};
  }

  /**
   * Parse an array from its header line (`[N]: …`, `[N]{cols}:`, `[N]:` + list).
   * `rest` defaults to the full line content (anonymous arrays).
   */
  parseArrayHeader(ln: SourceLine, rest: string = ln.content): ToonValue[] {
    const m = ARRAY_HEADER_RE.exec(rest);
    if (m === null) {
      throw new ToonParseError("Malformed array header", ln.lineNo, ln.indent + 1);
    }
    const count = parseInt(m[1], 10);
    const colsRaw = m[2];
    const after = (m[3] ?? "").trim();
    this.pos++;

    if (colsRaw !== undefined) {
      if (after !== "") {
        throw new ToonParseError(
          "Unexpected content after table header",
          ln.lineNo,
          ln.indent + 1
        );
      }
      return this.parseTableRows(ln, count, colsRaw);
    }

    if (after !== "") {
      // Inline array.
      const tokens = splitCsvLine(after, { preserveQuotes: true, trim: true });
      if (tokens.length !== count) {
        throw new ToonParseError(
          `Inline array declares ${count} item(s) but has ${tokens.length}`,
          ln.lineNo,
          ln.indent + 1
        );
      }
      return tokens.map(decodeScalarToken);
    }

    if (count === 0) return [];
    return this.parseListItems(ln, count);
  }

  private parseTableRows(header: SourceLine, count: number, colsRaw: string): ToonValue[] {
    const cols = colsRaw === "" ? [] : colsRaw.split(",").map((c) => c.trim());
    if (count > 0 && cols.length === 0) {
      throw new ToonParseError("Table header declares no columns", header.lineNo, header.indent + 1);
    }
    const rows: ToonValue[] = [];
    let childIndent = -1;
    while (rows.length < count) {
      const ln = this.peek();
      if (ln === undefined || ln.indent <= header.indent) break;
      if (childIndent === -1) {
        childIndent = ln.indent;
      } else if (ln.indent !== childIndent) {
        throw new ToonParseError("Inconsistent table row indentation", ln.lineNo, ln.indent + 1);
      }
      const cells = splitCsvLine(ln.content, { preserveQuotes: true, trim: true });
      if (cells.length !== cols.length) {
        throw new ToonParseError(
          `Table row has ${cells.length} cell(s), expected ${cols.length}`,
          ln.lineNo,
          ln.indent + 1
        );
      }
      const row: { [key: string]: ToonValue } = {};
      for (let c = 0; c < cols.length; c++) {
        Object.defineProperty(row, cols[c], {
          value: decodeScalarToken(cells[c]),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      rows.push(row);
      this.pos++;
    }
    if (rows.length !== count) {
      throw new ToonParseError(
        `Table declares ${count} row(s) but has ${rows.length}`,
        header.lineNo,
        header.indent + 1
      );
    }
    return rows;
  }

  private parseListItems(header: SourceLine, count: number): ToonValue[] {
    const items: ToonValue[] = [];
    let childIndent = -1;
    while (items.length < count) {
      const ln = this.peek();
      if (ln === undefined || ln.indent <= header.indent) break;
      if (childIndent === -1) {
        childIndent = ln.indent;
      } else if (ln.indent !== childIndent) {
        throw new ToonParseError("Inconsistent list item indentation", ln.lineNo, ln.indent + 1);
      }
      if (ln.content[0] !== "-") {
        throw new ToonParseError("Expected list item starting with '-'", ln.lineNo, ln.indent + 1);
      }
      const restOfDash = ln.content.slice(1).trim();
      this.pos++;
      if (restOfDash !== "") {
        items.push(decodeScalarToken(restOfDash));
        continue;
      }
      // Bare `-`: anonymous value on the following deeper-indented lines.
      const next = this.peek();
      if (next === undefined || next.indent <= childIndent) {
        items.push({});
      } else if (ARRAY_HEADER_RE.test(next.content)) {
        items.push(this.parseArrayHeader(next));
      } else {
        items.push(this.parseObject(next.indent));
      }
    }
    if (items.length !== count) {
      throw new ToonParseError(
        `List declares ${count} item(s) but has ${items.length}`,
        header.lineNo,
        header.indent + 1
      );
    }
    return items;
  }
}
