/**
 * scripts/ci/check-docs-drift.ts — CI check `docs-drift` (frozen name, see
 * protocols/ci-gates.contract.md).
 *
 * Recomputes generated-docs section checksums against
 * `docs/.generated-manifest.toon` (DocsGenerationManifest, written by
 * `scripts/generate-docs.ts` from Phase 16). A section's generated block spans
 *   <!-- loom:generated:{section} -->  …  <!-- /loom:generated:{section} -->
 * in its target file; the sha256 of the content between the markers must match
 * the manifest's per-section checksum.
 *
 * Flags:
 *   --check            compare only, never write (default true; accepted as no-op)
 *   --warn-only        report drift without failing (Phase 1 → Phase 16)
 *   --manifest <path>  manifest override (default docs/.generated-manifest.toon)
 *   --root <dir>       repo root for resolving targetFile paths (default cwd)
 *
 * Exit codes: 0 no drift (or --warn-only); 1 DOCS_DRIFT_DETECTED naming each
 * stale section; 3 manifest missing/unparseable.
 *
 * Node-runnable (erasable TS only); also runs under bun. No lib/ runtime
 * imports — the minimal TOON table reader below is scoped to this manifest
 * shape and is slated for replacement by lib/toon.ts in the Phase 11 strangler
 * migration.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DocsSection } from "../../lib/types.ts";

interface CliOptions {
  warnOnly: boolean;
  manifest: string;
  root: string;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    warnOnly: false,
    manifest: "docs/.generated-manifest.toon",
    root: process.cwd(),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") continue; // compare-only is the only mode
    else if (a === "--warn-only") opts.warnOnly = true;
    else if (a === "--manifest") opts.manifest = argv[++i] ?? opts.manifest;
    else if (a === "--root") opts.root = argv[++i] ?? opts.root;
    else {
      process.stderr.write(`error: DOCS_DRIFT_USAGE\nmessage: unknown flag ${a}\n`);
      process.exit(1);
    }
  }
  return opts;
}

/** Split one TOON table row on commas, honoring double-quoted fields. */
function splitRow(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"' && current === "") {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/** Minimal reader for the manifest's `sections[N]{...}:` typed-array table. */
function parseManifestSections(text: string): DocsSection[] {
  const lines = text.split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => /^\s*sections\[\d+\]\{[^}]*\}:\s*$/.test(l));
  if (headerIdx === -1) {
    throw new Error("no sections[N]{...}: table found in manifest");
  }
  const columns = lines[headerIdx]
    .replace(/^\s*sections\[\d+\]\{/, "")
    .replace(/\}:\s*$/, "")
    .split(",")
    .map((c) => c.trim());
  const required = ["section", "targetFile", "checksum"];
  for (const col of required) {
    if (!columns.includes(col)) throw new Error(`manifest table missing column '${col}'`);
  }
  const headerIndent = lines[headerIdx].length - lines[headerIdx].trimStart().length;
  const rows: DocsSection[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) break;
    const indent = line.length - line.trimStart().length;
    if (indent <= headerIndent) break;
    const fields = splitRow(line.trim());
    const record: Record<string, string> = {};
    columns.forEach((col, idx) => {
      record[col] = fields[idx] ?? "";
    });
    rows.push({
      section: record.section,
      targetFile: record.targetFile,
      source: record.source ?? "",
      checksum: record.checksum,
      drift: record.drift === "stale" ? "stale" : "none",
    });
  }
  if (rows.length === 0) throw new Error("manifest sections table has no rows");
  return rows;
}

type SectionStatus = "clean" | "stale" | "target-missing" | "marker-missing";

function checkSection(root: string, section: DocsSection): SectionStatus {
  const targetPath = resolve(root, section.targetFile);
  if (!existsSync(targetPath)) return "target-missing";
  const content = readFileSync(targetPath, "utf8");
  const begin = `<!-- loom:generated:${section.section} -->`;
  const end = `<!-- /loom:generated:${section.section} -->`;
  const beginIdx = content.indexOf(begin);
  const endIdx = content.indexOf(end);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) return "marker-missing";
  const block = content.slice(beginIdx + begin.length, endIdx);
  const checksum = createHash("sha256").update(block).digest("hex");
  return checksum === section.checksum ? "clean" : "stale";
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));

  if (!existsSync(opts.manifest)) {
    if (opts.warnOnly) {
      process.stdout.write(
        `docsDriftReport:\n  manifest: ${opts.manifest}\n  status: manifest-missing\n  warnOnly: true\nwarning: DOCS_MANIFEST_MISSING\nnote: scripts/generate-docs.ts (Phase 16) writes the manifest; warn-only until then\n`,
      );
      process.exit(0);
    }
    process.stderr.write(
      `error: DOCS_MANIFEST_MISSING\nmessage: ${opts.manifest} not found\n`,
    );
    process.exit(3);
  }

  let sections: DocsSection[];
  try {
    sections = parseManifestSections(readFileSync(opts.manifest, "utf8"));
  } catch (err) {
    process.stderr.write(
      `error: DOCS_MANIFEST_UNPARSEABLE\nmessage: ${(err as Error).message}\n`,
    );
    process.exit(3);
  }

  const results = sections!.map((s) => ({ ...s, status: checkSection(opts.root, s) }));
  const stale = results.filter((r) => r.status !== "clean");

  const lines: string[] = [
    "docsDriftReport:",
    `  manifest: ${opts.manifest}`,
    `  warnOnly: ${opts.warnOnly}`,
    `  sectionCount: ${results.length}`,
    `  staleCount: ${stale.length}`,
    `sections[${results.length}]{section,targetFile,status}:`,
    ...results.map((r) => `  ${r.section},${r.targetFile},${r.status}`),
  ];
  process.stdout.write(lines.join("\n") + "\n");

  if (stale.length > 0) {
    const names = stale.map((r) => r.section).join(", ");
    if (opts.warnOnly) {
      process.stdout.write(
        `warning: DOCS_DRIFT_DETECTED\nstaleSections[${stale.length}]: ${names}\nnote: warn-only until Phase 16 flips docs-drift to blocking\n`,
      );
      process.exit(0);
    }
    process.stderr.write(
      `error: DOCS_DRIFT_DETECTED\nstaleSections[${stale.length}]: ${names}\n`,
    );
    process.exit(1);
  }
  process.exit(0);
}

main();
