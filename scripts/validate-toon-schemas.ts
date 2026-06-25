#!/usr/bin/env bunx tsx
/**
 * validate-toon-schemas.ts — walks `protocols/*.schema.md` and validates
 * each file contains:
 *   (a) a top-level `# ...Schema` heading (markdown H1)
 *   (b) at least one fenced ```toon block whose body parses as well-formed TOON
 *       at a structural level (every non-blank line is `key: value`, `key[N]:`,
 *       `key[N]{...}:`, a comment (`#`), or indented under one of those).
 *
 * Exits 0 on success, 1 on any validation failure with a per-file diagnostic.
 *
 * Invocation:
 *   bunx tsx scripts/validate-toon-schemas.ts
 *   bunx tsx scripts/validate-toon-schemas.ts --quiet   # only print failures
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..');
const PROTOCOLS_DIR = join(REPO_ROOT, 'agents', 'protocols');

interface Diagnostic {
  file: string;
  errors: string[];
}

function findSchemaFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isFile() && entry.endsWith('.schema.md')) out.push(p);
  }
  return out.sort();
}

function extractToonBlocks(md: string): string[] {
  const blocks: string[] = [];
  // Match ```toon ... ``` fenced blocks, multi-line, non-greedy.
  const re = /^```toon[^\n]*\n([\s\S]*?)^```$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    blocks.push(m[1]);
  }
  return blocks;
}

function hasTopLevelHeading(md: string): boolean {
  // Accept any markdown H1 — the validator deliberately permits varied wording
  // (`# Foo Schema`, `# Schema: Foo`, etc.) as long as one exists.
  return /^#\s+\S/m.test(md);
}

/**
 * Validate that every non-blank, non-comment line in a TOON block matches one
 * of the structural forms. We don't fully parse TOON; we check shape only:
 *   - blank line                                          OK
 *   - `# ...` (comment)                                   OK
 *   - `<indent>key: <value...>`                           OK (scalar)
 *   - `<indent>key[N]: <inline list>` or `key[N]:`        OK (array)
 *   - `<indent>key[N]{col1,col2,...}:` (optional rows)    OK (table)
 *   - row line: `<indent><value>,<value>,...`             OK if under a table
 *   - `<indent>- ...` (rare list-style)                   OK
 *
 * For this gate we accept any line that is either:
 *   - empty
 *   - starts with `#`
 *   - matches a KEY-prefixed form (with optional `[N]` / `{...}` markers)
 *   - is an indented continuation (any non-empty line indented >= 2 spaces is
 *     accepted as a row or nested value, since we can't statically know the
 *     enclosing table's column count from a one-pass walk).
 */
function validateToonBlock(block: string): string[] {
  const errors: string[] = [];
  const lines = block.split('\n');
  // Drop trailing empty line caused by closing fence.
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (lines.length === 0) {
    errors.push('toon block is empty');
    return errors;
  }

  // Accept identifier-keyed lines (`foo:`, `foo[N]:`, `foo[3]:`, `foo[N]{a,b}:`)
  // and integer-keyed lines (`0:`, `1:`). The `[N]` slot tolerates a literal
  // `N` (schema-doc placeholder), a digit run, or empty.
  const keyLine =
    /^[ \t]*(?:[A-Za-z_][A-Za-z0-9_.-]*|\d+)(?:\[(?:\d+|N|)\])?(?:\{[^}]*\})?\s*:/;
  const indentedContinuation = /^[ \t]+\S/;
  const commentLine = /^[ \t]*#/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    if (commentLine.test(line)) continue;
    if (keyLine.test(line)) continue;
    if (indentedContinuation.test(line)) continue;
    errors.push(`line ${i + 1}: unrecognized TOON syntax: ${JSON.stringify(line)}`);
  }
  return errors;
}

function validateFile(path: string): Diagnostic {
  const md = readFileSync(path, 'utf8');
  const errors: string[] = [];

  if (!hasTopLevelHeading(md)) {
    errors.push('missing top-level markdown heading (`# ...`)');
  }

  const blocks = extractToonBlocks(md);
  if (blocks.length === 0) {
    errors.push('no fenced ```toon block found (every schema needs at least one TOON exemplar)');
  } else {
    blocks.forEach((b, idx) => {
      const blockErrors = validateToonBlock(b);
      for (const e of blockErrors) {
        errors.push(`toon block #${idx + 1}: ${e}`);
      }
    });
  }

  return { file: path, errors };
}

function main(): void {
  const quiet = process.argv.includes('--quiet');
  const files = findSchemaFiles(PROTOCOLS_DIR);
  if (files.length === 0) {
    console.error(`validate-toon-schemas: no *.schema.md files found under ${PROTOCOLS_DIR}`);
    process.exit(1);
  }

  let failed = 0;
  for (const f of files) {
    const rel = f.slice(REPO_ROOT.length + 1);
    const d = validateFile(f);
    if (d.errors.length > 0) {
      failed++;
      console.error(`FAIL ${rel}`);
      for (const e of d.errors) console.error(`  - ${e}`);
    } else if (!quiet) {
      console.log(`ok   ${rel}`);
    }
  }

  if (failed > 0) {
    console.error(`\nvalidate-toon-schemas: ${failed} file(s) failed`);
    process.exit(1);
  }
  if (!quiet) console.log(`\nvalidate-toon-schemas: ${files.length} schema(s) validated`);
  process.exit(0);
}

main();
