/**
 * Minimal read-only TOON parser for hooks.
 * Handles flat key-value pairs and typed arrays. No write support needed.
 *
 * CSV row splitting is delegated to the shared-core `splitCsvLine` (lib/csv.ts,
 * C-02) — the single sanctioned splitter. The former local `splitCsvRow`
 * mishandled escaped `""` (Phase 11a, F-08 defect 8, scenario S-01); the lib
 * splitter is the reference behavior.
 */

import { splitCsvLine } from "../../lib/index.js";

/** Parse flat key: value pairs from TOON content. */
export function parseToon(content: string): Record<string, string | number | boolean | null> {
  const result: Record<string, string | number | boolean | null> = {};
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Skip array headers (contain [ or are indented array rows)
    if (/^\w+\[/.test(trimmed)) continue;
    if (line.startsWith("  ")) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const rawValue = trimmed.slice(colonIdx + 1).trim();

    result[key] = parseValue(rawValue);
  }

  return result;
}

/** Parse a typed array from TOON content. Returns array of objects with named fields. */
export function parseToonArray(
  content: string,
  arrayName: string
): Record<string, string | number | boolean | null>[] {
  const lines = content.split("\n");
  const results: Record<string, string | number | boolean | null>[] = [];
  let fields: string[] | null = null;
  let inArray = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Match array header: name[count]{field1,field2,...}:
    if (!inArray) {
      const headerMatch = trimmed.match(
        new RegExp(`^${escapeRegExp(arrayName)}\\[\\d+\\]\\{([^}]+)\\}:$`)
      );
      if (headerMatch) {
        fields = headerMatch[1].split(",").map((f) => f.trim());
        inArray = true;
        continue;
      }
      // Also match empty array: name[0]{...}: or name[0]:
      const emptyMatch = trimmed.match(
        new RegExp(`^${escapeRegExp(arrayName)}\\[0\\]`)
      );
      if (emptyMatch) {
        return [];
      }
      continue;
    }

    // Inside array: indented rows are data, non-indented ends the array
    if (inArray) {
      if (!line.startsWith("  ") || !trimmed) {
        break;
      }

      if (!fields) break;

      // preserveQuotes keeps outer quotes and `""` doubling intact so
      // parseValue can distinguish quoted (string, unescape) from bare
      // (typed) cells — the inverse of toon-writer's encodeToonCell.
      const values = splitCsvLine(trimmed, { trim: true, preserveQuotes: true });
      const obj: Record<string, string | number | boolean | null> = {};
      for (let i = 0; i < fields.length; i++) {
        obj[fields[i]] = parseValue(values[i] ?? "");
      }
      results.push(obj);
    }
  }

  return results;
}

/** Parse a simple array (comma-separated on header line). */
export function parseToonSimpleArray(content: string, arrayName: string): string[] {
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(
      new RegExp(`^${escapeRegExp(arrayName)}\\[(\\d+)\\]:\\s*(.*)$`)
    );
    if (match) {
      const count = parseInt(match[1], 10);
      if (count === 0) return [];
      const valuesStr = match[2].trim();
      if (!valuesStr) return [];
      return valuesStr.split(",").map((v) => v.trim());
    }
  }
  return [];
}

/**
 * Decode one scalar token — the inverse of toon-writer's encodeToonCell and
 * a mirror of lib/toon.ts decodeScalarToken. A quoted token is always a
 * string: strip outer quotes, collapse `""` → `"`, then backslash-decode.
 * A bare token gets keyword/number typing.
 */
function parseValue(raw: string): string | number | boolean | null {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    const inner = raw.slice(1, -1).replace(/""/g, '"');
    return backslashDecode(inner);
  }

  if (raw === "null") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;

  // Try number
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    return Number(raw);
  }

  return raw;
}

/**
 * Inverse of the backslash escapes applied by toon-writer's quoteString
 * (mirror of lib/toon.ts backslashDecode). Lone backslashes are kept
 * verbatim so legacy hand-written or pre-writer ledger cells stay intact.
 */
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
      out += ch; // lone backslash: keep verbatim (legacy cells)
    }
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
