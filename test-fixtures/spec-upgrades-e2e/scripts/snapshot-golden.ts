#!/usr/bin/env tsx
/**
 * Regenerate `golden-final-state.toon` for the spec-upgrades-e2e fixture.
 *
 * Walks the fixture root and emits a `path,size,sha256_16` row for every
 * tracked file. The e2e test asserts the file inventory matches the golden
 * file; the size + short-hash columns are informational diagnostics that
 * surface in test failure diffs.
 *
 * Run:
 *   npx tsx test-fixtures/spec-upgrades-e2e/scripts/snapshot-golden.ts
 *
 * The script overwrites the existing golden file. Re-run after any
 * intentional change to build-fixture.ts.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const FIXTURE_ROOT = path.resolve(__dirname, "..");
const GOLDEN_PATH = path.join(FIXTURE_ROOT, "golden-final-state.toon");

function walk(dir: string, results: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) walk(fp, results);
    else if (e.isFile() && !e.name.endsWith(".tmp") && !e.name.endsWith(".bak")) {
      results.push(fp);
    }
  }
  return results;
}

function main(): void {
  const files = walk(FIXTURE_ROOT)
    .filter(
      (f) =>
        !f.includes(path.sep + "scripts" + path.sep) &&
        !f.endsWith("golden-final-state.toon")
    )
    .map((f) => {
      const buf = fs.readFileSync(f);
      const sha = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
      return {
        rel: path.relative(FIXTURE_ROOT, f).replace(/\\/g, "/"),
        size: buf.length,
        sha,
      };
    })
    .sort((a, b) => a.rel.localeCompare(b.rel));

  // Preserve the existing prelude / status block when present — only the
  // `files[N]{...}:` typed array gets rewritten.
  const existingRaw = fs.existsSync(GOLDEN_PATH) ? fs.readFileSync(GOLDEN_PATH, "utf8") : "";
  const lines = existingRaw.split("\n");

  // Find the header row.
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^files\[\d+\]\{path,size,sha256_16\}:\s*$/.test(lines[i])) {
      headerIdx = i;
      break;
    }
  }

  // If there's no existing file, write a brand-new one.
  if (existingRaw.length === 0 || headerIdx === -1) {
    const out: string[] = [];
    out.push("# Golden final-state snapshot for spec-upgrades-e2e.");
    out.push("# Regenerate by running scripts/snapshot-golden.ts.");
    out.push("");
    out.push("snapshotVersion: 1");
    out.push("generatedAt: 2026-05-23T12:00:00Z");
    out.push("fixtureRoot: test-fixtures/spec-upgrades-e2e");
    out.push("sourceTrigger: build-fixture.ts");
    out.push("");
    out.push(`files[${files.length}]{path,size,sha256_16}:`);
    for (const f of files) out.push(`  ${f.rel},${f.size},${f.sha}`);
    fs.writeFileSync(GOLDEN_PATH, out.join("\n") + "\n", "utf8");
    process.stdout.write(`Wrote ${GOLDEN_PATH} (${files.length} files).\n`);
    return;
  }

  // Else, splice in the new files[] block.
  // Find the end of the existing files block (first non-indented line after header).
  let endIdx = lines.length;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (lines[i].length > 0 && !lines[i].startsWith("  ")) {
      endIdx = i;
      break;
    }
  }

  const newBlock: string[] = [`files[${files.length}]{path,size,sha256_16}:`];
  for (const f of files) newBlock.push(`  ${f.rel},${f.size},${f.sha}`);

  const next = [
    ...lines.slice(0, headerIdx),
    ...newBlock,
    ...lines.slice(endIdx),
  ];
  fs.writeFileSync(GOLDEN_PATH, next.join("\n"), "utf8");
  process.stdout.write(`Updated ${GOLDEN_PATH} (${files.length} files).\n`);
}

main();
