/**
 * Shared test-data generators for meta-orchestration protocol tests.
 *
 * Every generator returns a structurally valid object by default.
 * Pass `overrides` to tweak individual fields for negative-path tests.
 */

import type {
  AgentResult,
  AgentResultExport,
  AgentResultIssue,
  ExecutionState,
  Wave,
  WaveTask,
  WaveSummary,
  ContractManifest,
  ContractEntry,
  CrossBoundaryRequest,
  CrossBoundaryRequestItem,
} from './types.js';

// ---------------------------------------------------------------------------
// AgentResult
// ---------------------------------------------------------------------------

export function createValidAgentResult(
  overrides?: Partial<AgentResult>,
): AgentResult {
  return {
    agent: 'agent-auth',
    wave: 0,
    taskId: 'task-jwt-middleware',
    status: 'success',
    filesCreated: [
      'src/auth/middleware.ts',
      'src/auth/token.ts',
      'src/auth/types.ts',
    ],
    filesModified: ['src/server.ts', 'src/routes/index.ts'],
    filesDeleted: [],
    exportsAdded: [
      {
        name: 'authMiddleware',
        file: 'src/auth/middleware.ts',
        kind: 'function',
      },
      { name: 'TokenPayload', file: 'src/auth/types.ts', kind: 'interface' },
    ],
    dependenciesAdded: ['jsonwebtoken@9.0.0'],
    integrationNotes:
      'The authMiddleware export must be registered before any protected route. ' +
      'It reads JWT_SECRET from process.env. Token refresh uses a sliding window of 5 min.',
    issues: [
      {
        severity: 'warning',
        description: 'Token refresh window is hardcoded to 5 minutes',
        file: 'src/auth/middleware.ts',
        line: 42,
      },
    ],
    contractAmendments: [],
    crossBoundaryRequests: [],
    durationMs: 34500,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ExecutionState (state.json)
// ---------------------------------------------------------------------------

function createWave(
  waveIndex: number,
  status: Wave['status'],
  agents: string[],
): Wave {
  const now = Date.now();
  const startedAt =
    status !== 'pending'
      ? new Date(now - (10 - waveIndex) * 60_000).toISOString()
      : null;
  const completedAt =
    status === 'succeeded' || status === 'failed'
      ? new Date(now - (9 - waveIndex) * 60_000).toISOString()
      : null;

  const tasks: WaveTask[] = agents.map((agent, i) => ({
    taskId: `task-${waveIndex}-${i}`,
    agent,
    description: `Task for ${agent} in wave ${waveIndex}`,
    status:
      status === 'succeeded'
        ? 'succeeded'
        : status === 'failed'
          ? 'failed'
          : status === 'in_progress'
            ? 'in_progress'
            : 'pending',
    fileOwnership: [`src/${agent.replace('agent-', '')}/index.ts`],
    retryCount: 0,
    result: null,
    startedAt,
    completedAt,
  }));

  return {
    status,
    startedAt,
    completedAt,
    agents,
    tasks,
    summaryFile:
      status === 'succeeded'
        ? `.plan-execution/wave-${waveIndex}-summary.json`
        : null,
    verificationResult: {
      status: status === 'succeeded' ? 'pass' : null,
      checks: [],
    },
    gateApproval: status === 'succeeded' ? 'approved' : null,
    fileHashes: {},
  };
}

export function createValidState(
  waveCount: number = 2,
  overrides?: Partial<ExecutionState>,
): ExecutionState {
  const agentPool = [
    ['agent-auth', 'agent-db'],
    ['agent-api', 'agent-ui'],
    ['agent-integration', 'agent-deploy'],
    ['agent-monitoring'],
    ['agent-docs'],
  ];

  const waves: Record<string, Wave> = {};
  for (let i = 0; i < waveCount; i++) {
    const agents = agentPool[i % agentPool.length];
    const status: Wave['status'] =
      i < waveCount - 1 ? 'succeeded' : 'in_progress';
    waves[String(i)] = createWave(i, status, agents);
  }

  return {
    schemaVersion: 1,
    runId: '550e8400-e29b-41d4-a716-446655440000',
    planFile: '.plan-execution/plan.md',
    status: 'running',
    currentWave: waveCount - 1,
    startedAt: new Date(Date.now() - waveCount * 60_000).toISOString(),
    updatedAt: new Date().toISOString(),
    waves,
    rollingContextFile: '.plan-execution/rolling-context.md',
    lockPid: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// WaveSummary
// ---------------------------------------------------------------------------

export function createValidWaveSummary(
  wave: number,
  agentResults: AgentResult[],
): WaveSummary {
  const filesChanged = Array.from(
    new Set([
      ...agentResults.flatMap((r) => r.filesCreated),
      ...agentResults.flatMap((r) => r.filesModified),
      ...agentResults.flatMap((r) => r.filesDeleted),
    ]),
  );

  const exportsAdded: AgentResultExport[] = agentResults.flatMap(
    (r) => r.exportsAdded,
  );

  const unresolvedIssues = agentResults.flatMap((r) =>
    r.issues
      .filter((issue) => issue.severity === 'blocking' || issue.severity === 'warning')
      .map((issue) => ({
        severity: issue.severity,
        description: issue.description,
        file: issue.file,
        agent: r.agent,
        taskId: r.taskId,
      })),
  );

  return {
    wave,
    agentResults,
    filesChanged,
    exportsAdded,
    unresolvedIssues,
  };
}

// ---------------------------------------------------------------------------
// ContractManifest
// ---------------------------------------------------------------------------

export function createValidManifest(
  contracts?: ContractEntry[],
): ContractManifest {
  return {
    contracts: contracts ?? [
      {
        file: 'contracts/auth-token.ts',
        purpose: 'Defines the AuthToken interface and validation utilities',
        exports: ['AuthToken', 'validateToken'],
      },
      {
        file: 'contracts/user-profile.ts',
        purpose: 'Defines the UserProfile interface shared between DB and API',
        exports: ['UserProfile', 'UserRole'],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// CrossBoundaryRequest
// ---------------------------------------------------------------------------

export function createValidRequest(
  taskId?: string,
  requests?: CrossBoundaryRequestItem[],
): CrossBoundaryRequest {
  return {
    taskId: taskId ?? 'task-jwt-middleware',
    agent: 'agent-auth',
    requests: requests ?? [
      {
        file: 'src/db/queries.ts',
        reason:
          'Need a getUserById query that returns the full user record including role field',
        suggestedChange:
          'Add getUserById function that returns User with role field',
      },
      {
        file: 'src/routes/auth.ts',
        reason:
          'Please expose /api/auth/refresh endpoint using the tokenRefresh function',
        suggestedChange:
          'Add POST /api/auth/refresh route handler calling tokenRefresh',
      },
    ],
  };
}
