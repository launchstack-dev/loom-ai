/**
 * Roadmap-level scenario validation orchestrator.
 *
 * Parallel of plan-scenarios.ts for ROADMAP.md. Roadmap scenarios live under a
 * `Scenarios:` subsection inside each feature block (see roadmap.schema.md).
 * Features are typically delimited by `### F-XX` headings. This validator:
 *
 *  - locates every feature
 *  - parses scenarios from the feature's Scenarios subsection
 *  - runs per-scenario well-formedness checks
 *  - adds cross-feature ID collision check (warning — duplicates across
 *    features are flagged because roadmap scenario IDs should be globally
 *    unique within a roadmap document; in practice a duplicate usually means
 *    accidental copy-paste rather than intentional propagation)
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

export interface RoadmapScenarioFinding extends ScenarioFinding {
  /** Feature the scenario belongs to (e.g., "F-03 — User Signup"). */
  feature: string;
  /** 1-indexed line in ROADMAP.md where the offending block starts. */
  line: number;
}

export interface RoadmapScenarioValidationResult {
  scenarios: Array<Scenario & { feature: string }>;
  findings: RoadmapScenarioFinding[];
  parseErrors: Array<ScenarioParseError & { feature: string }>;
}

interface FeatureSlice {
  name: string;
  start: number; // 1-indexed inclusive
  end: number; // 1-indexed inclusive
  body: string;
}

const FEATURE_HEADING_RE = /^###\s+F-\d+/;
/** Matches both `#### Scenarios` and an indented `Scenarios:` label. */
const SCENARIOS_HEADING_RE = /^(?:#{2,6}\s+Scenarios\s*$|Scenarios\s*:\s*$)/;

export function validateRoadmapScenarios(
  roadmapSource: string,
  options: { localTags?: string[]; emitInfo?: boolean } = {}
): RoadmapScenarioValidationResult {
  const features = extractFeatures(roadmapSource);

  const scenarios: Array<Scenario & { feature: string }> = [];
  const findings: RoadmapScenarioFinding[] = [];
  const parseErrors: Array<ScenarioParseError & { feature: string }> = [];

  for (const feature of features) {
    const { scenarios: featureScenarios, errors } = parseScenariosInSection(
      feature.body,
      SCENARIOS_HEADING_RE
    );

    for (const e of errors) {
      parseErrors.push({
        ...e,
        line: e.line + feature.start - 1,
        feature: feature.name,
      });
    }

    const idSeen = new Map<string, number>();
    for (const s of featureScenarios) {
      const prior = idSeen.get(s.id);
      if (prior !== undefined) {
        findings.push({
          severity: "blocking",
          scenarioId: s.id,
          field: "id",
          feature: feature.name,
          line: s.sourceLine + feature.start - 1,
          message: `scenario ${s.id}: duplicate id within feature "${feature.name}". A scenario with id ${s.id} already exists at line ${prior}.`,
        });
      } else {
        idSeen.set(s.id, s.sourceLine + feature.start - 1);
      }

      const ctx: ScenarioValidationContext = {
        // Roadmap features rarely declare state machines locally — leave
        // parentStates undefined so stateRef resolution is skipped with info.
        localTags: options.localTags,
        emitInfo: options.emitInfo,
        parentName: feature.name,
      };
      const sf = validateScenario(s, ctx);
      for (const f of sf) {
        findings.push({
          ...f,
          feature: feature.name,
          line: s.sourceLine + feature.start - 1,
        });
      }

      scenarios.push({
        ...s,
        sourceLine: s.sourceLine + feature.start - 1,
        feature: feature.name,
      });
    }
  }

  // Cross-feature collision check — warning.
  const crossFeature = new Map<string, Array<Scenario & { feature: string }>>();
  for (const s of scenarios) {
    const arr = crossFeature.get(s.id) ?? [];
    arr.push(s);
    crossFeature.set(s.id, arr);
  }
  for (const [id, copies] of crossFeature.entries()) {
    const distinctFeatures = new Set(copies.map((c) => c.feature));
    if (distinctFeatures.size > 1) {
      const featureList = Array.from(distinctFeatures).join(", ");
      for (const c of copies) {
        findings.push({
          severity: "warning",
          scenarioId: id,
          field: "id",
          feature: c.feature,
          line: c.sourceLine,
          message: `scenario ${id}: id appears in multiple features (${featureList}). Roadmap scenario ids should be globally unique within a roadmap document.`,
        });
      }
    }
  }

  return { scenarios, findings, parseErrors };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractFeatures(source: string): FeatureSlice[] {
  const lines = source.split("\n");
  const features: FeatureSlice[] = [];
  let current: { name: string; start: number; lines: string[] } | null = null;

  const flush = (endLine: number) => {
    if (!current) return;
    features.push({
      name: current.name,
      start: current.start,
      end: endLine,
      body: current.lines.join("\n"),
    });
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FEATURE_HEADING_RE.test(line)) {
      flush(i);
      const name = line.replace(/^###\s+/, "").trim();
      current = { name, start: i + 1, lines: [line] };
      continue;
    }
    // Higher-level heading ends the feature.
    if (/^#{1,2}\s/.test(line) && current) {
      flush(i);
    }
    if (current) current.lines.push(line);
  }
  flush(lines.length);

  return features;
}
