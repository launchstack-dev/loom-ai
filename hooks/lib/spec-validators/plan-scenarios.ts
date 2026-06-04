/**
 * Plan-level scenario validation orchestrator.
 *
 * Given the source of a PLAN.md file, locates every `#### Scenarios` block
 * under each `### Phase N` heading (planVersion 2 only — see plan.schema.md),
 * parses scenarios, runs per-scenario well-formedness checks, and adds
 * plan-level checks:
 *
 *  - cross-phase ID collisions (warning per scenario.schema.md propagation rule)
 *  - duplicate IDs within a single phase (blocking)
 *  - stateRef resolution against the phase's State Machines section (when
 *    parsable from frontmatter / section context — falls back to plan-wide)
 *  - planVersion 2 gate — emits info-level skip for v1 plans
 *
 * Implementation note: this module deliberately does NOT depend on a full
 * PLAN.md parser. It uses light-touch heuristics (regex over headings) to
 * locate phase boundaries and known-states. The richer plan schema validator
 * (Stage 1 from validation-rules.md) is the authoritative structural pass; we
 * layer scenario validation on top.
 */

import {
  parseScenariosInSection,
  type Scenario,
  type ScenarioParseError,
} from "../scenario-parser.js";
import {
  validateScenario,
  type ScenarioFinding,
  type ScenarioValidationContext,
} from "../scenario-validator.js";

export interface PlanScenarioFinding extends ScenarioFinding {
  /** Phase the scenario belongs to (e.g., "Phase 1 — User Signup"). */
  phase: string;
  /** 1-indexed line in PLAN.md where the offending block starts. */
  line: number;
}

export interface PlanScenarioValidationResult {
  scenarios: Array<Scenario & { phase: string }>;
  findings: PlanScenarioFinding[];
  parseErrors: Array<ScenarioParseError & { phase: string }>;
  /** True when planVersion 2 markers were detected. */
  planVersion2: boolean;
}

interface PhaseSlice {
  name: string;
  start: number; // 1-indexed inclusive
  end: number; // 1-indexed inclusive
  body: string;
  states: string[];
}

const PHASE_HEADING_RE = /^###\s+Phase\s+\d+/;
const SCENARIOS_HEADING_RE = /^####\s+Scenarios\s*$/;

/**
 * Validate scenarios across an entire PLAN.md source.
 *
 * Pass `options.localTags` if you've loaded scenarios.local.yaml so the
 * scenario validator can recognize project-local tags as non-blocking.
 */
export function validatePlanScenarios(
  planSource: string,
  options: { localTags?: string[]; emitInfo?: boolean } = {}
): PlanScenarioValidationResult {
  const planVersion2 = detectPlanVersion2(planSource);
  const phases = extractPhases(planSource);

  const scenarios: Array<Scenario & { phase: string }> = [];
  const findings: PlanScenarioFinding[] = [];
  const parseErrors: Array<ScenarioParseError & { phase: string }> = [];

  if (!planVersion2) {
    return {
      scenarios,
      findings: [
        {
          severity: "info",
          scenarioId: "(plan)",
          message:
            "plan is not planVersion 2 — scenario validation skipped (scenarios are a v2 feature)",
          phase: "(plan)",
          line: 1,
        },
      ],
      parseErrors,
      planVersion2,
    };
  }

  // Per-phase parse + validate.
  for (const phase of phases) {
    const { scenarios: phaseScenarios, errors } = parseScenariosInSection(
      phase.body,
      SCENARIOS_HEADING_RE
    );

    for (const e of errors) {
      parseErrors.push({ ...e, line: e.line + phase.start - 1, phase: phase.name });
    }

    const idSeen = new Map<string, number>();
    for (const s of phaseScenarios) {
      // Duplicate id within phase — blocking.
      const prior = idSeen.get(s.id);
      if (prior !== undefined) {
        findings.push({
          severity: "blocking",
          scenarioId: s.id,
          field: "id",
          phase: phase.name,
          line: s.sourceLine + phase.start - 1,
          message: `scenario ${s.id}: duplicate id within phase "${phase.name}". A scenario with id ${s.id} already exists at line ${prior}. Renumber to ${nextId(s.id)} or higher.`,
        });
      } else {
        idSeen.set(s.id, s.sourceLine + phase.start - 1);
      }

      // Per-scenario validation with phase context.
      const ctx: ScenarioValidationContext = {
        parentStates: phase.states,
        localTags: options.localTags,
        emitInfo: options.emitInfo,
        parentName: phase.name,
      };
      const sf = validateScenario(s, ctx);
      for (const f of sf) {
        findings.push({ ...f, phase: phase.name, line: s.sourceLine + phase.start - 1 });
      }

      scenarios.push({ ...s, sourceLine: s.sourceLine + phase.start - 1, phase: phase.name });
    }
  }

  // Cross-phase id collisions — warning per propagation rule.
  const crossPhase = new Map<string, Array<Scenario & { phase: string }>>();
  for (const s of scenarios) {
    const arr = crossPhase.get(s.id) ?? [];
    arr.push(s);
    crossPhase.set(s.id, arr);
  }
  for (const [id, copies] of crossPhase.entries()) {
    // Multiple copies in distinct phases → warning.
    const distinctPhases = new Set(copies.map((c) => c.phase));
    if (distinctPhases.size > 1) {
      const phaseList = Array.from(distinctPhases).join(", ");
      // Attach the warning to every occurrence so downstream consumers can
      // surface it next to either scenario.
      for (const c of copies) {
        findings.push({
          severity: "warning",
          scenarioId: id,
          field: "id",
          phase: c.phase,
          line: c.sourceLine,
          message: `scenario ${id}: id appears in multiple phases (${phaseList}). Cross-phase ID collisions are flagged for awareness — confirm intentional propagation.`,
        });
      }
    }
  }

  return { scenarios, findings, parseErrors, planVersion2 };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectPlanVersion2(source: string): boolean {
  const fmMatch = /^---\s*\n([\s\S]*?)\n---\s*\n/.exec(source);
  if (!fmMatch) return false;
  return /^\s*planVersion:\s*2\b/m.test(fmMatch[1]);
}

function extractPhases(source: string): PhaseSlice[] {
  const lines = source.split("\n");
  const phases: PhaseSlice[] = [];

  let current: { name: string; start: number; lines: string[] } | null = null;

  const flush = (endLine: number) => {
    if (!current) return;
    const body = current.lines.join("\n");
    phases.push({
      name: current.name,
      start: current.start,
      end: endLine,
      body,
      states: extractStateNames(body),
    });
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (PHASE_HEADING_RE.test(line)) {
      flush(i);
      const name = line.replace(/^###\s+/, "").trim();
      current = { name, start: i + 1, lines: [line] };
      continue;
    }
    // A higher-level (## or #) heading ends the phase.
    if (/^#{1,2}\s/.test(line) && current) {
      flush(i);
    }
    if (current) current.lines.push(line);
  }
  flush(lines.length);

  return phases;
}

/**
 * Extract candidate state names from a phase body. Heuristic: looks for a
 * `## State Machines` or `#### State Machines` subsection and collects any
 * tokens following lines like `- States: pending, active, archived` or a
 * fenced table column. This is intentionally permissive — the goal is to
 * resolve common references; the formal plan schema validator owns deeper
 * checks.
 */
function extractStateNames(body: string): string[] {
  const out = new Set<string>();
  const lines = body.split("\n");
  let inStateSection = false;

  for (const line of lines) {
    if (/^#{2,6}\s+State Machines?\s*$/i.test(line)) {
      inStateSection = true;
      continue;
    }
    if (inStateSection && /^#{2,6}\s/.test(line)) {
      // Different section — done.
      inStateSection = false;
      continue;
    }
    if (!inStateSection) continue;

    // Bullet "- States: x, y, z" or "States: x, y, z"
    const statesMatch = /^[-*]?\s*(?:States?|Possible states)\s*:\s*(.+)$/i.exec(
      line.trim()
    );
    if (statesMatch) {
      for (const tok of statesMatch[1].split(",")) {
        const t = tok.trim().replace(/[`"']/g, "");
        if (t && /^[a-z][\w-]*$/i.test(t)) out.add(t);
      }
      continue;
    }
    // Table-style: | pending | initial |
    const tableMatch = /^\|\s*([a-z][\w-]*)\s*\|/i.exec(line.trim());
    if (tableMatch) {
      const candidate = tableMatch[1];
      // Skip table headers like "State" / "Name".
      if (!/^(state|name|status|description|next|from|to)$/i.test(candidate)) {
        out.add(candidate);
      }
    }
  }
  return Array.from(out);
}

function nextId(id: string): string {
  const m = /^S-(\d+)$/.exec(id);
  if (!m) return id;
  const n = Number.parseInt(m[1], 10) + 1;
  return `S-${String(n).padStart(m[1].length, "0")}`;
}
