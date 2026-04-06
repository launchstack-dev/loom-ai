/**
 * Tests for the JSONL feedback logger.
 *
 * The orchestrator logs every agent run as a single JSON line in a .jsonl
 * file.  These tests verify append-only semantics, format correctness,
 * and derived-metrics computation.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { TestRunEntry, DerivedMetrics } from './helpers/types.js';

// ---------------------------------------------------------------------------
// Feedback logger utilities (inline)
// ---------------------------------------------------------------------------

/**
 * Append a single TestRunEntry as a JSON line to the given file.
 */
function logTestResult(filepath: string, entry: TestRunEntry): void {
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(filepath, line, 'utf-8');
}

/**
 * Read all entries from a JSONL file.
 */
function readTestResults(filepath: string): TestRunEntry[] {
  const content = fs.readFileSync(filepath, 'utf-8').trim();
  if (!content) return [];
  return content.split('\n').map((line) => JSON.parse(line));
}

/**
 * Compute aggregate metrics from a set of test run entries.
 */
function computeMetrics(entries: TestRunEntry[]): DerivedMetrics {
  const total = entries.length;
  if (total === 0) {
    return {
      schema_compliance_rate: 0,
      boundary_violation_rate: 0,
      first_pass_verification_rate: 0,
      cost_per_wave_usd: 0,
      total_runs: 0,
    };
  }

  const schemaValid = entries.filter((e) => e.schema_valid).length;
  const boundaryViolations = entries.reduce(
    (sum, e) => sum + e.boundary_violations,
    0,
  );
  const firstPassOk = entries.filter(
    (e) => e.schema_valid && e.typecheck_pass && e.boundary_violations === 0,
  ).length;
  const totalCost = entries.reduce((sum, e) => sum + e.cost_usd, 0);

  return {
    schema_compliance_rate: schemaValid / total,
    boundary_violation_rate: boundaryViolations / total,
    first_pass_verification_rate: firstPassOk / total,
    cost_per_wave_usd: totalCost / total,
    total_runs: total,
  };
}

// ---------------------------------------------------------------------------
// Test-data factory
// ---------------------------------------------------------------------------

function makeEntry(overrides?: Partial<TestRunEntry>): TestRunEntry {
  return {
    timestamp: new Date().toISOString(),
    git_sha: 'abc1234def5678',
    agent: 'agent-auth',
    model: 'claude-sonnet-4-20250514',
    duration_ms: 12000,
    status: 'succeeded',
    token_input: 8500,
    token_output: 3200,
    cost_usd: 0.042,
    files_created: 3,
    files_modified: 2,
    schema_valid: true,
    boundary_violations: 0,
    typecheck_pass: true,
    rolling_context_tokens: 4200,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Temp-file helpers
// ---------------------------------------------------------------------------

const tmpFiles: string[] = [];

function makeTmpFile(): string {
  const filepath = path.join(
    os.tmpdir(),
    `feedback-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`,
  );
  tmpFiles.push(filepath);
  return filepath;
}

afterEach(() => {
  for (const f of tmpFiles) {
    try {
      fs.unlinkSync(f);
    } catch {
      // best-effort
    }
  }
  tmpFiles.length = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('feedback-logger', () => {
  it('logged entry contains all required fields', () => {
    const filepath = makeTmpFile();
    const entry = makeEntry();
    logTestResult(filepath, entry);

    const results = readTestResults(filepath);
    expect(results).toHaveLength(1);

    const logged = results[0];
    const requiredKeys: (keyof TestRunEntry)[] = [
      'timestamp',
      'git_sha',
      'agent',
      'model',
      'duration_ms',
      'status',
      'token_input',
      'token_output',
      'cost_usd',
      'files_created',
      'files_modified',
      'schema_valid',
      'boundary_violations',
      'typecheck_pass',
      'rolling_context_tokens',
    ];

    for (const key of requiredKeys) {
      expect(logged).toHaveProperty(key);
    }
  });

  it('JSONL format valid — each line is independent JSON', () => {
    const filepath = makeTmpFile();

    for (let i = 0; i < 5; i++) {
      logTestResult(
        filepath,
        makeEntry({
          agent: `agent-${i}`,
          duration_ms: 10000 + i * 1000,
          cost_usd: 0.03 + i * 0.01,
        }),
      );
    }

    const raw = fs.readFileSync(filepath, 'utf-8').trim();
    const lines = raw.split('\n');
    expect(lines).toHaveLength(5);

    for (const line of lines) {
      // Each line must parse independently as valid JSON
      const parsed = JSON.parse(line);
      expect(parsed).toBeDefined();
      expect(typeof parsed.agent).toBe('string');
      expect(typeof parsed.duration_ms).toBe('number');
    }
  });

  it('append-only — writing in two calls preserves all entries', () => {
    const filepath = makeTmpFile();

    // First batch
    logTestResult(filepath, makeEntry({ agent: 'agent-alpha' }));
    logTestResult(filepath, makeEntry({ agent: 'agent-beta' }));

    // Second batch (separate call context)
    logTestResult(filepath, makeEntry({ agent: 'agent-gamma' }));

    const results = readTestResults(filepath);
    expect(results).toHaveLength(3);
    expect(results[0].agent).toBe('agent-alpha');
    expect(results[1].agent).toBe('agent-beta');
    expect(results[2].agent).toBe('agent-gamma');
  });

  it('derived metrics compute correctly from known values', () => {
    const entries: TestRunEntry[] = [];

    // 7 fully passing entries
    for (let i = 0; i < 7; i++) {
      entries.push(
        makeEntry({
          schema_valid: true,
          boundary_violations: 0,
          typecheck_pass: true,
          cost_usd: 0.05,
        }),
      );
    }

    // 2 entries with schema violations
    entries.push(
      makeEntry({
        schema_valid: false,
        boundary_violations: 1,
        typecheck_pass: true,
        cost_usd: 0.05,
      }),
    );
    entries.push(
      makeEntry({
        schema_valid: false,
        boundary_violations: 2,
        typecheck_pass: false,
        cost_usd: 0.05,
      }),
    );

    // 1 entry with typecheck failure but valid schema
    entries.push(
      makeEntry({
        schema_valid: true,
        boundary_violations: 0,
        typecheck_pass: false,
        cost_usd: 0.05,
      }),
    );

    expect(entries).toHaveLength(10);

    const metrics = computeMetrics(entries);

    // total_runs
    expect(metrics.total_runs).toBe(10);

    // schema_compliance_rate: 8 out of 10 have schema_valid = true
    expect(metrics.schema_compliance_rate).toBeCloseTo(0.8, 5);

    // boundary_violation_rate: total violations = 0*7 + 1 + 2 + 0 = 3, avg = 3/10
    expect(metrics.boundary_violation_rate).toBeCloseTo(0.3, 5);

    // first_pass_verification_rate: schema_valid AND typecheck_pass AND 0 violations
    // That's the 7 fully passing entries → 7/10
    expect(metrics.first_pass_verification_rate).toBeCloseTo(0.7, 5);

    // cost_per_wave_usd: all entries cost 0.05 → avg = 0.05
    expect(metrics.cost_per_wave_usd).toBeCloseTo(0.05, 5);
  });
});
