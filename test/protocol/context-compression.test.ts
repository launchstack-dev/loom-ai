/**
 * Tests for tiered context compression.
 *
 * The meta-orchestration protocol uses a HOT / WARM / COLD tiering model
 * so that rolling context stays under ~10 000 tokens regardless of how
 * many waves have completed.
 */

import { describe, it, expect } from 'vitest';
import {
  createValidAgentResult,
  createValidWaveSummary,
} from './helpers/synthetic-data.js';
import type { WaveSummary, AgentResultExport } from './helpers/types.js';

// ---------------------------------------------------------------------------
// Compression utilities (inline — production code would live elsewhere)
// ---------------------------------------------------------------------------

function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).length * 1.3);
}

/**
 * Generate a detailed HOT summary (~3-5k tokens).
 * Includes every file changed, every export added, and full integration notes.
 */
function generateHotSummary(
  wave: number,
  filesChanged: string[],
  exports: AgentResultExport[],
  notes: string[],
): string {
  const lines: string[] = [];
  lines.push(`=== Wave ${wave} — Detailed Summary ===`);
  lines.push('');
  lines.push('## Files Changed');
  for (const f of filesChanged) {
    lines.push(`  - ${f}`);
  }
  lines.push('');
  lines.push('## Exports Added');
  for (const e of exports) {
    lines.push(`  - ${e.name} (${e.kind ?? (e as any).type ?? 'unknown'}) from ${e.file}`);
  }
  lines.push('');
  lines.push('## Integration Notes');
  for (const n of notes) {
    lines.push(n);
    lines.push('');
  }
  // Pad to ensure the summary is realistically sized
  lines.push('## Verification');
  lines.push(
    'All type-checks passed. Integration tests cover the new auth middleware flow, ' +
    'token refresh sliding window, and protected route gating. The JWT_SECRET env var ' +
    'must be set in CI before running the auth test suite. Database migrations have been ' +
    'generated but not yet applied to staging. Schema validation confirms all agent results ' +
    'conform to agent-result.schema.json v1.0.0.',
  );
  return lines.join('\n');
}

/**
 * Compress a HOT summary down to WARM (~500-1000 tokens).
 * Keeps key decisions and interface changes, drops file-level detail.
 */
function compressToWarm(hotSummary: string): string {
  const lines = hotSummary.split('\n');
  const warm: string[] = [];
  let inNotes = false;
  let inExports = false;

  for (const line of lines) {
    if (line.startsWith('=== Wave')) {
      warm.push(line.replace('Detailed Summary', 'Key Decisions'));
      continue;
    }
    if (line.startsWith('## Integration Notes')) {
      inNotes = true;
      inExports = false;
      warm.push('## Key Decisions');
      continue;
    }
    if (line.startsWith('## Exports Added')) {
      inExports = true;
      inNotes = false;
      warm.push('## Interface Changes');
      continue;
    }
    if (line.startsWith('## Files Changed') || line.startsWith('## Verification')) {
      inNotes = false;
      inExports = false;
      continue; // skip file lists and verification detail
    }
    if (inNotes || inExports) {
      warm.push(line);
    }
  }
  return warm.join('\n');
}

/**
 * Compress a WARM summary down to COLD (~50-100 tokens).
 * Single-line executive summary.
 */
function compressToCold(warmSummary: string): string {
  // Extract the wave number and summarise in one line
  const waveMatch = warmSummary.match(/Wave (\d+)/);
  const waveNum = waveMatch ? waveMatch[1] : '?';

  // Count interface changes mentioned
  const interfaceChanges = (warmSummary.match(/^\s+-\s/gm) || []).length;

  return `Wave ${waveNum}: ${interfaceChanges} interface changes, decisions captured.`;
}

interface ContextTier {
  wave: number;
  tier: 'HOT' | 'WARM' | 'COLD';
  content: string;
}

/**
 * Generate full rolling context for N waves.
 * - Most recent wave → HOT
 * - Previous 1-3 waves → WARM
 * - Everything older → COLD
 */
function generateRollingContext(waveCount: number): ContextTier[] {
  const tiers: ContextTier[] = [];

  for (let i = 0; i < waveCount; i++) {
    // Build realistic wave data
    const agents = [
      createValidAgentResult({
        agent: `agent-wave${i}-a`,
        filesCreated: [
          `src/wave${i}/handler.ts`,
          `src/wave${i}/types.ts`,
          `src/wave${i}/utils.ts`,
          `src/wave${i}/index.ts`,
          `src/wave${i}/constants.ts`,
        ],
        filesModified: [
          `src/server.ts`,
          `src/routes/index.ts`,
          `src/config.ts`,
          `src/shared/types.ts`,
          `src/wave${i}/README.md`,
        ],
        integrationNotes:
          `Wave ${i} agent A implemented the primary handler logic for the wave${i} module. ` +
          `The handler reads configuration from src/config.ts and registers routes via the ` +
          `central router in src/routes/index.ts. All types are co-located in src/wave${i}/types.ts ` +
          `and re-exported from src/wave${i}/index.ts for downstream consumers.`,
      }),
      createValidAgentResult({
        agent: `agent-wave${i}-b`,
        filesCreated: [
          `src/wave${i}/middleware.ts`,
          `src/wave${i}/validation.ts`,
          `src/wave${i}/__tests__/handler.test.ts`,
        ],
        filesModified: [`src/middleware/index.ts`, `src/wave${i}/handler.ts`],
        integrationNotes:
          `Wave ${i} agent B added request validation middleware and unit tests. ` +
          `Validation schemas use zod and are exported for reuse. The middleware must be ` +
          `registered before the handler in the route chain.`,
      }),
    ];

    const summary = createValidWaveSummary(i, agents);
    const filesChanged = [
      ...agents[0].filesCreated,
      ...agents[0].filesModified,
      ...agents[1].filesCreated,
      ...agents[1].filesModified,
    ];
    const exports = agents.flatMap((a) => a.exportsAdded);
    const notes = agents.map((a) => a.integrationNotes);

    const hot = generateHotSummary(i, filesChanged, exports as any, notes);

    if (i === waveCount - 1) {
      tiers.push({ wave: i, tier: 'HOT', content: hot });
    } else if (i >= waveCount - 4) {
      tiers.push({ wave: i, tier: 'WARM', content: compressToWarm(hot) });
    } else {
      tiers.push({ wave: i, tier: 'COLD', content: compressToCold(compressToWarm(hot)) });
    }
  }

  return tiers;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('context-compression', () => {
  it('single wave (HOT only) is under 10k tokens', () => {
    const tiers = generateRollingContext(1);
    expect(tiers).toHaveLength(1);
    expect(tiers[0].tier).toBe('HOT');

    const totalTokens = tiers.reduce((sum, t) => sum + estimateTokens(t.content), 0);
    expect(totalTokens).toBeLessThan(10_000);
  });

  it('5 waves (1 HOT, 3 WARM, 1 COLD) stays under 10k tokens', () => {
    const tiers = generateRollingContext(5);
    expect(tiers).toHaveLength(5);

    const hot = tiers.filter((t) => t.tier === 'HOT');
    const warm = tiers.filter((t) => t.tier === 'WARM');
    const cold = tiers.filter((t) => t.tier === 'COLD');

    expect(hot).toHaveLength(1);
    expect(warm).toHaveLength(3);
    expect(cold).toHaveLength(1);

    const totalTokens = tiers.reduce((sum, t) => sum + estimateTokens(t.content), 0);
    expect(totalTokens).toBeLessThan(10_000);
  });

  it('10 waves stays under 10k tokens', () => {
    const tiers = generateRollingContext(10);
    expect(tiers).toHaveLength(10);

    const totalTokens = tiers.reduce((sum, t) => sum + estimateTokens(t.content), 0);
    expect(totalTokens).toBeLessThan(10_000);
  });

  it('20 waves stays under 10k tokens', () => {
    const tiers = generateRollingContext(20);
    expect(tiers).toHaveLength(20);

    const totalTokens = tiers.reduce((sum, t) => sum + estimateTokens(t.content), 0);
    expect(totalTokens).toBeLessThan(10_000);
  });

  it('HOT tier contains file lists and integration notes', () => {
    const tiers = generateRollingContext(3);
    const hot = tiers.find((t) => t.tier === 'HOT')!;

    expect(hot.content).toContain('## Files Changed');
    expect(hot.content).toContain('## Integration Notes');
    expect(hot.content).toContain('## Exports Added');
    // Should list actual file paths
    expect(hot.content).toMatch(/src\/wave\d+\/handler\.ts/);
  });

  it('WARM tier entries are each under 1000 tokens', () => {
    const tiers = generateRollingContext(10);
    const warm = tiers.filter((t) => t.tier === 'WARM');

    expect(warm.length).toBeGreaterThan(0);
    for (const entry of warm) {
      const tokens = estimateTokens(entry.content);
      expect(tokens).toBeLessThan(1000);
    }
  });

  it('COLD tier entries are each under 100 tokens', () => {
    const tiers = generateRollingContext(10);
    const cold = tiers.filter((t) => t.tier === 'COLD');

    expect(cold.length).toBeGreaterThan(0);
    for (const entry of cold) {
      const tokens = estimateTokens(entry.content);
      expect(tokens).toBeLessThan(100);
    }
  });

  it('compression reduces size: HOT > WARM > COLD', () => {
    const agents = [
      createValidAgentResult({
        agent: 'agent-sizing-a',
        filesCreated: [
          'src/sizing/handler.ts',
          'src/sizing/types.ts',
          'src/sizing/utils.ts',
          'src/sizing/index.ts',
          'src/sizing/constants.ts',
          'src/sizing/validation.ts',
          'src/sizing/middleware.ts',
        ],
        filesModified: [
          'src/server.ts',
          'src/routes/index.ts',
          'src/config.ts',
        ],
        integrationNotes:
          'Agent A built the full sizing module including request validation, ' +
          'type-safe handlers, and shared utility functions. The module registers ' +
          'itself via the central router and reads runtime config from environment ' +
          'variables. All public types are re-exported from the barrel index.',
      }),
    ];

    const filesChanged = [...agents[0].filesCreated, ...agents[0].filesModified];
    const exports = agents[0].exportsAdded;
    const notes = [agents[0].integrationNotes];

    const hot = generateHotSummary(0, filesChanged, exports, notes);
    const warm = compressToWarm(hot);
    const cold = compressToCold(warm);

    const hotTokens = estimateTokens(hot);
    const warmTokens = estimateTokens(warm);
    const coldTokens = estimateTokens(cold);

    expect(hotTokens).toBeGreaterThan(warmTokens);
    expect(warmTokens).toBeGreaterThan(coldTokens);
  });
});
