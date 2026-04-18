import type { CompareOptions, CompareResult } from "../types.js";

interface LeafCount {
  matched: number;
  total: number;
  mismatches: string[];
}

function countLeaves(
  baseline: unknown,
  actual: unknown,
  path: string,
  opts: CompareOptions
): LeafCount {
  // Check ignore list
  const lastKey = path.split(".").pop() ?? "";
  if (opts.ignoreFields?.includes(lastKey) && path !== "") {
    return { matched: 0, total: 0, mismatches: [] };
  }

  // Both null/undefined
  if (baseline == null && actual == null) {
    return { matched: 1, total: 1, mismatches: [] };
  }

  // One is null/undefined
  if (baseline == null || actual == null) {
    return { matched: 0, total: 1, mismatches: [`${path}: ${JSON.stringify(baseline)} vs ${JSON.stringify(actual)}`] };
  }

  // Both arrays
  if (Array.isArray(baseline) && Array.isArray(actual)) {
    const maxLen = Math.max(baseline.length, actual.length);
    if (maxLen === 0) return { matched: 1, total: 1, mismatches: [] };
    let matched = 0;
    let total = 0;
    const mismatches: string[] = [];
    for (let i = 0; i < maxLen; i++) {
      const sub = countLeaves(
        i < baseline.length ? baseline[i] : undefined,
        i < actual.length ? actual[i] : undefined,
        `${path}[${i}]`,
        opts
      );
      matched += sub.matched;
      total += sub.total;
      mismatches.push(...sub.mismatches);
    }
    return { matched, total, mismatches };
  }

  // Both objects
  if (typeof baseline === "object" && typeof actual === "object" && !Array.isArray(baseline) && !Array.isArray(actual)) {
    const baseObj = baseline as Record<string, unknown>;
    const actObj = actual as Record<string, unknown>;
    const allKeys = new Set([...Object.keys(baseObj), ...Object.keys(actObj)]);

    if (allKeys.size === 0) return { matched: 1, total: 1, mismatches: [] };

    let matched = 0;
    let total = 0;
    const mismatches: string[] = [];
    for (const key of allKeys) {
      if (opts.ignoreFields?.includes(key)) continue;
      const sub = countLeaves(
        baseObj[key],
        actObj[key],
        path ? `${path}.${key}` : key,
        opts
      );
      matched += sub.matched;
      total += sub.total;
      mismatches.push(...sub.mismatches);
    }
    if (total === 0) return { matched: 1, total: 1, mismatches: [] };
    return { matched, total, mismatches };
  }

  // Leaf comparison
  if (typeof baseline === "number" && typeof actual === "number") {
    const tol = opts.numericTolerance ?? 0;
    if (Math.abs(baseline - actual) <= tol) {
      return { matched: 1, total: 1, mismatches: [] };
    }
    return { matched: 0, total: 1, mismatches: [`${path}: ${baseline} vs ${actual}`] };
  }

  // Type mismatch or value mismatch
  if (baseline === actual) {
    return { matched: 1, total: 1, mismatches: [] };
  }
  return { matched: 0, total: 1, mismatches: [`${path}: ${JSON.stringify(baseline)} vs ${JSON.stringify(actual)}`] };
}

export function compareJson(
  baseline: unknown,
  actual: unknown,
  options: CompareOptions = {}
): CompareResult {
  const { matched, total, mismatches } = countLeaves(baseline, actual, "", options);
  if (total === 0) return { score: 1.0, details: "Both empty" };
  const score = matched / total;
  return {
    score: Math.round(score * 1000) / 1000,
    details: mismatches.length > 0 ? mismatches.join("; ") : "Identical",
  };
}
