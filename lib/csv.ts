/**
 * lib/csv.ts — SharedCoreModule "csv" (PLAN-exceed-gstack Phase 2a, C-02).
 *
 * The single sanctioned CSV line splitter/joiner. Reimplementing these
 * exports outside lib/ is banned by lint (wired in Phase 2b). This module
 * unifies three divergent local implementations (defect 8):
 *
 *   1. hooks/lib/toon-reader.ts:125 (`splitCsvRow`) — toggles `inQuotes` on
 *      every `"` and therefore LOSES escaped double-quotes: `"b""c"` came
 *      back as `bc` instead of `b"c`. Fixed here: `""` inside a quoted field
 *      is a literal quote.
 *   2. scripts/loom-change/archive.ts:1119 (`splitCsvLine`) — the correct
 *      reference implementation: collapses `""` to `"`, strips the
 *      surrounding quotes, trims fields. Reproduced by
 *      `splitCsvLine(line, { trim: true })` (the empty-field filter it also
 *      applied is caller-side policy, not splitter behavior).
 *   3. scripts/materialize-contracts.ts:787 (`splitCsv`) — the
 *      quote-preservation divergence: keeps quote characters verbatim in the
 *      returned fields so the caller can `stripQuotes` selectively.
 *      Reproduced by `splitCsvLine(line, { preserveQuotes: true })`.
 *
 * Library only — no CLI entry point (shared-core.schema.md).
 */

import type { CsvSplitOptions } from "./types.js";

/**
 * Split one CSV line into fields.
 *
 * Behavior (frozen in protocols/shared-core.schema.md):
 * - Fields wrapped in the quote char may contain the delimiter.
 * - An escaped quote (`""` by default) inside a quoted field is a literal
 *   quote character — the hooks/lib/toon-reader.ts:125 miss.
 * - Default (`preserveQuotes: false`): surrounding quotes are stripped and
 *   escaped quotes collapse (`""` → `"`).
 * - `preserveQuotes: true`: fields are returned verbatim, quote characters
 *   included (the scripts/materialize-contracts.ts:787 behavior).
 * - `trim: true`: leading/trailing whitespace OUTSIDE quotes is trimmed from
 *   each field; whitespace inside a quoted region is always preserved
 *   (quoted content is never trimmed, per CsvSplitOptions).
 * - Lenient on unbalanced quotes (matches all three prior implementations):
 *   an unterminated quote runs to end of line, no throw.
 */
export function splitCsvLine(line: string, opts?: CsvSplitOptions): string[] {
  const delimiter = opts?.delimiter ?? ",";
  const quote = opts?.quote ?? '"';
  const preserveQuotes = opts?.preserveQuotes ?? false;
  const trim = opts?.trim ?? false;

  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  // Indices (within `current`) of the first/last char that came from a quoted
  // region. `trim` never eats protected chars, so whitespace INSIDE quotes
  // survives while whitespace outside quotes is stripped.
  let firstProtected = -1;
  let lastProtected = -1;

  const appendProtected = (s: string): void => {
    if (firstProtected === -1) firstProtected = current.length;
    lastProtected = current.length + s.length - 1;
    current += s;
  };

  const finish = (): void => {
    let start = 0;
    let end = current.length;
    if (trim) {
      while (
        start < end &&
        /\s/.test(current[start]) &&
        (firstProtected === -1 || start < firstProtected)
      ) {
        start++;
      }
      while (
        end > start &&
        /\s/.test(current[end - 1]) &&
        (lastProtected === -1 || end - 1 > lastProtected)
      ) {
        end--;
      }
    }
    out.push(current.slice(start, end));
    current = "";
    firstProtected = -1;
    lastProtected = -1;
  };

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === quote) {
      if (inQuotes && line[i + 1] === quote) {
        // Escaped quote inside a quoted field → literal quote.
        appendProtected(preserveQuotes ? quote + quote : quote);
        i++;
      } else {
        inQuotes = !inQuotes;
        if (preserveQuotes) appendProtected(quote);
      }
    } else if (ch === delimiter && !inQuotes) {
      finish();
    } else if (inQuotes) {
      appendProtected(ch);
    } else {
      current += ch;
    }
  }
  finish();
  return out;
}

/**
 * Join fields into one CSV line — the quoting/escaping inverse of
 * `splitCsvLine` with default options:
 *
 *   splitCsvLine(joinCsvLine(fields))  deep-equals  fields
 *
 * for any `fields` array with length >= 1. (A zero-length array is not
 * representable: `""` always splits to `[""]` per CSV semantics.)
 *
 * A field is wrapped in quotes when it contains the delimiter, a quote,
 * a newline/carriage return, or leading/trailing whitespace; embedded
 * quotes are escaped by doubling (`"` → `""`).
 */
export function joinCsvLine(fields: string[]): string {
  return fields
    .map((field) => {
      if (/[",\n\r]/.test(field) || field !== field.trim()) {
        return '"' + field.replace(/"/g, '""') + '"';
      }
      return field;
    })
    .join(",");
}
