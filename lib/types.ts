/**
 * Shared type contracts for the "Exceed gstack" initiative (PLAN-exceed-gstack, Phase 0).
 *
 * This file is the Wave-0 source of truth. It compiles standalone —
 * `bunx tsc --noEmit lib/types.ts` MUST exit 0 with no other lib/ files present.
 * It therefore has ZERO imports and declares only types (no runtime code).
 *
 * Contents:
 *   1. Shared-core library types      — ToonValue, CsvSplitOptions, AtomicWriteOptions
 *   2. Record types for all 12 schema entities in the plan's Schema section
 *
 * Downstream waves treat this file as read-only. Signature changes require
 * migrating every caller in the same phase (RESTRICT cascade, C-02).
 */

/* ────────────────────────────────────────────────────────────────────────
 * 1. Shared-core library types (lib/toon.ts, lib/csv.ts, lib/atomic-fs.ts)
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The value space produced by `parseToon` and accepted by `serializeToon`.
 * Recursive union covering every TOON node kind per the CLAUDE.md quick
 * reference: flat scalars, inline arrays, typed-array tables (arrays of
 * objects), and nested blocks (objects).
 */
export type ToonScalar = string | number | boolean | null;

export type ToonValue =
  | ToonScalar
  | ToonValue[]
  | { [key: string]: ToonValue };

/** Options for `splitCsvLine(line, opts?)` in lib/csv.ts. */
export interface CsvSplitOptions {
  /** Field delimiter. @default "," */
  delimiter?: string;
  /** Quote character used to wrap fields containing the delimiter. @default '"' */
  quote?: string;
  /**
   * When true, surrounding quotes are kept on the returned fields
   * (the `scripts/loom-change/archive.ts:1119` reference behavior).
   * When false, quotes are stripped and escaped `""` collapses to `"`.
   * @default false
   */
  preserveQuotes?: boolean;
  /** Trim leading/trailing whitespace from each unquoted field. @default false */
  trim?: boolean;
}

/** Options for `atomicWrite(path, data, opts?)` in lib/atomic-fs.ts. */
export interface AtomicWriteOptions {
  /** Text encoding when `data` is a string. @default "utf8" */
  encoding?: BufferEncoding;
  /** File mode applied to the final path. */
  mode?: number;
  /** Suffix for the temp file written before rename. @default ".tmp" */
  tmpSuffix?: string;
  /** fsync the temp file before rename for durability. @default false */
  fsync?: boolean;
}

/**
 * BufferEncoding is normally provided by @types/node. It is re-declared
 * narrowly here so this file typechecks standalone without a node lib.
 */
export type BufferEncoding =
  | "ascii"
  | "utf8"
  | "utf-8"
  | "utf16le"
  | "ucs2"
  | "ucs-2"
  | "base64"
  | "base64url"
  | "latin1"
  | "binary"
  | "hex";

/* ────────────────────────────────────────────────────────────────────────
 * 2. Schema entity record types (12 entities from the plan Schema section)
 * ──────────────────────────────────────────────────────────────────────── */

/** Repo-wide exit-code convention (API Specification header). */
export type ExitCode = 0 | 1 | 2 | 3;

/* ── 1/12 CiGateConfig ──────────────────────────────────────────────────── */

export type CiGateTier = "pr" | "nightly";

/** One required-check row inside a CiGateConfig. `name` is the branch-protection interface. */
export interface CiGateCheck {
  /** Stable check name; unique within tier (uq_check_name). */
  name: string;
  command: string;
  blocking: boolean;
  /** Empty/undefined, or a valid phase number after which the check flips to blocking. */
  warnUntilPhase?: number | null;
}

export interface CiGateConfig {
  tier: CiGateTier;
  /** Filename under .github/workflows/. */
  workflow: string;
  blocking: boolean;
  /** Cron expression; required iff tier === "nightly", else null. */
  schedule?: string | null;
  /** ≥1 row; check names unique within tier. */
  checks: CiGateCheck[];
}

/* ── 2/12 SharedCoreModule ──────────────────────────────────────────────── */

export type SharedCoreModuleName = "toon" | "csv" | "atomic-fs" | "entry-guard";

export interface SharedCoreModule {
  /** kebab-case, unique (pk_module). */
  name: SharedCoreModuleName;
  /** Path under lib/. */
  file: string;
  /** ≥1 exported symbol; every export is typed in this file (uq_export). */
  exports: string[];
  /** Description backing the no-restricted-imports lint rule. */
  bannedReimplementations: string;
  /** File paths of callers migrated during Phase 11a/11b strangler migration. */
  migratedCallers?: string[];
}

/* ── 3/12 HookRegistrationManifest ──────────────────────────────────────── */

export type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "SubagentStop"
  | "Stop"
  | "UserPromptSubmit"
  | "SessionStart"
  | "Notification"
  | "PreCompact";

export type HookDrift =
  | "none"
  | "missing-source"
  | "event-mismatch"
  | "dead-file";

export interface HookRegistration {
  /** Unique (pk_hook); matches hooks/{hookName}.ts. */
  hookName: string;
  event: HookEvent;
  /** Tool-name matcher, or null. */
  matcher?: string | null;
  /** Which of the 3 sources declare it (settings|hooks.json|manifest). */
  sources: string;
  /** Live in .claude/settings.json. */
  registered: boolean;
  /** Any non-"none" fails the CI drift check (blocking after Phase 13). */
  drift: HookDrift;
}

export interface HookRegistrationManifest {
  hookRegistrations: HookRegistration[];
}

/* ── 4/12 AgentResultFinding ────────────────────────────────────────────── */

export type FindingSeverity = "blocking" | "warning" | "info";

export interface AgentResultFinding {
  /** `F-\d{2,}`, unique within envelope. Required — validator exits 2 when missing. */
  id: string;
  severity: FindingSeverity;
  /** Non-empty. */
  category: string;
  /**
   * 0.0–1.0. Required for pipeline-participant agents (C-07/C-08).
   * NOTE: the AgentResult envelope's own findings[] table uses an integer 1..10
   * confidence (see agent-result.schema.md); this record models the 0.0–1.0
   * form the plan's AgentResultFinding schema specifies.
   */
  confidence: number;
  /** ≤200 chars. */
  summary?: string;
}

/* ── 5/12 MetricsSnapshot ───────────────────────────────────────────────── */

/** The 7 pre-registered scorecard/success metric names. Unknown names are blocking. */
export type MetricName =
  | "typecheck-errors"
  | "test-source-ratio"
  | "tautological-tests"
  | "defects-closed"
  | "ci-gates-green"
  | "meta-tests-firing"
  | "scorecard-overall";

export type MetricValue = number | boolean;

export interface MetricRow {
  metric: MetricName;
  /** Number or boolean; never hand-edited (derivation command is the source). */
  value: MetricValue;
  target: MetricValue;
  /** Re-runnable derivation command — no telemetry (C-12). */
  derivedBy: string;
  /** Computed (value meets target), not authored. */
  pass: boolean;
}

/**
 * C-21 / IC-001 equivalence block: the machine-validated alternative to a
 * raw test-source-ratio ≥ 1.4. No free-prose escape — this shape is checked
 * by scripts/metrics-snapshot.ts.
 */
export interface MetricEquivalenceBlock {
  /** What the equivalence is computed over (e.g., "behavioral-assertion-count"). */
  basis: string;
  /** The machine-derived value the basis yields. */
  computedValue: number;
  /** Why this basis is an accepted equivalent to the raw LOC ratio. */
  rationale: string;
}

export interface MetricsSnapshot {
  /** ISO 8601. */
  capturedAt: string;
  /** 40-char sha; must be an ancestor of main. */
  gitRef: string;
  /** One value per metric (pk_metric = gitRef, metric). */
  metrics: MetricRow[];
  /** Optional C-21 equivalence block for the test-source-ratio metric. */
  equivalence?: MetricEquivalenceBlock;
}

/* ── 6/12 TautologicalTestAudit ─────────────────────────────────────────── */

export type TestClassification = "behavioral" | "tautological" | "prompt-grep";
export type TestAuditAction = "retained" | "deleted" | "backfilled";

export interface TestAuditRow {
  /** Unique, repo-relative (pk_test). */
  testPath: string;
  classification: TestClassification;
  /** Non-empty for non-behavioral classifications. */
  evidence: string;
  /** behavioral ⇒ retained. */
  action: TestAuditAction;
  /** Path to backfill test; required when action === "backfilled". */
  replacedBy?: string | null;
}

export interface TautologicalTestAudit {
  auditedAt: string;
  suspectCount: number;
  rows: TestAuditRow[];
}

/* ── 7/12 ReleaseVersion ────────────────────────────────────────────────── */

export type ReleaseStatus =
  | "draft"
  | "gated"
  | "rejected"
  | "tagged"
  | "released"
  | "yanked";

export interface ReleaseMetricRef {
  metric: MetricName;
  value: MetricValue;
}

export interface ReleaseVersion {
  /** `\d+\.\d+\.\d+` (pk_release). */
  semver: string;
  /** `refs/tags/v{semver}`; v* namespace is semver-only after Phase 10 (uq_tag). */
  tagRef: string;
  /** `M-\d{2}` (idx_milestone). */
  milestone: string;
  /** `{prevTag}..{tag}`, non-empty. */
  commitRange: string;
  status: ReleaseStatus;
  /** Pre-registered names only; filled from MetricsSnapshot, never prose. */
  metrics: ReleaseMetricRef[];
}

/* ── 8/12 InstallManifest ───────────────────────────────────────────────── */

export interface InstallArtifact {
  artifact: string;
  /** sha256 hex, 64 chars. */
  checksum: string;
  /** Absolute path; rollback trap removes every recorded path on failure. */
  installedPath: string;
}

export interface InstallManifest {
  /** `v` + semver. */
  release: string;
  installedAt: string;
  /** True only when every artifact checksum matched checksums.sha256 (fail-closed). */
  verified: boolean;
  /** ≥1 row (pk_install = release, artifact). */
  artifacts: InstallArtifact[];
}

/* ── 9/12 DocsGenerationManifest ────────────────────────────────────────── */

export type DocsDrift = "none" | "stale";

export interface DocsSection {
  /** Unique (pk_section); matches `<!-- loom:generated:{section} -->` markers. */
  section: string;
  /** Repo-relative (idx_target). */
  targetFile: string;
  /** Derivation source description. */
  source: string;
  /** sha256 of the generated block. */
  checksum: string;
  /** "stale" fails CI (blocking after Phase 16). */
  drift: DocsDrift;
}

export interface DocsGenerationManifest {
  generatedAt: string;
  sections: DocsSection[];
}

/* ── 10/12 EvalTierResult ───────────────────────────────────────────────── */

export type EvalTier = "t1" | "t2" | "t3";
export type EvalStatus =
  | "pending"
  | "running"
  | "skipped"
  | "passed"
  | "failed"
  | "error";
export type EvalOutcome = "passed" | "failed" | "skipped" | "error";

export interface EvalResultRow {
  evalId: string;
  outcome: EvalOutcome;
  /** Static/hermetic score. */
  score: number;
  /** LLM-judge score, t3 only (0–10), else null. */
  judgedScore?: number | null;
}

export interface EvalTierResult {
  /** `{date}-{tier}-{shortsha}`, unique (pk_run). */
  runId: string;
  tier: EvalTier;
  gitRef: string;
  status: EvalStatus;
  /** ≥0; MUST be 0 for t1 and t2 (free-by-default invariant). */
  llmCalls: number;
  /** main-branch floor runId; required for t3 pre-release runs, else null. */
  floorRef?: string | null;
  results: EvalResultRow[];
}

/* ── 11/12 SkillUpgradeMatrix ───────────────────────────────────────────── */

export type SkillBatch = "review" | "workflow" | "ops";

export interface SkillUpgradeMatrix {
  /** Unique (pk_skill); matches shard filename. */
  skill: string;
  batch: SkillBatch;
  /** MUST equal `protocols/skill-preamble.md` (C-06). */
  preambleRef: string;
  /** Behavioral tests exist for backing scripts/hooks; required true (C-13). */
  testsPresent: boolean;
  /** Claimed enforcement is registered/live. */
  enforcementWired: boolean;
  /** Non-empty concrete capability beyond upstream — parity is not enough (C-13). */
  beyondUpstream: string;
}

/* ── 12/12 ScorecardResult ──────────────────────────────────────────────── */

export type ScorecardStatus =
  | "pending"
  | "evaluated"
  | "pass"
  | "below-target"
  | "loop-back";

/**
 * One of the 7 pinned baseline dimensions. Known dimensions include
 * code-quality, tests, extensibility, and ops; the full set is fixed by the
 * baseline rubric (planning/reports/scorecard-baseline.toon) and must not
 * drift (C-09), so this is modeled as a string keyed to that baseline.
 */
export type ScorecardDimensionName = string;

export interface ScorecardDimension {
  dimension: ScorecardDimensionName;
  /** 0–10. */
  loomScore: number;
  /** 0–10; copied from baseline, never re-scored. */
  gstackScore: number;
  /** loomScore − gstackScore; acceptance requires ≥ 0 for every dimension. */
  delta: number;
}

export interface ScorecardResult {
  runAt: string;
  /** Must reference the pinned baseline rubric path (C-09). */
  rubricRef: string;
  /** Same 4 reviewer agents as baseline. */
  agents: string[];
  status: ScorecardStatus;
  /** 0–10; acceptance requires overall > 8.3. */
  overall: number;
  /** gstack baseline overall (8.3). */
  gstackOverall: number;
  /** One score per dimension (pk_dim = runAt, dimension). */
  dimensions: ScorecardDimension[];
}
