/**
 * scripts/ci/check-library-catalog.ts — CI check `library-catalog` (frozen
 * name, see protocols/ci-gates.contract.md).
 *
 * Validates `skills/library.yaml`:
 *   - catalog_version present and a positive integer
 *   - library sections are lists of entries with unique, non-empty `name` and
 *     a non-empty `source`
 *   - kit integrity: unique kit names, non-empty `includes:`
 *   - typed `includes:` entries ({type, name}) resolve to an entry in the
 *     matching library section
 *   - bare-string includes resolve via the documented priority
 *     agent > protocol > skill > prompt (CLAUDE.md, Extensibility Model)
 *
 * Flags:
 *   --catalog <path>   catalog override (default skills/library.yaml)
 *
 * Exit codes: 0 valid; 1 CATALOG_INVALID with per-entry findings (TOON on
 * stdout, error record on stderr).
 *
 * Node-runnable (erasable TS only); also runs under bun. The YAML-subset
 * parser below intentionally supports only the structures library.yaml uses
 * (nested mappings, lists of mappings/scalars, inline arrays, quoted scalars,
 * full-line comments) — no external YAML dependency in the CI path.
 */

import { readFileSync } from "node:fs";

type YamlValue = string | number | boolean | null | YamlValue[] | YamlMap;
interface YamlMap {
  [key: string]: YamlValue;
}

interface Line {
  indent: number;
  content: string;
}

const KEY_RE = /^([A-Za-z0-9_.-]+):(?:[ \t]+(.*))?$/;

function parseScalar(raw: string): YamlValue {
  const s = raw.trim();
  if (s === "" || s === "~" || s === "null") return null;
  if (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
  ) {
    return s.slice(1, -1);
  }
  if (s.startsWith("[") && s.endsWith("]")) {
    const inner = s.slice(1, -1).trim();
    if (inner === "") return [];
    return inner.split(",").map((item) => parseScalar(item));
  }
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+$/.test(s)) return Number.parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return Number.parseFloat(s);
  return s;
}

/** Parse the YAML subset used by skills/library.yaml. Throws on structures it
 * cannot represent (caught by main and reported as CATALOG_INVALID).
 * NOT exported: this script runs main() unconditionally (note 047 — argv
 * entry guards fail open), so it must only be exercised as a subprocess. */
function parseYamlSubset(text: string): YamlValue {
  const lines: Line[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const trimmed = rawLine.trimStart();
    if (trimmed.startsWith("#")) continue;
    lines.push({ indent: rawLine.length - trimmed.length, content: trimmed });
  }

  let i = 0;

  function parseBlock(blockIndent: number): YamlValue {
    if (i >= lines.length) return null;
    return lines[i].content.startsWith("- ")
      ? parseSequence(lines[i].indent)
      : parseMapping(lines[i].indent, blockIndent);
  }

  function parseSequence(seqIndent: number): YamlValue[] {
    const items: YamlValue[] = [];
    while (i < lines.length && lines[i].indent === seqIndent && lines[i].content.startsWith("- ")) {
      const rest = lines[i].content.slice(2).trim();
      if (KEY_RE.test(rest)) {
        // Mapping item: rewrite "- key: …" as a virtual key line two columns in.
        lines[i] = { indent: seqIndent + 2, content: rest };
        items.push(parseMapping(seqIndent + 2, seqIndent));
      } else {
        items.push(parseScalar(rest));
        i++;
      }
    }
    return items;
  }

  function parseMapping(mapIndent: number, parentIndent: number): YamlMap {
    const obj: YamlMap = {};
    while (i < lines.length && lines[i].indent === mapIndent) {
      const match = KEY_RE.exec(lines[i].content);
      if (!match) break; // e.g. a "- " sequence item at the same indent
      const [, key, inlineValue] = match;
      i++;
      if (inlineValue !== undefined && inlineValue.trim() !== "") {
        obj[key] = parseScalar(inlineValue);
      } else if (
        i < lines.length &&
        (lines[i].indent > mapIndent ||
          (lines[i].indent >= mapIndent && lines[i].content.startsWith("- ")))
      ) {
        obj[key] = lines[i].content.startsWith("- ")
          ? parseSequence(lines[i].indent)
          : parseMapping(lines[i].indent, mapIndent);
      } else {
        obj[key] = null;
      }
    }
    if (Object.keys(obj).length === 0) {
      throw new Error(`unparseable mapping near line content '${lines[i]?.content ?? "<eof>"}'`);
    }
    return obj;
  }

  const root = parseMapping(lines[0]?.indent ?? 0, -1);
  if (i < lines.length) {
    throw new Error(`trailing unparsed content near '${lines[i].content}'`);
  }
  return root;
}

/* ── Validation ──────────────────────────────────────────────────────────── */

type Severity = "error" | "warning";

interface Finding {
  severity: Severity;
  kit: string;
  include: string;
  rule: string;
  message: string;
}

const RESOURCE_SECTIONS: Record<string, string> = {
  agent: "agents",
  protocol: "protocols",
  skill: "skills",
  prompt: "prompts",
  infrastructure: "infrastructure",
};

/** Bare-include resolution priority per CLAUDE.md Extensibility Model. */
const BARE_PRIORITY = ["agent", "protocol", "skill", "prompt"] as const;

function asList(value: YamlValue): YamlValue[] {
  return Array.isArray(value) ? value : [];
}

function validate(doc: YamlMap): Finding[] {
  const findings: Finding[] = [];
  const add = (severity: Severity, kit: string, include: string, rule: string, message: string) =>
    findings.push({ severity, kit, include, rule, message });

  // catalog_version
  const version = doc.catalog_version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    add("error", "-", "-", "catalog_version", "catalog_version must be a positive integer");
  }

  // library sections: unique non-empty names + non-empty source
  const library = (doc.library ?? {}) as YamlMap;
  const sectionNames: Record<string, Set<string>> = {};
  for (const [section, entries] of Object.entries(library)) {
    const names = new Set<string>();
    sectionNames[section] = names;
    for (const entry of asList(entries)) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        add("error", "-", "-", "entry-shape", `library.${section} contains a non-mapping entry`);
        continue;
      }
      const name = (entry as YamlMap).name;
      const source = (entry as YamlMap).source;
      if (typeof name !== "string" || name === "") {
        add("error", "-", "-", "entry-name", `library.${section} entry missing name`);
        continue;
      }
      if (names.has(name)) {
        add("error", "-", name, "entry-unique", `duplicate name '${name}' in library.${section}`);
      }
      names.add(name);
      if (typeof source !== "string" || source === "") {
        add("error", "-", name, "entry-source", `library.${section}.${name} missing source`);
      }
    }
  }

  // kits
  const kits = asList(doc.kits);
  const kitNames = new Set<string>();
  for (const kitValue of kits) {
    const kit = (kitValue ?? {}) as YamlMap;
    const kitName = typeof kit.name === "string" ? kit.name : "";
    if (kitName === "") {
      add("error", "-", "-", "kit-name", "kit entry missing name");
      continue;
    }
    if (kitNames.has(kitName)) {
      add("error", kitName, "-", "kit-unique", `duplicate kit name '${kitName}'`);
    }
    kitNames.add(kitName);

    const includes = asList(kit.includes);
    if (includes.length === 0) {
      add("error", kitName, "-", "kit-includes", `kit '${kitName}' has an empty includes: list`);
      continue;
    }
    for (const inc of includes) {
      if (typeof inc === "string") {
        const resolved = BARE_PRIORITY.find((type) =>
          sectionNames[RESOURCE_SECTIONS[type]]?.has(inc),
        );
        if (!resolved) {
          const onlyInfra = sectionNames.infrastructure?.has(inc);
          add(
            "error",
            kitName,
            inc,
            "include-unresolved",
            onlyInfra
              ? `bare include '${inc}' only exists in library.infrastructure — use the typed form {type: infrastructure, name: ${inc}}`
              : `bare include '${inc}' does not resolve via agent > protocol > skill > prompt`,
          );
        }
      } else if (inc !== null && typeof inc === "object" && !Array.isArray(inc)) {
        const type = (inc as YamlMap).type;
        const name = (inc as YamlMap).name;
        if (typeof type !== "string" || !(type in RESOURCE_SECTIONS)) {
          add("error", kitName, String(name ?? "?"), "include-type", `unknown include type '${String(type)}'`);
          continue;
        }
        if (typeof name !== "string" || name === "") {
          add("error", kitName, "-", "include-name", `typed include in kit '${kitName}' missing name`);
          continue;
        }
        if (!sectionNames[RESOURCE_SECTIONS[type]]?.has(name)) {
          add(
            "error",
            kitName,
            name,
            "include-unresolved",
            `typed include {type: ${type}, name: ${name}} not found in library.${RESOURCE_SECTIONS[type]}`,
          );
        }
      } else {
        add("error", kitName, "-", "include-shape", `kit '${kitName}' has a malformed includes entry`);
      }
    }
  }

  return findings;
}

/* ── CLI ─────────────────────────────────────────────────────────────────── */

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function main(): void {
  let catalog = "skills/library.yaml";
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--catalog") catalog = argv[++i] ?? catalog;
    else {
      process.stderr.write(`error: CATALOG_USAGE\nmessage: unknown flag ${argv[i]}\n`);
      process.exit(1);
    }
  }

  let doc: YamlMap;
  try {
    const parsed = parseYamlSubset(readFileSync(catalog, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("catalog root is not a mapping");
    }
    doc = parsed;
  } catch (err) {
    process.stdout.write(
      `libraryCatalogReport:\n  catalog: ${catalog}\n  findings: 1\nfindings[1]{severity,kit,include,rule,message}:\n  error,-,-,parse,${csvField((err as Error).message)}\n`,
    );
    process.stderr.write(`error: CATALOG_INVALID\nmessage: ${(err as Error).message}\n`);
    process.exit(1);
  }

  const findings = validate(doc!);
  const errors = findings.filter((f) => f.severity === "error");

  const lines: string[] = [
    "libraryCatalogReport:",
    `  catalog: ${catalog}`,
    `  catalogVersion: ${String(doc!.catalog_version ?? "missing")}`,
    `  kits: ${asListLength(doc!.kits)}`,
    `  findings: ${findings.length}`,
    `findings[${findings.length}]{severity,kit,include,rule,message}:`,
    ...findings.map(
      (f) =>
        "  " + [f.severity, f.kit, f.include, f.rule, f.message].map(csvField).join(","),
    ),
  ];
  process.stdout.write(lines.join("\n") + "\n");

  if (errors.length > 0) {
    process.stderr.write(`error: CATALOG_INVALID\nfindings: ${errors.length}\n`);
    process.exit(1);
  }
  process.exit(0);
}

function asListLength(value: YamlValue | undefined): number {
  return Array.isArray(value) ? value.length : 0;
}

main();
