#!/usr/bin/env bun
/**
 * scripts/context-vocab-diff.ts
 *
 * CT-06 / Phase 1 S-05 harness — programmatic stand-in for the plan's
 * `qa-review`/`automatable: false` convergence target:
 *
 *   "A fresh agent reading CONTEXT.md at session start uses domain
 *    terms (not generic words) in its first response — measured by a
 *    vocabulary-diff fixture comparing first-response token frequencies
 *    against CONTEXT.md glossary terms."
 *
 * The plan doesn't ship a fresh-agent harness (you can't spawn a real
 * fresh Claude Code session from inside one). This script approximates
 * the gate so it is CI-checkable:
 *
 *   1. Parse CONTEXT.md as a glossary. Glossary entries are extracted from
 *      `## {term}` heading lines (post-frontmatter, post-intro).
 *   2. Read a `--response` argument (a file containing a candidate first
 *      response) and count how many distinct glossary terms appear
 *      verbatim (case-insensitive, whole-word).
 *   3. Pass when `count >= --min` (default 3, matching plan §903).
 *
 * Pure function `analyseVocabularyDiff()` is exported for unit tests.
 *
 * NOTE: CONTEXT.md may currently be a decisions-only document until
 * `scripts/migrate-context-split.ts` is run live. In that state, this
 * harness reports `glossaryTerms: 0` and treats the gate as "not yet
 * applicable" rather than failing — so it can be committed and exercised
 * once the live migration lands.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface VocabularyDiffResult {
  glossaryTerms: string[];
  matchedTerms: string[];
  count: number;
  threshold: number;
  passed: boolean;
  status: "passed" | "failed" | "not-applicable";
  contextPath: string;
}

/**
 * Extract glossary terms from CONTEXT.md.
 *
 * A glossary entry is a `## <term>` heading where the body following the
 * heading is a short definition (≤ ~3 paragraphs). Decision-style headings
 * (those starting with `D-NN:`, `## Decision`, `## Constraint`, etc.) are
 * excluded — that content belongs in DECISIONS.md after the Phase 1
 * context-split migration.
 */
export function extractGlossaryTerms(content: string): string[] {
  const terms: string[] = [];
  const lines = content.split("\n");
  for (const line of lines) {
    const m = /^##\s+(?!D-\d|Decision\b|Constraint\b)(.+?)\s*$/.exec(line);
    if (!m) continue;
    const heading = m[1].trim();
    // Skip section dividers like "## Notes" or "## Project Decisions"
    if (/^(Notes?|Project Decisions?|Locked Decisions?)$/i.test(heading)) {
      continue;
    }
    terms.push(heading);
  }
  return terms;
}

/**
 * Count how many distinct glossary terms appear verbatim (case-insensitive,
 * whole-word) in the candidate response.
 */
export function analyseVocabularyDiff(
  contextContent: string,
  responseText: string,
  threshold = 3,
  contextPath = "CONTEXT.md",
): VocabularyDiffResult {
  const glossaryTerms = extractGlossaryTerms(contextContent);
  const matchedTerms: string[] = [];
  for (const term of glossaryTerms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "i");
    if (re.test(responseText)) {
      matchedTerms.push(term);
    }
  }
  const count = matchedTerms.length;
  if (glossaryTerms.length === 0) {
    return {
      glossaryTerms,
      matchedTerms,
      count: 0,
      threshold,
      passed: false,
      status: "not-applicable",
      contextPath,
    };
  }
  const passed = count >= threshold;
  return {
    glossaryTerms,
    matchedTerms,
    count,
    threshold,
    passed,
    status: passed ? "passed" : "failed",
    contextPath,
  };
}

function main(): number {
  const args = process.argv.slice(2);
  let responsePath: string | null = null;
  let contextPath = resolve(process.cwd(), "CONTEXT.md");
  let threshold = 3;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--response") {
      responsePath = args[++i];
    } else if (a === "--context") {
      contextPath = resolve(process.cwd(), args[++i]);
    } else if (a === "--min") {
      threshold = parseInt(args[++i], 10);
    } else if (a === "--json") {
      json = true;
    } else if (a === "-h" || a === "--help") {
      console.log(
        "usage: context-vocab-diff --response <path> [--context CONTEXT.md] [--min 3] [--json]",
      );
      return 0;
    }
  }

  if (!responsePath) {
    console.error("error: --response <path> is required");
    return 1;
  }
  if (!existsSync(contextPath)) {
    console.error(`error: context not found: ${contextPath}`);
    return 1;
  }
  if (!existsSync(responsePath)) {
    console.error(`error: response not found: ${responsePath}`);
    return 1;
  }

  const contextContent = readFileSync(contextPath, "utf8");
  const responseText = readFileSync(responsePath, "utf8");
  const result = analyseVocabularyDiff(
    contextContent,
    responseText,
    threshold,
    contextPath,
  );

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.status === "not-applicable") {
    console.log(
      `context-vocab-diff: CONTEXT.md has no glossary entries yet (not-applicable). Run scripts/migrate-context-split.ts to produce a glossary view.`,
    );
  } else {
    console.log(
      `context-vocab-diff: matched ${result.count} of ${result.glossaryTerms.length} glossary terms (threshold=${result.threshold}): ${result.status}`,
    );
    if (result.matchedTerms.length > 0) {
      console.log(`  matched: ${result.matchedTerms.join(", ")}`);
    }
  }

  return result.status === "failed" ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
