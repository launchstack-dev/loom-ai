/**
 * Archetype detection hook implementation for roadmap-converge.
 *
 * Implements the `ArchetypeDetectionHook` seam defined in driver.ts.
 *
 * Detection algorithm:
 *   1. Read CLAUDE.md, package.json (or pyproject.toml), README.md, and top-
 *      level directory names from the current working directory.
 *   2. For each archetype defined in protocols/roadmap-archetypes.toon,
 *      count how many of its `detectionHints` are present (case-insensitive
 *      substring match) in the combined corpus.
 *   3. The archetype with the highest hit count wins, provided its hit count ≥
 *      the `MIN_CONFIDENCE_HITS` threshold. Ties are broken by archetype order
 *      in the enum (first wins).
 *   4. Below threshold → returns `{ archetype: "default", confidence: 0 }`.
 *
 * On cold start (existingState == null):
 *   - Runs detection.
 *   - If `--archetype` was passed in opts (the caller passes it through), uses
 *     that value directly (no detection needed). This function only runs when
 *     the caller decides to invoke it.
 *   - Interactive TTY: prompts the user to confirm or correct (accept default,
 *     or type a different archetype name).
 *   - Non-interactive TTY or piped stdin: auto-selects best-guess and prints
 *     a stderr advisory (UX-26).
 *
 * On warm start (existingState != null):
 *   - Returns null (no archetype change; driver keeps existing state.archetype).
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createInterface } from "node:readline";
import { dirname } from "node:path";

import type { ArchetypeDetectionHook } from "./driver.js";
import type { RoadmapConvergeStateV1 } from "../migrators/roadmap-converge-state/index.js";

// ---------------------------------------------------------------------------
// Stage context path for archetype-detection stage (AC11)
// ---------------------------------------------------------------------------

export const ARCHETYPE_STAGE_CONTEXT_PATH =
  ".plan-execution/stage-context/execute-archetype.toon";

/**
 * Write the archetype-detection stage context atomically.
 */
function writeArchetypeStageContext(
  archetype: string,
  confidence: number,
  startedAt: Date,
  completedAt: Date
): void {
  mkdirSync(dirname(ARCHETYPE_STAGE_CONTEXT_PATH), { recursive: true });
  const lines: string[] = [
    `stage: execute-archetype`,
    `wave: 4`,
    `iteration: 0`,
    `startedAt: ${startedAt.toISOString()}`,
    `completedAt: ${completedAt.toISOString()}`,
    `durationMs: ${completedAt.getTime() - startedAt.getTime()}`,
    `inputTokensEstimate: 0`,
    `outputTokensEstimate: 0`,
    `findingsResolved: 0`,
    `findingsRemaining: 0`,
    `summary: archetype detection selected '${archetype}' (confidence ${confidence})`,
    ``,
    `filesChanged[0]:`,
    `exportsAdded[0]:`,
    ``,
    `keyDecisions[1]:`,
    `  archetype=${archetype} confidence=${confidence}`,
    ``,
    `nextStageHints[1]:`,
    `  proceed to reviewer fan-out with archetype ${archetype}`,
  ];
  const body = lines.join("\n") + "\n";
  const tmp = ARCHETYPE_STAGE_CONTEXT_PATH + ".tmp";
  writeFileSync(tmp, body, "utf-8");
  renameSync(tmp, ARCHETYPE_STAGE_CONTEXT_PATH);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum hit count for a non-default archetype to be selected. */
export const MIN_CONFIDENCE_HITS = 1;

/** Valid archetype names (mirrors roadmap-archetypes.toon). */
export const VALID_ARCHETYPES = [
  "cli",
  "web-app",
  "library",
  "data-pipeline",
  "research",
  "default",
] as const;

export type ArchetypeName = typeof VALID_ARCHETYPES[number];

// ---------------------------------------------------------------------------
// Detection hints table (mirrors protocols/roadmap-archetypes.toon)
// ---------------------------------------------------------------------------

interface ArchetypeSpec {
  name: ArchetypeName;
  hints: string[];
}

const ARCHETYPES: ArchetypeSpec[] = [
  {
    name: "cli",
    hints: ["bin/", "cli", "argv", "commander", "yargs", "clap", "cobra"],
  },
  {
    name: "web-app",
    hints: ["next", "react", "vite", "svelte", "nuxt", "remix", "app/page", "pages/"],
  },
  {
    name: "library",
    hints: [
      "exports",
      "main",
      "types",
      "peerDependencies",
      "publishConfig",
      ".npmignore",
    ],
  },
  {
    name: "data-pipeline",
    hints: ["airflow", "dagster", "dbt", "prefect", "luigi", "kafka", "spark"],
  },
  {
    name: "research",
    hints: [
      "notebooks/",
      ".ipynb",
      "data/",
      "experiments/",
      "papers/",
      "jupyter",
    ],
  },
];

// ---------------------------------------------------------------------------
// Corpus builders
// ---------------------------------------------------------------------------

/**
 * Build a text corpus from the project root for archetype detection.
 * Scans: CLAUDE.md, package.json, pyproject.toml, README.md (case-variants),
 * top-level directory names, and file path snippets from top-level listing.
 *
 * @param cwd  Working directory (default: process.cwd()).
 */
export function buildDetectionCorpus(cwd: string = process.cwd()): string {
  const parts: string[] = [];

  // Read well-known files
  const files = [
    "CLAUDE.md",
    "package.json",
    "pyproject.toml",
    "README.md",
    "readme.md",
    "README.rst",
    "Cargo.toml",
    "go.mod",
    ".npmignore",
  ];
  for (const f of files) {
    const p = `${cwd}/${f}`;
    if (existsSync(p)) {
      try {
        parts.push(readFileSync(p, "utf-8"));
      } catch {
        // Non-fatal — skip unreadable files
      }
    }
  }

  // Add top-level directory names and file names
  try {
    const entries = readdirSync(cwd);
    for (const entry of entries) {
      parts.push(entry);
      // Add trailing slash for dirs (matches "bin/", "notebooks/", etc.)
      try {
        if (statSync(`${cwd}/${entry}`).isDirectory()) {
          parts.push(`${entry}/`);
        }
      } catch {
        // Ignore stat failures
      }
    }
  } catch {
    // Ignore unreadable cwd
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Score an archetype against a corpus
// ---------------------------------------------------------------------------

/**
 * Count how many detection hints for an archetype appear in the corpus
 * (case-insensitive substring match).
 */
export function scoreArchetype(spec: ArchetypeSpec, corpus: string): number {
  const lower = corpus.toLowerCase();
  let hits = 0;
  for (const hint of spec.hints) {
    if (lower.includes(hint.toLowerCase())) {
      hits++;
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Best-guess selection
// ---------------------------------------------------------------------------

export interface DetectionResult {
  archetype: ArchetypeName;
  confidence: number;
  /** Normalized 0–1 confidence fraction (hits / max_possible_hints). */
  confidenceFraction: number;
}

/**
 * Run archetype detection against a corpus. Returns the best-guess archetype
 * and a confidence score (raw hit count).
 */
export function detectArchetype(corpus: string): DetectionResult {
  let best: { spec: ArchetypeSpec; hits: number } | null = null;
  for (const spec of ARCHETYPES) {
    const hits = scoreArchetype(spec, corpus);
    if (hits >= MIN_CONFIDENCE_HITS) {
      if (best === null || hits > best.hits) {
        best = { spec, hits };
      }
    }
  }

  if (best === null) {
    return { archetype: "default", confidence: 0, confidenceFraction: 0 };
  }

  const maxHints = best.spec.hints.length;
  return {
    archetype: best.spec.name,
    confidence: best.hits,
    confidenceFraction: maxHints > 0 ? best.hits / maxHints : 0,
  };
}

// ---------------------------------------------------------------------------
// Interactive confirm-or-correct prompt
// ---------------------------------------------------------------------------

/**
 * Prompt the user to confirm or correct the detected archetype.
 *
 * Renders:
 *   Detected project archetype: <name> (confidence: <hits>)
 *   Valid choices: cli, web-app, library, data-pipeline, research, default
 *   Press Enter to accept, or type a different archetype name:
 *
 * Returns the confirmed or overridden archetype name.
 */
export async function promptArchetypeConfirm(
  detected: DetectionResult,
  stdin: NodeJS.ReadableStream = process.stdin,
  stdout: NodeJS.WritableStream = process.stdout
): Promise<string> {
  const validList = VALID_ARCHETYPES.join(", ");
  const prompt = [
    ``,
    `[roadmap-converge] Detected project archetype: ${detected.archetype} (confidence: ${detected.confidence})`,
    `  Valid choices: ${validList}`,
    `  Press Enter to accept "${detected.archetype}", or type a different archetype name: `,
  ].join("\n");

  return new Promise((resolve, reject) => {
    stdout.write(prompt);

    const rl = createInterface({ input: stdin, output: undefined, terminal: false });
    let answered = false;

    rl.once("line", (line: string) => {
      answered = true;
      rl.close();
      const trimmed = line.trim();
      if (!trimmed) {
        // Accept detected default
        resolve(detected.archetype);
        return;
      }
      const valid = VALID_ARCHETYPES.includes(trimmed as ArchetypeName);
      if (!valid) {
        stdout.write(
          `[roadmap-converge] Unknown archetype "${trimmed}". Using detected: "${detected.archetype}"\n`
        );
        resolve(detected.archetype);
        return;
      }
      resolve(trimmed);
    });

    rl.once("close", () => {
      if (!answered) {
        // EOF without a line — fall back to detected
        resolve(detected.archetype);
      }
    });

    rl.once("error", (err: Error) => {
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// TTY detection
// ---------------------------------------------------------------------------

/**
 * Returns true when stdin is an interactive terminal.
 * This is how we implement UX-26: non-interactive TTY fallback.
 */
export function isInteractiveTty(
  stdin: NodeJS.ReadableStream = process.stdin
): boolean {
  return (stdin as typeof process.stdin).isTTY === true;
}

// ---------------------------------------------------------------------------
// Hook factory
// ---------------------------------------------------------------------------

export interface ArchetypeDetectorOptions {
  /**
   * Pre-selected archetype (e.g. from `--archetype` CLI flag). When provided,
   * skips detection entirely and returns this value immediately.
   */
  archetypeOverride?: string;

  /**
   * Stderr sink for the UX-26 non-interactive advisory and other messages.
   * Default: process.stderr.write.
   */
  stderr?: (line: string) => void;

  /**
   * Stdin stream override (for tests). Default: process.stdin.
   */
  stdin?: NodeJS.ReadableStream;

  /**
   * Stdout stream override (for tests). Default: process.stdout.
   */
  stdout?: NodeJS.WritableStream;

  /**
   * Working directory override (for tests). Default: process.cwd().
   */
  cwd?: string;
}

/**
 * Create an ArchetypeDetectionHook that implements the full cold-start flow:
 *
 *   - Warm start (existingState != null) → return null immediately (no-op).
 *   - `--archetype` override → return that archetype at confidence=1.
 *   - Cold start, interactive TTY → detect + confirm-or-correct prompt.
 *   - Cold start, non-interactive TTY → detect + auto-select + UX-26 advisory.
 */
export function createArchetypeDetectionHook(
  opts: ArchetypeDetectorOptions = {}
): ArchetypeDetectionHook {
  const stderr =
    opts.stderr ?? ((l: string) => process.stderr.write(l + "\n"));
  const stdin = opts.stdin ?? process.stdin;
  const stdout = opts.stdout ?? process.stdout;
  const cwd = opts.cwd ?? process.cwd();

  return async (
    _roadmapPath: string,
    existingState: RoadmapConvergeStateV1 | null
  ): Promise<{ archetype: string; confidence: number } | null> => {
    // Warm start — existing state already has an archetype. No detection needed.
    if (existingState !== null) {
      return null;
    }

    const startedAt = new Date();

    // --archetype override: skip detection, use the override verbatim.
    if (opts.archetypeOverride) {
      if (!VALID_ARCHETYPES.includes(opts.archetypeOverride as ArchetypeName)) {
        throw new Error(
          `Invalid --archetype value: "${opts.archetypeOverride}". Valid: ${VALID_ARCHETYPES.join(", ")}`
        );
      }
      const result = { archetype: opts.archetypeOverride, confidence: 1 };
      writeArchetypeStageContext(result.archetype, result.confidence, startedAt, new Date());
      return result;
    }

    // Cold start: run detection.
    const corpus = buildDetectionCorpus(cwd);
    const detected = detectArchetype(corpus);

    let result: { archetype: string; confidence: number };

    // Interactive TTY: prompt user to confirm or correct.
    if (isInteractiveTty(stdin)) {
      const chosen = await promptArchetypeConfirm(detected, stdin, stdout);
      result = {
        archetype: chosen,
        confidence: chosen === detected.archetype ? detected.confidence : 1,
      };
    } else {
      // Non-interactive TTY / piped stdin: UX-26 auto-select with advisory.
      stderr(
        `[roadmap-converge] non-interactive stdin: auto-selected archetype '${detected.archetype}' (confidence ${detected.confidence}). Override with --archetype <name>.`
      );
      result = { archetype: detected.archetype, confidence: detected.confidence };
    }

    writeArchetypeStageContext(result.archetype, result.confidence, startedAt, new Date());
    return result;
  };
}

/**
 * Default export: the archetype detection hook (wired into driver.ts by Phase 4).
 *
 * In production, `runConvergePass` callers should pass:
 *   archetypeDetectionHook: createArchetypeDetectionHook({ archetypeOverride })
 *
 * where `archetypeOverride` is the --archetype flag value (or undefined).
 */
export const archetypeDetectionHook: ArchetypeDetectionHook =
  createArchetypeDetectionHook();
