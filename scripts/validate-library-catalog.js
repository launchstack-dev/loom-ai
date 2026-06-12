#!/usr/bin/env node
/**
 * Validate skills/library.yaml against library-catalog.schema.md and the
 * on-disk sources every catalog entry claims.
 *
 * Checks performed:
 *   1. Required top-level fields exist (catalog_version, repo, library).
 *   2. Every entry under library.{skills,agents,prompts} has name, description, source.
 *   3. Every `source` resolves to an existing file relative to the repo root.
 *   4. Every entry in `requires` resolves to another catalog entry of the
 *      correct kind (skill:foo, agent:foo, prompt:foo, protocol:foo, or infrastructure:foo).
 *   5. No duplicate names within a single section.
 *   6. Kit `includes[]` entries map to a real catalog entry (warning only —
 *      data-engineering kit is an optional add-on).
 *
 * Exit codes:
 *   0  catalog is valid
 *   1  catalog has at least one error
 *   2  catalog file missing or unparseable
 */

const fs = require("node:fs");
const path = require("node:path");

const CATALOG_PATH = path.resolve(__dirname, "..", "skills", "library.yaml");
const REPO_ROOT = path.resolve(__dirname, "..");

function readCatalog() {
  if (!fs.existsSync(CATALOG_PATH)) {
    process.stderr.write(`error: catalog not found at ${CATALOG_PATH}\n`);
    process.exit(2);
  }
  return fs.readFileSync(CATALOG_PATH, "utf8");
}

/**
 * Targeted YAML reader tuned for the shape of library.yaml. Returns:
 *
 *   {
 *     catalog_version: number,
 *     repo: string,
 *     library: { skills: [...], agents: [...], prompts: [...] },
 *     kits: [...]
 *   }
 *
 * Where each list element is `{name, description, source, requires?, kit?, target?}`.
 *
 * The reader is line-oriented and indent-aware. It handles:
 *   - Top-level scalars: `key: value`
 *   - Top-level dict openers: `key:`
 *   - Nested dict children at deeper indent
 *   - List items prefixed with `- `, both inline (`- key: val`) and block
 *     (`- ` then nested children at deeper indent)
 *   - Inline lists `[a, b, c]` and bracketed nested arrays
 *   - Comment lines (`# ...`) and blank lines are ignored
 *
 * It does NOT handle: anchors, aliases, folded scalars, multi-line strings,
 * flow-style mappings, complex keys. The library.yaml schema does not use
 * any of these.
 */
function parseYaml(text) {
  const lines = text.split(/\r?\n/);

  // Tokenize first — produce {indent, content} for each non-blank, non-comment line.
  const tokens = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // Strip trailing inline comments (only when preceded by whitespace).
    const noComment = raw.replace(/\s+#.*$/, "");
    const trimmedRight = noComment.replace(/\s+$/, "");
    if (trimmedRight.length === 0) continue;
    const indentMatch = trimmedRight.match(/^( *)/);
    const indent = indentMatch ? indentMatch[1].length : 0;
    const content = trimmedRight.slice(indent);
    if (content.startsWith("#")) continue;
    tokens.push({ indent, content, lineNum: i + 1 });
  }

  // Recursive descent: parseBlock(idx, parentIndent) returns [value, nextIdx].
  // A block is either a list (next non-blank token at indent > parentIndent
  // starts with "- ") or a dict (next non-blank token is "key: ...").
  let idx = 0;

  function peekIndent() {
    if (idx >= tokens.length) return -1;
    return tokens[idx].indent;
  }

  function parseValueAtIndent(parentIndent) {
    if (idx >= tokens.length) return null;
    const next = tokens[idx];
    if (next.indent <= parentIndent) {
      // Empty block — caller's key has no nested value.
      return null;
    }
    if (next.content.startsWith("- ")) {
      return parseList(next.indent);
    }
    if (next.content === "-") {
      return parseList(next.indent);
    }
    return parseDict(next.indent);
  }

  function parseDict(indent) {
    const obj = {};
    while (idx < tokens.length) {
      const tok = tokens[idx];
      if (tok.indent < indent) break;
      if (tok.indent > indent) {
        // Should not happen with well-formed input; skip to avoid infinite loop.
        idx++;
        continue;
      }
      if (tok.content.startsWith("- ") || tok.content === "-") {
        // Switched to a list at this level — caller should have handled it.
        break;
      }
      const m = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(tok.content);
      if (!m) {
        throw new Error(`line ${tok.lineNum}: unrecognized syntax: ${tok.content}`);
      }
      const [, key, rest] = m;
      idx++;
      if (rest.length === 0) {
        // Nested block.
        const nested = parseValueAtIndent(indent);
        obj[key] = nested === null ? {} : nested;
      } else {
        obj[key] = parseScalar(rest);
      }
    }
    return obj;
  }

  function parseList(indent) {
    const list = [];
    while (idx < tokens.length) {
      const tok = tokens[idx];
      if (tok.indent < indent) break;
      if (tok.indent > indent) {
        idx++;
        continue;
      }
      if (!tok.content.startsWith("- ") && tok.content !== "-") {
        break;
      }
      const rest = tok.content === "-" ? "" : tok.content.slice(2);
      idx++;
      if (rest.length === 0) {
        // Block list item with children at deeper indent.
        const nested = parseValueAtIndent(indent);
        list.push(nested === null ? {} : nested);
      } else {
        // Try inline `- key: value`.
        const kvMatch = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(rest);
        if (kvMatch) {
          const [, key, val] = kvMatch;
          const itemObj = {};
          if (val.length === 0) {
            const nested = parseValueAtIndent(indent);
            itemObj[key] = nested === null ? {} : nested;
          } else {
            itemObj[key] = parseScalar(val);
          }
          // Continue absorbing sibling keys that share the list item's body.
          // Their indent is indent + 2 (or more) AND the line is NOT a new
          // list item. They count as further keys of the SAME item.
          while (idx < tokens.length) {
            const nxt = tokens[idx];
            if (nxt.indent <= indent) break;
            if (nxt.content.startsWith("- ") || nxt.content === "-") break;
            const m2 = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(nxt.content);
            if (!m2) break;
            const [, k2, v2] = m2;
            idx++;
            if (v2.length === 0) {
              const nested = parseValueAtIndent(nxt.indent);
              itemObj[k2] = nested === null ? {} : nested;
            } else {
              itemObj[k2] = parseScalar(v2);
            }
          }
          list.push(itemObj);
        } else {
          // Inline scalar item.
          list.push(parseScalar(rest));
        }
      }
    }
    return list;
  }

  // Start with a virtual root at indent -1.
  const root = parseDict(0);
  return root;
}

function parseScalar(raw) {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return unescape(trimmed.slice(1, -1));
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner.length === 0) return [];
    return splitFlowList(inner).map((s) => parseScalar(s));
  }
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null" || trimmed === "~") return null;
  return trimmed;
}

function unescape(s) {
  return s.replace(/\\(["'\\nrt])/g, (_, ch) => {
    switch (ch) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      default:
        return ch;
    }
  });
}

function splitFlowList(s) {
  const out = [];
  let depth = 0;
  let current = "";
  let inQuotes = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes !== null) {
      if (ch === inQuotes) inQuotes = null;
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuotes = ch;
      current += ch;
      continue;
    }
    if (ch === "[" || ch === "{") depth++;
    if (ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0) out.push(current.trim());
  return out;
}

// ---------------------------------------------------------------------------

function main() {
  const raw = readCatalog();
  let catalog;
  try {
    catalog = parseYaml(raw);
  } catch (err) {
    process.stderr.write(`error: failed to parse library.yaml: ${err.message}\n`);
    process.exit(2);
  }

  const errors = [];
  const warnings = [];

  // 1. Required top-level fields.
  for (const field of ["catalog_version", "repo", "library"]) {
    if (!(field in catalog)) {
      errors.push(`missing required top-level field '${field}'`);
    }
  }

  const library = catalog.library;
  if (typeof library !== "object" || library === null || Array.isArray(library)) {
    if (errors.length === 0) {
      errors.push(`'library' must be an object with skills/agents/prompts sections`);
    }
  } else {
    const sections = ["skills", "agents", "prompts", "protocols", "infrastructure"];
    const sectionNames = new Map();
    for (const section of sections) {
      sectionNames.set(section, new Set());
      const entries = library[section];
      if (entries === undefined) continue;
      if (!Array.isArray(entries)) {
        errors.push(`library.${section} must be a list (got ${typeof entries})`);
        continue;
      }
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
          errors.push(`library.${section}[${i}] is not an object`);
          continue;
        }
        for (const field of ["name", "description", "source"]) {
          if (!(field in entry) || entry[field] === "" || entry[field] === null) {
            errors.push(
              `library.${section}[${i}] missing required field '${field}' (name=${entry.name ?? "<unknown>"})`
            );
          }
        }
        if (entry.name) {
          const set = sectionNames.get(section);
          if (set.has(entry.name)) {
            errors.push(`duplicate name '${entry.name}' in library.${section}`);
          }
          set.add(entry.name);
        }
        if (typeof entry.source === "string" && entry.source.length > 0) {
          const sourcePath = path.resolve(REPO_ROOT, entry.source);
          if (!fs.existsSync(sourcePath)) {
            errors.push(
              `library.${section}[${i}] source '${entry.source}' does not resolve to an existing file (name=${entry.name})`
            );
          }
        }
      }
    }

    for (const section of sections) {
      const entries = library[section];
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        const requires = entry.requires;
        if (!Array.isArray(requires)) continue;
        for (const req of requires) {
          if (typeof req !== "string") {
            errors.push(
              `library.${section}[name=${entry.name}].requires has a non-string entry: ${JSON.stringify(req)}`
            );
            continue;
          }
          const m = /^(skill|agent|prompt|protocol|infrastructure):(.+)$/.exec(req);
          if (!m) {
            errors.push(
              `library.${section}[name=${entry.name}].requires entry '${req}' must use 'skill:name', 'agent:name', 'prompt:name', 'protocol:name', or 'infrastructure:name' form`
            );
            continue;
          }
          const [, kind, depName] = m;
          const expectSection = kind === "infrastructure" ? "infrastructure" : `${kind}s`;
          const target = sectionNames.get(expectSection);
          if (!target || !target.has(depName)) {
            errors.push(
              `library.${section}[name=${entry.name}].requires '${req}' does not resolve to any library.${expectSection} entry`
            );
          }
        }
      }
    }

    if (Array.isArray(catalog.kits)) {
      const allKnownNames = new Set();
      for (const section of sections) {
        for (const n of sectionNames.get(section) ?? []) allKnownNames.add(n);
      }
      for (const kit of catalog.kits) {
        if (typeof kit !== "object" || kit === null) continue;
        const includes = kit.includes;
        if (!Array.isArray(includes)) continue;
        for (const inc of includes) {
          // v4 typed-include form: { type: 'skill'|'agent'|'protocol'|'prompt'|'infrastructure', name: '...' }
          // Legacy bare-name form: plain string resolved via cross-section lookup.
          let incName;
          let incTypeSet;
          if (typeof inc === "string") {
            incName = inc;
            incTypeSet = allKnownNames;
          } else if (inc && typeof inc === "object" && typeof inc.type === "string" && typeof inc.name === "string") {
            incName = inc.name;
            const expectSection = inc.type === "infrastructure" ? "infrastructure" : `${inc.type}s`;
            incTypeSet = sectionNames.get(expectSection) ?? new Set();
          } else {
            warnings.push(
              `kit '${kit.name ?? "<unnamed>"}' includes malformed entry ${JSON.stringify(inc)} — expected string or { type, name }`
            );
            continue;
          }
          if (!incTypeSet.has(incName)) {
            warnings.push(
              `kit '${kit.name ?? "<unnamed>"}' includes '${typeof inc === "string" ? inc : `${inc.type}:${inc.name}`}' which is not a registered catalog entry`
            );
          }
        }
      }
    }
  }

  if (warnings.length > 0) {
    process.stderr.write(`Warnings (${warnings.length}):\n`);
    for (const w of warnings) process.stderr.write(`  - ${w}\n`);
  }
  if (errors.length > 0) {
    process.stderr.write(`Errors (${errors.length}):\n`);
    for (const e of errors) process.stderr.write(`  - ${e}\n`);
    process.exit(1);
  }
  const totalEntries =
    ((catalog.library?.skills ?? []).length || 0) +
    ((catalog.library?.agents ?? []).length || 0) +
    ((catalog.library?.prompts ?? []).length || 0);
  process.stdout.write(
    `OK: skills/library.yaml validated (${totalEntries} entries, ${warnings.length} warning(s)).\n`
  );
}

main();
