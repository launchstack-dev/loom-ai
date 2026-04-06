/**
 * TypeScript types matching the meta-orchestration protocol schemas.
 * These types are the canonical in-code representation of the JSON Schemas
 * in test/protocol/schemas/.
 */

// ---------------------------------------------------------------------------
// AgentResult — the standard return envelope from agent-result.schema.json
// ---------------------------------------------------------------------------

export interface AgentResultExport {
  file: string;
  name: string;
  kind: 'function' | 'class' | 'const' | 'type' | 'interface' | 'enum';
}

export interface AgentResultIssue {
  severity: 'blocking' | 'warning' | 'info';
  description: string;
  file: string | null;
  line: number | null;
}

export interface AgentResultAmendment {
  file: string;
  issue: string;
}

export interface AgentResultCrossBoundaryRequest {
  file: string;
  reason: string;
  suggestedChange: string;
}

export interface AgentResult {
  agent: string;
  wave: number;
  taskId: string;
  status: 'success' | 'failure' | 'partial';
  filesCreated: string[];
  filesModified: string[];
  filesDeleted: string[];
  exportsAdded: AgentResultExport[];
  dependenciesAdded: string[];
  integrationNotes: string;
  issues: AgentResultIssue[];
  contractAmendments: AgentResultAmendment[];
  crossBoundaryRequests: AgentResultCrossBoundaryRequest[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// ExecutionState — state.toon from state.schema.json
// ---------------------------------------------------------------------------

export type RunStatus = 'initializing' | 'running' | 'paused' | 'completed' | 'failed';
export type WaveStatus = 'pending' | 'in_progress' | 'succeeded' | 'failed' | 'skipped';
export type TaskStatus = 'pending' | 'in_progress' | 'succeeded' | 'failed';

export interface WaveTask {
  taskId: string;
  agent: string;
  description: string;
  status: TaskStatus;
  fileOwnership: string[];
  retryCount: number;
  result: AgentResult | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface VerificationCheck {
  name: string;
  status: 'pass' | 'fail';
  details: string | null;
}

export interface WaveVerification {
  status: 'pass' | 'fail' | null;
  checks: VerificationCheck[];
}

export interface Wave {
  status: WaveStatus;
  startedAt: string | null;
  completedAt: string | null;
  agents: string[];
  tasks: WaveTask[];
  summaryFile: string | null;
  verificationResult: WaveVerification;
  gateApproval: 'approved' | 'rejected' | 'pending' | null;
  fileHashes: Record<string, Record<string, string>>;
}

export interface ExecutionState {
  schemaVersion: number;
  runId: string;
  planFile: string;
  status: RunStatus;
  currentWave: number;
  startedAt: string;
  updatedAt: string;
  waves: Record<string, Wave>;
  rollingContextFile: string;
  lockPid: number | null;
}

// ---------------------------------------------------------------------------
// WaveSummary — wave-N-summary.toon
// ---------------------------------------------------------------------------

export interface WaveSummaryIssue {
  severity: 'blocking' | 'warning' | 'info';
  description: string;
  file: string | null;
  agent: string;
  taskId: string;
}

export interface WaveSummary {
  wave: number;
  agentResults: AgentResult[];
  filesChanged: string[];
  exportsAdded: AgentResultExport[];
  unresolvedIssues: WaveSummaryIssue[];
}

// ---------------------------------------------------------------------------
// ContractManifest — contracts/manifest.toon
// ---------------------------------------------------------------------------

export interface ContractEntry {
  file: string;
  purpose: string;
  exports: string[];
}

export interface ContractManifest {
  contracts: ContractEntry[];
}

// ---------------------------------------------------------------------------
// CrossBoundaryRequest — requests/{taskId}.toon
// ---------------------------------------------------------------------------

export interface CrossBoundaryRequestItem {
  file: string;
  reason: string;
  suggestedChange: string;
}

export interface CrossBoundaryRequest {
  taskId: string;
  agent: string;
  requests: CrossBoundaryRequestItem[];
}

// ---------------------------------------------------------------------------
// Feedback / metrics types
// ---------------------------------------------------------------------------

export interface TestRunEntry {
  timestamp: string;
  git_sha: string;
  agent: string;
  model: string;
  duration_ms: number;
  status: string;
  token_input: number;
  token_output: number;
  cost_usd: number;
  files_created: number;
  files_modified: number;
  schema_valid: boolean;
  boundary_violations: number;
  typecheck_pass: boolean;
  rolling_context_tokens: number;
}

export interface DerivedMetrics {
  schema_compliance_rate: number;
  boundary_violation_rate: number;
  first_pass_verification_rate: number;
  cost_per_wave_usd: number;
  total_runs: number;
}

// ---------------------------------------------------------------------------
// Plan validation types
// ---------------------------------------------------------------------------

export interface PlanFrontmatter {
  planVersion: number;
  name: string;
  status: 'draft' | 'reviewed' | 'approved' | 'in-progress' | 'completed';
  created: string;
  lastReviewed: string | null;
  totalPhases: number;
  totalWaves: number;
}

export interface PlanDeliverable {
  file: string;
  action: string;
  owner: string;
}

export interface PhaseNode {
  id: number;
  name: string;
  wave: number;
  agent: string;
  objective: string;
  dependencies: number[];
  fileOwnership: string[];
  deliverables: PlanDeliverable[];
  acceptanceCriteria: string[];
}

export interface PlanStructure {
  frontmatter: PlanFrontmatter | null;
  title: string | null;
  hasOverview: boolean;
  hasTechStack: boolean;
  hasSchema: boolean;
  hasExecutionPhases: boolean;
  hasVerificationCommands: boolean;
  phases: PhaseNode[];
}

export interface DependencyGraph {
  nodes: PhaseNode[];
  adjacency: Record<number, number[]>; // phase → depends-on phases
  criticalPath: number[];
  criticalPathLength: number;
  hasCycles: boolean;
  cycleNodes: number[];
}

export interface ValidationFinding {
  stage: 'structure' | 'dependencies' | 'ownership' | 'sizing' | 'criteria';
  severity: 'error' | 'warning';
  message: string;
  phase?: number;
  file?: string;
}

export interface PlanValidationResult {
  valid: boolean;
  errors: ValidationFinding[];
  warnings: ValidationFinding[];
  graph: DependencyGraph;
  sizing: {
    phaseId: number;
    deliverableCount: number;
    criteriaCount: number;
    flag?: 'oversized' | 'undersized' | 'no-criteria';
  }[];
}

// ---------------------------------------------------------------------------
// Agent monitoring — .plan-execution/progress/{taskId}.toon
// ---------------------------------------------------------------------------

export type AgentPhase =
  | 'initializing'
  | 'reading-contracts'
  | 'implementing'
  | 'writing-files'
  | 'finalizing';

export interface AgentProgress {
  taskId: string;
  agent: string;
  wave: number;
  phase: AgentPhase;
  percentComplete: number;
  currentActivity: string;
  filesWritten: string[];
  issuesSoFar: number;
  heartbeatAt: string;
  startedAt: string;
  checkpointCount: number;
}

export type AgentMonitoringStatus =
  | 'reporting'
  | 'silent'
  | 'stale'
  | 'completed'
  | 'timed-out';

export interface AgentProgressSummary {
  taskId: string;
  agent: string;
  status: AgentMonitoringStatus;
  lastHeartbeat: string | null;
  secondsSinceHeartbeat: number;
  phase: AgentPhase | null;
  percentComplete: number;
  currentActivity: string | null;
  filesWrittenCount: number;
}

// ---------------------------------------------------------------------------
// Monitoring evaluation — graded rubric for E2E tests
// ---------------------------------------------------------------------------

export interface RubricDimension {
  name: string;
  maxScore: number;
  score: number;
  details: string;
}

export interface MonitoringEvaluation {
  scenario: string;
  dimensions: RubricDimension[];
  totalScore: number;
  maxScore: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  summary: string;
}

// ---------------------------------------------------------------------------
// Ownership conflict detection
// ---------------------------------------------------------------------------

export interface Conflict {
  file: string;
  agents: string[];
  type: 'modified' | 'created' | 'directory';
}

// ---------------------------------------------------------------------------
// Scope coverage — .plan-execution/scope-coverage.toon
// ---------------------------------------------------------------------------

export type ScopeCriterionStatus = 'pending' | 'covered' | 'orphaned' | 'dropped';

export interface ScopeCoverageCriterion {
  phaseId: number;
  criterion: string;
  coveringTasks: string[];
  status: ScopeCriterionStatus;
}

export interface ScopeCoverage {
  criteria: ScopeCoverageCriterion[];
}

// ---------------------------------------------------------------------------
// Library catalog — ~/.claude/skills/library/install-state.toon
// ---------------------------------------------------------------------------

export interface LibraryInstallItem {
  name: string;
  type: 'agent' | 'skill' | 'prompt';
  source: string;
  targetPath: string;
  installedAt: string;
  contentHash: string;
}

export interface LibraryInstallState {
  schemaVersion: number;
  lastSynced: string;
  items: LibraryInstallItem[];
}

export interface LibraryCatalogEntry {
  name: string;
  description: string;
  source: string;
  requires?: string[];
}

export interface LibraryCatalog {
  skills: LibraryCatalogEntry[];
  agents: LibraryCatalogEntry[];
  prompts: LibraryCatalogEntry[];
}
