import type { ConvergeConfig, Target, ComparisonMethod, CompareOptions } from "../types.js";

/**
 * Parse a converge.config in TOON format.
 *
 * Example:
 *   runner: .plan-execution/convergence/harness/run-harness.sh
 *
 *   targets[2]{id,name,comparisonMethod,tolerance,baselinePath,actualPath}:
 *     get-api-users,GET /api/users,json-deep-equal,1.0,targets/api-users.json,actual/api-users.json
 *     readme,README,text-diff,1.0,targets/readme.txt,actual/readme.txt
 *
 *   options.get-api-users.ignoreFields: timestamp,requestId
 *   options.get-api-users.numericTolerance: 0.001
 */
export function parseConvergeConfig(content: string): ConvergeConfig {
  const lines = content.split("\n");
  const targets: Target[] = [];
  const optionsMap = new Map<string, CompareOptions>();

  // Parse target array
  let fields: string[] = [];
  let collecting = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Target array header
    const headerMatch = trimmed.match(/^targets\[\d+\]\{([^}]+)\}:/);
    if (headerMatch) {
      fields = headerMatch[1].split(",").map((f) => f.trim());
      collecting = true;
      continue;
    }

    // Collecting target rows
    if (collecting) {
      if (!trimmed || trimmed.startsWith("#")) continue;
      if (!line.startsWith("  ") && !line.startsWith("\t")) {
        collecting = false;
        // Fall through to check other patterns
      } else {
        const values = splitCsvLine(trimmed);
        const row: Record<string, string> = {};
        for (let i = 0; i < fields.length && i < values.length; i++) {
          row[fields[i]] = values[i];
        }
        targets.push({
          id: row.id ?? "",
          name: row.name ?? "",
          comparisonMethod: (row.comparisonMethod ?? "text-diff") as ComparisonMethod,
          tolerance: parseFloat(row.tolerance ?? "1.0"),
          baselinePath: row.baselinePath ?? "",
          actualPath: row.actualPath ?? "",
        });
        continue;
      }
    }

    // Parse per-target options: options.<targetId>.<key>: value
    const optMatch = trimmed.match(/^options\.([^.]+)\.(\w+):\s*(.+)$/);
    if (optMatch) {
      const [, targetId, key, value] = optMatch;
      if (!optionsMap.has(targetId)) optionsMap.set(targetId, {});
      const opts = optionsMap.get(targetId)!;
      if (key === "ignoreFields") {
        opts.ignoreFields = value.split(",").map((f) => f.trim());
      } else if (key === "numericTolerance") {
        opts.numericTolerance = parseFloat(value);
      } else if (key === "ignoreWhitespace") {
        opts.ignoreWhitespace = value === "true";
      } else if (key === "ignoreBlankLines") {
        opts.ignoreBlankLines = value === "true";
      }
    }
  }

  // Attach options to targets
  for (const target of targets) {
    const opts = optionsMap.get(target.id);
    if (opts) target.options = opts;
  }

  return { targets };
}

export function serializeConvergeConfig(config: ConvergeConfig): string {
  const lines: string[] = [];
  const fields = "id,name,comparisonMethod,tolerance,baselinePath,actualPath";

  lines.push(`targets[${config.targets.length}]{${fields}}:`);
  for (const t of config.targets) {
    lines.push(`  ${t.id},${t.name},${t.comparisonMethod},${t.tolerance},${t.baselinePath},${t.actualPath}`);
  }

  // Write options
  for (const t of config.targets) {
    if (!t.options) continue;
    if (t.options.ignoreFields) {
      lines.push(`options.${t.id}.ignoreFields: ${t.options.ignoreFields.join(",")}`);
    }
    if (t.options.numericTolerance !== undefined) {
      lines.push(`options.${t.id}.numericTolerance: ${t.options.numericTolerance}`);
    }
    if (t.options.ignoreWhitespace !== undefined) {
      lines.push(`options.${t.id}.ignoreWhitespace: ${t.options.ignoreWhitespace}`);
    }
    if (t.options.ignoreBlankLines !== undefined) {
      lines.push(`options.${t.id}.ignoreBlankLines: ${t.options.ignoreBlankLines}`);
    }
  }

  return lines.join("\n") + "\n";
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuote = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === "," && !inQuote) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}
