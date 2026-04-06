/**
 * Plan parser — extracts structured data from PLAN.md markdown files.
 *
 * Used by plan-validation tests and conceptually mirrors what the /roadmap
 * command does when validating a plan.
 */

import type {
  PlanFrontmatter,
  PlanStructure,
  PhaseNode,
  PlanDeliverable,
  DependencyGraph,
  PlanValidationResult,
  ValidationFinding,
} from './types.js';

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

export function parseFrontmatter(markdown: string): PlanFrontmatter | null {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const lines = match[1].split('\n');
  const kv: Record<string, string> = {};
  for (const line of lines) {
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const val = line.slice(sep + 1).trim().replace(/^["']|["']$/g, '');
    kv[key] = val;
  }

  return {
    planVersion: parseInt(kv['planVersion'] ?? '0', 10),
    name: kv['name'] ?? '',
    status: (kv['status'] ?? 'draft') as PlanFrontmatter['status'],
    created: kv['created'] ?? '',
    lastReviewed: kv['lastReviewed'] === 'null' ? null : (kv['lastReviewed'] ?? null),
    totalPhases: parseInt(kv['totalPhases'] ?? '0', 10),
    totalWaves: parseInt(kv['totalWaves'] ?? '0', 10),
  };
}

// ---------------------------------------------------------------------------
// Phase parsing
// ---------------------------------------------------------------------------

function parseDeliverables(phaseBlock: string): PlanDeliverable[] {
  const deliverables: PlanDeliverable[] = [];
  // Match markdown table rows (skip header and separator)
  const tableMatch = phaseBlock.match(
    /#### Deliverables\s*\n\|[^\n]+\|\s*\n\|[-| ]+\|\s*\n((?:\|[^\n]+\|\s*\n?)*)/
  );
  if (!tableMatch) {
    // Try simpler numbered list format
    const listMatch = phaseBlock.match(/\*\*Deliverables:\*\*\s*\n((?:\d+\.\s+[^\n]+\n?)*)/);
    if (listMatch) {
      const lines = listMatch[1].split('\n').filter(l => l.trim());
      for (const line of lines) {
        const fileMatch = line.match(/`([^`]+)`/);
        if (fileMatch) {
          deliverables.push({ file: fileMatch[1], action: 'Create', owner: '' });
        }
      }
    }
    return deliverables;
  }

  const rows = tableMatch[1].split('\n').filter(r => r.trim());
  for (const row of rows) {
    const cells = row.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length >= 2) {
      deliverables.push({
        file: cells[0].replace(/`/g, ''),
        action: cells[1] || 'Create',
        owner: cells[2] || '',
      });
    }
  }
  return deliverables;
}

function parseCriteria(phaseBlock: string): string[] {
  const criteria: string[] = [];
  const section = phaseBlock.match(/#### Acceptance Criteria\s*\n((?:- \[[ x]\][^\n]+\n?)*)/);
  if (section) {
    const lines = section[1].split('\n').filter(l => l.trim());
    for (const line of lines) {
      const text = line.replace(/^- \[[ x]\]\s*/, '').trim();
      if (text) criteria.push(text);
    }
  }
  return criteria;
}

function parseDependencies(phaseBlock: string): number[] {
  // Match "**Dependencies:** Phase 0, Phase 1" or "**Depends on:** Phase 3"
  const depMatch = phaseBlock.match(
    /\*\*(?:Dependencies|Depends on):\*\*\s*([^\n]+)/i
  );
  if (!depMatch) return [];
  const text = depMatch[1].trim();
  if (/^none$/i.test(text)) return [];

  const deps: number[] = [];
  const phaseRefs = text.matchAll(/Phase\s+(\d+)/gi);
  for (const m of phaseRefs) {
    deps.push(parseInt(m[1], 10));
  }
  return deps;
}

function parseFileOwnership(phaseBlock: string): string[] {
  const match = phaseBlock.match(/\*\*File Ownership:\*\*\s*\n((?:- [^\n]+\n?)*)/);
  if (match) {
    return match[1].split('\n')
      .map(l => l.replace(/^- /, '').trim())
      .filter(Boolean);
  }
  // Inline format: **File Ownership:** src/auth/**, src/middleware/auth.ts
  const inlineMatch = phaseBlock.match(/\*\*File Ownership:\*\*\s*([^\n]+)/);
  if (inlineMatch) {
    return inlineMatch[1].split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
}

export function parsePhases(markdown: string): PhaseNode[] {
  const phases: PhaseNode[] = [];

  // Match ### Phase N patterns (various formats)
  const phaseRegex = /### Phase (\d+)\s*[—–-]\s*Wave (\d+):\s*([^\n]+)/g;
  const simplePhaseRegex = /### Phase (\d+)\s*[—–-]\s*(?:Wave (\d+):\s*)?([^\n]+)/g;

  // Split by ### Phase headings
  const blocks = markdown.split(/(?=### Phase \d+)/);

  for (const block of blocks) {
    const headerMatch = block.match(
      /### Phase (\d+)\s*[—–-]\s*(?:Wave (\d+):\s*)?([^\n]+)/
    );
    if (!headerMatch) continue;

    const id = parseInt(headerMatch[1], 10);
    const wave = headerMatch[2] ? parseInt(headerMatch[2], 10) : id;
    const name = headerMatch[3].trim();

    const agentMatch = block.match(/\*\*Agent:\*\*\s*([^\n]+)/);
    const objectiveMatch = block.match(/\*\*Objective:\*\*\s*([^\n]+)/);

    phases.push({
      id,
      name,
      wave,
      agent: agentMatch ? agentMatch[1].trim() : '',
      objective: objectiveMatch ? objectiveMatch[1].trim() : '',
      dependencies: parseDependencies(block),
      fileOwnership: parseFileOwnership(block),
      deliverables: parseDeliverables(block),
      acceptanceCriteria: parseCriteria(block),
    });
  }

  return phases;
}

// ---------------------------------------------------------------------------
// Full plan structure extraction
// ---------------------------------------------------------------------------

export function parsePlan(markdown: string): PlanStructure {
  const titleMatch = markdown.match(/^# Plan:\s*(.+)$/m) ??
    markdown.match(/^# (.+)$/m);

  return {
    frontmatter: parseFrontmatter(markdown),
    title: titleMatch ? titleMatch[1].trim() : null,
    hasOverview: /^## Overview/m.test(markdown),
    hasTechStack: /^## Tech Stack/m.test(markdown),
    hasSchema: /^## Schema/m.test(markdown),
    hasExecutionPhases: /^## Execution Phases/m.test(markdown),
    hasVerificationCommands: /^## Verification Commands/m.test(markdown),
    phases: parsePhases(markdown),
  };
}

// ---------------------------------------------------------------------------
// Dependency graph construction
// ---------------------------------------------------------------------------

export function buildDependencyGraph(phases: PhaseNode[]): DependencyGraph {
  const adjacency: Record<number, number[]> = {};
  for (const p of phases) {
    adjacency[p.id] = p.dependencies;
  }

  // Kahn's algorithm for cycle detection + topological sort
  const inDegree: Record<number, number> = {};
  const nodeIds = phases.map(p => p.id);
  for (const id of nodeIds) inDegree[id] = 0;

  for (const p of phases) {
    for (const dep of p.dependencies) {
      // dep → p (p depends on dep, so dep has an edge to p in the "blocks" direction)
      // But for in-degree of topological sort, we need edges in dependency direction
    }
  }

  // Build forward edges: for each phase, which phases depend on it?
  const forwardEdges: Record<number, number[]> = {};
  for (const id of nodeIds) forwardEdges[id] = [];
  for (const p of phases) {
    for (const dep of p.dependencies) {
      if (forwardEdges[dep]) {
        forwardEdges[dep].push(p.id);
      }
    }
    inDegree[p.id] = p.dependencies.filter(d => nodeIds.includes(d)).length;
  }

  // Kahn's BFS
  const queue: number[] = [];
  for (const id of nodeIds) {
    if (inDegree[id] === 0) queue.push(id);
  }

  const sorted: number[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);
    for (const dependent of (forwardEdges[node] ?? [])) {
      inDegree[dependent]--;
      if (inDegree[dependent] === 0) queue.push(dependent);
    }
  }

  const hasCycles = sorted.length !== nodeIds.length;
  const cycleNodes = hasCycles
    ? nodeIds.filter(id => !sorted.includes(id))
    : [];

  // Critical path (longest path) — only valid if no cycles
  let criticalPath: number[] = [];
  let criticalPathLength = 0;

  if (!hasCycles && sorted.length > 0) {
    const dist: Record<number, number> = {};
    const prev: Record<number, number | null> = {};
    for (const id of nodeIds) {
      dist[id] = 0;
      prev[id] = null;
    }

    for (const node of sorted) {
      for (const dependent of (forwardEdges[node] ?? [])) {
        if (dist[node] + 1 > dist[dependent]) {
          dist[dependent] = dist[node] + 1;
          prev[dependent] = node;
        }
      }
    }

    // Find the node with maximum distance
    let maxNode = sorted[0];
    for (const id of nodeIds) {
      if (dist[id] > dist[maxNode]) maxNode = id;
    }

    criticalPathLength = dist[maxNode] + 1; // +1 because dist counts edges, path includes start node

    // Backtrack to get path
    criticalPath = [];
    let current: number | null = maxNode;
    while (current !== null) {
      criticalPath.unshift(current);
      current = prev[current] ?? null;
    }
  }

  return {
    nodes: phases,
    adjacency,
    criticalPath,
    criticalPathLength,
    hasCycles,
    cycleNodes,
  };
}

// ---------------------------------------------------------------------------
// Validation pipeline
// ---------------------------------------------------------------------------

const SUBJECTIVE_PATTERNS = [
  /should work well/i,
  /good (error )?handling/i,
  /handles? edge cases/i,
  /clean (code|implementation)/i,
  /reasonable (performance|speed)/i,
  /looks? good/i,
  /user[- ]friendly/i,
];

const UNMEASURABLE_PERF_PATTERN = /(?:loads?|responds?|runs?|completes?) in (?:under|less than) \d+\s*(?:ms|seconds?)/i;

function validateStructure(plan: PlanStructure): ValidationFinding[] {
  const findings: ValidationFinding[] = [];

  if (!plan.frontmatter) {
    findings.push({
      stage: 'structure',
      severity: 'error',
      message: 'Missing YAML frontmatter',
    });
  }

  if (!plan.title) {
    findings.push({
      stage: 'structure',
      severity: 'error',
      message: 'Missing plan title (# Plan: ...)',
    });
  }

  if (!plan.hasOverview) {
    findings.push({ stage: 'structure', severity: 'error', message: 'Missing ## Overview section' });
  }
  if (!plan.hasTechStack) {
    findings.push({ stage: 'structure', severity: 'error', message: 'Missing ## Tech Stack section' });
  }
  if (!plan.hasSchema) {
    findings.push({ stage: 'structure', severity: 'error', message: 'Missing ## Schema / Type Definitions section' });
  }
  if (!plan.hasExecutionPhases) {
    findings.push({ stage: 'structure', severity: 'error', message: 'Missing ## Execution Phases section' });
  }
  if (!plan.hasVerificationCommands) {
    findings.push({ stage: 'structure', severity: 'warning', message: 'Missing ## Verification Commands section' });
  }

  if (plan.phases.length === 0) {
    findings.push({ stage: 'structure', severity: 'error', message: 'No phases found in Execution Phases' });
  }

  // Phase 0 must exist and be contracts
  const phase0 = plan.phases.find(p => p.id === 0);
  if (!phase0) {
    findings.push({
      stage: 'structure',
      severity: 'error',
      message: 'Missing Phase 0 (contracts phase). Every plan must start with a contracts phase at Wave 0.',
    });
  } else {
    if (phase0.wave !== 0) {
      findings.push({
        stage: 'structure',
        severity: 'error',
        message: 'Phase 0 must be Wave 0',
        phase: 0,
      });
    }
    if (phase0.dependencies.length > 0) {
      findings.push({
        stage: 'structure',
        severity: 'error',
        message: 'Phase 0 must have no dependencies',
        phase: 0,
      });
    }
  }

  return findings;
}

function validateDependencies(graph: DependencyGraph): ValidationFinding[] {
  const findings: ValidationFinding[] = [];

  if (graph.hasCycles) {
    findings.push({
      stage: 'dependencies',
      severity: 'error',
      message: `Circular dependency detected involving phases: ${graph.cycleNodes.join(', ')}`,
    });
  }

  // Check for self-dependencies and forward references
  for (const node of graph.nodes) {
    if (node.dependencies.includes(node.id)) {
      findings.push({
        stage: 'dependencies',
        severity: 'error',
        message: `Phase ${node.id} depends on itself`,
        phase: node.id,
      });
    }

    for (const dep of node.dependencies) {
      if (!graph.nodes.find(n => n.id === dep)) {
        findings.push({
          stage: 'dependencies',
          severity: 'error',
          message: `Phase ${node.id} depends on undefined Phase ${dep}`,
          phase: node.id,
        });
      }
    }
  }

  return findings;
}

function fileMatchesOwnership(file: string, ownershipPatterns: string[]): boolean {
  for (const pattern of ownershipPatterns) {
    if (pattern.endsWith('**')) {
      const dir = pattern.slice(0, -2); // Remove **
      if (file.startsWith(dir)) return true;
    } else if (pattern.endsWith('/')) {
      if (file.startsWith(pattern)) return true;
    } else {
      if (file === pattern) return true;
    }
    // Also match "src/foo/" style against "src/foo/bar.ts"
    if (!pattern.includes('*') && !pattern.includes('.') && file.startsWith(pattern + '/')) {
      return true;
    }
    if (!pattern.includes('*') && !pattern.includes('.') && file.startsWith(pattern)) {
      return true;
    }
  }
  return false;
}

function validateOwnership(phases: PhaseNode[]): ValidationFinding[] {
  const findings: ValidationFinding[] = [];

  // Check for same-wave file ownership overlaps
  const waveGroups: Record<number, PhaseNode[]> = {};
  for (const p of phases) {
    if (!waveGroups[p.wave]) waveGroups[p.wave] = [];
    waveGroups[p.wave].push(p);
  }

  for (const [wave, wavePhases] of Object.entries(waveGroups)) {
    if (wavePhases.length < 2) continue;

    for (let i = 0; i < wavePhases.length; i++) {
      for (let j = i + 1; j < wavePhases.length; j++) {
        const a = wavePhases[i];
        const b = wavePhases[j];

        // Check explicit file overlaps
        for (const fileA of a.fileOwnership) {
          for (const fileB of b.fileOwnership) {
            // Exact match
            if (fileA === fileB) {
              findings.push({
                stage: 'ownership',
                severity: 'error',
                message: `File ownership conflict in Wave ${wave}: "${fileA}" claimed by Phase ${a.id} and Phase ${b.id}`,
                file: fileA,
              });
            }
            // Directory containment: one dir contains another
            const dirA = fileA.endsWith('**') ? fileA.slice(0, -2) : fileA.endsWith('/') ? fileA : null;
            const dirB = fileB.endsWith('**') ? fileB.slice(0, -2) : fileB.endsWith('/') ? fileB : null;
            if (dirA && dirB) {
              if (dirA.startsWith(dirB) || dirB.startsWith(dirA)) {
                findings.push({
                  stage: 'ownership',
                  severity: 'error',
                  message: `Directory ownership overlap in Wave ${wave}: "${fileA}" (Phase ${a.id}) and "${fileB}" (Phase ${b.id})`,
                  file: fileA,
                });
              }
            }
            // File inside directory
            if (dirA && !dirB && fileB.startsWith(dirA)) {
              findings.push({
                stage: 'ownership',
                severity: 'error',
                message: `File "${fileB}" (Phase ${b.id}) falls within directory "${fileA}" (Phase ${a.id}) in Wave ${wave}`,
                file: fileB,
              });
            }
            if (dirB && !dirA && fileA.startsWith(dirB)) {
              findings.push({
                stage: 'ownership',
                severity: 'error',
                message: `File "${fileA}" (Phase ${a.id}) falls within directory "${fileB}" (Phase ${b.id}) in Wave ${wave}`,
                file: fileA,
              });
            }
          }
        }
      }
    }
  }

  // Check that deliverables fall within ownership
  for (const p of phases) {
    if (p.fileOwnership.length === 0) continue;
    for (const d of p.deliverables) {
      if (!fileMatchesOwnership(d.file, p.fileOwnership)) {
        findings.push({
          stage: 'ownership',
          severity: 'warning',
          message: `Deliverable "${d.file}" in Phase ${p.id} is outside its declared file ownership`,
          phase: p.id,
          file: d.file,
        });
      }
    }
  }

  return findings;
}

function validateSizing(phases: PhaseNode[]): {
  findings: ValidationFinding[];
  sizing: PlanValidationResult['sizing'];
} {
  const findings: ValidationFinding[] = [];
  const sizing: PlanValidationResult['sizing'] = [];

  for (const p of phases) {
    const dc = p.deliverables.length;
    const cc = p.acceptanceCriteria.length;
    let flag: 'oversized' | 'undersized' | 'no-criteria' | undefined;

    if (dc > 12) {
      findings.push({
        stage: 'sizing',
        severity: 'error',
        message: `Phase ${p.id} has ${dc} deliverables (max 12). Split into smaller phases.`,
        phase: p.id,
      });
      flag = 'oversized';
    } else if (dc > 8) {
      findings.push({
        stage: 'sizing',
        severity: 'warning',
        message: `Phase ${p.id} has ${dc} deliverables (recommended max 8). Consider splitting.`,
        phase: p.id,
      });
      flag = 'oversized';
    }

    if (cc === 0) {
      findings.push({
        stage: 'sizing',
        severity: 'error',
        message: `Phase ${p.id} has no acceptance criteria`,
        phase: p.id,
      });
      flag = 'no-criteria';
    }

    if (dc < 2 && dc > 0) {
      findings.push({
        stage: 'sizing',
        severity: 'warning',
        message: `Phase ${p.id} has only ${dc} deliverable(s). Consider merging with adjacent phase.`,
        phase: p.id,
      });
      if (!flag) flag = 'undersized';
    }

    sizing.push({ phaseId: p.id, deliverableCount: dc, criteriaCount: cc, flag });
  }

  return { findings, sizing };
}

function validateCriteria(phases: PhaseNode[]): ValidationFinding[] {
  const findings: ValidationFinding[] = [];

  for (const p of phases) {
    for (const criterion of p.acceptanceCriteria) {
      for (const pattern of SUBJECTIVE_PATTERNS) {
        if (pattern.test(criterion)) {
          findings.push({
            stage: 'criteria',
            severity: 'warning',
            message: `Phase ${p.id}: subjective criterion "${criterion}" — rewrite as testable assertion`,
            phase: p.id,
          });
          break;
        }
      }

      if (UNMEASURABLE_PERF_PATTERN.test(criterion)) {
        // Only flag if there's no corresponding test infrastructure mention
        const hasTestMechanism = /test|benchmark|vitest|jest|k6|artillery/i.test(criterion);
        if (!hasTestMechanism) {
          findings.push({
            stage: 'criteria',
            severity: 'warning',
            message: `Phase ${p.id}: performance criterion "${criterion}" has no test mechanism specified`,
            phase: p.id,
          });
        }
      }
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Main validation entrypoint
// ---------------------------------------------------------------------------

export function validatePlan(markdown: string): PlanValidationResult {
  const plan = parsePlan(markdown);
  const graph = buildDependencyGraph(plan.phases);

  const structureFindings = validateStructure(plan);
  const depFindings = validateDependencies(graph);
  const ownershipFindings = validateOwnership(plan.phases);
  const { findings: sizingFindings, sizing } = validateSizing(plan.phases);
  const criteriaFindings = validateCriteria(plan.phases);

  const allFindings = [
    ...structureFindings,
    ...depFindings,
    ...ownershipFindings,
    ...sizingFindings,
    ...criteriaFindings,
  ];

  const errors = allFindings.filter(f => f.severity === 'error');
  const warnings = allFindings.filter(f => f.severity === 'warning');

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    graph,
    sizing,
  };
}
