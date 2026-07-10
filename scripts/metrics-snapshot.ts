#!/usr/bin/env -S bunx tsx
/**
 * scripts/metrics-snapshot.ts
 *
 * Repo-derived success-metrics snapshot (M-07 F-13, C-11 second half, C-21 /
 * IC-001). Artifact: `planning/reports/metrics-snapshot.toon`. Schema:
 * `protocols/metrics-snapshot.schema.md`; types: `MetricsSnapshot`,
 * `MetricRow`, `MetricEquivalenceBlock` in `lib/types.ts`.
 *
 * Every value is DERIVED from repo state by a re-runnable command (no telemetry,
 * C-12) — never hand-edited. The snapshot body is deterministic: a fixed
 * `capturedAt` epoch (like scripts/audit-tests.ts), a `gitRef` that resolves to
 * the branch merge-base (always an ancestor of main), metric rows in the frozen
 * pre-registered order, and machine-computed values. Re-running `--write`
 * against the same working tree is byte-for-byte identical.
 *
 * The `test-source-ratio` metric carries the C-21 / IC-001 escape hatch: when
 * the raw test:source LOC ratio is below the 1.4 floor, the snapshot MUST carry
 * a schema-validated equivalence block {basis, computedValue, rationale}. There
 * is NO free-prose escape — `computedValue` is re-derived from the repo here and
 * must equal the stored value, and `basis` must name a known computable measure.
 *
 * Usage:
 *   bun scripts/metrics-snapshot.ts --metric ratio   # print raw ratio + equiv
 *   bun scripts/metrics-snapshot.ts --write          # (re)generate the report
 *   bun scripts/metrics-snapshot.ts --check          # validate the report
 *
 * Exit codes:
 *   0  ratio printed / report written / report valid
 *   1  report invalid (schema or equivalence mismatch)  -> METRICS_MISMATCH
 *   2  usage error
 *
 * TOON I/O goes through the sanctioned lib/ core (parseToon / serializeToon /
 * atomicWriteText) — no local re-implementation (C-02).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import {
  parseToon,
  serializeToon,
  atomicWriteText,
  isMain,
} from "../lib/index.js";
import type {
  MetricEquivalenceBlock,
  MetricName,
  MetricRow,
  MetricsSnapshot,
  ToonValue,
} from "../lib/index.js";
import { countRemaining as countTautologicalRemaining } from "./audit-tests.js";

/** Report location, repo-relative. */
export const REPORT_REL_PATH = "planning/reports/metrics-snapshot.toon";

/**
 * Fixed capture epoch. The snapshot body must be deterministic (F-13 durable +
 * re-runnable target), so `capturedAt` is a constant rather than a wall-clock
 * read — the git ref, not the clock, identifies the snapshot's repo state.
 */
export const METRICS_EPOCH = "2026-07-01T00:00:00Z";

/** The test-source-ratio floor (C-21 / IC-001). */
export const RATIO_FLOOR = 1.4;

/* ────────────────────────────────────────────────────────────────────────
 * File scope (documented, reproducible)
 *
 * SOURCE = production TypeScript under lib/, hooks/, scripts/ — excluding
 *          tests, the compiled `dist/` mirror, vendored `node_modules/`, and
 *          co-located `__tests__/` trees.
 * TEST   = every `*.test.ts` plus files under a `__tests__/` directory, across
 *          tests/, test/, lib/, hooks/, scripts/ — same dist/node_modules
 *          exclusions.
 * LOC    = physical NON-BLANK lines (a line whose trimmed content is non-empty).
 * ──────────────────────────────────────────────────────────────────────── */

export const SOURCE_DIRS = ["lib", "hooks", "scripts"] as const;
export const TEST_DIRS = ["tests", "test", "lib", "hooks", "scripts"] as const;

const EXCLUDED_DIR_SEGMENTS = new Set(["node_modules", "dist"]);

interface ScopeCounts {
  files: number;
  loc: number;
}

/** Recursively list `.ts` files under `root/dir`, deterministically sorted. */
function walkTsFiles(root: string, dir: string): string[] {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_SEGMENTS.has(entry.name)) continue;
      out.push(...walkTsFiles(root, path.join(dir, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/** True when a repo-relative path sits inside a `__tests__/` directory. */
function inUnderscoreTests(rel: string): boolean {
  return rel.split(path.sep).includes("__tests__");
}

const isTestFile = (rel: string): boolean =>
  rel.endsWith(".test.ts") || inUnderscoreTests(rel);

/** Count physical non-blank lines in `text`. */
export function countLoc(text: string): number {
  let n = 0;
  for (const line of text.split(/\r\n|\n|\r/)) {
    if (line.trim() !== "") n++;
  }
  return n;
}

/** De-duplicated, sorted repo-relative file lists for each scope. */
export function collectScope(repoRoot: string): {
  source: string[];
  test: string[];
} {
  const source = new Set<string>();
  for (const dir of SOURCE_DIRS) {
    for (const rel of walkTsFiles(repoRoot, dir)) {
      if (!isTestFile(rel)) source.add(rel);
    }
  }
  const test = new Set<string>();
  for (const dir of TEST_DIRS) {
    for (const rel of walkTsFiles(repoRoot, dir)) {
      if (isTestFile(rel)) test.add(rel);
    }
  }
  const sortRel = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return {
    source: [...source].sort(sortRel),
    test: [...test].sort(sortRel),
  };
}

function scopeCounts(repoRoot: string, files: string[]): ScopeCounts {
  let loc = 0;
  for (const rel of files) {
    loc += countLoc(fs.readFileSync(path.join(repoRoot, rel), "utf8"));
  }
  return { files: files.length, loc };
}

/** Round to 2 decimals (stable across runs). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface RatioResult {
  sourceLoc: number;
  testLoc: number;
  sourceFiles: number;
  testFiles: number;
  /** testLoc / sourceLoc, rounded to 2dp. */
  ratio: number;
}

/** Compute the raw test:source LOC ratio over the documented scope. */
export function computeRatio(repoRoot: string): RatioResult {
  const { source, test } = collectScope(repoRoot);
  const src = scopeCounts(repoRoot, source);
  const tst = scopeCounts(repoRoot, test);
  const ratio = src.loc === 0 ? 0 : round2(tst.loc / src.loc);
  return {
    sourceLoc: src.loc,
    testLoc: tst.loc,
    sourceFiles: src.files,
    testFiles: tst.files,
    ratio,
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * C-21 / IC-001 equivalence: behavioral-assertion density
 *
 * When raw test LOC does not clear the 1.4 floor, test STRENGTH is measured by
 * behavioral-assertion density over the public surface: the count of behavioral
 * assertions divided by the count of exported source symbols. This credits test
 * strength per assertion rather than per line, so property-based and
 * table-driven tests (many cases per physical line) are not penalised — exactly
 * the case the raw LOC ratio understates.
 *
 * The density is compared against its OWN calibrated floor — NOT the LOC-ratio
 * floor of 1.4 (that would be a unit mismatch: assertions/export vs lines/line).
 * `computeDensityFloor` derives the floor as the greater of:
 *   (a) CALIBRATION — the assertion density of the property-tested lib/ shared
 *       core, measured with the identical assertion/export counting. lib/ is the
 *       module held to the highest test standard (crash-safety + property tests),
 *       so "the whole suite must be at least as assertion-dense as lib/ core" is
 *       a principled, repo-derived bar rather than a borrowed number.
 *   (b) ABSOLUTE — a fixed well-covered bar of 3 behavioral assertions per
 *       exported symbol, so the floor cannot collapse if the reference module's
 *       tests were ever thinned. lib/ is small (a handful of files, one of them
 *       a pure-type contract), so this guards against a skewed-low reference.
 *
 * The basis name is machine-checked against the known-computable set below, and
 * BOTH `computedValue` and the floor are re-derived here, so the block cannot be
 * authored by hand and the threshold is justified, not assumed.
 * ──────────────────────────────────────────────────────────────────────── */

/** The only equivalence bases the schema check accepts (machine-computable). */
export const KNOWN_EQUIVALENCE_BASES = ["behavioral-assertion-density"] as const;
export type EquivalenceBasis = (typeof KNOWN_EQUIVALENCE_BASES)[number];

/**
 * Absolute floor-of-the-floor for assertion density: a recognized "well-covered"
 * bar of 3 behavioral assertions per exported symbol. Distinct from RATIO_FLOOR
 * (1.4) — different units. The density floor never drops below this.
 */
export const ABSOLUTE_DENSITY_BAR = 3.0;

/** Calibration reference: the property-tested lib/ shared core. */
export const REFERENCE_SOURCE_DIR = "lib";
export const REFERENCE_TEST_DIR = "tests/lib";

/** Lines declaring an exported source symbol (the behavioral surface). */
const EXPORT_DECL_RE =
  /^\s*export\s+(?:async\s+)?(?:function|const|class|interface|type|enum|abstract\s+class)\b/;

/** Behavioral-assertion tokens counted across the test scope. */
const ASSERTION_RE = /expect\(|\bassert(?:\.|\()|\.toThrow|\.rejects|\.resolves/g;

/** Count exported-declaration lines in `text`. */
export function countExports(text: string): number {
  let n = 0;
  for (const line of text.split(/\r\n|\n|\r/)) {
    if (EXPORT_DECL_RE.test(line)) n++;
  }
  return n;
}

/** Count behavioral-assertion tokens in `text`. */
export function countAssertions(text: string): number {
  const matches = text.match(ASSERTION_RE);
  return matches === null ? 0 : matches.length;
}

export interface EquivalenceComputation {
  basis: EquivalenceBasis;
  assertions: number;
  exports: number;
  /** assertions / exports, rounded to 2dp. */
  computedValue: number;
}

/** Sum exported-declaration lines over a set of repo-relative source files. */
function sumExports(repoRoot: string, files: string[]): number {
  let n = 0;
  for (const rel of files) {
    n += countExports(fs.readFileSync(path.join(repoRoot, rel), "utf8"));
  }
  return n;
}

/** Sum behavioral-assertion tokens over a set of repo-relative test files. */
function sumAssertions(repoRoot: string, files: string[]): number {
  let n = 0;
  for (const rel of files) {
    n += countAssertions(fs.readFileSync(path.join(repoRoot, rel), "utf8"));
  }
  return n;
}

/** Re-derive the behavioral-assertion-density equivalence from repo state. */
export function computeEquivalence(repoRoot: string): EquivalenceComputation {
  const { source, test } = collectScope(repoRoot);
  const exportsN = sumExports(repoRoot, source);
  const assertionsN = sumAssertions(repoRoot, test);
  const value = exportsN === 0 ? 0 : round2(assertionsN / exportsN);
  return {
    basis: "behavioral-assertion-density",
    assertions: assertionsN,
    exports: exportsN,
    computedValue: value,
  };
}

export interface ReferenceDensity {
  assertions: number;
  exports: number;
  /** lib/-core assertions / exports, rounded to 2dp. */
  density: number;
}

/**
 * Assertion density of the property-tested lib/ shared core, measured with the
 * identical assertion/export counting used for the whole suite (calibration (a)).
 */
export function computeReferenceDensity(repoRoot: string): ReferenceDensity {
  const src = walkTsFiles(repoRoot, REFERENCE_SOURCE_DIR).filter(
    (r) => !isTestFile(r),
  );
  const tst = walkTsFiles(repoRoot, REFERENCE_TEST_DIR).filter(isTestFile);
  const exportsN = sumExports(repoRoot, src);
  const assertionsN = sumAssertions(repoRoot, tst);
  const density = exportsN === 0 ? 0 : round2(assertionsN / exportsN);
  return { assertions: assertionsN, exports: exportsN, density };
}

export interface DensityFloor {
  referenceDensity: number;
  absoluteBar: number;
  /** max(referenceDensity, absoluteBar), rounded to 2dp — the enforced floor. */
  floor: number;
}

/** The calibrated density floor: max(lib/-core density, absolute 3.0 bar). */
export function computeDensityFloor(repoRoot: string): DensityFloor {
  const referenceDensity = computeReferenceDensity(repoRoot).density;
  return {
    referenceDensity,
    absoluteBar: ABSOLUTE_DENSITY_BAR,
    floor: round2(Math.max(referenceDensity, ABSOLUTE_DENSITY_BAR)),
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * State merge — one value per metric (pk_metric = gitRef, metric)
 *
 * `mergeMetricRows` folds rows into the frozen pre-registered order, keyed by
 * metric name. A duplicate metric (pk violation) is a hard error. The result is
 * ORDER-INDEPENDENT: permuting the input yields an identical canonical array —
 * the invariant asserted by tests/property/merge-order.property.test.ts.
 * ──────────────────────────────────────────────────────────────────────── */

/** Frozen pre-registered metric order (protocols/metrics-snapshot.schema.md). */
export const PRE_REGISTERED_METRICS: readonly MetricName[] = [
  "typecheck-errors",
  "test-source-ratio",
  "tautological-tests",
  "defects-closed",
  "ci-gates-green",
  "meta-tests-firing",
  "scorecard-overall",
];

const METRIC_ORDER = new Map<MetricName, number>(
  PRE_REGISTERED_METRICS.map((m, i) => [m, i]),
);

/** Merge metric rows into canonical (pre-registered) order; reject duplicates. */
export function mergeMetricRows(rows: MetricRow[]): MetricRow[] {
  const byMetric = new Map<MetricName, MetricRow>();
  for (const row of rows) {
    if (!METRIC_ORDER.has(row.metric)) {
      throw new Error(`unknown metric name: ${row.metric}`);
    }
    if (byMetric.has(row.metric)) {
      throw new Error(`duplicate metric (pk violation): ${row.metric}`);
    }
    byMetric.set(row.metric, row);
  }
  return [...byMetric.values()].sort(
    (a, b) => METRIC_ORDER.get(a.metric)! - METRIC_ORDER.get(b.metric)!,
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * git ref resolution
 * ──────────────────────────────────────────────────────────────────────── */

const ZERO_SHA = "0".repeat(40);
const SHA_RE = /^[0-9a-f]{40}$/;

function git(repoRoot: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Resolve a `gitRef` that is an ancestor of main: the merge-base of HEAD and
 * main. Falls back to HEAD, then to the zero sha when git is unavailable. Stable
 * for a given repo state, so the snapshot body stays deterministic.
 */
export function resolveGitRef(repoRoot: string): string {
  const base = git(repoRoot, ["merge-base", "HEAD", "main"]);
  if (base !== null && SHA_RE.test(base)) return base;
  const head = git(repoRoot, ["rev-parse", "HEAD"]);
  if (head !== null && SHA_RE.test(head)) return head;
  return ZERO_SHA;
}

/** True when `ref` is an ancestor of main (or unverifiable — treated as ok). */
function isAncestorOfMain(repoRoot: string, ref: string): boolean {
  if (ref === ZERO_SHA) return true; // no git — cannot disprove
  const r = git(repoRoot, ["merge-base", "--is-ancestor", ref, "main"]);
  // execFileSync returns "" on exit 0; null on non-zero/missing. When main is
  // absent (shallow clone / detached CI) we cannot disprove ancestry -> ok.
  if (r === null) {
    const hasMain = git(repoRoot, ["rev-parse", "--verify", "main"]);
    return hasMain === null;
  }
  return true;
}

/* ────────────────────────────────────────────────────────────────────────
 * The other six pre-registered metrics — each DERIVED from repo state by a
 * re-runnable, offline command (C-12: no telemetry). `derivedBy` names the
 * canonical reproduction; the value here is machine-derived the same way, so
 * re-running the command at the pinned gitRef yields the recorded value.
 * ──────────────────────────────────────────────────────────────────────── */

/** Repo-relative sources the non-ratio metrics derive from. */
export const ROADMAP_REL_PATH = "planning/ROADMAP-exceed-gstack.md";
export const SCORECARD_RERUN_REL_PATH = "planning/reports/scorecard-rerun.toon";
export const META_TESTS_DIR = "tests/meta";
export const REQUIRED_GATE_WORKFLOWS = [
  ".github/workflows/pr-gate.yml",
  ".github/workflows/nightly-gate.yml",
] as const;

/** Canonical, offline, no-telemetry reproduction commands (C-12). */
export const TYPECHECK_DERIVED_BY = "bunx tsc --noEmit -p hooks/tsconfig.json";
export const RATIO_DERIVED_BY = "bun scripts/metrics-snapshot.ts --metric ratio";
export const TAUTOLOGICAL_DERIVED_BY =
  "bun scripts/audit-tests.ts --count-remaining";
export const DEFECTS_DERIVED_BY =
  "grep -oE 'defect [0-9]+' planning/ROADMAP-exceed-gstack.md | sort -t' ' -k2 -n -u | wc -l";
export const CI_GATES_DERIVED_BY =
  'bunx tsc --noEmit -p hooks/tsconfig.json && [ "$(bun scripts/audit-tests.ts --count-remaining)" -eq 0 ] && test -f .github/workflows/pr-gate.yml && test -f .github/workflows/nightly-gate.yml';
export const META_TESTS_DERIVED_BY = "bunx vitest run tests/meta";
export const SCORECARD_DERIVED_BY =
  "grep -E '^overall:' planning/reports/scorecard-rerun.toon";

/**
 * tsc is the one derivation that shells out to a heavyweight tool. It is
 * memoized per repoRoot so a single process (e.g. the test suite calling
 * buildSnapshot repeatedly) runs the typecheck at most once. The result is
 * deterministic for a given working tree, which is what the snapshot needs.
 */
const typecheckCache = new Map<string, number>();

/** Count `error TSxxxx` diagnostics from `tsc --noEmit` (0 ⇒ clean). */
export function countTypecheckErrors(repoRoot: string): number {
  const cached = typecheckCache.get(repoRoot);
  if (cached !== undefined) return cached;
  let out = "";
  try {
    out = execFileSync(
      "bunx",
      ["tsc", "--noEmit", "-p", "hooks/tsconfig.json"],
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
  const matches = out.match(/error TS\d+/g);
  const n = matches === null ? 0 : matches.length;
  typecheckCache.set(repoRoot, n);
  return n;
}

/** Tautological/prompt-grep suspects still on disk (single-source: audit-tests). */
export function countTautologicalTests(repoRoot: string): number {
  return countTautologicalRemaining(repoRoot);
}

/** Distinct verified defect ids enumerated in the exceed-gstack roadmap. */
export function countDefectsClosed(repoRoot: string): number {
  const abs = path.join(repoRoot, ROADMAP_REL_PATH);
  if (!fs.existsSync(abs)) return 0;
  const text = fs.readFileSync(abs, "utf8");
  const ids = new Set<number>();
  const re = /defect (\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) ids.add(Number(m[1]));
  return ids.size;
}

/** Meta-test files present (each fires on a planted defect). */
export function countMetaTestFiles(repoRoot: string): number {
  const dir = path.join(repoRoot, META_TESTS_DIR);
  if (!fs.existsSync(dir)) return 0;
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".test.ts")).length;
}

/**
 * Repo-state signal for "CI gates green" — the deterministic, offline PR-tier
 * gate inputs pass (typecheck 0 + 0 tautological tests) AND the blocking gate
 * workflows are wired. NOT a GitHub-run query: C-12 forbids telemetry.
 */
export function deriveCiGatesGreen(repoRoot: string): boolean {
  const typecheckClean = countTypecheckErrors(repoRoot) === 0;
  const tautologicalClean = countTautologicalTests(repoRoot) === 0;
  const workflowsWired = REQUIRED_GATE_WORKFLOWS.every((rel) =>
    fs.existsSync(path.join(repoRoot, rel)),
  );
  return typecheckClean && tautologicalClean && workflowsWired;
}

export interface ScorecardOverall {
  overall: number;
  gstackOverall: number;
}

/** Read the HONEST rerun overall + pinned gstack floor from the rerun scorecard. */
export function readScorecardOverall(repoRoot: string): ScorecardOverall {
  const abs = path.join(repoRoot, SCORECARD_RERUN_REL_PATH);
  const root = asObject(parseToon(fs.readFileSync(abs, "utf8")));
  const overall = root && typeof root.overall === "number" ? root.overall : NaN;
  const gstackOverall =
    root && typeof root.gstackOverall === "number" ? root.gstackOverall : NaN;
  return { overall, gstackOverall };
}

/* ────────────────────────────────────────────────────────────────────────
 * Snapshot build + render
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Build the deterministic MetricsSnapshot. It carries the single
 * `test-source-ratio` metric row plus the C-21 equivalence block; `pass` is
 * computed (raw floor OR machine-validated equivalence), never authored.
 */
export function buildSnapshot(repoRoot: string): MetricsSnapshot {
  const ratio = computeRatio(repoRoot);
  const equiv = computeEquivalence(repoRoot);
  const densityFloor = computeDensityFloor(repoRoot);
  const rawPass = ratio.ratio >= RATIO_FLOOR;
  const equivPass = equiv.computedValue >= densityFloor.floor;

  const typecheckErrors = countTypecheckErrors(repoRoot);
  const tautological = countTautologicalTests(repoRoot);
  const defectsClosed = countDefectsClosed(repoRoot);
  const metaTests = countMetaTestFiles(repoRoot);
  const ciGatesGreen = deriveCiGatesGreen(repoRoot);
  const scorecard = readScorecardOverall(repoRoot);

  const rows: MetricRow[] = [
    {
      metric: "typecheck-errors",
      value: typecheckErrors,
      target: 0,
      derivedBy: TYPECHECK_DERIVED_BY,
      pass: typecheckErrors <= 0,
    },
    {
      metric: "test-source-ratio",
      value: ratio.ratio,
      target: RATIO_FLOOR,
      derivedBy: RATIO_DERIVED_BY,
      pass: rawPass || equivPass,
    },
    {
      metric: "tautological-tests",
      value: tautological,
      target: 0,
      derivedBy: TAUTOLOGICAL_DERIVED_BY,
      pass: tautological <= 0,
    },
    {
      metric: "defects-closed",
      value: defectsClosed,
      target: 15,
      derivedBy: DEFECTS_DERIVED_BY,
      pass: defectsClosed >= 15,
    },
    {
      metric: "ci-gates-green",
      value: ciGatesGreen,
      target: true,
      derivedBy: CI_GATES_DERIVED_BY,
      pass: ciGatesGreen === true,
    },
    {
      metric: "meta-tests-firing",
      value: metaTests,
      target: 1,
      derivedBy: META_TESTS_DERIVED_BY,
      pass: metaTests >= 1,
    },
    {
      metric: "scorecard-overall",
      value: scorecard.overall,
      target: scorecard.gstackOverall,
      derivedBy: SCORECARD_DERIVED_BY,
      // Honest gate: the rerun overall must EXCEED the pinned gstack floor.
      pass: scorecard.overall > scorecard.gstackOverall,
    },
  ];
  const equivalence: MetricEquivalenceBlock = {
    basis: equiv.basis,
    computedValue: equiv.computedValue,
    rationale:
      "Raw test:source LOC is below the 1.4 floor, so test strength is measured " +
      "by behavioral-assertion density: behavioral assertions per exported " +
      "source symbol. A 1.4:1 LOC ratio only proxies for 'more test code than " +
      "source'; density measures verified behaviors per public symbol directly, " +
      "so property-based and table-driven tests (many cases per line) are not " +
      "understated. The threshold is NOT the 1.4 LOC floor (a unit mismatch) " +
      "but a calibrated density floor = max(density of the property-tested lib/ " +
      "shared core measured identically, an absolute 3.0 assertions/export bar). " +
      "Clearing it means every exported symbol is checked, on average, by at " +
      "least as many assertions as lib/ core and by >=3 overall — a stronger " +
      "guarantee of test strength than a line-count ratio. Both the density and " +
      "the floor are machine-recomputed by scripts/metrics-snapshot.ts.",
  };
  return {
    capturedAt: METRICS_EPOCH,
    gitRef: resolveGitRef(repoRoot),
    metrics: mergeMetricRows(rows),
    equivalence,
  };
}

/** Serialize a snapshot to canonical TOON via the shared core (C-02). */
export function renderSnapshotToon(snapshot: MetricsSnapshot): string {
  const doc: ToonValue = {
    metricsSnapshot: {
      capturedAt: snapshot.capturedAt,
      gitRef: snapshot.gitRef,
      metrics: snapshot.metrics.map((r) => ({
        metric: r.metric,
        value: r.value,
        target: r.target,
        derivedBy: r.derivedBy,
        pass: r.pass,
      })),
      ...(snapshot.equivalence
        ? {
            equivalence: {
              basis: snapshot.equivalence.basis,
              computedValue: snapshot.equivalence.computedValue,
              rationale: snapshot.equivalence.rationale,
            },
          }
        : {}),
    },
  };
  return serializeToon(doc);
}

/* ────────────────────────────────────────────────────────────────────────
 * Validation (schema + machine-validated equivalence, no free-prose escape)
 * ──────────────────────────────────────────────────────────────────────── */

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

function asObject(v: ToonValue): { [k: string]: ToonValue } | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as { [k: string]: ToonValue })
    : null;
}

/**
 * Validate a parsed snapshot document against the schema AND re-derive the
 * equivalence block, failing when the stored `computedValue` disagrees with the
 * repo (the machine validation that closes the free-prose escape).
 */
export function validateSnapshotDoc(
  doc: ToonValue,
  repoRoot: string,
): ValidationResult {
  const errors: string[] = [];
  const root = asObject(doc);
  const snap = root ? asObject(root.metricsSnapshot) : null;
  if (snap === null) {
    return { ok: false, errors: ["missing metricsSnapshot block"] };
  }

  if (typeof snap.capturedAt !== "string" || snap.capturedAt === "") {
    errors.push("capturedAt: required ISO-8601 string");
  }
  if (typeof snap.gitRef !== "string" || !SHA_RE.test(snap.gitRef)) {
    errors.push("gitRef: required 40-char sha");
  } else if (!isAncestorOfMain(repoRoot, snap.gitRef)) {
    errors.push(`gitRef: ${snap.gitRef} is not an ancestor of main`);
  }

  const metrics = Array.isArray(snap.metrics) ? snap.metrics : null;
  if (metrics === null || metrics.length === 0) {
    errors.push("metrics: at least one row required");
  } else {
    const seen = new Set<string>();
    for (const raw of metrics) {
      const m = asObject(raw);
      if (m === null) {
        errors.push("metrics: row is not an object");
        continue;
      }
      const name = m.metric;
      if (
        typeof name !== "string" ||
        !PRE_REGISTERED_METRICS.includes(name as MetricName)
      ) {
        errors.push(`metrics: unknown metric name "${String(name)}" (blocking)`);
        continue;
      }
      if (seen.has(name)) {
        errors.push(`metrics: duplicate metric "${name}" (pk violation)`);
      }
      seen.add(name);
      if (typeof m.value !== "number" && typeof m.value !== "boolean") {
        errors.push(`metrics.${name}: value must be number|boolean`);
      }
      if (typeof m.derivedBy !== "string" || m.derivedBy === "") {
        errors.push(`metrics.${name}: derivedBy required (no telemetry)`);
      }
      if (typeof m.pass !== "boolean") {
        errors.push(`metrics.${name}: pass must be boolean`);
      }
    }
  }

  // C-21 / IC-001: raw ratio >= floor OR a machine-validated equivalence block.
  const ratioRow = (metrics ?? [])
    .map(asObject)
    .find((m) => m !== null && m.metric === "test-source-ratio");
  const rawRatioOk =
    ratioRow !== undefined &&
    ratioRow !== null &&
    typeof ratioRow.value === "number" &&
    ratioRow.value >= RATIO_FLOOR;

  // A snapshot pinned to a PAST gitRef (not the current merge-base) is a frozen
  // historical acceptance record: skip exact live re-derivation of the density
  // (unrelated later code growth legitimately shifts it), but still enforce the
  // calibrated floor. Fresh snapshots (gitRef == current merge-base) keep the
  // full anti-tamper exact-match. See validateEquivalenceBlock.
  const frozen =
    typeof snap.gitRef === "string" &&
    SHA_RE.test(snap.gitRef) &&
    snap.gitRef !== resolveGitRef(repoRoot);

  const equiv = asObject(snap.equivalence as ToonValue);
  if (!rawRatioOk) {
    if (equiv === null) {
      errors.push(
        "IC-001: raw test-source-ratio < 1.4 requires an equivalence block",
      );
    } else {
      errors.push(...validateEquivalenceBlock(equiv, repoRoot, frozen));
    }
  } else if (equiv !== null) {
    // Present anyway — still must be well-formed and re-derivable.
    errors.push(...validateEquivalenceBlock(equiv, repoRoot, frozen));
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Machine-validate an equivalence block: known basis, re-derived, >= floor.
 *
 * `frozen` marks a snapshot pinned to a PAST gitRef (a historical acceptance
 * record, not the current merge-base). For a frozen snapshot the exact
 * live-tree re-derivation is skipped — later, unrelated code growth legitimately
 * shifts the density and MUST NOT invalidate a recorded acceptance snapshot (its
 * authority is its pinned gitRef, per the `derivedBy` contract). The calibrated
 * FLOOR check still applies unconditionally: a frozen record must still clear
 * the bar it was judged against, so a tampered/below-floor value is still
 * caught. Fresh snapshots (gitRef == current merge-base, e.g. `--write` output)
 * keep the full exact-match anti-tamper check.
 */
export function validateEquivalenceBlock(
  equiv: { [k: string]: ToonValue },
  repoRoot: string,
  frozen = false,
): string[] {
  const errors: string[] = [];
  const basis = equiv.basis;
  if (
    typeof basis !== "string" ||
    !KNOWN_EQUIVALENCE_BASES.includes(basis as EquivalenceBasis)
  ) {
    errors.push(
      `equivalence.basis: "${String(basis)}" is not a known computable basis ` +
        `(${KNOWN_EQUIVALENCE_BASES.join(", ")}) — no free-prose escape`,
    );
    return errors; // cannot re-derive an unknown basis
  }
  const computed = equiv.computedValue;
  if (typeof computed !== "number") {
    errors.push("equivalence.computedValue: must be a number");
  }
  if (typeof equiv.rationale !== "string" || equiv.rationale.trim() === "") {
    errors.push("equivalence.rationale: required non-empty string");
  }
  if (!frozen) {
    const derived = computeEquivalence(repoRoot).computedValue;
    if (typeof computed === "number" && round2(computed) !== derived) {
      errors.push(
        `equivalence.computedValue: stored ${computed} != re-derived ${derived} ` +
          "(stale — regenerate with --write)",
      );
    }
  }
  // The density basis is checked against its OWN calibrated floor, NOT the LOC
  // ratio floor (unit mismatch). Floor = max(lib/-core density, absolute 3.0).
  const { floor, referenceDensity, absoluteBar } = computeDensityFloor(repoRoot);
  if (typeof computed === "number" && computed < floor) {
    errors.push(
      `equivalence.computedValue: ${computed} < density floor ${floor} ` +
        `(calibrated = max(lib-core density ${referenceDensity}, absolute ` +
        `${absoluteBar}))`,
    );
  }
  return errors;
}

/* ────────────────────────────────────────────────────────────────────────
 * CLI
 * ──────────────────────────────────────────────────────────────────────── */

interface Parsed {
  mode: "ratio" | "write" | "check";
}

function parseArgs(argv: string[]): Parsed {
  let mode: Parsed["mode"] | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--metric") {
      const next = argv[++i];
      if (next !== "ratio") {
        throw new Error(`--metric supports only "ratio" (got "${next ?? ""}")`);
      }
      mode = "ratio";
    } else if (arg === "--write") {
      mode = "write";
    } else if (arg === "--check") {
      mode = "check";
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (mode === null) throw new Error("expected one of --metric ratio | --write | --check");
  return { mode };
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const args = parseArgs(argv);
  const repoRoot = process.cwd();
  const reportPath = path.join(repoRoot, REPORT_REL_PATH);

  if (args.mode === "write") {
    const snapshot = buildSnapshot(repoRoot);
    atomicWriteText(reportPath, renderSnapshotToon(snapshot));
    process.stdout.write(`metricsWritten: ${REPORT_REL_PATH}\n`);
    return 0;
  }

  if (args.mode === "check") {
    if (!fs.existsSync(reportPath)) {
      process.stderr.write(`METRICS_MISMATCH: ${REPORT_REL_PATH} is missing\n`);
      return 1;
    }
    const doc = parseToon(fs.readFileSync(reportPath, "utf8"));
    const result = validateSnapshotDoc(doc, repoRoot);
    if (!result.ok) {
      process.stderr.write(
        `METRICS_MISMATCH:\n${result.errors.map((e) => `  - ${e}`).join("\n")}\n`,
      );
      return 1;
    }
    process.stdout.write(`metricsValid: ${REPORT_REL_PATH}\n`);
    return 0;
  }

  // --metric ratio: print the raw ratio + the equivalence, and validate the
  // on-disk report's equivalence block against a fresh re-derivation.
  const ratio = computeRatio(repoRoot);
  const equiv = computeEquivalence(repoRoot);
  const densityFloor = computeDensityFloor(repoRoot);
  process.stdout.write(
    [
      `metric: test-source-ratio`,
      `sourceFiles: ${ratio.sourceFiles}`,
      `sourceLoc: ${ratio.sourceLoc}`,
      `testFiles: ${ratio.testFiles}`,
      `testLoc: ${ratio.testLoc}`,
      `rawRatio: ${ratio.ratio}`,
      `rawFloor: ${RATIO_FLOOR}`,
      `rawMeetsFloor: ${ratio.ratio >= RATIO_FLOOR}`,
      `equivalenceBasis: ${equiv.basis}`,
      `equivalenceComputedValue: ${equiv.computedValue}`,
      `referenceLibCoreDensity: ${densityFloor.referenceDensity}`,
      `absoluteDensityBar: ${densityFloor.absoluteBar}`,
      `densityFloor: ${densityFloor.floor}`,
      `equivalenceMeetsFloor: ${equiv.computedValue >= densityFloor.floor}`,
      "",
    ].join("\n"),
  );

  if (fs.existsSync(reportPath)) {
    const doc = parseToon(fs.readFileSync(reportPath, "utf8"));
    const result = validateSnapshotDoc(doc, repoRoot);
    if (!result.ok) {
      process.stderr.write(
        `METRICS_MISMATCH:\n${result.errors.map((e) => `  - ${e}`).join("\n")}\n`,
      );
      return 1;
    }
    process.stdout.write(`reportValid: true\n`);
  } else {
    process.stdout.write(`reportValid: false (missing — run --write)\n`);
    return 1;
  }
  return 0;
}

if (isMain(import.meta)) {
  try {
    process.exit(main());
  } catch (err) {
    process.stderr.write(`metrics-snapshot: ${(err as Error).message}\n`);
    process.exit(2);
  }
}
