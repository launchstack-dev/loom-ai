/**
 * Tests for file ownership conflict detection.
 *
 * The orchestrator must detect when two agents touch the same file or when
 * one agent modifies a file inside another agent's owned directory.
 */

import { describe, it, expect } from 'vitest';
import { createValidAgentResult } from './helpers/synthetic-data.js';
import type { AgentResult, Conflict } from './helpers/types.js';

// ---------------------------------------------------------------------------
// Conflict detection utility (inline)
// ---------------------------------------------------------------------------

/**
 * Detect file-level and directory-level ownership conflicts across agent
 * results.  Files inside `.plan-execution/requests/` are excluded because
 * cross-boundary request files are shared by design.
 */
function detectConflicts(results: AgentResult[]): Conflict[] {
  const REQUEST_DIR = '.plan-execution/requests/';
  const conflicts: Conflict[] = [];
  const seen = new Map<string, { agents: Set<string>; type: Conflict['type'] }>();

  // Collect every file each agent touches
  for (const result of results) {
    const created = result.filesCreated ?? [];
    const modified = result.filesModified ?? [];

    for (const file of created) {
      if (file.startsWith(REQUEST_DIR)) continue;
      if (!seen.has(file)) {
        seen.set(file, { agents: new Set(), type: 'created' });
      }
      seen.get(file)!.agents.add(result.agent);
    }

    for (const file of modified) {
      if (file.startsWith(REQUEST_DIR)) continue;
      const entry = seen.get(file);
      if (entry) {
        entry.agents.add(result.agent);
        // If one agent created and another modified, keep 'created' type
      } else {
        seen.set(file, { agents: new Set([result.agent]), type: 'modified' });
      }
    }
  }

  // Direct file conflicts
  for (const [file, entry] of seen) {
    if (entry.agents.size > 1) {
      conflicts.push({
        file,
        agents: Array.from(entry.agents),
        type: entry.type,
      });
    }
  }

  // Directory-level conflicts:
  // For each agent, derive the set of "owned directories" from filesCreated.
  // If another agent modifies a file inside that directory, flag it.
  const ownershipDirs = new Map<string, string>(); // dir -> owning agent
  for (const result of results) {
    const dirs = new Set<string>();
    for (const file of result.filesCreated ?? []) {
      if (file.startsWith(REQUEST_DIR)) continue;
      const parts = file.split('/');
      if (parts.length > 1) {
        // Use the deepest directory containing created files
        dirs.add(parts.slice(0, -1).join('/') + '/');
      }
    }
    for (const dir of dirs) {
      // Only set ownership if not already claimed (first-come)
      if (!ownershipDirs.has(dir)) {
        ownershipDirs.set(dir, result.agent);
      }
    }
  }

  for (const result of results) {
    for (const file of result.filesModified ?? []) {
      if (file.startsWith(REQUEST_DIR)) continue;
      for (const [dir, owner] of ownershipDirs) {
        if (file.startsWith(dir) && owner !== result.agent) {
          // Check we haven't already flagged this as a direct conflict
          const alreadyFlagged = conflicts.some((c) => c.file === file);
          if (!alreadyFlagged) {
            conflicts.push({
              file,
              agents: [owner, result.agent],
              type: 'directory',
            });
          }
        }
      }
    }
  }

  return conflicts;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ownership-detection', () => {
  it('returns empty array when two results have non-overlapping files', () => {
    const resultA = createValidAgentResult({
      agent: 'agent-auth',
      filesCreated: ['src/auth/middleware.ts', 'src/auth/token.ts'],
      filesModified: ['src/auth/index.ts'],
    });
    const resultB = createValidAgentResult({
      agent: 'agent-db',
      filesCreated: ['src/db/connection.ts', 'src/db/queries.ts'],
      filesModified: ['src/db/index.ts'],
    });

    const conflicts = detectConflicts([resultA, resultB]);
    expect(conflicts).toEqual([]);
  });

  it('detects direct conflict when two agents modify the same file', () => {
    const resultA = createValidAgentResult({
      agent: 'agent-auth',
      filesCreated: ['src/auth/middleware.ts'],
      filesModified: ['src/types.ts'],
    });
    const resultB = createValidAgentResult({
      agent: 'agent-db',
      filesCreated: ['src/db/connection.ts'],
      filesModified: ['src/types.ts'],
    });

    const conflicts = detectConflicts([resultA, resultB]);
    expect(conflicts.length).toBeGreaterThanOrEqual(1);

    const typesConflict = conflicts.find((c) => c.file === 'src/types.ts');
    expect(typesConflict).toBeDefined();
    expect(typesConflict!.agents).toContain('agent-auth');
    expect(typesConflict!.agents).toContain('agent-db');
  });

  it('detects conflict when agent A creates and agent B modifies the same file', () => {
    const resultA = createValidAgentResult({
      agent: 'agent-auth',
      filesCreated: ['src/shared/utils.ts'],
      filesModified: [],
    });
    const resultB = createValidAgentResult({
      agent: 'agent-api',
      filesCreated: [],
      filesModified: ['src/shared/utils.ts'],
    });

    const conflicts = detectConflicts([resultA, resultB]);
    expect(conflicts.length).toBeGreaterThanOrEqual(1);

    const utilsConflict = conflicts.find((c) => c.file === 'src/shared/utils.ts');
    expect(utilsConflict).toBeDefined();
    expect(utilsConflict!.agents).toContain('agent-auth');
    expect(utilsConflict!.agents).toContain('agent-api');
  });

  it('detects directory-level conflict when agent B modifies file in agent A owned directory', () => {
    const resultA = createValidAgentResult({
      agent: 'agent-auth',
      filesCreated: [
        'src/auth/middleware.ts',
        'src/auth/token.ts',
        'src/auth/types.ts',
      ],
      filesModified: [],
    });
    const resultB = createValidAgentResult({
      agent: 'agent-api',
      filesCreated: ['src/api/routes.ts'],
      filesModified: ['src/auth/middleware.ts'],
    });

    const conflicts = detectConflicts([resultA, resultB]);
    expect(conflicts.length).toBeGreaterThanOrEqual(1);

    const dirConflict = conflicts.find(
      (c) => c.file === 'src/auth/middleware.ts',
    );
    expect(dirConflict).toBeDefined();
    expect(dirConflict!.agents).toContain('agent-auth');
    expect(dirConflict!.agents).toContain('agent-api');
  });

  it('does not produce false positives for agents in different directories', () => {
    const resultA = createValidAgentResult({
      agent: 'agent-auth',
      filesCreated: ['src/auth/middleware.ts', 'src/auth/token.ts'],
      filesModified: ['src/auth/index.ts'],
    });
    const resultB = createValidAgentResult({
      agent: 'agent-payments',
      filesCreated: ['src/payments/stripe.ts', 'src/payments/types.ts'],
      filesModified: ['src/payments/index.ts'],
    });

    const conflicts = detectConflicts([resultA, resultB]);
    expect(conflicts).toHaveLength(0);
  });

  it('excludes cross-boundary request files from conflict detection', () => {
    const resultA = createValidAgentResult({
      agent: 'agent-auth',
      filesCreated: [
        '.plan-execution/requests/task-auth-001.json',
        'src/auth/middleware.ts',
      ],
      filesModified: [],
    });
    const resultB = createValidAgentResult({
      agent: 'agent-db',
      filesCreated: [
        '.plan-execution/requests/task-db-001.json',
      ],
      filesModified: ['.plan-execution/requests/task-auth-001.json'],
    });

    const conflicts = detectConflicts([resultA, resultB]);

    // No conflict should be flagged for files under .plan-execution/requests/
    const requestConflicts = conflicts.filter((c) =>
      c.file.startsWith('.plan-execution/requests/'),
    );
    expect(requestConflicts).toHaveLength(0);
  });
});
