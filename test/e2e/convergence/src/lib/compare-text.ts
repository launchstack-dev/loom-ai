import type { CompareOptions, CompareResult } from "../types.js";

export function compareText(
  baseline: string,
  actual: string,
  options: CompareOptions = {}
): CompareResult {
  let baseLines = baseline.split("\n");
  let actLines = actual.split("\n");

  if (options.ignoreBlankLines) {
    baseLines = baseLines.filter((l) => l.trim() !== "");
    actLines = actLines.filter((l) => l.trim() !== "");
  }

  const maxLen = Math.max(baseLines.length, actLines.length);
  if (maxLen === 0) return { score: 1.0, details: "Both empty" };

  let matching = 0;
  const mismatched: number[] = [];

  for (let i = 0; i < maxLen; i++) {
    const b = i < baseLines.length ? baseLines[i] : undefined;
    const a = i < actLines.length ? actLines[i] : undefined;

    if (b === undefined || a === undefined) {
      mismatched.push(i + 1);
      continue;
    }

    const bCmp = options.ignoreWhitespace ? b.trim() : b;
    const aCmp = options.ignoreWhitespace ? a.trim() : a;

    if (bCmp === aCmp) {
      matching++;
    } else {
      mismatched.push(i + 1);
    }
  }

  const score = matching / maxLen;
  return {
    score: Math.round(score * 1000) / 1000,
    details:
      mismatched.length > 0
        ? `Mismatched lines: ${mismatched.join(", ")}`
        : "Identical",
  };
}
