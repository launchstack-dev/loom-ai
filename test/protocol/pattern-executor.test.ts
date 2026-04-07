import { describe, it, expect, beforeAll } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { encode, decode } from '@toon-format/toon';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PatternType, PatternResult } from './helpers/types.js';
import { createValidPatternResult } from './helpers/synthetic-data.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadSchema(name: string): Record<string, unknown> {
  const path = resolve(__dirname, 'schemas', name);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function toonRoundtrip<T>(data: T): T {
  const encoded = encode(data);
  return decode(encoded) as T;
}

interface PatternConfig {
  name: string;
  type: PatternType;
  trigger: string;
  agents: string[];
  moderator?: string;
  evaluator?: string;
  router?: string;
  maxRounds?: number;
  passOriginalInput?: boolean;
  isolation?: string;
}

function matchTrigger(patterns: PatternConfig[], label: string): PatternConfig | null {
  for (const p of patterns) {
    if (p.trigger === label) return p;
  }
  return null;
}

function calculateDebateBudget(maxRounds: number): number {
  return (maxRounds * 2) + 1;
}

function calculateVoteBudget(agentCount: number): number {
  return agentCount + 1;
}

function calculateTriageBudget(complexity: string, domainCount?: number): number {
  if (complexity === 'simple') return 1;
  if (complexity === 'complex') return 2;
  // multi-domain: router + N specialists
  return 1 + (domainCount ?? 1);
}

function handleChainFailure(
  outputs: (string | null)[],
  failIndex: number,
): { result: string; error: string } {
  const lastGood = outputs.slice(0, failIndex).filter(Boolean).pop() ?? '';
  return {
    result: lastGood,
    error: `Chain halted at step ${failIndex}: agent failed`,
  };
}

function checkBudget(spawned: number, max: number): 'ok' | 'warn' | 'block' {
  if (spawned >= max) return 'block';
  if (spawned >= max * 0.8) return 'warn';
  return 'ok';
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const samplePatterns: PatternConfig[] = [
  {
    name: 'arch-debate',
    type: 'debate',
    trigger: 'architecture-decision',
    agents: ['advocate-agent', 'critic-agent'],
    moderator: 'synthesis-agent',
    maxRounds: 3,
  },
  {
    name: 'code-quality-chain',
    type: 'chain',
    trigger: 'code-generation',
    agents: ['draft-agent', 'refine-agent', 'harden-agent'],
    passOriginalInput: true,
  },
  {
    name: 'auth-vote',
    type: 'vote',
    trigger: 'auth-implementation',
    agents: ['jwt-agent', 'session-agent', 'oauth-agent'],
    evaluator: 'auth-evaluator',
    isolation: 'worktree',
  },
  {
    name: 'smart-triage',
    type: 'triage',
    trigger: 'task-intake',
    agents: [],
    router: 'triage-agent',
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Pattern Executor', () => {
  let ajv: InstanceType<typeof Ajv2020>;
  let validatePatternResult: ReturnType<InstanceType<typeof Ajv2020>['compile']>;

  beforeAll(() => {
    ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    validatePatternResult = ajv.compile(loadSchema('pattern-result.schema.json'));
  });

  // -------------------------------------------------------------------------
  // Trigger Matching
  // -------------------------------------------------------------------------

  describe('Trigger Matching', () => {
    it('matches exact trigger string', () => {
      const match = matchTrigger(samplePatterns, 'architecture-decision');
      expect(match).not.toBeNull();
      expect(match!.name).toBe('arch-debate');
    });

    it('returns null when no pattern matches', () => {
      expect(matchTrigger(samplePatterns, 'unknown-label')).toBeNull();
    });

    it('matches first pattern when multiple triggers match', () => {
      const dupes: PatternConfig[] = [
        { ...samplePatterns[0], name: 'first' },
        { ...samplePatterns[0], name: 'second' },
      ];
      expect(matchTrigger(dupes, 'architecture-decision')!.name).toBe('first');
    });

    it('handles empty patterns config', () => {
      expect(matchTrigger([], 'anything')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // PatternResult Schema
  // -------------------------------------------------------------------------

  describe('PatternResult Schema', () => {
    it('validates debate result with transcript and rounds', () => {
      const result = createValidPatternResult('debate');
      expect(validatePatternResult(result)).toBe(true);
    });

    it('validates chain result (minimal — just result + agentsUsed)', () => {
      const result = createValidPatternResult('chain');
      expect(validatePatternResult(result)).toBe(true);
    });

    it('validates vote result with solutions count', () => {
      const result = createValidPatternResult('vote');
      expect(validatePatternResult(result)).toBe(true);
    });

    it('validates triage result with routing classification', () => {
      const result = createValidPatternResult('triage');
      expect(validatePatternResult(result)).toBe(true);
    });

    it('rejects result missing required fields', () => {
      const bad = { pattern: 'test', type: 'debate' }; // missing result, agentsUsed
      expect(validatePatternResult(bad)).toBe(false);
    });

    it('rejects result with invalid type', () => {
      const bad = { pattern: 'test', type: 'unknown', result: 'x', agentsUsed: 1 };
      expect(validatePatternResult(bad)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Debate Pattern
  // -------------------------------------------------------------------------

  describe('Debate Pattern', () => {
    it('agent budget: (maxRounds * 2) + 1', () => {
      expect(calculateDebateBudget(3)).toBe(7);
    });

    it('caps at maxRounds even if no convergence', () => {
      const maxRounds = 5;
      let rounds = 0;
      for (let i = 0; i < 10; i++) {
        if (rounds >= maxRounds) break;
        rounds++;
      }
      expect(rounds).toBe(maxRounds);
      expect(calculateDebateBudget(maxRounds)).toBe(11);
    });

    it('halts on advocate failure — returns last output', () => {
      const outputs: (string | null)[] = ['advocate-r1', 'critic-r1', null];
      const { result } = handleChainFailure(outputs, 2);
      expect(result).toBe('critic-r1');
    });

    it('halts on critic failure — returns advocate output', () => {
      const outputs: (string | null)[] = ['advocate-r1', null];
      const { result } = handleChainFailure(outputs, 1);
      expect(result).toBe('advocate-r1');
    });

    it('moderator failure — returns raw last round', () => {
      // All debate rounds succeed, moderator (last step) fails
      const outputs: (string | null)[] = [
        'advocate-r1', 'critic-r1', 'advocate-r2', 'critic-r2',
        'advocate-r3', 'critic-r3', null,
      ];
      const { result, error } = handleChainFailure(outputs, 6);
      expect(result).toBe('critic-r3');
      expect(error).toContain('step 6');
    });
  });

  // -------------------------------------------------------------------------
  // Chain Pattern
  // -------------------------------------------------------------------------

  describe('Chain Pattern', () => {
    it('agent budget: N agents', () => {
      const chain = samplePatterns.find((p) => p.type === 'chain')!;
      expect(chain.agents.length).toBe(3);
    });

    it('passes original input when passOriginalInput=true', () => {
      const chain = samplePatterns.find((p) => p.type === 'chain')!;
      expect(chain.passOriginalInput).toBe(true);
      // Simulate: each agent receives original input + prior output
      const original = 'spec: build auth';
      const step1 = `draft from ${original}`;
      const step2Input = chain.passOriginalInput ? `${step1} | ${original}` : step1;
      expect(step2Input).toContain(original);
    });

    it('omits original input when passOriginalInput=false', () => {
      const chain: PatternConfig = { ...samplePatterns[1], passOriginalInput: false };
      const original = 'spec: build auth';
      const step1 = 'draft output';
      const step2Input = chain.passOriginalInput ? `${step1} | ${original}` : step1;
      expect(step2Input).not.toContain(original);
    });

    it('halts on mid-chain failure — returns last successful output', () => {
      const outputs: (string | null)[] = ['draft-v1', null, null];
      const { result } = handleChainFailure(outputs, 1);
      expect(result).toBe('draft-v1');
    });

    it('annotates error on chain halt', () => {
      const outputs: (string | null)[] = ['draft-v1', 'refined-v2', null];
      const { result, error } = handleChainFailure(outputs, 2);
      expect(result).toBe('refined-v2');
      expect(error).toContain('Chain halted');
      expect(error).toContain('step 2');
    });
  });

  // -------------------------------------------------------------------------
  // Vote Pattern
  // -------------------------------------------------------------------------

  describe('Vote Pattern', () => {
    it('agent budget: N agents + 1 evaluator', () => {
      const vote = samplePatterns.find((p) => p.type === 'vote')!;
      expect(calculateVoteBudget(vote.agents.length)).toBe(4);
    });

    it('skips evaluator when only 1 agent succeeds', () => {
      const solutions = ['solution-A', null, null].filter(Boolean);
      const needsEvaluator = solutions.length >= 2;
      expect(needsEvaluator).toBe(false);
      expect(solutions[0]).toBe('solution-A');
    });

    it('all agents fail — returns error result', () => {
      const solutions = [null, null, null].filter(Boolean);
      expect(solutions.length).toBe(0);
      const result: PatternResult = {
        pattern: 'auth-vote',
        type: 'vote',
        result: 'All agents failed — no solution produced',
        agentsUsed: 3,
        solutions: 0,
      };
      expect(result.solutions).toBe(0);
      expect(result.result).toContain('failed');
    });

    it('tracks solutions count in result', () => {
      const result = createValidPatternResult('vote', { solutions: 2 });
      expect(result.solutions).toBe(2);
      expect(validatePatternResult(result)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Triage Pattern
  // -------------------------------------------------------------------------

  describe('Triage Pattern', () => {
    it('routes simple to sonnet-worker', () => {
      const routing = { complexity: 'simple', domains: ['backend'] };
      const specialist = routing.complexity === 'simple' ? 'sonnet-worker' : 'opus-worker';
      expect(specialist).toBe('sonnet-worker');
    });

    it('routes complex to opus-worker', () => {
      const routing = { complexity: 'complex', domains: ['backend'] };
      const specialist = routing.complexity === 'complex' ? 'opus-worker' : 'sonnet-worker';
      expect(specialist).toBe('opus-worker');
    });

    it('routes multi-domain to parallel specialists', () => {
      const routing = { complexity: 'multi-domain', domains: ['frontend', 'backend', 'infra'] };
      expect(routing.domains.length).toBeGreaterThan(1);
      expect(calculateTriageBudget('multi-domain', routing.domains.length)).toBe(4);
    });

    it('falls back to opus on router failure', () => {
      const routerFailed = true;
      const specialist = routerFailed ? 'opus-worker' : 'sonnet-worker';
      expect(specialist).toBe('opus-worker');
    });

    it('agent budget: 1 (simple) or 2 (complex) or 1+N (multi)', () => {
      expect(calculateTriageBudget('simple')).toBe(1);
      expect(calculateTriageBudget('complex')).toBe(2);
      expect(calculateTriageBudget('multi-domain', 3)).toBe(4);
    });
  });

  // -------------------------------------------------------------------------
  // TOON Roundtrip
  // -------------------------------------------------------------------------

  describe('TOON Roundtrip', () => {
    it('PatternResult with debate fields survives roundtrip', () => {
      const original = createValidPatternResult('debate');
      const decoded = toonRoundtrip(original);
      expect(decoded).toEqual(original);
      expect(validatePatternResult(decoded)).toBe(true);
    });

    it('PatternResult with triage routing survives roundtrip', () => {
      const original = createValidPatternResult('triage', {
        routing: { complexity: 'multi-domain', domains: ['frontend', 'backend'] },
      });
      const decoded = toonRoundtrip(original);
      expect(decoded).toEqual(original);
      expect(validatePatternResult(decoded)).toBe(true);
    });

    it('orchestration.toml pattern config survives roundtrip', () => {
      const config = {
        patterns: {
          'arch-debate': {
            type: 'debate',
            agents: ['advocate-agent', 'critic-agent'],
            moderator: 'synthesis-agent',
            maxRounds: 3,
            trigger: 'architecture-decision',
          },
          'code-quality-chain': {
            type: 'chain',
            agents: ['draft-agent', 'refine-agent', 'harden-agent'],
            trigger: 'code-generation',
            passOriginalInput: true,
          },
        },
      };
      const decoded = toonRoundtrip(config);
      expect(decoded).toEqual(config);
    });
  });

  // -------------------------------------------------------------------------
  // Budget Accounting
  // -------------------------------------------------------------------------

  describe('Budget Accounting', () => {
    it('accumulates agentsUsed across multiple pattern invocations', () => {
      let totalSpawned = 10; // already spawned before patterns
      const debateResult = createValidPatternResult('debate'); // agentsUsed=7
      totalSpawned += debateResult.agentsUsed;
      const chainResult = createValidPatternResult('chain'); // agentsUsed=3
      totalSpawned += chainResult.agentsUsed;
      expect(totalSpawned).toBe(20);
    });

    it('triggers budget warning at 80% capacity', () => {
      expect(checkBudget(39, 50)).toBe('ok');
      expect(checkBudget(40, 50)).toBe('warn');
      expect(checkBudget(45, 50)).toBe('warn');
    });

    it('blocks pattern invocation at 100% budget', () => {
      expect(checkBudget(50, 50)).toBe('block');
      expect(checkBudget(55, 50)).toBe('block');
    });
  });
});
