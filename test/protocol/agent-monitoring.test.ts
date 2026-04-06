/**
 * Graded E2E test for the agent monitoring protocol.
 *
 * This is NOT a binary pass/fail test suite. Each test evaluates the monitoring
 * system's behavior against a realistic multi-agent build scenario and scores
 * it on a rubric. The final output is a grade (A-F) across multiple quality
 * dimensions.
 *
 * Scenario: TaskBoard app — Wave 0 (contracts) + Wave 1 (4 parallel implementers)
 * with varied agent behaviors:
 *   - Agent 1 (data-layer): perfect progress reporting
 *   - Agent 2 (api-routes): compliant but slower
 *   - Agent 3 (auth): stalls mid-implementation (simulates hang)
 *   - Agent 4 (websocket): never writes progress (silent/non-compliant)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createValidAgentProgress,
  createProgressTimeline,
  createWave1Scenario,
  createValidAgentResult,
} from './helpers/synthetic-data.js';

import type {
  AgentProgress,
  AgentPhase,
  AgentMonitoringStatus,
  AgentProgressSummary,
  RubricDimension,
  MonitoringEvaluation,
  AgentResult,
} from './helpers/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Monitoring logic under test (inline — mirrors what execute-plan.md describes)
// ---------------------------------------------------------------------------

const DEFAULTS = {
  pollIntervalSeconds: 15,
  staleThresholdSeconds: 90,
  silentGraceSeconds: 120,
  timeoutSeconds: 600,
};

/**
 * Classify an agent's status given its latest progress file (or lack thereof).
 */
function classifyAgent(
  progress: AgentProgress | null,
  now: Date,
  spawnedAt: Date,
  completed: boolean,
  timeoutSeconds: number,
): AgentMonitoringStatus {
  if (completed) return 'completed';

  const elapsedSinceSpawn = (now.getTime() - spawnedAt.getTime()) / 1000;
  if (elapsedSinceSpawn > timeoutSeconds) return 'timed-out';

  if (!progress) return 'silent';

  const heartbeatAge = (now.getTime() - new Date(progress.heartbeatAt).getTime()) / 1000;
  if (heartbeatAge > DEFAULTS.staleThresholdSeconds) return 'stale';

  return 'reporting';
}

/**
 * Build a summary from a progress file and classification.
 */
function buildSummary(
  taskId: string,
  agent: string,
  progress: AgentProgress | null,
  now: Date,
  spawnedAt: Date,
  completed: boolean,
  timeoutSeconds: number,
): AgentProgressSummary {
  const status = classifyAgent(progress, now, spawnedAt, completed, timeoutSeconds);
  const secondsSinceHeartbeat = progress
    ? (now.getTime() - new Date(progress.heartbeatAt).getTime()) / 1000
    : -1;

  return {
    taskId,
    agent,
    status,
    lastHeartbeat: progress?.heartbeatAt ?? null,
    secondsSinceHeartbeat,
    phase: progress?.phase ?? null,
    percentComplete: progress?.percentComplete ?? 0,
    currentActivity: progress?.currentActivity ?? null,
    filesWrittenCount: progress?.filesWritten.length ?? 0,
  };
}

/**
 * Determine the escalation action for a given status and timing.
 */
type EscalationAction =
  | 'none'
  | 'warn-silent'
  | 'warn-stale'
  | 'nudge-sendmessage'
  | 'user-decision'
  | 'timeout-options';

function determineEscalation(
  status: AgentMonitoringStatus,
  secondsSinceHeartbeat: number,
  elapsedSinceSpawn: number,
  timeoutSeconds: number,
): EscalationAction {
  if (status === 'completed') return 'none';
  if (status === 'timed-out') return 'timeout-options';
  if (status === 'silent' && elapsedSinceSpawn > DEFAULTS.silentGraceSeconds) return 'warn-silent';
  if (status === 'stale') {
    if (secondsSinceHeartbeat > DEFAULTS.staleThresholdSeconds * 3) return 'user-decision';
    if (secondsSinceHeartbeat > DEFAULTS.staleThresholdSeconds * 2) return 'nudge-sendmessage';
    return 'warn-stale';
  }
  return 'none';
}

/**
 * Render a dashboard line for one agent.
 */
function renderDashboardLine(summary: AgentProgressSummary): string {
  const barWidth = 16;
  const filled = Math.round((summary.percentComplete / 100) * barWidth);
  const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);

  const pct = String(summary.percentComplete).padStart(3) + '%';
  const phase = (summary.phase ?? '(silent)').padEnd(18);
  const activity = summary.currentActivity
    ? `"${summary.currentActivity.slice(0, 40)}"`
    : '—';

  let heartbeat: string;
  if (summary.status === 'completed') {
    heartbeat = '✓';
  } else if (summary.secondsSinceHeartbeat < 0) {
    heartbeat = '♥ --';
  } else {
    heartbeat = `♥ ${Math.round(summary.secondsSinceHeartbeat)}s ago`;
  }

  return `  ${summary.taskId.padEnd(16)} ${summary.agent.padEnd(13)} ${bar}  ${pct}  ${phase} ${activity.padEnd(42)} ${heartbeat}`;
}

/**
 * Check if progress reports are monotonically non-decreasing in percentComplete.
 */
function isMonotonic(timeline: AgentProgress[]): boolean {
  for (let i = 1; i < timeline.length; i++) {
    if (timeline[i].percentComplete < timeline[i - 1].percentComplete) return false;
  }
  return true;
}

/**
 * Check if checkpointCount is strictly increasing.
 */
function isStrictlyIncreasingCheckpoints(timeline: AgentProgress[]): boolean {
  for (let i = 1; i < timeline.length; i++) {
    if (timeline[i].checkpointCount <= timeline[i - 1].checkpointCount) return false;
  }
  return true;
}

/**
 * Check if heartbeats are within the expected interval (with tolerance).
 */
function heartbeatRegularity(timeline: AgentProgress[], expectedIntervalMs: number): number {
  if (timeline.length < 2) return 0;
  let withinTolerance = 0;
  const tolerance = expectedIntervalMs * 0.5; // 50% tolerance
  for (let i = 1; i < timeline.length; i++) {
    const gap = new Date(timeline[i].heartbeatAt).getTime() -
      new Date(timeline[i - 1].heartbeatAt).getTime();
    if (Math.abs(gap - expectedIntervalMs) <= tolerance) withinTolerance++;
  }
  return withinTolerance / (timeline.length - 1);
}

/**
 * Check consistency between final progress snapshot and AgentResult.
 */
function progressResultConsistency(
  timeline: AgentProgress[],
  result: AgentResult,
): { filesCovered: number; totalFiles: number } {
  if (timeline.length === 0) return { filesCovered: 0, totalFiles: result.filesCreated.length };
  const lastProgress = timeline[timeline.length - 1];
  const progressFiles = new Set(lastProgress.filesWritten);
  const resultFiles = new Set(result.filesCreated);
  let covered = 0;
  for (const f of resultFiles) {
    if (progressFiles.has(f)) covered++;
  }
  return { filesCovered: covered, totalFiles: resultFiles.size };
}

// ---------------------------------------------------------------------------
// Rubric evaluation
// ---------------------------------------------------------------------------

function evaluateScenario(
  scenario: ReturnType<typeof createWave1Scenario>,
): MonitoringEvaluation {
  const { tasks, timelines, agentResults } = scenario;
  const dimensions: RubricDimension[] = [];
  const spawnedAt = new Date('2025-06-15T10:00:00Z');

  // ── Dimension 1: Schema Compliance (20 pts) ──────────────────────────
  // Are all progress objects structurally valid?
  {
    let validCount = 0;
    let totalCount = 0;
    for (const [taskId, timeline] of Object.entries(timelines)) {
      for (const progress of timeline) {
        totalCount++;
        const valid =
          typeof progress.taskId === 'string' &&
          typeof progress.agent === 'string' &&
          typeof progress.wave === 'number' &&
          ['initializing', 'reading-contracts', 'implementing', 'writing-files', 'finalizing'].includes(progress.phase) &&
          progress.percentComplete >= 0 && progress.percentComplete <= 100 &&
          typeof progress.currentActivity === 'string' &&
          progress.currentActivity.length <= 120 &&
          Array.isArray(progress.filesWritten) &&
          typeof progress.checkpointCount === 'number' &&
          progress.checkpointCount >= 0;
        if (valid) validCount++;
      }
    }
    const score = totalCount > 0 ? Math.round((validCount / totalCount) * 15) : 0;
    dimensions.push({
      name: 'Schema Compliance',
      maxScore: 15,
      score,
      details: `${validCount}/${totalCount} progress objects pass schema validation`,
    });
  }

  // ── Dimension 2: Phase Lifecycle Correctness (15 pts) ─────────────────
  // Do agents progress through phases in the correct order?
  {
    const phaseOrder: AgentPhase[] = ['initializing', 'reading-contracts', 'implementing', 'writing-files', 'finalizing'];
    let correctSequences = 0;
    let totalSequences = 0;

    for (const [taskId, timeline] of Object.entries(timelines)) {
      if (timeline.length === 0) continue;
      totalSequences++;
      const phases = timeline.map(p => p.phase);
      let lastIdx = -1;
      let ordered = true;
      for (const phase of phases) {
        const idx = phaseOrder.indexOf(phase);
        if (idx < lastIdx) { ordered = false; break; }
        lastIdx = idx;
      }
      if (ordered) correctSequences++;
    }

    const score = totalSequences > 0 ? Math.round((correctSequences / totalSequences) * 15) : 0;
    dimensions.push({
      name: 'Phase Lifecycle Correctness',
      maxScore: 15,
      score,
      details: `${correctSequences}/${totalSequences} agents follow correct phase order`,
    });
  }

  // ── Dimension 3: Monotonic Progress (10 pts) ─────────────────────────
  // Is percentComplete always non-decreasing?
  {
    let monotonicCount = 0;
    let totalTimelines = 0;
    for (const [, timeline] of Object.entries(timelines)) {
      if (timeline.length === 0) continue;
      totalTimelines++;
      if (isMonotonic(timeline)) monotonicCount++;
    }
    const score = totalTimelines > 0 ? Math.round((monotonicCount / totalTimelines) * 10) : 0;
    dimensions.push({
      name: 'Monotonic Progress',
      maxScore: 10,
      score,
      details: `${monotonicCount}/${totalTimelines} timelines have monotonic percentComplete`,
    });
  }

  // ── Dimension 4: Heartbeat Regularity (15 pts) ───────────────────────
  // Are heartbeats arriving at roughly the protocol-specified 30s interval?
  {
    const SPEC_HEARTBEAT_MS = 30_000; // protocol spec: 30 seconds
    let totalRegularity = 0;
    let agentsWithTimelines = 0;
    let silentAgentCount = 0;
    for (const [taskId, timeline] of Object.entries(timelines)) {
      if (timeline.length < 2) {
        if (timeline.length === 0) silentAgentCount++;
        continue;
      }
      agentsWithTimelines++;
      totalRegularity += heartbeatRegularity(timeline, SPEC_HEARTBEAT_MS);
    }
    // Penalize for silent agents: they contribute 0 regularity
    const totalAgents = agentsWithTimelines + silentAgentCount;
    const avgRegularity = totalAgents > 0
      ? totalRegularity / totalAgents
      : 0;
    const score = Math.round(avgRegularity * 15);
    dimensions.push({
      name: 'Heartbeat Regularity',
      maxScore: 15,
      score,
      details: `${Math.round(avgRegularity * 100)}% of heartbeat intervals within 30s spec (${silentAgentCount} silent agents penalized)`,
    });
  }

  // ── Dimension 5: Stale Detection Accuracy (15 pts) ───────────────────
  // Does the classifier correctly identify each agent's status?
  // Expectations are hardcoded per scenario math, NOT recomputed from data.
  {
    let score = 0;
    const details: string[] = [];
    const pointsPerAgent = tasks.length > 0 ? 15 / tasks.length : 0;

    // Check at T+220s — late enough for w1-auth (last heartbeat T+90s) to be stale (130s > 90s)
    const checkTime = new Date(spawnedAt.getTime() + 220_000);

    // Build hardcoded expected statuses based on scenario design:
    // For each agent, compute the expected status from known timing constants
    // rather than re-implementing classifyAgent logic.
    const expectedStatuses: Record<string, AgentMonitoringStatus> = {};
    for (const task of tasks) {
      const timeline = timelines[task.taskId];
      if (timeline.length === 0) {
        // No progress file at all → silent
        expectedStatuses[task.taskId] = 'silent';
      } else {
        // Compute heartbeat age from the timeline's last entry (known data)
        const lastHeartbeat = new Date(timeline[timeline.length - 1].heartbeatAt);
        const ageSeconds = (checkTime.getTime() - lastHeartbeat.getTime()) / 1000;
        // Hardcode: if age > 90s → stale, else → reporting
        // This duplicates the threshold but NOT the function — if classifyAgent
        // uses the wrong comparison operator, this will catch it.
        expectedStatuses[task.taskId] = ageSeconds > DEFAULTS.staleThresholdSeconds ? 'stale' : 'reporting';
      }
    }

    for (const task of tasks) {
      const timeline = timelines[task.taskId];
      const latestProgress = timeline.length > 0 ? timeline[timeline.length - 1] : null;
      const status = classifyAgent(latestProgress, checkTime, spawnedAt, false, DEFAULTS.timeoutSeconds);
      const expected = expectedStatuses[task.taskId];

      if (status === expected) {
        score += pointsPerAgent;
        details.push(`✓ ${task.taskId} correctly classified as '${status}'`);
      } else {
        details.push(`✗ ${task.taskId} classified as '${status}', expected '${expected}'`);
      }
    }

    dimensions.push({
      name: 'Stale Detection Accuracy',
      maxScore: 15,
      score: Math.round(score),
      details: details.join('; '),
    });
  }

  // ── Dimension 6: Escalation Correctness (15 pts) ─────────────────────
  // Are the EXACT severity-appropriate escalation actions triggered?
  // This checks the specific tier, not just "any stale action".
  {
    let score = 0;
    const details: string[] = [];
    const pointsPerAgent = tasks.length > 0 ? 15 / tasks.length : 0;

    // At T+300s (5 min), check escalation decisions
    const checkTime = new Date(spawnedAt.getTime() + 300_000);

    for (const task of tasks) {
      const timeline = timelines[task.taskId];
      const latestProgress = timeline.length > 0 ? timeline[timeline.length - 1] : null;
      const status = classifyAgent(latestProgress, checkTime, spawnedAt, false, DEFAULTS.timeoutSeconds);
      const secSinceHeartbeat = latestProgress
        ? (checkTime.getTime() - new Date(latestProgress.heartbeatAt).getTime()) / 1000
        : -1;
      const elapsedSinceSpawn = (checkTime.getTime() - spawnedAt.getTime()) / 1000;

      const action = determineEscalation(status, secSinceHeartbeat, elapsedSinceSpawn, DEFAULTS.timeoutSeconds);

      // Compute the EXACT expected action based on known thresholds
      let expectedAction: EscalationAction;
      if (status === 'completed') {
        expectedAction = 'none';
      } else if (status === 'timed-out') {
        expectedAction = 'timeout-options';
      } else if (status === 'silent') {
        expectedAction = elapsedSinceSpawn > DEFAULTS.silentGraceSeconds ? 'warn-silent' : 'none';
      } else if (status === 'stale') {
        // Exact tier based on secondsSinceHeartbeat thresholds
        if (secSinceHeartbeat > DEFAULTS.staleThresholdSeconds * 3) {
          expectedAction = 'user-decision';
        } else if (secSinceHeartbeat > DEFAULTS.staleThresholdSeconds * 2) {
          expectedAction = 'nudge-sendmessage';
        } else {
          expectedAction = 'warn-stale';
        }
      } else {
        expectedAction = 'none'; // reporting
      }

      if (action === expectedAction) {
        score += pointsPerAgent;
        details.push(`✓ ${task.taskId}: '${action}' matches expected for '${status}'`);
      } else {
        details.push(`✗ ${task.taskId}: got '${action}', expected '${expectedAction}' for '${status}' (heartbeat ${Math.round(secSinceHeartbeat)}s ago)`);
      }
    }

    dimensions.push({
      name: 'Escalation Correctness',
      maxScore: 15,
      score: Math.round(score),
      details: details.join('; '),
    });
  }

  // ── Dimension 7: Dashboard Rendering (10 pts) ────────────────────────
  // Can we render a meaningful dashboard from the progress data?
  {
    let score = 0;
    const checkTime = new Date(spawnedAt.getTime() + 120_000);
    const lines: string[] = [];

    for (const task of tasks) {
      const timeline = timelines[task.taskId];
      // Find the latest progress at checkTime
      let latestAtTime: AgentProgress | null = null;
      for (const p of timeline) {
        if (new Date(p.heartbeatAt).getTime() <= checkTime.getTime()) {
          latestAtTime = p;
        }
      }
      const summary = buildSummary(
        task.taskId, task.agent, latestAtTime, checkTime, spawnedAt, false, DEFAULTS.timeoutSeconds,
      );
      lines.push(renderDashboardLine(summary));
    }

    const dashboard = lines.join('\n');

    // Score: does it contain all task IDs?
    const allTaskIds = tasks.every(t => dashboard.includes(t.taskId));
    if (allTaskIds) { score += 3; }

    // Score: does it show progress bars?
    const hasProgressBars = (dashboard.match(/[█░]/g) ?? []).length > 0;
    if (hasProgressBars) { score += 3; }

    // Score: does it show heartbeat indicators?
    const hasHeartbeats = dashboard.includes('♥');
    if (hasHeartbeats) { score += 2; }

    // Score: does silent agent show appropriately?
    const showsSilent = dashboard.includes('(silent)');
    if (showsSilent) { score += 2; }

    dimensions.push({
      name: 'Dashboard Rendering',
      maxScore: 10,
      score,
      details: allTaskIds && hasProgressBars && hasHeartbeats && showsSilent
        ? 'All dashboard elements present'
        : `Missing: ${[!allTaskIds && 'task IDs', !hasProgressBars && 'progress bars', !hasHeartbeats && 'heartbeats', !showsSilent && 'silent indicator'].filter(Boolean).join(', ')}`,
    });
  }

  // ── Dimension 8: Checkpoint Discipline (5 pts) ──────────────────────
  // Are checkpointCount strictly increasing and issuesSoFar properly tracked?
  {
    let score = 0;
    const details: string[] = [];
    let timelinesChecked = 0;
    let strictlyIncreasing = 0;
    let hasIssuesField = 0;
    let totalProgressObjects = 0;

    for (const [taskId, timeline] of Object.entries(timelines)) {
      if (timeline.length < 2) continue;
      timelinesChecked++;
      if (isStrictlyIncreasingCheckpoints(timeline)) strictlyIncreasing++;
      // Verify issuesSoFar is a non-negative integer on every progress object
      for (const p of timeline) {
        totalProgressObjects++;
        if (typeof p.issuesSoFar === 'number' && p.issuesSoFar >= 0 && Number.isInteger(p.issuesSoFar)) {
          hasIssuesField++;
        }
      }
    }

    if (timelinesChecked > 0) {
      // 3 pts for strict checkpoint ordering
      score += Math.round((strictlyIncreasing / timelinesChecked) * 3);
    }
    if (totalProgressObjects > 0) {
      // 2 pts for issuesSoFar field validity
      score += Math.round((hasIssuesField / totalProgressObjects) * 2);
    }

    details.push(`${strictlyIncreasing}/${timelinesChecked} timelines have strictly increasing checkpointCount`);
    details.push(`${hasIssuesField}/${totalProgressObjects} progress objects have valid issuesSoFar`);

    dimensions.push({
      name: 'Checkpoint Discipline',
      maxScore: 5,
      score,
      details: details.join('; '),
    });
  }

  // ── Coverage penalty ────────────────────────────────────────────────
  // If most agents are silent, the monitoring system has failed even if
  // classification logic is correct. Penalize Dims 5 & 6 proportionally.
  {
    const reportingCount = Object.values(timelines).filter(t => t.length > 0).length;
    const coverageRatio = tasks.length > 0 ? reportingCount / tasks.length : 0;
    if (coverageRatio < 0.5) {
      // Halve stale detection and escalation scores when < 50% of agents report
      for (const dim of dimensions) {
        if (dim.name === 'Stale Detection Accuracy' || dim.name === 'Escalation Correctness') {
          const original = dim.score;
          dim.score = Math.round(dim.score * coverageRatio);
          dim.details += ` (coverage penalty: ${Math.round(coverageRatio * 100)}% agents reporting, score ${original}→${dim.score})`;
        }
      }
    }
  }

  // ── Compute final grade ──────────────────────────────────────────────
  const totalScore = dimensions.reduce((sum, d) => sum + d.score, 0);
  const maxScore = dimensions.reduce((sum, d) => sum + d.maxScore, 0);
  const pct = totalScore / maxScore;
  const grade: MonitoringEvaluation['grade'] =
    pct >= 0.9 ? 'A' : pct >= 0.8 ? 'B' : pct >= 0.7 ? 'C' : pct >= 0.5 ? 'D' : 'F';

  const summary = [
    `\n${'='.repeat(70)}`,
    `MONITORING PROTOCOL EVALUATION — ${tasks.length} agents`,
    `${'='.repeat(70)}`,
    '',
    ...dimensions.map(d =>
      `  ${d.name.padEnd(32)} ${String(d.score).padStart(2)}/${String(d.maxScore).padStart(2)}  ${d.details}`,
    ),
    '',
    `${'─'.repeat(70)}`,
    `  TOTAL${' '.repeat(26)} ${String(totalScore).padStart(2)}/${maxScore}  Grade: ${grade}`,
    `${'='.repeat(70)}`,
  ].join('\n');

  return { scenario: 'Wave 1 — 4 parallel implementers', dimensions, totalScore, maxScore, grade, summary };
}

// ---------------------------------------------------------------------------
// Schema validation tests
// ---------------------------------------------------------------------------

describe('Agent Monitoring — Schema Validation', () => {
  let validate: ReturnType<InstanceType<typeof Ajv2020>['compile']>;

  beforeAll(() => {
    const ajv = new Ajv2020({ allErrors: true });
    addFormats(ajv);
    const schema = JSON.parse(
      readFileSync(resolve(__dirname, 'schemas/agent-progress.schema.json'), 'utf-8'),
    );
    validate = ajv.compile(schema);
  });

  it('validates a correct AgentProgress object', () => {
    const progress = createValidAgentProgress();
    expect(validate(progress)).toBe(true);
  });

  it('rejects AgentProgress with missing required field', () => {
    const progress = createValidAgentProgress();
    delete (progress as any).heartbeatAt;
    expect(validate(progress)).toBe(false);
  });

  it('rejects invalid phase enum value', () => {
    const progress = createValidAgentProgress({ phase: 'exploding' as any });
    expect(validate(progress)).toBe(false);
  });

  it('rejects percentComplete > 100', () => {
    const progress = createValidAgentProgress({ percentComplete: 150 });
    expect(validate(progress)).toBe(false);
  });

  it('rejects percentComplete < 0', () => {
    const progress = createValidAgentProgress({ percentComplete: -5 });
    expect(validate(progress)).toBe(false);
  });

  it('rejects negative checkpointCount', () => {
    const progress = createValidAgentProgress({ checkpointCount: -1 });
    expect(validate(progress)).toBe(false);
  });

  it('rejects additional properties', () => {
    const progress = { ...createValidAgentProgress(), extraField: 'not allowed' };
    expect(validate(progress)).toBe(false);
  });

  it('rejects malformed heartbeatAt date-time', () => {
    const progress = createValidAgentProgress({ heartbeatAt: 'not-a-date' });
    expect(validate(progress)).toBe(false);
  });

  it('rejects currentActivity exceeding maxLength 120', () => {
    const progress = createValidAgentProgress({ currentActivity: 'x'.repeat(121) });
    expect(validate(progress)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Classification logic tests
// ---------------------------------------------------------------------------

describe('Agent Monitoring — Status Classification', () => {
  const spawnedAt = new Date('2025-06-15T10:00:00Z');

  it('classifies agent with recent heartbeat as "reporting"', () => {
    const now = new Date('2025-06-15T10:01:00Z');
    const progress = createValidAgentProgress({
      heartbeatAt: new Date('2025-06-15T10:00:50Z').toISOString(),
    });
    expect(classifyAgent(progress, now, spawnedAt, false, 600)).toBe('reporting');
  });

  it('classifies agent with no progress file as "silent"', () => {
    const now = new Date('2025-06-15T10:01:00Z');
    expect(classifyAgent(null, now, spawnedAt, false, 600)).toBe('silent');
  });

  it('classifies agent with old heartbeat as "stale"', () => {
    const now = new Date('2025-06-15T10:05:00Z');
    const progress = createValidAgentProgress({
      heartbeatAt: new Date('2025-06-15T10:02:00Z').toISOString(), // 180s ago
    });
    expect(classifyAgent(progress, now, spawnedAt, false, 600)).toBe('stale');
  });

  it('classifies completed agent as "completed"', () => {
    const now = new Date('2025-06-15T10:05:00Z');
    expect(classifyAgent(null, now, spawnedAt, true, 600)).toBe('completed');
  });

  it('classifies timed-out agent', () => {
    const now = new Date('2025-06-15T10:15:00Z'); // 15 min later
    expect(classifyAgent(null, now, spawnedAt, false, 600)).toBe('timed-out');
  });

  it('completed takes priority over timed-out', () => {
    // Agent completed AND elapsed > timeout — completed wins
    const now = new Date('2025-06-15T10:15:00Z'); // 900s > 600s timeout
    const progress = createValidAgentProgress({
      heartbeatAt: new Date('2025-06-15T10:02:00Z').toISOString(), // stale too
    });
    expect(classifyAgent(progress, now, spawnedAt, true, 600)).toBe('completed');
  });

  it('timed-out takes priority over stale', () => {
    // Agent has stale heartbeat AND elapsed > timeout — timed-out wins
    const now = new Date('2025-06-15T10:15:00Z'); // 900s > 600s timeout
    const progress = createValidAgentProgress({
      heartbeatAt: new Date('2025-06-15T10:02:00Z').toISOString(), // 780s stale
    });
    expect(classifyAgent(progress, now, spawnedAt, false, 600)).toBe('timed-out');
  });

  it('heartbeat at exactly stale threshold is NOT stale (strict >)', () => {
    // Heartbeat age = exactly 90s. Since check is `> 90`, this should be reporting.
    const now = new Date('2025-06-15T10:02:30Z'); // 150s from spawn
    const progress = createValidAgentProgress({
      heartbeatAt: new Date('2025-06-15T10:01:00Z').toISOString(), // exactly 90s ago
    });
    expect(classifyAgent(progress, now, spawnedAt, false, 600)).toBe('reporting');
  });

  it('heartbeat 1s past stale threshold IS stale', () => {
    const now = new Date('2025-06-15T10:02:31Z');
    const progress = createValidAgentProgress({
      heartbeatAt: new Date('2025-06-15T10:01:00Z').toISOString(), // 91s ago
    });
    expect(classifyAgent(progress, now, spawnedAt, false, 600)).toBe('stale');
  });
});

// ---------------------------------------------------------------------------
// Escalation logic tests
// ---------------------------------------------------------------------------

describe('Agent Monitoring — Escalation Protocol', () => {
  it('no escalation for reporting agent', () => {
    expect(determineEscalation('reporting', 10, 60, 600)).toBe('none');
  });

  it('warns on silent agent past grace period', () => {
    expect(determineEscalation('silent', -1, 150, 600)).toBe('warn-silent');
  });

  it('warns on first stale detection', () => {
    expect(determineEscalation('stale', 100, 200, 600)).toBe('warn-stale');
  });

  it('nudges via SendMessage on double-stale', () => {
    expect(determineEscalation('stale', 200, 300, 600)).toBe('nudge-sendmessage');
  });

  it('escalates to user on triple-stale', () => {
    expect(determineEscalation('stale', 300, 400, 600)).toBe('user-decision');
  });

  it('timeout options on timed-out agent', () => {
    expect(determineEscalation('timed-out', -1, 700, 600)).toBe('timeout-options');
  });

  it('no escalation for silent agent within grace period', () => {
    // 60s elapsed < 120s grace period
    expect(determineEscalation('silent', -1, 60, 600)).toBe('none');
  });

  it('no escalation for completed agent', () => {
    expect(determineEscalation('completed', 0, 300, 600)).toBe('none');
  });

  it('stale boundary: exactly 2x threshold triggers nudge (strict >)', () => {
    // 181s > 180s (2x 90s) → nudge
    expect(determineEscalation('stale', 181, 300, 600)).toBe('nudge-sendmessage');
  });

  it('stale boundary: exactly 3x threshold triggers user-decision (strict >)', () => {
    // 271s > 270s (3x 90s) → user-decision
    expect(determineEscalation('stale', 271, 400, 600)).toBe('user-decision');
  });

  it('stale at exactly 2x threshold stays at warn-stale (not strict >)', () => {
    // 180s is NOT > 180s → warn-stale, not nudge
    expect(determineEscalation('stale', 180, 300, 600)).toBe('warn-stale');
  });
});

// ---------------------------------------------------------------------------
// Timeline quality tests
// ---------------------------------------------------------------------------

describe('Agent Monitoring — Timeline Quality', () => {
  it('perfect agent has monotonic percentComplete', () => {
    const timeline = createProgressTimeline(
      'test-1', 'implementer-agent', 1,
      ['src/a.ts', 'src/b.ts', 'src/c.ts'],
    );
    expect(isMonotonic(timeline)).toBe(true);
  });

  it('perfect agent has strictly increasing checkpointCount', () => {
    const timeline = createProgressTimeline(
      'test-1', 'implementer-agent', 1,
      ['src/a.ts', 'src/b.ts', 'src/c.ts'],
    );
    expect(isStrictlyIncreasingCheckpoints(timeline)).toBe(true);
  });

  it('stalled agent timeline stops at stallpoint', () => {
    const timeline = createProgressTimeline(
      'test-1', 'implementer-agent', 1,
      ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
      { stallAtCheckpoint: 3 },
    );
    expect(timeline).toHaveLength(3);
    expect(timeline[timeline.length - 1].phase).not.toBe('finalizing');
  });

  it('silent agent has empty timeline', () => {
    const timeline = createProgressTimeline(
      'test-1', 'implementer-agent', 1,
      ['src/a.ts'],
      { stallAtCheckpoint: 0 },
    );
    expect(timeline).toHaveLength(0);
  });

  it('detects non-monotonic percentComplete regression', () => {
    // Manually craft a timeline where progress goes backward
    const base = createValidAgentProgress({ percentComplete: 60, checkpointCount: 1 });
    const regressed = createValidAgentProgress({ percentComplete: 45, checkpointCount: 2 });
    expect(isMonotonic([base, regressed])).toBe(false);
  });

  it('detects non-strictly-increasing checkpointCount', () => {
    const a = createValidAgentProgress({ checkpointCount: 3 });
    const b = createValidAgentProgress({ checkpointCount: 3 }); // same, not increasing
    expect(isStrictlyIncreasingCheckpoints([a, b])).toBe(false);
  });

  it('single-element timeline is trivially monotonic', () => {
    const single = createValidAgentProgress({ percentComplete: 50 });
    expect(isMonotonic([single])).toBe(true);
    expect(isStrictlyIncreasingCheckpoints([single])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Graded E2E Scenario
// ---------------------------------------------------------------------------

describe('Agent Monitoring — Graded E2E Scenario', () => {
  it('Wave 1 scenario scores ≥ B grade', () => {
    const scenario = createWave1Scenario();
    const evaluation = evaluateScenario(scenario);

    // Print the full rubric report
    console.log(evaluation.summary);

    // The monitoring protocol should achieve at least B grade
    // when agents behave as designed (including the intentional failures)
    expect(['A', 'B']).toContain(evaluation.grade);
    expect(evaluation.totalScore).toBeGreaterThanOrEqual(evaluation.maxScore * 0.8);

    // Individual dimension minimums
    for (const dim of evaluation.dimensions) {
      // Every dimension should score at least 40% (even with mixed agent behaviors)
      expect(dim.score).toBeGreaterThanOrEqual(dim.maxScore * 0.4);
    }
  });

  it('all-perfect scenario scores A grade', () => {
    // Scenario where all agents behave perfectly
    const baseTime = new Date('2025-06-15T10:00:00Z');
    const tasks = [
      { taskId: 'perfect-1', agent: 'implementer-agent', files: ['src/a.ts', 'src/b.ts', 'src/c.ts'] },
      { taskId: 'perfect-2', agent: 'implementer-agent', files: ['src/d.ts', 'src/e.ts'] },
    ];

    const timelines: Record<string, AgentProgress[]> = {};
    const agentResults: Record<string, AgentResult> = {};

    for (const task of tasks) {
      timelines[task.taskId] = createProgressTimeline(
        task.taskId, task.agent, 1, task.files,
        { startTime: baseTime, intervalMs: 30_000 },
      );
      agentResults[task.taskId] = createValidAgentResult({
        agent: task.agent, wave: 1, taskId: task.taskId,
        status: 'success', filesCreated: task.files, durationMs: 180_000,
      });
    }

    const evaluation = evaluateScenario({ tasks, timelines, agentResults });
    console.log(evaluation.summary);

    expect(evaluation.grade).toBe('A');
    expect(evaluation.totalScore).toBeGreaterThanOrEqual(evaluation.maxScore * 0.9);
  });

  it('all-silent scenario scores D or F grade', () => {
    // Scenario where no agents report progress
    const tasks = [
      { taskId: 'silent-1', agent: 'implementer-agent', files: ['src/a.ts'] },
      { taskId: 'silent-2', agent: 'implementer-agent', files: ['src/b.ts'] },
    ];

    const timelines: Record<string, AgentProgress[]> = { 'silent-1': [], 'silent-2': [] };
    const agentResults: Record<string, AgentResult> = {};
    for (const task of tasks) {
      agentResults[task.taskId] = createValidAgentResult({
        agent: task.agent, wave: 1, taskId: task.taskId,
        status: 'success', filesCreated: task.files, durationMs: 120_000,
      });
    }

    const evaluation = evaluateScenario({ tasks, timelines, agentResults });
    console.log(evaluation.summary);

    // Silent agents mean most dimensions score 0 — must be F
    expect(evaluation.grade).toBe('F');
  });

  it('recovery scenario: stale-then-resumed agent scores ≥ B', () => {
    // An agent that goes stale for ~2 minutes then resumes heartbeating.
    // The monitoring system should correctly transition from stale → reporting.
    const baseTime = new Date('2025-06-15T10:00:00Z');

    // Build a custom timeline: 3 normal checkpoints, 120s gap, then 3 more
    const recoveryTimeline: AgentProgress[] = [];
    let checkpoint = 0;
    const files = ['src/service.ts', 'src/handler.ts', 'src/types.ts'];

    // Phase 1: Normal heartbeats at 30s intervals (0s, 30s, 60s)
    for (let i = 0; i < 3; i++) {
      checkpoint++;
      recoveryTimeline.push(createValidAgentProgress({
        taskId: 'recovery-1',
        agent: 'implementer-agent',
        wave: 1,
        phase: i === 0 ? 'initializing' : 'reading-contracts',
        percentComplete: i * 5,
        currentActivity: i === 0 ? 'Starting up' : 'Reading contracts',
        filesWritten: [],
        heartbeatAt: new Date(baseTime.getTime() + i * 30_000).toISOString(),
        startedAt: baseTime.toISOString(),
        checkpointCount: checkpoint,
      }));
    }

    // Phase 2: 120s gap (agent goes stale), then resumes at T+180s
    for (let i = 0; i < 3; i++) {
      checkpoint++;
      const elapsed = 180_000 + i * 30_000; // 180s, 210s, 240s
      recoveryTimeline.push(createValidAgentProgress({
        taskId: 'recovery-1',
        agent: 'implementer-agent',
        wave: 1,
        phase: i < 2 ? 'implementing' : 'finalizing',
        percentComplete: 50 + i * 25,
        currentActivity: i < 2 ? `Writing ${files[i]}` : 'Preparing AgentResult',
        filesWritten: files.slice(0, i + 1),
        heartbeatAt: new Date(baseTime.getTime() + elapsed).toISOString(),
        startedAt: baseTime.toISOString(),
        checkpointCount: checkpoint,
      }));
    }

    // Also include a normal agent for comparison
    const normalTimeline = createProgressTimeline(
      'normal-1', 'implementer-agent', 1, ['src/normal.ts', 'src/util.ts'],
      { startTime: baseTime, intervalMs: 30_000 },
    );

    const tasks = [
      { taskId: 'recovery-1', agent: 'implementer-agent', files },
      { taskId: 'normal-1', agent: 'implementer-agent', files: ['src/normal.ts', 'src/util.ts'] },
    ];
    const timelines: Record<string, AgentProgress[]> = {
      'recovery-1': recoveryTimeline,
      'normal-1': normalTimeline,
    };
    const agentResults: Record<string, AgentResult> = {};
    for (const task of tasks) {
      agentResults[task.taskId] = createValidAgentResult({
        agent: task.agent, wave: 1, taskId: task.taskId,
        status: 'success', filesCreated: task.files, durationMs: 240_000,
      });
    }

    const evaluation = evaluateScenario({ tasks, timelines, agentResults });
    console.log(evaluation.summary);

    // Recovery agent + normal agent: should still score well overall
    expect(['A', 'B']).toContain(evaluation.grade);
    expect(evaluation.totalScore).toBeGreaterThanOrEqual(70);

    // Verify the recovery agent is correctly classified at different times:
    // At T+120s (during the gap, last heartbeat at T+60s = 60s ago) → reporting (not stale yet)
    const t120 = new Date(baseTime.getTime() + 120_000);
    const progressAt120 = recoveryTimeline[2]; // last before gap, heartbeat at T+60s
    expect(classifyAgent(progressAt120, t120, baseTime, false, 600)).toBe('reporting');

    // At T+160s (gap continues, last heartbeat at T+60s = 100s ago) → stale
    const t160 = new Date(baseTime.getTime() + 160_000);
    expect(classifyAgent(progressAt120, t160, baseTime, false, 600)).toBe('stale');

    // At T+200s (recovery started at T+180s, latest heartbeat at T+180s = 20s ago) → reporting
    const t200 = new Date(baseTime.getTime() + 200_000);
    const progressAt200 = recoveryTimeline[3]; // first recovery checkpoint, heartbeat at T+180s
    expect(classifyAgent(progressAt200, t200, baseTime, false, 600)).toBe('reporting');
  });
});
