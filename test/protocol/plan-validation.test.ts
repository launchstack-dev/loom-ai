import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parsePlan, buildDependencyGraph, validatePlan } from './helpers/plan-parser.js';
import type { PhaseNode } from './helpers/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(relativePath: string): string {
  return readFileSync(resolve(__dirname, relativePath), 'utf-8');
}

// ---------------------------------------------------------------------------
// Helpers: inline PhaseNode factories
// ---------------------------------------------------------------------------

function makePhase(overrides: Partial<PhaseNode> & { id: number }): PhaseNode {
  return {
    name: `Phase ${overrides.id}`,
    wave: overrides.id,
    agent: 'implementer-agent',
    objective: '',
    dependencies: [],
    fileOwnership: [],
    deliverables: [],
    acceptanceCriteria: ['Some testable criterion'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Structure Parsing
// ---------------------------------------------------------------------------

describe('Structure Parsing', () => {
  it('parses a valid plan with all required sections and non-empty phases', () => {
    const md = loadFixture('../../test-fixtures/taskboard/PLAN.md');
    const structure = parsePlan(md);

    expect(structure.title).toBeTruthy();
    expect(structure.hasOverview).toBe(true);
    expect(structure.hasTechStack).toBe(true);
    expect(structure.hasSchema).toBe(true);
    expect(structure.hasExecutionPhases).toBe(true);
    expect(structure.phases.length).toBeGreaterThan(0);
  });

  it('reports missing Phase 0 in broken plan', () => {
    const md = loadFixture('../../test-fixtures/broken-plan/PLAN.md');
    const result = validatePlan(md);

    const phase0Error = result.errors.find(
      (e) => e.stage === 'structure' && /Phase 0/.test(e.message),
    );
    expect(phase0Error).toBeDefined();
  });

  it('reports missing YAML frontmatter', () => {
    const md = '# Plan: No Frontmatter\n\n## Overview\nStuff.\n';
    const result = validatePlan(md);

    const fmError = result.errors.find(
      (e) => e.stage === 'structure' && e.message === 'Missing YAML frontmatter',
    );
    expect(fmError).toBeDefined();
  });

  it('reports missing acceptance criteria per phase', () => {
    const md = loadFixture('../../test-fixtures/broken-plan/PLAN.md');
    const result = validatePlan(md);

    const criteriaError = result.errors.find(
      (e) => e.stage === 'sizing' && /no acceptance criteria/i.test(e.message),
    );
    expect(criteriaError).toBeDefined();
  });

  it('reports an error when there are 0 phases', () => {
    const md = `# Plan: Empty\n\n## Overview\nNothing.\n\n## Execution Phases\n\nNo phases here.\n`;
    const result = validatePlan(md);

    const noPhaseError = result.errors.find(
      (e) => e.stage === 'structure' && /No phases/i.test(e.message),
    );
    expect(noPhaseError).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Dependency Cycle Detection
// ---------------------------------------------------------------------------

describe('Dependency Cycle Detection', () => {
  it('detects no cycles in a valid DAG (taskboard phases)', () => {
    const md = loadFixture('../../test-fixtures/taskboard/PLAN.md');
    const structure = parsePlan(md);
    const graph = buildDependencyGraph(structure.phases);

    expect(graph.hasCycles).toBe(false);
    expect(graph.cycleNodes).toEqual([]);
  });

  it('detects a circular dependency between two phases', () => {
    const phases: PhaseNode[] = [
      makePhase({ id: 0, wave: 0, dependencies: [] }),
      makePhase({ id: 1, wave: 1, dependencies: [0] }),
      makePhase({ id: 2, wave: 2, dependencies: [3] }),
      makePhase({ id: 3, wave: 2, dependencies: [2] }),
    ];
    const graph = buildDependencyGraph(phases);

    expect(graph.hasCycles).toBe(true);
    expect(graph.cycleNodes).toContain(2);
    expect(graph.cycleNodes).toContain(3);
  });

  it('detects self-dependency as an error', () => {
    const phases: PhaseNode[] = [
      makePhase({ id: 0, wave: 0, dependencies: [] }),
      makePhase({ id: 1, wave: 1, dependencies: [0, 1] }),
    ];
    const graph = buildDependencyGraph(phases);
    const result = validatePlan(''); // We need to use the full pipeline for this

    // Use validatePlan indirectly — build a minimal markdown that triggers self-dep
    // Instead, test the graph + validate manually
    const md = [
      '# Plan: Self Dep',
      '',
      '## Overview',
      'Test.',
      '',
      '## Tech Stack',
      '- Node.js',
      '',
      '## Schema / Type Definitions',
      'None.',
      '',
      '## Execution Phases',
      '',
      '### Phase 0 — Wave 0: Contracts',
      '**Agent:** contracts-agent',
      '**Objective:** Set up contracts.',
      '**Deliverables:**',
      '1. `src/contracts/types.ts`',
      '2. `src/contracts/schema.sql`',
      '**File Ownership:**',
      '- `src/contracts/`',
      '#### Acceptance Criteria',
      '- [ ] Types compile with `npx tsc --noEmit`',
      '',
      '### Phase 1 — Wave 1: Self Dep Phase',
      '**Depends on:** Phase 0, Phase 1',
      '**Agent:** implementer-agent',
      '**Objective:** Broken phase.',
      '**Deliverables:**',
      '1. `src/self/thing.ts`',
      '2. `src/self/other.ts`',
      '**File Ownership:**',
      '- `src/self/`',
      '#### Acceptance Criteria',
      '- [ ] Something testable',
      '',
      '## Verification Commands',
      '```bash',
      'npx tsc --noEmit',
      '```',
    ].join('\n');

    const selfResult = validatePlan(md);
    const selfDepError = selfResult.errors.find(
      (e) => e.stage === 'dependencies' && /depends on itself/i.test(e.message),
    );
    expect(selfDepError).toBeDefined();
    expect(selfDepError!.phase).toBe(1);
  });

  it('detects a deep cycle (A -> B -> C -> A)', () => {
    const phases: PhaseNode[] = [
      makePhase({ id: 1, wave: 1, dependencies: [3] }),
      makePhase({ id: 2, wave: 2, dependencies: [1] }),
      makePhase({ id: 3, wave: 3, dependencies: [2] }),
    ];
    const graph = buildDependencyGraph(phases);

    expect(graph.hasCycles).toBe(true);
    expect(graph.cycleNodes.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Critical Path
// ---------------------------------------------------------------------------

describe('Critical Path', () => {
  it('computes critical path for a linear chain (0->1->2->3)', () => {
    const phases: PhaseNode[] = [
      makePhase({ id: 0, wave: 0, dependencies: [] }),
      makePhase({ id: 1, wave: 1, dependencies: [0] }),
      makePhase({ id: 2, wave: 2, dependencies: [1] }),
      makePhase({ id: 3, wave: 3, dependencies: [2] }),
    ];
    const graph = buildDependencyGraph(phases);

    expect(graph.hasCycles).toBe(false);
    expect(graph.criticalPathLength).toBe(4);
    expect(graph.criticalPath).toEqual([0, 1, 2, 3]);
  });

  it('computes critical path for a diamond (0->1,2; 1->3; 2->3)', () => {
    const phases: PhaseNode[] = [
      makePhase({ id: 0, wave: 0, dependencies: [] }),
      makePhase({ id: 1, wave: 1, dependencies: [0] }),
      makePhase({ id: 2, wave: 1, dependencies: [0] }),
      makePhase({ id: 3, wave: 2, dependencies: [1, 2] }),
    ];
    const graph = buildDependencyGraph(phases);

    expect(graph.hasCycles).toBe(false);
    expect(graph.criticalPathLength).toBe(3);
  });

  it('computes critical path for fully parallel phases', () => {
    const phases: PhaseNode[] = [
      makePhase({ id: 0, wave: 0, dependencies: [] }),
      makePhase({ id: 1, wave: 1, dependencies: [0] }),
      makePhase({ id: 2, wave: 1, dependencies: [0] }),
      makePhase({ id: 3, wave: 1, dependencies: [0] }),
    ];
    const graph = buildDependencyGraph(phases);

    expect(graph.hasCycles).toBe(false);
    expect(graph.criticalPathLength).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// File Ownership
// ---------------------------------------------------------------------------

describe('File Ownership', () => {
  it('finds no ownership errors for non-overlapping ownership (taskboard)', () => {
    const md = loadFixture('../../test-fixtures/taskboard/PLAN.md');
    const result = validatePlan(md);

    const ownershipErrors = result.errors.filter((e) => e.stage === 'ownership');
    expect(ownershipErrors).toEqual([]);
  });

  it('detects same-wave file overlap', () => {
    const phases: PhaseNode[] = [
      makePhase({ id: 0, wave: 0, dependencies: [] }),
      makePhase({
        id: 1,
        wave: 1,
        dependencies: [0],
        fileOwnership: ['src/utils/helpers.ts', 'src/alpha/'],
        deliverables: [
          { file: 'src/alpha/a.ts', action: 'Create', owner: '' },
          { file: 'src/utils/helpers.ts', action: 'Create', owner: '' },
        ],
      }),
      makePhase({
        id: 2,
        wave: 1,
        dependencies: [0],
        fileOwnership: ['src/utils/helpers.ts', 'src/beta/'],
        deliverables: [
          { file: 'src/beta/b.ts', action: 'Create', owner: '' },
          { file: 'src/utils/helpers.ts', action: 'Create', owner: '' },
        ],
      }),
    ];
    const graph = buildDependencyGraph(phases);

    // Manually call validatePlan with markdown that produces same-wave overlapping phases
    // Instead, test with inline phases via the parser path — build markdown
    const md = [
      '# Plan: Overlap',
      '',
      '## Overview',
      'Test.',
      '',
      '## Tech Stack',
      '- Node.js',
      '',
      '## Schema / Type Definitions',
      'None.',
      '',
      '## Execution Phases',
      '',
      '### Phase 0 — Wave 0: Contracts',
      '**Agent:** contracts-agent',
      '**Objective:** Contracts.',
      '**Deliverables:**',
      '1. `src/contracts/types.ts`',
      '2. `src/contracts/schema.sql`',
      '**File Ownership:**',
      '- `src/contracts/`',
      '#### Acceptance Criteria',
      '- [ ] Types compile',
      '',
      '### Phase 1 — Wave 1: Track A',
      '**Depends on:** Phase 0',
      '**Agent:** implementer-agent',
      '**Objective:** Track A.',
      '**Deliverables:**',
      '1. `src/alpha/a.ts`',
      '2. `src/utils/helpers.ts`',
      '**File Ownership:**',
      '- `src/alpha/`',
      '- `src/utils/helpers.ts`',
      '#### Acceptance Criteria',
      '- [ ] Tests pass',
      '',
      '### Phase 2 — Wave 1: Track B',
      '**Depends on:** Phase 0',
      '**Agent:** implementer-agent',
      '**Objective:** Track B.',
      '**Deliverables:**',
      '1. `src/beta/b.ts`',
      '2. `src/utils/helpers.ts`',
      '**File Ownership:**',
      '- `src/beta/`',
      '- `src/utils/helpers.ts`',
      '#### Acceptance Criteria',
      '- [ ] Tests pass',
      '',
      '## Verification Commands',
      '```bash',
      'npx tsc --noEmit',
      '```',
    ].join('\n');

    const result = validatePlan(md);
    const ownershipError = result.errors.find(
      (e) => e.stage === 'ownership' && /helpers\.ts/.test(e.message),
    );
    expect(ownershipError).toBeDefined();
  });

  it('warns about deliverable outside file ownership boundary', () => {
    const md = [
      '# Plan: Outside Ownership',
      '',
      '## Overview',
      'Test.',
      '',
      '## Tech Stack',
      '- Node.js',
      '',
      '## Schema / Type Definitions',
      'None.',
      '',
      '## Execution Phases',
      '',
      '### Phase 0 — Wave 0: Contracts',
      '**Agent:** contracts-agent',
      '**Objective:** Contracts.',
      '**Deliverables:**',
      '1. `src/contracts/types.ts`',
      '2. `src/contracts/schema.sql`',
      '3. `src/outside/rogue.ts`',
      '**File Ownership:**',
      '- `src/contracts/`',
      '#### Acceptance Criteria',
      '- [ ] Types compile',
      '',
      '## Verification Commands',
      '```bash',
      'npx tsc --noEmit',
      '```',
    ].join('\n');

    const result = validatePlan(md);
    const ownershipWarning = result.warnings.find(
      (w) => w.stage === 'ownership' && /outside.*ownership/i.test(w.message),
    );
    expect(ownershipWarning).toBeDefined();
  });

  it('has no ownership conflicts for wiring phase in taskboard fixture', () => {
    const md = loadFixture('../../test-fixtures/taskboard/PLAN.md');
    const structure = parsePlan(md);

    // The wiring phase (Phase 2) is in Wave 2, alone — no same-wave conflicts
    const wiringPhase = structure.phases.find((p) => /wiring|integration/i.test(p.name));
    expect(wiringPhase).toBeDefined();

    const result = validatePlan(md);
    const wiringOwnershipErrors = result.errors.filter(
      (e) => e.stage === 'ownership' && e.file && wiringPhase!.fileOwnership.some(
        (owned) => e.file!.includes(owned.replace(/\/$/, '')) || owned.includes(e.file!),
      ),
    );
    expect(wiringOwnershipErrors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Sizing
// ---------------------------------------------------------------------------

describe('Sizing', () => {
  it('raises no sizing issues for a phase with 5 deliverables', () => {
    const phases: PhaseNode[] = [
      makePhase({
        id: 0,
        wave: 0,
        deliverables: Array.from({ length: 5 }, (_, i) => ({
          file: `src/mod${i}.ts`,
          action: 'Create',
          owner: '',
        })),
        acceptanceCriteria: ['Tests pass'],
      }),
    ];

    // Validate via markdown
    const md = [
      '# Plan: Sizing OK',
      '',
      '## Overview',
      'Test.',
      '',
      '## Tech Stack',
      '- Node.js',
      '',
      '## Schema / Type Definitions',
      'None.',
      '',
      '## Execution Phases',
      '',
      '### Phase 0 — Wave 0: Contracts',
      '**Agent:** contracts-agent',
      '**Objective:** Contracts.',
      '**Deliverables:**',
      '1. `src/mod0.ts`',
      '2. `src/mod1.ts`',
      '3. `src/mod2.ts`',
      '4. `src/mod3.ts`',
      '5. `src/mod4.ts`',
      '**File Ownership:**',
      '- `src/`',
      '#### Acceptance Criteria',
      '- [ ] Tests pass',
      '',
      '## Verification Commands',
      '```bash',
      'npx tsc --noEmit',
      '```',
    ].join('\n');

    const result = validatePlan(md);
    const sizingErrors = result.errors.filter(
      (e) => e.stage === 'sizing' && e.phase === 0 && /oversized/i.test(e.message),
    );
    expect(sizingErrors).toEqual([]);
  });

  it('reports oversized error for a phase with 16 deliverables', () => {
    const deliverableLines = Array.from(
      { length: 16 },
      (_, i) => `${i + 1}. \`src/file${i}.ts\``,
    ).join('\n');

    const md = [
      '# Plan: Oversized',
      '',
      '## Overview',
      'Test.',
      '',
      '## Tech Stack',
      '- Node.js',
      '',
      '## Schema / Type Definitions',
      'None.',
      '',
      '## Execution Phases',
      '',
      '### Phase 0 — Wave 0: Contracts',
      '**Agent:** contracts-agent',
      '**Objective:** Contracts.',
      '**Deliverables:**',
      deliverableLines,
      '**File Ownership:**',
      '- `src/`',
      '#### Acceptance Criteria',
      '- [ ] Tests pass',
      '',
      '## Verification Commands',
      '```bash',
      'npx tsc --noEmit',
      '```',
    ].join('\n');

    const result = validatePlan(md);
    const oversizedError = result.errors.find(
      (e) => e.stage === 'sizing' && /oversized|deliverables/i.test(e.message),
    );
    expect(oversizedError).toBeDefined();
  });

  it('reports error for a phase with 0 acceptance criteria', () => {
    const md = loadFixture('../../test-fixtures/broken-plan/PLAN.md');
    const result = validatePlan(md);

    const noCriteriaError = result.errors.find(
      (e) => e.stage === 'sizing' && /no acceptance criteria/i.test(e.message),
    );
    expect(noCriteriaError).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Criteria Quality
// ---------------------------------------------------------------------------

describe('Criteria Quality', () => {
  it('raises no warnings for a testable criterion', () => {
    const md = [
      '# Plan: Good Criteria',
      '',
      '## Overview',
      'Test.',
      '',
      '## Tech Stack',
      '- Node.js',
      '',
      '## Schema / Type Definitions',
      'None.',
      '',
      '## Execution Phases',
      '',
      '### Phase 0 — Wave 0: Contracts',
      '**Agent:** contracts-agent',
      '**Objective:** Contracts.',
      '**Deliverables:**',
      '1. `src/contracts/types.ts`',
      '2. `src/contracts/schema.sql`',
      '**File Ownership:**',
      '- `src/contracts/`',
      '#### Acceptance Criteria',
      '- [ ] `npx tsc --noEmit` exits with code 0',
      '',
      '## Verification Commands',
      '```bash',
      'npx tsc --noEmit',
      '```',
    ].join('\n');

    const result = validatePlan(md);
    const criteriaWarnings = result.warnings.filter((w) => w.stage === 'criteria');
    expect(criteriaWarnings).toEqual([]);
  });

  it('warns about subjective criterion "should work well"', () => {
    const md = [
      '# Plan: Subjective',
      '',
      '## Overview',
      'Test.',
      '',
      '## Tech Stack',
      '- Node.js',
      '',
      '## Schema / Type Definitions',
      'None.',
      '',
      '## Execution Phases',
      '',
      '### Phase 0 — Wave 0: Contracts',
      '**Agent:** contracts-agent',
      '**Objective:** Contracts.',
      '**Deliverables:**',
      '1. `src/contracts/types.ts`',
      '2. `src/contracts/schema.sql`',
      '**File Ownership:**',
      '- `src/contracts/`',
      '#### Acceptance Criteria',
      '- [ ] The system should work well under load',
      '',
      '## Verification Commands',
      '```bash',
      'npx tsc --noEmit',
      '```',
    ].join('\n');

    const result = validatePlan(md);
    const subjectiveWarning = result.warnings.find(
      (w) => w.stage === 'criteria' && /subjective/i.test(w.message),
    );
    expect(subjectiveWarning).toBeDefined();
  });

  it('warns about unmeasurable performance criterion without test mechanism', () => {
    const md = [
      '# Plan: Perf No Test',
      '',
      '## Overview',
      'Test.',
      '',
      '## Tech Stack',
      '- Node.js',
      '',
      '## Schema / Type Definitions',
      'None.',
      '',
      '## Execution Phases',
      '',
      '### Phase 0 — Wave 0: Contracts',
      '**Agent:** contracts-agent',
      '**Objective:** Contracts.',
      '**Deliverables:**',
      '1. `src/contracts/types.ts`',
      '2. `src/contracts/schema.sql`',
      '**File Ownership:**',
      '- `src/contracts/`',
      '#### Acceptance Criteria',
      '- [ ] Page loads in under 200ms',
      '',
      '## Verification Commands',
      '```bash',
      'npx tsc --noEmit',
      '```',
    ].join('\n');

    const result = validatePlan(md);
    const perfWarning = result.warnings.find(
      (w) => w.stage === 'criteria' && /performance.*no test mechanism/i.test(w.message),
    );
    expect(perfWarning).toBeDefined();
  });
});
