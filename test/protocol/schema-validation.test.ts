import { describe, it, expect, beforeAll } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { encode, decode } from '@toon-format/toon';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createValidAgentResult,
  createValidState,
  createValidWaveSummary,
  createValidManifest,
  createValidRequest,
} from './helpers/synthetic-data.js';

/**
 * TOON roundtrip helper: encode JS object to TOON, decode back, verify fidelity.
 * Returns the decoded object for further AJV validation.
 */
function toonRoundtrip<T>(data: T): T {
  const encoded = encode(data);
  const decoded = decode(encoded);
  return decoded as T;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadSchema(name: string): Record<string, unknown> {
  const path = resolve(__dirname, 'schemas', name);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

describe('Schema Validation', () => {
  let ajv: InstanceType<typeof Ajv2020>;
  let validateAgentResult: ReturnType<InstanceType<typeof Ajv2020>['compile']>;
  let validateState: ReturnType<InstanceType<typeof Ajv2020>['compile']>;
  let validateWaveSummary: ReturnType<InstanceType<typeof Ajv2020>['compile']>;
  let validateManifest: ReturnType<InstanceType<typeof Ajv2020>['compile']>;
  let validateCrossBoundary: ReturnType<InstanceType<typeof Ajv2020>['compile']>;

  beforeAll(() => {
    ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);

    // Add agent-result schema first so $ref can resolve it
    const agentResultSchema = loadSchema('agent-result.schema.json');
    ajv.addSchema(agentResultSchema);

    validateAgentResult = ajv.compile(agentResultSchema);
    validateState = ajv.compile(loadSchema('state.schema.json'));
    validateWaveSummary = ajv.compile(loadSchema('wave-summary.schema.json'));
    validateManifest = ajv.compile(loadSchema('manifest.schema.json'));
    validateCrossBoundary = ajv.compile(
      loadSchema('cross-boundary-request.schema.json'),
    );
  });

  // -----------------------------------------------------------------------
  // AgentResult
  // -----------------------------------------------------------------------

  describe('AgentResult', () => {
    it('validates a fully valid AgentResult', () => {
      const result = createValidAgentResult();
      const valid = validateAgentResult(result);
      if (!valid) {
        console.error('AgentResult errors:', validateAgentResult.errors);
      }
      expect(valid).toBe(true);
      expect(validateAgentResult.errors).toBeNull();
    });

    it('rejects AgentResult with missing required field (status)', () => {
      const result = createValidAgentResult();
      const { status, ...incomplete } = result;
      const valid = validateAgentResult(incomplete);
      expect(valid).toBe(false);
      expect(validateAgentResult.errors).toBeDefined();

      const mentionsStatus = validateAgentResult.errors!.some(
        (e) =>
          e.instancePath?.includes('status') ||
          e.params?.missingProperty === 'status' ||
          e.message?.includes('status'),
      );
      expect(mentionsStatus).toBe(true);
    });

    it('rejects AgentResult with invalid status enum value', () => {
      const result = createValidAgentResult({ status: 'unknown' as any });
      const valid = validateAgentResult(result);
      expect(valid).toBe(false);

      const hasEnumError = validateAgentResult.errors!.some(
        (e) =>
          e.keyword === 'enum' && e.instancePath?.includes('status'),
      );
      expect(hasEnumError).toBe(true);
    });

    it('rejects AgentResult with invalid severity enum value', () => {
      const result = createValidAgentResult({
        issues: [
          {
            severity: 'critical' as any,
            description: 'Something bad',
            file: 'src/foo.ts',
            line: 10,
          },
        ],
      });
      const valid = validateAgentResult(result);
      expect(valid).toBe(false);

      const hasSeverityError = validateAgentResult.errors!.some(
        (e) =>
          e.keyword === 'enum' &&
          (e.instancePath?.includes('severity') ||
            e.instancePath?.includes('issues')),
      );
      expect(hasSeverityError).toBe(true);
    });

    it('validates AgentResult with empty arrays', () => {
      const result = createValidAgentResult({
        filesCreated: [],
        filesModified: [],
        filesDeleted: [],
        exportsAdded: [],
        dependenciesAdded: [],
        issues: [],
        contractAmendments: [],
        crossBoundaryRequests: [],
      });
      const valid = validateAgentResult(result);
      if (!valid) {
        console.error('Empty arrays errors:', validateAgentResult.errors);
      }
      expect(valid).toBe(true);
      expect(validateAgentResult.errors).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // ExecutionState (state.toon)
  // -----------------------------------------------------------------------

  describe('State (TOON roundtrip)', () => {
    it('validates a state with 2 waves', () => {
      const state = createValidState(2);
      const valid = validateState(state);
      if (!valid) {
        console.error('State validation errors:', validateState.errors);
      }
      expect(valid).toBe(true);
    });

    it('rejects state with invalid wave status', () => {
      const state = createValidState(1);
      (state.waves['0'] as any).status = 'running';
      const valid = validateState(state);
      expect(valid).toBe(false);

      const hasStatusError = validateState.errors!.some(
        (e) =>
          e.keyword === 'enum' &&
          (e.instancePath?.includes('status') ||
            e.instancePath?.includes('waves')),
      );
      expect(hasStatusError).toBe(true);
    });

    it('rejects state with missing schemaVersion', () => {
      const state = createValidState(1);
      const { schemaVersion, ...incomplete } = state;
      const valid = validateState(incomplete);
      expect(valid).toBe(false);

      const mentionsSchemaVersion = validateState.errors!.some(
        (e) =>
          e.instancePath?.includes('schemaVersion') ||
          e.params?.missingProperty === 'schemaVersion' ||
          e.message?.includes('schemaVersion'),
      );
      expect(mentionsSchemaVersion).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // WaveSummary
  // -----------------------------------------------------------------------

  describe('WaveSummary', () => {
    it('validates a valid wave summary', () => {
      const results = [
        createValidAgentResult(),
        createValidAgentResult({
          agent: 'agent-db',
          wave: 0,
          taskId: 'task-create-user-table',
          status: 'success',
          filesCreated: ['src/db/schema.ts'],
          filesModified: ['src/db/index.ts'],
          filesDeleted: [],
          exportsAdded: [
            { name: 'UserTable', file: 'src/db/schema.ts', kind: 'const' },
          ],
          dependenciesAdded: [],
          integrationNotes: 'Run migrations before starting the server.',
          issues: [],
          contractAmendments: [],
          crossBoundaryRequests: [],
          durationMs: 21000,
        }),
      ];
      const summary = createValidWaveSummary(0, results);
      const valid = validateWaveSummary(summary);
      if (!valid) {
        console.error('WaveSummary errors:', validateWaveSummary.errors);
      }
      expect(valid).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Manifest
  // -----------------------------------------------------------------------

  describe('Manifest', () => {
    it('validates a valid manifest', () => {
      const manifest = createValidManifest();
      const valid = validateManifest(manifest);
      if (!valid) {
        console.error('Manifest errors:', validateManifest.errors);
      }
      expect(valid).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // CrossBoundaryRequest
  // -----------------------------------------------------------------------

  describe('CrossBoundaryRequest', () => {
    it('validates a valid cross-boundary request', () => {
      const req = createValidRequest();
      const valid = validateCrossBoundary(req);
      if (!valid) {
        console.error('CrossBoundary errors:', validateCrossBoundary.errors);
      }
      expect(valid).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // TOON Roundtrip Fidelity — encode→decode→validate for all schemas
  // -----------------------------------------------------------------------

  describe('TOON Roundtrip', () => {
    it('AgentResult survives TOON roundtrip and validates', () => {
      const original = createValidAgentResult();
      const roundtripped = toonRoundtrip(original);
      expect(roundtripped).toEqual(original);
      expect(validateAgentResult(roundtripped)).toBe(true);
    });

    it('ExecutionState survives TOON roundtrip and validates', () => {
      const original = createValidState(2);
      const roundtripped = toonRoundtrip(original);
      expect(roundtripped).toEqual(original);
      expect(validateState(roundtripped)).toBe(true);
    });

    it('WaveSummary survives TOON roundtrip and validates', () => {
      const results = [createValidAgentResult()];
      const original = createValidWaveSummary(0, results);
      const roundtripped = toonRoundtrip(original);
      expect(roundtripped).toEqual(original);
      expect(validateWaveSummary(roundtripped)).toBe(true);
    });

    it('Manifest survives TOON roundtrip and validates', () => {
      const original = createValidManifest();
      const roundtripped = toonRoundtrip(original);
      expect(roundtripped).toEqual(original);
      expect(validateManifest(roundtripped)).toBe(true);
    });

    it('CrossBoundaryRequest survives TOON roundtrip and validates', () => {
      const original = createValidRequest();
      const roundtripped = toonRoundtrip(original);
      expect(roundtripped).toEqual(original);
      expect(validateCrossBoundary(roundtripped)).toBe(true);
    });

    it('AgentResult with empty arrays survives roundtrip', () => {
      const original = createValidAgentResult({
        filesCreated: [],
        filesModified: [],
        filesDeleted: [],
        exportsAdded: [],
        dependenciesAdded: [],
        issues: [],
        contractAmendments: [],
        crossBoundaryRequests: [],
      });
      const roundtripped = toonRoundtrip(original);
      expect(roundtripped).toEqual(original);
      expect(validateAgentResult(roundtripped)).toBe(true);
    });
  });
});
