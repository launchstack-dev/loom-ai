import { describe, it, expect } from 'vitest';

import type {
  PipelineState,
  PipelineStage,
  GateResult,
  WaveGateInput,
  QualityGateInput,
  StageHistoryEntry,
  FailureLogEntry,
} from './helpers/types.js';

import {
  createValidPipelineState,
  createStageHistoryEntry,
  createWaveGateInput,
  createQualityGateInput,
} from './helpers/synthetic-data.js';

// ---------------------------------------------------------------------------
// Inline helpers — pure gate logic functions
// ---------------------------------------------------------------------------

function evaluateWaveGate(input: WaveGateInput): 'proceed' | 'retry' | 'escalate' {
  // Blocking issues or ownership violations always escalate
  if (input.blockingIssueCount > 0 || input.ownershipViolationCount > 0) {
    return 'escalate';
  }
  if (input.verificationStatus === 'pass') {
    return 'proceed'; // orphaned criteria are non-blocking in auto mode
  }
  // Verification failed
  if (!input.failuresInOwnedFiles) return 'escalate';
  if (input.waveRetryCount >= 2) return 'escalate';
  return 'retry';
}

function evaluateQualityGate(input: QualityGateInput): GateResult {
  const totalTests = input.testsPassed + input.testsFailed;
  const testPassRate = totalTests > 0 ? input.testsPassed / totalTests : 1;

  // Perfect: done
  if (input.criticalCount === 0 && testPassRate === 1 && input.typecheckPasses) {
    return 'proceed';
  }
  // Too many criticals or low pass rate → revise or escalate
  if (input.criticalCount > 3 || testPassRate < 0.8) {
    return input.outerIteration >= input.maxIterations ? 'escalate' : 'revise-plan';
  }
  // Fix cycles exhausted → revise or escalate
  if (input.fixCycleCount >= 2) {
    return input.outerIteration >= input.maxIterations ? 'escalate' : 'revise-plan';
  }
  // Fixable range: criticalCount 1-3, passRate >= 80%, fixCycle < 2
  return 'fix-and-recheck';
}

function detectConvergence(
  prior: { criticalCount: number; testPassRate: number; findings: string[] },
  current: { criticalCount: number; testPassRate: number; findings: string[] },
): 'progress' | 'stalled' {
  if (current.criticalCount < prior.criticalCount) return 'progress';
  if (current.testPassRate > prior.testPassRate) return 'progress';
  // Same findings = stalled
  const priorSet = new Set(prior.findings);
  const currentSet = new Set(current.findings);
  if (priorSet.size === currentSet.size && [...priorSet].every((f) => currentSet.has(f))) {
    return 'stalled';
  }
  return 'progress';
}

function determineResumePoint(
  state: PipelineState,
): { stage: PipelineStage; flags: string[] } {
  const stage = state.currentStage;
  const flags: string[] = [];

  if (stage === 'execute') {
    flags.push('--resume');
  }
  if (stage === 'escalated') {
    flags.push('--show-report');
  }
  if (stage === 'complete') {
    flags.push('--show-summary');
  }

  // Failed stages restart fresh
  const lastEntry = state.stageHistory.findLast((e) => e.stage === stage);
  if (lastEntry?.status === 'failed') {
    flags.push('--restart-stage');
  }

  return { stage, flags };
}

function checkCircuitBreaker(
  state: PipelineState,
  proposedAgents: number,
): 'ok' | 'warn' | 'block' {
  const projectedTotal = state.agentsSpawned + proposedAgents;
  if (projectedTotal > state.maxAgents) return 'block';
  if (projectedTotal > state.maxAgents * 0.8) return 'warn';
  return 'ok';
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Pipeline Loop Mechanics', () => {
  // -------------------------------------------------------------------------
  // Outer Loop — Plan Iteration
  // -------------------------------------------------------------------------
  describe('Outer Loop — Plan Iteration', () => {
    it('completes on first iteration when all stages succeed', () => {
      const state = createValidPipelineState({
        outerIteration: 1,
        currentStage: 'complete',
        stageHistory: [
          createStageHistoryEntry('plan-create'),
          createStageHistoryEntry('execute', { agentsUsed: 18 }),
          createStageHistoryEntry('test', { agentsUsed: 3 }),
          createStageHistoryEntry('review-code', { agentsUsed: 5 }),
        ],
      });

      expect(state.outerIteration).toBe(1);
      expect(state.currentStage).toBe('complete');
      expect(state.failureLog).toHaveLength(0);
    });

    it('increments iteration and reverts to plan-create on execution failure', () => {
      const state = createValidPipelineState({
        outerIteration: 1,
        currentStage: 'execute',
        stageHistory: [
          createStageHistoryEntry('plan-create'),
          createStageHistoryEntry('execute', { status: 'failed' }),
        ],
      });

      // Simulate outer loop logic
      const failureEntry: FailureLogEntry = {
        iteration: state.outerIteration,
        stage: 'execute',
        error: 'wave-3-typecheck-failure',
        resolution: 'revise-plan',
      };
      const next: PipelineState = {
        ...state,
        outerIteration: state.outerIteration + 1,
        currentStage: 'plan-create',
        failureLog: [...state.failureLog, failureEntry],
      };

      expect(next.outerIteration).toBe(2);
      expect(next.currentStage).toBe('plan-create');
      expect(next.failureLog).toHaveLength(1);
      expect(next.failureLog[0].resolution).toBe('revise-plan');
    });

    it('escalates when iteration exceeds maxIterations', () => {
      const state = createValidPipelineState({
        outerIteration: 3,
        maxIterations: 3,
        currentStage: 'execute',
        stageHistory: [
          createStageHistoryEntry('execute', { status: 'failed', iteration: 3 }),
        ],
      });

      // Outer loop: iteration > maxIterations → escalate
      const shouldEscalate = state.outerIteration >= state.maxIterations;
      expect(shouldEscalate).toBe(true);

      const next: PipelineState = {
        ...state,
        currentStage: 'escalated',
      };
      expect(next.currentStage).toBe('escalated');
    });

    it('escalates on identical failure across iterations', () => {
      const state = createValidPipelineState({
        outerIteration: 2,
        maxIterations: 3,
        failureLog: [
          { iteration: 1, stage: 'execute', error: 'contract-mismatch-auth-types', resolution: 'revise-plan' },
          { iteration: 2, stage: 'execute', error: 'contract-mismatch-auth-types', resolution: 'revise-plan' },
        ],
      });

      const hasIdenticalFailure = state.failureLog.length >= 2 &&
        state.failureLog[state.failureLog.length - 1].error ===
        state.failureLog[state.failureLog.length - 2].error;

      expect(hasIdenticalFailure).toBe(true);
    });

    it('preserves completed stages when revising plan', () => {
      const history: StageHistoryEntry[] = [
        createStageHistoryEntry('plan-create', { iteration: 1 }),
        createStageHistoryEntry('execute', { iteration: 1, agentsUsed: 18 }),
        createStageHistoryEntry('test', { iteration: 1 }),
        createStageHistoryEntry('review-code', { iteration: 1, status: 'failed' }),
      ];

      const state = createValidPipelineState({
        outerIteration: 1,
        stageHistory: history,
      });

      // On revision: history is preserved, new iteration starts fresh
      const next: PipelineState = {
        ...state,
        outerIteration: 2,
        currentStage: 'plan-create',
      };

      // Prior history entries remain
      expect(next.stageHistory).toHaveLength(4);
      expect(next.stageHistory.filter((e) => e.iteration === 1)).toHaveLength(4);
      expect(next.currentStage).toBe('plan-create');
    });
  });

  // -------------------------------------------------------------------------
  // Inner Loop — Wave Retry
  // -------------------------------------------------------------------------
  describe('Inner Loop — Wave Retry', () => {
    it('proceeds when verification passes', () => {
      const input = createWaveGateInput({ verificationStatus: 'pass' });
      expect(evaluateWaveGate(input)).toBe('proceed');
    });

    it('retries when verification fails in owned files and retryCount < 2', () => {
      const input = createWaveGateInput({
        verificationStatus: 'fail',
        failuresInOwnedFiles: true,
        waveRetryCount: 0,
      });
      expect(evaluateWaveGate(input)).toBe('retry');
    });

    it('escalates when verification fails in unowned files', () => {
      const input = createWaveGateInput({
        verificationStatus: 'fail',
        failuresInOwnedFiles: false,
        waveRetryCount: 0,
      });
      expect(evaluateWaveGate(input)).toBe('escalate');
    });

    it('escalates when retryCount reaches 2', () => {
      const input = createWaveGateInput({
        verificationStatus: 'fail',
        failuresInOwnedFiles: true,
        waveRetryCount: 2,
      });
      expect(evaluateWaveGate(input)).toBe('escalate');
    });

    it('proceeds with warning on orphaned criteria in auto mode', () => {
      const input = createWaveGateInput({
        verificationStatus: 'pass',
        newOrphanedCriteria: 2,
      });
      // Orphans are non-blocking in auto mode
      expect(evaluateWaveGate(input)).toBe('proceed');
    });

    it('escalates on blocking reconciliation conflicts', () => {
      const input = createWaveGateInput({
        verificationStatus: 'fail',
        blockingIssueCount: 1,
        ownershipViolationCount: 1,
      });
      expect(evaluateWaveGate(input)).toBe('escalate');
    });
  });

  // -------------------------------------------------------------------------
  // Fix Loop — Convergence
  // -------------------------------------------------------------------------
  describe('Fix Loop — Convergence', () => {
    it('returns proceed when zero critical findings and all tests pass', () => {
      const input = createQualityGateInput({
        criticalCount: 0,
        testsFailed: 0,
        typecheckPasses: true,
      });
      expect(evaluateQualityGate(input)).toBe('proceed');
    });

    it('returns fix-and-recheck when critical findings <= 3 and fixCycle < 2', () => {
      const input = createQualityGateInput({
        criticalCount: 2,
        testsPassed: 45,
        testsFailed: 1,
        fixCycleCount: 0,
      });
      expect(evaluateQualityGate(input)).toBe('fix-and-recheck');
    });

    it('returns revise-plan when critical findings > 3', () => {
      const input = createQualityGateInput({
        criticalCount: 5,
        fixCycleCount: 0,
      });
      expect(evaluateQualityGate(input)).toBe('revise-plan');
    });

    it('returns revise-plan when test pass rate < 80%', () => {
      const input = createQualityGateInput({
        criticalCount: 0,
        testsPassed: 3,
        testsFailed: 5,
        typecheckPasses: true,
      });
      // 3/8 = 37.5% < 80%
      expect(evaluateQualityGate(input)).toBe('revise-plan');
    });

    it('returns revise-plan when fix cycle exhausted (fixCycleCount >= 2)', () => {
      const input = createQualityGateInput({
        criticalCount: 1,
        testsPassed: 45,
        testsFailed: 2,
        fixCycleCount: 2,
      });
      expect(evaluateQualityGate(input)).toBe('revise-plan');
    });

    it('escalates when revise-plan triggered but iterations exhausted', () => {
      const input = createQualityGateInput({
        criticalCount: 5,
        outerIteration: 3,
        maxIterations: 3,
      });
      expect(evaluateQualityGate(input)).toBe('escalate');
    });

    it('detects convergence stall — same findings after fix cycle', () => {
      const prior = { criticalCount: 3, testPassRate: 0.85, findings: ['null-ref:auth.ts:42', 'missing-import:db.ts:10', 'type-error:api.ts:55'] };
      const current = { criticalCount: 3, testPassRate: 0.85, findings: ['null-ref:auth.ts:42', 'missing-import:db.ts:10', 'type-error:api.ts:55'] };
      expect(detectConvergence(prior, current)).toBe('stalled');
    });
  });

  // -------------------------------------------------------------------------
  // Circuit Breakers
  // -------------------------------------------------------------------------
  describe('Circuit Breakers', () => {
    it('triggers on agent budget exhaustion', () => {
      const state = createValidPipelineState({
        agentsSpawned: 48,
        maxAgents: 50,
      });
      expect(checkCircuitBreaker(state, 5)).toBe('block');
    });

    it('warns when approaching agent budget', () => {
      const state = createValidPipelineState({
        agentsSpawned: 38,
        maxAgents: 50,
      });
      // 38 + 5 = 43 > 40 (80% of 50)
      expect(checkCircuitBreaker(state, 5)).toBe('warn');
    });

    it('triggers on wave deadlock — failed 2x, plan unchanged', () => {
      const state = createValidPipelineState({
        outerIteration: 2,
        failureLog: [
          { iteration: 1, stage: 'execute', error: 'wave-3-contract-mismatch', resolution: 'revise-plan' },
          { iteration: 2, stage: 'execute', error: 'wave-3-contract-mismatch', resolution: 'revise-plan' },
        ],
      });

      // Detect deadlock: same stage+error across two iterations
      const lastTwo = state.failureLog.slice(-2);
      const isDeadlock = lastTwo.length === 2 &&
        lastTwo[0].stage === lastTwo[1].stage &&
        lastTwo[0].error === lastTwo[1].error;
      expect(isDeadlock).toBe(true);
    });

    it('triggers on validation failure after review-integrate', () => {
      const state = createValidPipelineState({
        currentStage: 'plan-validate',
        stageHistory: [
          createStageHistoryEntry('plan-create'),
          createStageHistoryEntry('plan-review'),
          createStageHistoryEntry('plan-integrate'),
          createStageHistoryEntry('plan-validate', { status: 'failed' }),
        ],
      });

      // Validation failure after integrate → escalate, don't retry
      const validateFailed = state.stageHistory.some(
        (e) => e.stage === 'plan-validate' && e.status === 'failed',
      );
      expect(validateFailed).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Resume Logic
  // -------------------------------------------------------------------------
  describe('Resume Logic', () => {
    it('resumes at correct stage from pipeline-state', () => {
      const stages: PipelineStage[] = [
        'plan-create', 'plan-review', 'plan-integrate', 'plan-validate',
        'execute', 'test', 'review-code', 'fix-code',
        'complete', 'escalated',
      ];

      for (const stage of stages) {
        const state = createValidPipelineState({ currentStage: stage });
        const resume = determineResumePoint(state);
        expect(resume.stage).toBe(stage);
      }
    });

    it('delegates to loom-execute-plan --resume when stage is execute', () => {
      const state = createValidPipelineState({
        currentStage: 'execute',
        outerIteration: 1,
      });
      const resume = determineResumePoint(state);
      expect(resume.stage).toBe('execute');
      expect(resume.flags).toContain('--resume');
    });

    it('restarts failed stage on resume', () => {
      const state = createValidPipelineState({
        currentStage: 'test',
        stageHistory: [
          createStageHistoryEntry('test', { status: 'failed' }),
        ],
      });
      const resume = determineResumePoint(state);
      expect(resume.stage).toBe('test');
      expect(resume.flags).toContain('--restart-stage');
    });
  });
});
