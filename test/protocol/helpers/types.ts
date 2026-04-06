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
// ExecutionState — state.json from state.schema.json
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
// WaveSummary — wave-N-summary.json
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
// ContractManifest — contracts/manifest.json
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
// CrossBoundaryRequest — requests/{taskId}.json
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
// Ownership conflict detection
// ---------------------------------------------------------------------------

export interface Conflict {
  file: string;
  agents: string[];
  type: 'modified' | 'created' | 'directory';
}
