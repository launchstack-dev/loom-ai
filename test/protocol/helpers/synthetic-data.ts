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
  PhaseNode,
  AgentProgress,
  AgentPhase,
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

// ---------------------------------------------------------------------------
// Plan structures (for plan-validation tests)
// ---------------------------------------------------------------------------

export function createValidPlanStructure(): PhaseNode[] {
  // Mirrors taskboard structure: Phase 0 (contracts), Phase 1 parallel tracks, Phase 2 wiring
  return [
    {
      id: 0,
      name: 'Shared Contracts',
      wave: 0,
      agent: 'contracts-agent',
      objective: 'Create shared type definitions, database schema, and API contract types.',
      dependencies: [],
      fileOwnership: ['src/contracts/'],
      deliverables: [
        { file: 'src/contracts/types.ts', action: 'Create', owner: 'contracts-agent' },
        { file: 'src/contracts/schema.sql', action: 'Create', owner: 'contracts-agent' },
        { file: 'src/contracts/api-types.ts', action: 'Create', owner: 'contracts-agent' },
      ],
      acceptanceCriteria: [
        'All types compile with `npx tsc --noEmit`',
        'Types match the schema tables defined in this plan',
        'Input types use optional fields for update operations',
      ],
    },
    {
      id: 1,
      name: 'Data Layer',
      wave: 1,
      agent: 'implementer-agent',
      objective: 'Implement SQLite database setup and repository functions.',
      dependencies: [0],
      fileOwnership: ['src/db/', 'src/repositories/'],
      deliverables: [
        { file: 'src/db/connection.ts', action: 'Create', owner: 'implementer-agent' },
        { file: 'src/db/migrate.ts', action: 'Create', owner: 'implementer-agent' },
        { file: 'src/repositories/user.repository.ts', action: 'Create', owner: 'implementer-agent' },
        { file: 'src/repositories/board.repository.ts', action: 'Create', owner: 'implementer-agent' },
        { file: 'src/repositories/task.repository.ts', action: 'Create', owner: 'implementer-agent' },
      ],
      acceptanceCriteria: [
        'All repository functions use parameterized queries',
        'UUID generation uses crypto.randomUUID()',
        'All tests pass via `npx vitest run`',
      ],
    },
    {
      id: 2,
      name: 'API Routes',
      wave: 1,
      agent: 'implementer-agent',
      objective: 'Implement Express route handlers for all entities.',
      dependencies: [0],
      fileOwnership: ['src/routes/', 'src/middleware/'],
      deliverables: [
        { file: 'src/middleware/error-handler.ts', action: 'Create', owner: 'implementer-agent' },
        { file: 'src/middleware/validate.ts', action: 'Create', owner: 'implementer-agent' },
        { file: 'src/routes/user.routes.ts', action: 'Create', owner: 'implementer-agent' },
        { file: 'src/routes/board.routes.ts', action: 'Create', owner: 'implementer-agent' },
        { file: 'src/routes/task.routes.ts', action: 'Create', owner: 'implementer-agent' },
      ],
      acceptanceCriteria: [
        'Routes access repositories through req.app.locals.repositories',
        'All routes use try/catch and pass errors to next()',
        'All tests pass via `npx vitest run`',
      ],
    },
    {
      id: 3,
      name: 'Integration and Wiring',
      wave: 2,
      agent: 'wiring-agent',
      objective: 'Wire together routes and repositories, create app entry point.',
      dependencies: [1, 2],
      fileOwnership: ['src/app.ts', 'src/index.ts'],
      deliverables: [
        { file: 'src/app.ts', action: 'Create', owner: 'wiring-agent' },
        { file: 'src/index.ts', action: 'Create', owner: 'wiring-agent' },
      ],
      acceptanceCriteria: [
        'createApp() with no arguments uses in-memory SQLite',
        'All route prefixes match the API route table',
        'Application starts without errors: `npx tsx src/index.ts`',
      ],
    },
  ];
}

export function createBrokenPlanStructure(): PhaseNode[] {
  // Mirrors broken-plan: no Phase 0, circular deps, oversized phase, shared ownership
  return [
    {
      id: 1,
      name: 'Base Infrastructure',
      wave: 1,
      agent: 'implementer-agent',
      objective: 'Set up base models and routes.',
      dependencies: [],
      fileOwnership: ['src/models/', 'src/routes/'],
      deliverables: [
        { file: 'src/models/post.ts', action: 'Create', owner: 'implementer-agent' },
        { file: 'src/models/comment.ts', action: 'Create', owner: 'implementer-agent' },
        { file: 'src/routes/posts.ts', action: 'Create', owner: 'implementer-agent' },
      ],
      acceptanceCriteria: [], // Missing acceptance criteria
    },
    {
      id: 2,
      name: 'Feed Aggregation',
      wave: 2,
      agent: 'implementer-agent',
      objective: 'Build feed aggregation service.',
      dependencies: [3], // Circular: depends on Phase 3
      fileOwnership: ['src/services/', 'src/utils/helpers.ts'], // Shared ownership on helpers.ts
      deliverables: [
        { file: 'src/services/feed.ts', action: 'Create', owner: 'implementer-agent' },
        { file: 'src/services/ranking.ts', action: 'Create', owner: 'implementer-agent' },
        { file: 'src/utils/helpers.ts', action: 'Create', owner: 'implementer-agent' },
      ],
      acceptanceCriteria: ['Feed service returns sorted posts'],
    },
    {
      id: 3,
      name: 'Notifications and Realtime',
      wave: 3,
      agent: 'implementer-agent',
      objective: 'Build notifications and websocket features.',
      dependencies: [2], // Circular: depends on Phase 2
      fileOwnership: ['src/notifications/', 'src/utils/helpers.ts', 'src/websocket/'],
      deliverables: Array.from({ length: 16 }, (_, i) => ({
        file: `src/websocket/file${i}.ts`,
        action: 'Create',
        owner: 'implementer-agent',
      })), // Oversized: 16 deliverables
      acceptanceCriteria: [
        'All feeds load in under 200ms', // Unmeasurable perf criterion
        'Notifications are delivered within 5 seconds',
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Agent progress (for monitoring tests)
// ---------------------------------------------------------------------------

export function createValidAgentProgress(
  overrides?: Partial<AgentProgress>,
): AgentProgress {
  const now = new Date().toISOString();
  return {
    taskId: 'task-1a',
    agent: 'implementer-agent',
    wave: 1,
    phase: 'implementing',
    percentComplete: 45,
    currentActivity: 'Writing user repository functions',
    filesWritten: ['src/repositories/user.repository.ts'],
    issuesSoFar: 0,
    heartbeatAt: now,
    startedAt: now,
    checkpointCount: 5,
    ...overrides,
  };
}

/**
 * Simulate a sequence of progress updates from an agent over time.
 * Returns an array of AgentProgress snapshots at different phases.
 */
export function createProgressTimeline(
  taskId: string,
  agent: string,
  wave: number,
  files: string[],
  opts?: {
    startTime?: Date;
    intervalMs?: number;
    stallAtCheckpoint?: number;
    skipPhases?: AgentPhase[];
  },
): AgentProgress[] {
  const startTime = opts?.startTime ?? new Date();
  const interval = opts?.intervalMs ?? 30_000;
  const stallAt = opts?.stallAtCheckpoint ?? Infinity;
  const skip = new Set(opts?.skipPhases ?? []);
  const timeline: AgentProgress[] = [];
  let checkpoint = 0;
  let elapsed = 0;

  function ts(): string {
    return new Date(startTime.getTime() + elapsed).toISOString();
  }

  function push(phase: AgentPhase, pct: number, activity: string, written: string[]) {
    if (skip.has(phase)) return;
    if (checkpoint >= stallAt) return;
    checkpoint++;
    timeline.push({
      taskId,
      agent,
      wave,
      phase,
      percentComplete: pct,
      currentActivity: activity,
      filesWritten: written,
      issuesSoFar: 0,
      heartbeatAt: ts(),
      startedAt: startTime.toISOString(),
      checkpointCount: checkpoint,
    });
    elapsed += interval;
  }

  push('initializing', 0, 'Starting up', []);
  push('reading-contracts', 10, 'Reading contract files', []);

  const fileCount = files.length;
  for (let i = 0; i < fileCount; i++) {
    const pct = 15 + Math.round((70 * (i + 1)) / fileCount);
    const written = files.slice(0, i + 1);
    push('implementing', pct, `Writing ${files[i].split('/').pop()}`, written);
  }

  push('writing-files', 90, 'Finishing file writes', files);
  push('finalizing', 100, 'Preparing AgentResult', files);

  return timeline;
}

/**
 * Build scenario: a realistic Wave 1 with 4 parallel implementer agents.
 * Returns the progress timelines for each, with varied behaviors:
 *   - w1-data-layer: perfect behavior (regular heartbeats, smooth progress)
 *   - w1-api-routes: good but slower
 *   - w1-auth: stalls at checkpoint 4 (simulates hang)
 *   - w1-websocket: silent (never writes progress)
 */
export function createWave1Scenario(): {
  tasks: { taskId: string; agent: string; files: string[] }[];
  timelines: Record<string, AgentProgress[]>;
  agentResults: Record<string, AgentResult>;
} {
  const baseTime = new Date('2025-06-15T10:00:00Z');

  const tasks = [
    {
      taskId: 'w1-data-layer',
      agent: 'implementer-agent',
      files: [
        'src/db/connection.ts',
        'src/db/migrate.ts',
        'src/repositories/user.repository.ts',
        'src/repositories/board.repository.ts',
        'src/repositories/task.repository.ts',
      ],
    },
    {
      taskId: 'w1-api-routes',
      agent: 'implementer-agent',
      files: [
        'src/middleware/error-handler.ts',
        'src/middleware/validate.ts',
        'src/routes/user.routes.ts',
        'src/routes/board.routes.ts',
        'src/routes/task.routes.ts',
      ],
    },
    {
      taskId: 'w1-auth',
      agent: 'implementer-agent',
      files: ['src/auth/middleware.ts', 'src/auth/jwt.ts', 'src/auth/types.ts'],
    },
    {
      taskId: 'w1-websocket',
      agent: 'implementer-agent',
      files: ['src/websocket/server.ts', 'src/websocket/handlers.ts'],
    },
  ];

  const timelines: Record<string, AgentProgress[]> = {};

  timelines['w1-data-layer'] = createProgressTimeline(
    'w1-data-layer', 'implementer-agent', 1, tasks[0].files,
    { startTime: baseTime, intervalMs: 25_000 },
  );

  timelines['w1-api-routes'] = createProgressTimeline(
    'w1-api-routes', 'implementer-agent', 1, tasks[1].files,
    { startTime: baseTime, intervalMs: 40_000 },
  );

  timelines['w1-auth'] = createProgressTimeline(
    'w1-auth', 'implementer-agent', 1, tasks[2].files,
    { startTime: baseTime, intervalMs: 30_000, stallAtCheckpoint: 4 },
  );

  timelines['w1-websocket'] = [];

  const agentResults: Record<string, AgentResult> = {};
  for (const task of tasks) {
    agentResults[task.taskId] = createValidAgentResult({
      agent: task.agent,
      wave: 1,
      taskId: task.taskId,
      status: task.taskId === 'w1-auth' ? 'failure' : 'success',
      filesCreated: task.files,
      durationMs: task.taskId === 'w1-data-layer' ? 180_000
        : task.taskId === 'w1-api-routes' ? 320_000
        : task.taskId === 'w1-auth' ? 0
        : 150_000,
    });
  }

  return { tasks, timelines, agentResults };
}
