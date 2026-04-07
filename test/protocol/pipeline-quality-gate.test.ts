import { describe, it, expect, beforeAll } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { encode, decode } from '@toon-format/toon';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { QualityGateInput, GateResult, PipelineState } from './helpers/types.js';
import {
  createQualityGateInput,
  createValidPipelineState,
  createStageHistoryEntry,
} from './helpers/synthetic-data.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadSchema(name: string): Record<string, unknown> {
  const path = resolve(__dirname, 'schemas', name);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function toonRoundtrip<T>(data: T): T {
  return decode(encode(data)) as T;
}

/**
 * Pure-function implementation of the pipeline quality gate decision matrix.
 * Thresholds match the plan's DECISION MATRIX exactly.
 */
function evaluateQualityGate(input: QualityGateInput): GateResult {
  const totalTests = input.testsPassed + input.testsFailed;
  const testPassRate = totalTests === 0 ? 1 : input.testsPassed / totalTests;
  const iterationsExhausted = input.outerIteration >= input.maxIterations;

  // DONE: zero critical, 100% tests, typecheck passes
  if (input.criticalCount === 0 && testPassRate === 1 && input.typecheckPasses) {
    return 'proceed';
  }

  // REVISE/ESCALATE: critical > 3, or pass rate < 80%, or fix cycles exhausted
  if (input.criticalCount > 3 || testPassRate < 0.8 || input.fixCycleCount >= 2) {
    return iterationsExhausted ? 'escalate' : 'revise-plan';
  }

  // REVISE/ESCALATE: typecheck fails (systemic)
  if (!input.typecheckPasses) {
    return iterationsExhausted ? 'escalate' : 'revise-plan';
  }

  // FIX: critical <= 3, pass rate >= 80%, fixCycle < 2
  return 'fix-and-recheck';
}

/**
 * Compare prior and current findings to detect convergence stall.
 */
function detectConvergence(
  priorFindings: string[],
  currentFindings: string[],
): 'progress' | 'stalled' {
  if (priorFindings.length !== currentFindings.length) return 'progress';
  const priorSet = new Set(priorFindings);
  for (const f of currentFindings) {
    if (!priorSet.has(f)) return 'progress';
  }
  return 'stalled';
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Pipeline Quality Gate', () => {
  let validatePipelineState: ReturnType<InstanceType<typeof Ajv2020>['compile']>;

  beforeAll(() => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    validatePipelineState = ajv.compile(loadSchema('pipeline-state.schema.json'));
  });

  // -------------------------------------------------------------------------
  // Decision Matrix — 9 tests covering every boundary
  // -------------------------------------------------------------------------
  describe('Decision Matrix', () => {
    it('DONE: 0 critical, 100% tests, typecheck pass', () => {
      const input = createQualityGateInput();
      expect(evaluateQualityGate(input)).toBe('proceed');
    });

    it('DONE: 0 critical, 100% tests, 5 warnings (warnings dont block)', () => {
      const input = createQualityGateInput({ warningCount: 5 });
      expect(evaluateQualityGate(input)).toBe('proceed');
    });

    it('FIX: 1 critical, 95% tests, fixCycle=0', () => {
      const input = createQualityGateInput({
        criticalCount: 1, testsPassed: 19, testsFailed: 1,
      });
      expect(evaluateQualityGate(input)).toBe('fix-and-recheck');
    });

    it('FIX: 3 critical, 80% tests, fixCycle=1 (boundary)', () => {
      const input = createQualityGateInput({
        criticalCount: 3, testsPassed: 80, testsFailed: 20, fixCycleCount: 1,
      });
      expect(evaluateQualityGate(input)).toBe('fix-and-recheck');
    });

    it('REVISE: 4 critical, 80% tests (above threshold)', () => {
      const input = createQualityGateInput({
        criticalCount: 4, testsPassed: 80, testsFailed: 20,
      });
      expect(evaluateQualityGate(input)).toBe('revise-plan');
    });

    it('REVISE: 0 critical, 79% tests (below threshold)', () => {
      const input = createQualityGateInput({
        criticalCount: 0, testsPassed: 79, testsFailed: 21,
      });
      expect(evaluateQualityGate(input)).toBe('revise-plan');
    });

    it('REVISE: typecheck fails on systemic issues', () => {
      const input = createQualityGateInput({
        criticalCount: 1, typecheckPasses: false,
      });
      expect(evaluateQualityGate(input)).toBe('revise-plan');
    });

    it('REVISE: fixCycle=2 with remaining findings', () => {
      const input = createQualityGateInput({
        criticalCount: 1, testsPassed: 9, testsFailed: 1, fixCycleCount: 2,
      });
      expect(evaluateQualityGate(input)).toBe('revise-plan');
    });

    it('ESCALATE: revise needed but iteration=max', () => {
      const input = createQualityGateInput({
        criticalCount: 5, outerIteration: 3, maxIterations: 3,
      });
      expect(evaluateQualityGate(input)).toBe('escalate');
    });
  });

  // -------------------------------------------------------------------------
  // Convergence Detection — 5 tests
  // -------------------------------------------------------------------------
  describe('Convergence Detection', () => {
    it('detects progress: criticalCount decreased between cycles', () => {
      const prior = ['err:file.ts:10', 'err:file.ts:20', 'err:file.ts:30'];
      const current = ['err:file.ts:10'];
      expect(detectConvergence(prior, current)).toBe('progress');
    });

    it('detects progress: testPassRate increased between cycles', () => {
      // Different findings even at same count signals progress
      const prior = ['err:a.ts:1', 'err:b.ts:2'];
      const current = ['err:c.ts:3', 'err:d.ts:4'];
      expect(detectConvergence(prior, current)).toBe('progress');
    });

    it('detects stall: identical criticalCount and findings', () => {
      const findings = ['err:auth.ts:42', 'err:db.ts:99'];
      expect(detectConvergence(findings, [...findings])).toBe('stalled');
    });

    it('detects stall: same file:line findings across cycles', () => {
      const prior = ['critical:src/api.ts:10:missing-auth'];
      const current = ['critical:src/api.ts:10:missing-auth'];
      expect(detectConvergence(prior, current)).toBe('stalled');
    });

    it('does not false-positive on different findings at same count', () => {
      const prior = ['err:old.ts:1', 'err:old.ts:2'];
      const current = ['err:new.ts:5', 'err:new.ts:6'];
      expect(detectConvergence(prior, current)).toBe('progress');
    });
  });

  // -------------------------------------------------------------------------
  // Edge Cases — 3 tests
  // -------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('handles zero tests (no test suite yet) — treat as 100% pass rate', () => {
      const input = createQualityGateInput({
        testsPassed: 0, testsFailed: 0, criticalCount: 0,
      });
      expect(evaluateQualityGate(input)).toBe('proceed');
    });

    it('handles no review report (review-code failed) — escalate', () => {
      // When review-code itself failed, criticalCount is unknown.
      // Convention: caller sets criticalCount to Infinity or a high sentinel.
      const input = createQualityGateInput({
        criticalCount: 999, typecheckPasses: false,
        outerIteration: 3, maxIterations: 3,
      });
      expect(evaluateQualityGate(input)).toBe('escalate');
    });

    it('handles typecheck not configured — skip typecheck check', () => {
      // When typecheck is not configured, caller sets typecheckPasses=true.
      const input = createQualityGateInput({
        criticalCount: 1, testsPassed: 9, testsFailed: 1, typecheckPasses: true,
      });
      expect(evaluateQualityGate(input)).toBe('fix-and-recheck');
    });
  });

  // -------------------------------------------------------------------------
  // TOON Roundtrip — 3 tests
  // -------------------------------------------------------------------------
  describe('TOON Roundtrip', () => {
    it('QualityGateInput survives TOON encode/decode', () => {
      const input = createQualityGateInput({
        criticalCount: 2, warningCount: 7, testsPassed: 45, testsFailed: 5,
      });
      const roundtripped = toonRoundtrip(input);
      expect(roundtripped).toEqual(input);
      expect(evaluateQualityGate(roundtripped)).toBe(evaluateQualityGate(input));
    });

    it('PipelineState with full stageHistory survives roundtrip', () => {
      const state = createValidPipelineState({
        runId: '550e8400-e29b-41d4-a716-446655440000',
        outerIteration: 2,
        currentStage: 'fix-code',
        fixCycleCount: 1,
        agentsSpawned: 34,
        stageHistory: [
          createStageHistoryEntry('plan-create'),
          createStageHistoryEntry('execute', { agentsUsed: 18 }),
          createStageHistoryEntry('test', { agentsUsed: 3 }),
          createStageHistoryEntry('review-code', { gateResult: 'fix-and-recheck', agentsUsed: 5 }),
          createStageHistoryEntry('fix-code', {
            status: 'in_progress', completedAt: null, gateResult: null,
          }),
        ],
      });
      const roundtripped = toonRoundtrip(state);
      expect(roundtripped).toEqual(state);
      expect(validatePipelineState(roundtripped)).toBe(true);
    });

    it('failureLog with all resolution types survives roundtrip', () => {
      const state = createValidPipelineState({
        runId: '550e8400-e29b-41d4-a716-446655440000',
        failureLog: [
          { iteration: 1, stage: 'execute', error: 'wave-3-typecheck-failed', resolution: 'wave-retry' },
          { iteration: 1, stage: 'review-code', error: '5-critical-findings', resolution: 'fix-and-recheck' },
          { iteration: 1, stage: 'fix-code', error: '2-critical-remaining', resolution: 'revise-plan' },
          { iteration: 2, stage: 'execute', error: 'same-wave-3-failure', resolution: 'escalate' },
        ],
      });
      const roundtripped = toonRoundtrip(state);
      expect(roundtripped).toEqual(state);
      expect(validatePipelineState(roundtripped)).toBe(true);
      // Verify all 4 resolution types survived
      const resolutions = (roundtripped as PipelineState).failureLog.map(e => e.resolution);
      expect(resolutions).toEqual(['wave-retry', 'fix-and-recheck', 'revise-plan', 'escalate']);
    });
  });
});
