import { describe, it, expect } from 'vitest';
import { encode, decode } from '@toon-format/toon';

import type {
  LibraryInstallState,
  LibraryInstallItem,
  LibraryCatalog,
  LibraryCatalogEntry,
} from './helpers/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createValidInstallState(items?: LibraryInstallItem[]): LibraryInstallState {
  return {
    schemaVersion: 1,
    lastSynced: '2026-04-06T10:00:00Z',
    items: items ?? [
      {
        name: 'contracts-agent',
        type: 'agent',
        source: '/path/to/agents/contracts-agent.md',
        targetPath: '~/.claude/agents/contracts-agent.md',
        installedAt: '2026-04-06T10:00:00Z',
        contentHash: 'sha256:abc123def456',
      },
      {
        name: 'execution-protocols',
        type: 'skill',
        source: '/path/to/agents/protocols/execution-conventions.md',
        targetPath: '~/.claude/agents/protocols/execution-conventions.md',
        installedAt: '2026-04-06T09:55:00Z',
        contentHash: 'sha256:789ghi012jkl',
      },
    ],
  };
}

function createValidCatalog(): LibraryCatalog {
  return {
    skills: [
      { name: 'execution-protocols', description: 'Protocol schemas', source: '/path/to/source.md' },
    ],
    agents: [
      { name: 'contracts-agent', description: 'Wave 0 specialist', source: '/path/to/source.md', requires: ['skill:execution-protocols'] },
      { name: 'implementer-agent', description: 'Parallel worker', source: '/path/to/source.md', requires: ['skill:execution-protocols'] },
      { name: 'wiring-agent', description: 'Post-wave integration', source: '/path/to/source.md', requires: ['skill:execution-protocols'] },
      { name: 'plan-builder-agent', description: 'Creates PLAN.md', source: '/path/to/source.md' },
    ],
    prompts: [
      { name: 'execute-plan', description: 'Wave execution', source: '/path/to/source.md', requires: ['agent:contracts-agent', 'agent:implementer-agent', 'agent:wiring-agent'] },
      { name: 'roadmap', description: 'Plan management', source: '/path/to/source.md', requires: ['agent:plan-builder-agent'] },
    ],
  };
}

// Dependency resolution
function resolveDependencies(
  itemName: string,
  catalog: LibraryCatalog,
  installed: Set<string>,
  installing: Set<string> = new Set(),
): { order: string[]; circular: string[] } {
  if (installed.has(itemName)) return { order: [], circular: [] };
  if (installing.has(itemName)) return { order: [], circular: [itemName] };

  installing.add(itemName);

  // Find the item in catalog
  const allItems = [...catalog.skills, ...catalog.agents, ...catalog.prompts];
  const item = allItems.find((i) => i.name === itemName);
  if (!item) return { order: [itemName], circular: [] };

  const order: string[] = [];
  const circular: string[] = [];

  for (const dep of item.requires ?? []) {
    const depName = dep.split(':')[1]; // "agent:foo" → "foo"
    const result = resolveDependencies(depName, catalog, installed, new Set(installing));
    order.push(...result.order);
    circular.push(...result.circular);
  }

  if (circular.length === 0) {
    order.push(itemName);
  }

  installing.delete(itemName);
  return { order, circular };
}

// Hash change detection
function detectChanges(
  state: LibraryInstallState,
  currentHashes: Record<string, string>,
): { changed: string[]; missing: string[]; upToDate: string[] } {
  const changed: string[] = [];
  const missing: string[] = [];
  const upToDate: string[] = [];

  for (const item of state.items) {
    const currentHash = currentHashes[item.name];
    if (currentHash === undefined) {
      missing.push(item.name);
    } else if (currentHash !== item.contentHash) {
      changed.push(item.name);
    } else {
      upToDate.push(item.name);
    }
  }

  return { changed, missing, upToDate };
}

// Find dependents (reverse dependency lookup)
function findDependents(
  itemName: string,
  catalog: LibraryCatalog,
  installed: Set<string>,
): string[] {
  const allItems = [...catalog.skills, ...catalog.agents, ...catalog.prompts];
  return allItems
    .filter((item) => installed.has(item.name))
    .filter((item) => (item.requires ?? []).some((dep) => dep.split(':')[1] === itemName))
    .map((item) => item.name);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Library Catalog — Install State', () => {
  it('creates a valid install state', () => {
    const state = createValidInstallState();
    expect(state.schemaVersion).toBe(1);
    expect(state.items).toHaveLength(2);
    expect(state.items[0].type).toBe('agent');
  });

  it('handles empty install state', () => {
    const state = createValidInstallState([]);
    expect(state.items).toHaveLength(0);
  });

  it('install state survives TOON roundtrip', () => {
    const original = createValidInstallState();
    const encoded = encode(original);
    const decoded = decode(encoded) as LibraryInstallState;
    expect(decoded).toEqual(original);
  });

  it('empty install state survives TOON roundtrip', () => {
    const original = createValidInstallState([]);
    const encoded = encode(original);
    const decoded = decode(encoded) as LibraryInstallState;
    expect(decoded).toEqual(original);
  });
});

describe('Library Catalog — Dependency Resolution', () => {
  it('resolves simple dependency chain', () => {
    const catalog = createValidCatalog();
    const installed = new Set<string>();

    const result = resolveDependencies('contracts-agent', catalog, installed);
    expect(result.circular).toHaveLength(0);
    expect(result.order).toContain('execution-protocols');
    expect(result.order).toContain('contracts-agent');
    // Dependency comes before dependent
    expect(result.order.indexOf('execution-protocols'))
      .toBeLessThan(result.order.indexOf('contracts-agent'));
  });

  it('skips already installed dependencies', () => {
    const catalog = createValidCatalog();
    const installed = new Set(['execution-protocols']);

    const result = resolveDependencies('contracts-agent', catalog, installed);
    expect(result.order).not.toContain('execution-protocols');
    expect(result.order).toContain('contracts-agent');
  });

  it('resolves deep dependency chain', () => {
    const catalog = createValidCatalog();
    const installed = new Set<string>();

    // execute-plan → contracts-agent → execution-protocols
    const result = resolveDependencies('execute-plan', catalog, installed);
    expect(result.circular).toHaveLength(0);
    expect(result.order.indexOf('execution-protocols'))
      .toBeLessThan(result.order.indexOf('contracts-agent'));
    expect(result.order.indexOf('contracts-agent'))
      .toBeLessThan(result.order.indexOf('execute-plan'));
  });

  it('detects circular dependencies', () => {
    const catalog: LibraryCatalog = {
      skills: [],
      agents: [
        { name: 'agent-a', description: 'A', source: '/a.md', requires: ['agent:agent-b'] },
        { name: 'agent-b', description: 'B', source: '/b.md', requires: ['agent:agent-a'] },
      ],
      prompts: [],
    };

    const result = resolveDependencies('agent-a', catalog, new Set());
    expect(result.circular.length).toBeGreaterThan(0);
  });

  it('handles item with no dependencies', () => {
    const catalog = createValidCatalog();
    const installed = new Set<string>();

    const result = resolveDependencies('plan-builder-agent', catalog, installed);
    expect(result.circular).toHaveLength(0);
    expect(result.order).toEqual(['plan-builder-agent']);
  });

  it('handles item not found in catalog', () => {
    const catalog = createValidCatalog();
    const result = resolveDependencies('nonexistent', catalog, new Set());
    expect(result.order).toEqual(['nonexistent']);
    expect(result.circular).toHaveLength(0);
  });

  it('documents ambiguity: missing items are indistinguishable from resolved items', () => {
    const catalog = createValidCatalog();
    const resultMissing = resolveDependencies('nonexistent', catalog, new Set());
    const resultReal = resolveDependencies('plan-builder-agent', catalog, new Set());

    // Both return { order: [name], circular: [] } — the caller cannot tell
    // whether 'nonexistent' was found in the catalog or not.
    // This is a known limitation: the library.md command must separately
    // verify that each item in the resolved order exists in the catalog
    // before attempting installation.
    expect(resultMissing.order).toEqual(['nonexistent']);
    expect(resultMissing.circular).toEqual([]);
    expect(resultReal.order).toEqual(['plan-builder-agent']);
    expect(resultReal.circular).toEqual([]);
  });
});

describe('Library Catalog — Change Detection', () => {
  it('detects changed content hashes', () => {
    const state = createValidInstallState();
    const currentHashes: Record<string, string> = {
      'contracts-agent': 'sha256:DIFFERENT',
      'execution-protocols': 'sha256:789ghi012jkl',
    };

    const result = detectChanges(state, currentHashes);
    expect(result.changed).toEqual(['contracts-agent']);
    expect(result.upToDate).toEqual(['execution-protocols']);
    expect(result.missing).toHaveLength(0);
  });

  it('detects missing sources', () => {
    const state = createValidInstallState();
    const currentHashes: Record<string, string> = {
      'contracts-agent': 'sha256:abc123def456',
      // execution-protocols missing
    };

    const result = detectChanges(state, currentHashes);
    expect(result.missing).toEqual(['execution-protocols']);
    expect(result.upToDate).toEqual(['contracts-agent']);
  });

  it('reports all up-to-date when nothing changed', () => {
    const state = createValidInstallState();
    const currentHashes: Record<string, string> = {
      'contracts-agent': 'sha256:abc123def456',
      'execution-protocols': 'sha256:789ghi012jkl',
    };

    const result = detectChanges(state, currentHashes);
    expect(result.changed).toHaveLength(0);
    expect(result.missing).toHaveLength(0);
    expect(result.upToDate).toHaveLength(2);
  });
});

describe('Library Catalog — Reverse Dependencies', () => {
  it('finds dependents of a skill', () => {
    const catalog = createValidCatalog();
    const installed = new Set(['contracts-agent', 'implementer-agent', 'wiring-agent', 'execution-protocols']);

    const dependents = findDependents('execution-protocols', catalog, installed);
    expect(dependents).toContain('contracts-agent');
    expect(dependents).toContain('implementer-agent');
    expect(dependents).toContain('wiring-agent');
  });

  it('returns empty for item with no dependents', () => {
    const catalog = createValidCatalog();
    const installed = new Set(['plan-builder-agent']);

    const dependents = findDependents('plan-builder-agent', catalog, installed);
    expect(dependents).toHaveLength(0);
  });

  it('only includes installed items as dependents', () => {
    const catalog = createValidCatalog();
    // Only contracts-agent installed, not implementer or wiring
    const installed = new Set(['contracts-agent', 'execution-protocols']);

    const dependents = findDependents('execution-protocols', catalog, installed);
    expect(dependents).toEqual(['contracts-agent']);
  });
});

describe('Library Catalog — TOON Roundtrip', () => {
  it('full LibraryCatalog survives TOON roundtrip with optional requires', () => {
    const original: LibraryCatalog = createValidCatalog();
    const encoded = encode(original);
    const decoded = decode(encoded) as LibraryCatalog;
    expect(decoded).toEqual(original);
    // Specifically verify optional requires field survives
    const agentWithDeps = decoded.agents.find(a => a.requires && a.requires.length > 0);
    expect(agentWithDeps).toBeDefined();
    expect(agentWithDeps!.requires).toContain('skill:execution-protocols');
  });

  it('questioner-agent decision structure survives TOON roundtrip', () => {
    const original = {
      decisions: [
        { id: 'D-01', title: 'Auth Strategy', impact: 'high', recommended: 'JWT with refresh tokens', rationale: 'API-first architecture' },
        { id: 'D-02', title: 'Database Engine', impact: 'high', recommended: 'SQLite', rationale: 'Zero-config for MVP' },
      ],
    };
    const encoded = encode(original);
    const decoded = decode(encoded);
    expect(decoded).toEqual(original);
  });
});
