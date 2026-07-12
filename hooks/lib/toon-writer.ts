/**
 * hooks/lib/toon-writer.ts
 *
 * Minimal TOON writer for the hooks runtime — the write counterpart of
 * toon-reader.ts. Hooks compile to standalone .cjs and cannot import the
 * full lib/toon.ts, so this mirrors its encodeScalar quoting rules for the
 * flat-header + typed-table shape hooks actually write (freshness ledger).
 * Keep the quoting rules in sync with lib/toon.ts; hook-side coverage lives
 * in hooks/__tests__/toon-writer.test.ts as a round-trip through toon-reader.
 */

export type ToonCell = string | number | boolean | null;

// SYNC ANCHOR (lib/toon.ts): the bare-keyword set and number grammar below
// must stay in lockstep with lib/toon.ts needsQuoting/parseUnquotedToken:
// true | false | null | NaN | Infinity | -Infinity, plus NUMBER_RE.
// If lib/toon.ts adds a bare keyword, add it here or quoting drifts.
const NUMBER_RE = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** True when a string cannot survive as a bare (unquoted) token. */
function needsQuoting(s: string): boolean {
  if (s === "") return true;
  if (s !== s.trim()) return true;
  // eslint-disable-next-line no-control-regex
  if (/["\\,\u0000-\u001f]/.test(s)) return true;
  // Bare tokens that would re-parse as a non-string must be quoted.
  if (s === "true" || s === "false" || s === "null") return true;
  if (s === "NaN" || s === "Infinity" || s === "-Infinity") return true;
  return NUMBER_RE.test(s);
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

/** Serialize one scalar to a single-line token (mirror of lib/toon.ts encodeScalar). */
export function encodeToonCell(v: ToonCell): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  return needsQuoting(v) ? quoteString(v) : v;
}

/**
 * Serialize a flat scalar header plus one typed array (table) — the shape of
 * `.loom/wiki/freshness-ledger.toon` and similar hook-written artifacts.
 * Output round-trips through toon-reader's parseToon / parseToonArray.
 */
export function serializeToonTable(
  header: Record<string, ToonCell>,
  tableName: string,
  columns: string[],
  rows: Array<Record<string, ToonCell>>
): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(header)) {
    lines.push(`${key}: ${encodeToonCell(value)}`);
  }
  lines.push(`${tableName}[${rows.length}]{${columns.join(",")}}:`);
  for (const row of rows) {
    lines.push("  " + columns.map((c) => encodeToonCell(row[c] ?? null)).join(","));
  }
  return lines.join("\n") + "\n";
}
