/**
 * Minimal read-only TOON parser for hooks.
 * Handles flat key-value pairs and typed arrays. No write support needed.
 */

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

      const values = splitCsvRow(trimmed);
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

function parseValue(raw: string): string | number | boolean | null {
  if (raw === "null") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;

  // Remove surrounding quotes if present
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1);
  }

  // Try number
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    return Number(raw);
  }

  return raw;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitCsvRow(row: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (const ch of row) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}
