/**
 * Tests for the pure aggregator in `scripts/lib/aggregate-findings.ts`.
 *
 * The aggregator is the deterministic core of the plan-review convergence
 * harness. These tests exercise the locked severity mapping, ID sequencing,
 * dimension derivation, partial-failure behavior, invariant enforcement,
 * and TOON encoding — without any file I/O.
 *
 * Schema reference: `agents/protocols/findings.schema.md`
 */

import { describe, it, expect } from "vitest";

import {
  aggregateFindings,
  deriveDimension,
  encodeFindingsToToon,
  severityToConvergenceSeverity,
  CANONICAL_DIMENSIONS,
  CANONICAL_REVIEWER_AGENTS,
  FindingsInvariantViolation,
  type AgentResultEnvelope,
  type AgentResultIssue,
  type AgentIssueSeverity,
} from "../../scripts/lib/aggregate-findings.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SUBJECT = "planning/PLAN-convergence-generalization.md";

function fixedNow(): () => Date {
  return () => new Date("2026-06-13T12:00:00.000Z");
}

function envelope(
  agent: string,
  status: AgentResultEnvelope["status"],
  issues: AgentResultIssue[] = [],
): AgentResultEnvelope {
  return { agent, status, issues };
}

function issue(
  severity: AgentIssueSeverity,
  overrides: Partial<AgentResultIssue> = {},
): AgentResultIssue {
  return {
    severity,
    message: overrides.message ?? `issue with severity ${severity}`,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Severity mapping
// ---------------------------------------------------------------------------

describe("severityToConvergenceSeverity", () => {
  it("maps each AgentResult severity per findings.schema.md § Severity Mapping", () => {
    expect(severityToConvergenceSeverity("critical")).toBe("blocking");
    expect(severityToConvergenceSeverity("high")).toBe("blocking");
    expect(severityToConvergenceSeverity("medium")).toBe("warning");
    expect(severityToConvergenceSeverity("low")).toBe("info");
    expect(severityToConvergenceSeverity("info")).toBe("info");
    expect(severityToConvergenceSeverity("advisory")).toBe("info");
  });
});

// ---------------------------------------------------------------------------
// Dimension derivation
// ---------------------------------------------------------------------------

describe("deriveDimension", () => {
  it("strips the -reviewer-agent suffix for each of the 6 canonical reviewers", () => {
    const pairs: Array<[string, string]> = [
      ["feature-coverage-reviewer-agent", "feature-coverage"],
      ["strategy-reviewer-agent", "strategy"],
      ["ux-reviewer-agent", "ux"],
      ["phasing-reviewer-agent", "phasing"],
      ["parallelization-reviewer-agent", "parallelization"],
      ["agentic-workflow-reviewer-agent", "agentic-workflow"],
    ];
    for (const [name, expected] of pairs) {
      expect(deriveDimension(name)).toBe(expected);
    }
  });

  it("throws FindingsInvariantViolation for unknown reviewer agent names", () => {
    expect(() => deriveDimension("unknown-agent")).toThrow(
      FindingsInvariantViolation,
    );
    expect(() => deriveDimension("feature-coverage-agent")).toThrow(
      /FINDINGS_SCHEMA_INVALID/,
    );
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("aggregateFindings — happy path with 6 reviewers", () => {
  it("flattens findings in canonical reviewer order with sequential F-NN ids", () => {
    const envelopes: AgentResultEnvelope[] = [
      envelope("ux-reviewer-agent", "success", [
        issue("medium", { message: "ux issue 1" }),
      ]),
      envelope("feature-coverage-reviewer-agent", "success", [
        issue("critical", { message: "fc issue 1" }),
        issue("high", { message: "fc issue 2" }),
      ]),
      envelope("strategy-reviewer-agent", "success", [
        issue("low", { message: "strategy issue 1" }),
      ]),
      envelope("phasing-reviewer-agent", "success", []),
      envelope("parallelization-reviewer-agent", "success", [
        issue("info", { message: "parallel info" }),
      ]),
      envelope("agentic-workflow-reviewer-agent", "success", [
        issue("advisory", { message: "workflow advisory" }),
      ]),
    ];

    const findings = aggregateFindings({
      subject: SUBJECT,
      iteration: 1,
      envelopes,
      now: fixedNow(),
    });

    expect(findings.subject).toBe(SUBJECT);
    expect(findings.harnessName).toBe("plan-review");
    expect(findings.iteration).toBe(1);
    expect(findings.producedAt).toBe("2026-06-13T12:00:00.000Z");

    // Order: feature-coverage (2) -> strategy (1) -> ux (1) -> phasing (0)
    //        -> parallelization (1) -> agentic-workflow (1) = 6 findings.
    expect(findings.findings.length).toBe(6);

    // IDs sequence F-01..F-06.
    expect(findings.findings.map((f) => f.id)).toEqual([
      "F-01",
      "F-02",
      "F-03",
      "F-04",
      "F-05",
      "F-06",
    ]);

    // Reviewer attribution preserved (W-03).
    expect(findings.findings.map((f) => f.reviewerAgent)).toEqual([
      "feature-coverage-reviewer-agent",
      "feature-coverage-reviewer-agent",
      "strategy-reviewer-agent",
      "ux-reviewer-agent",
      "parallelization-reviewer-agent",
      "agentic-workflow-reviewer-agent",
    ]);

    // Dimensions derived from reviewer names.
    expect(findings.findings.map((f) => f.dimension)).toEqual([
      "feature-coverage",
      "feature-coverage",
      "strategy",
      "ux",
      "parallelization",
      "agentic-workflow",
    ]);

    // Severities mapped per the table.
    expect(findings.findings.map((f) => f.severity)).toEqual([
      "blocking",
      "blocking",
      "info",
      "warning",
      "info",
      "info",
    ]);

    // blockingCount = critical+high = 2; advisoryCount = warning+info*3 = 4.
    expect(findings.blockingCount).toBe(2);
    expect(findings.advisoryCount).toBe(4);
    expect(findings.findings.length).toBe(
      findings.blockingCount + findings.advisoryCount,
    );
  });
});

// ---------------------------------------------------------------------------
// Empty findings — convergence reached
// ---------------------------------------------------------------------------

describe("aggregateFindings — empty findings", () => {
  it("returns blockingCount=0, advisoryCount=0, findings=[] when no reviewer raises issues", () => {
    const envelopes = CANONICAL_REVIEWER_AGENTS.map((name) =>
      envelope(name, "success", []),
    );
    const findings = aggregateFindings({
      subject: SUBJECT,
      iteration: 3,
      envelopes,
      now: fixedNow(),
    });
    expect(findings.findings).toEqual([]);
    expect(findings.blockingCount).toBe(0);
    expect(findings.advisoryCount).toBe(0);
    expect(findings.iteration).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Severity mapping — exhaustive per-row
// ---------------------------------------------------------------------------

describe("aggregateFindings — severity mapping covers all 6 AgentResult values", () => {
  it("maps each of the 6 AgentResult severities to the right Convergence severity + counter", () => {
    // One reviewer emits all 6 issue severities in a known order; we
    // assert each row's mapped severity matches the schema table.
    const allSeverities: AgentIssueSeverity[] = [
      "critical",
      "high",
      "medium",
      "low",
      "info",
      "advisory",
    ];
    const envelopes: AgentResultEnvelope[] = [
      envelope(
        "feature-coverage-reviewer-agent",
        "success",
        allSeverities.map((s) =>
          issue(s, { message: `msg-${s}` }),
        ),
      ),
    ];

    const findings = aggregateFindings({
      subject: SUBJECT,
      iteration: 1,
      envelopes,
      now: fixedNow(),
    });

    expect(findings.findings.map((f) => f.severity)).toEqual([
      "blocking",
      "blocking",
      "warning",
      "info",
      "info",
      "info",
    ]);
    expect(findings.blockingCount).toBe(2);
    expect(findings.advisoryCount).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Partial-failure
// ---------------------------------------------------------------------------

describe("aggregateFindings — partial failure", () => {
  it("a reviewer with status=failure contributes zero findings; others still aggregate", () => {
    const envelopes: AgentResultEnvelope[] = [
      envelope("feature-coverage-reviewer-agent", "success", [
        issue("high", { message: "fc high" }),
      ]),
      envelope("strategy-reviewer-agent", "failure", [
        // These issues MUST be ignored because status=failure.
        issue("critical", { message: "strategy crit — should be ignored" }),
      ]),
      envelope("ux-reviewer-agent", "success", [
        issue("medium", { message: "ux medium" }),
      ]),
      envelope("phasing-reviewer-agent", "success", []),
      envelope("parallelization-reviewer-agent", "success", []),
      envelope("agentic-workflow-reviewer-agent", "success", []),
    ];

    const findings = aggregateFindings({
      subject: SUBJECT,
      iteration: 2,
      envelopes,
      now: fixedNow(),
    });

    expect(findings.findings.length).toBe(2);
    expect(findings.findings.map((f) => f.reviewerAgent)).toEqual([
      "feature-coverage-reviewer-agent",
      "ux-reviewer-agent",
    ]);
    expect(findings.blockingCount).toBe(1);
    expect(findings.advisoryCount).toBe(1);
  });

  it("works with fewer than 6 envelopes (driver only managed to spawn some)", () => {
    const envelopes: AgentResultEnvelope[] = [
      envelope("feature-coverage-reviewer-agent", "success", [
        issue("critical"),
      ]),
      envelope("phasing-reviewer-agent", "success", [issue("medium")]),
    ];
    const findings = aggregateFindings({
      subject: SUBJECT,
      iteration: 1,
      envelopes,
      now: fixedNow(),
    });
    expect(findings.findings.length).toBe(2);
    expect(findings.blockingCount).toBe(1);
    expect(findings.advisoryCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Stable ID assignment across envelopes
// ---------------------------------------------------------------------------

describe("aggregateFindings — ID assignment is stable across reviewer order", () => {
  it("F-NN ids walk envelopes in canonical reviewer order regardless of input ordering", () => {
    // Pass envelopes in REVERSE canonical order.
    const reversed = [...CANONICAL_REVIEWER_AGENTS].reverse();
    const envelopes: AgentResultEnvelope[] = reversed.map((name, i) =>
      envelope(name, "success", [
        issue("medium", { message: `from ${name}`, location: `idx-${i}` }),
      ]),
    );

    const findings = aggregateFindings({
      subject: SUBJECT,
      iteration: 1,
      envelopes,
      now: fixedNow(),
    });

    // Output should follow canonical order, not the input order.
    expect(findings.findings.map((f) => f.reviewerAgent)).toEqual([
      "feature-coverage-reviewer-agent",
      "strategy-reviewer-agent",
      "ux-reviewer-agent",
      "phasing-reviewer-agent",
      "parallelization-reviewer-agent",
      "agentic-workflow-reviewer-agent",
    ]);
    expect(findings.findings.map((f) => f.id)).toEqual([
      "F-01",
      "F-02",
      "F-03",
      "F-04",
      "F-05",
      "F-06",
    ]);
  });

  it("uses zero-padded 2-digit format for F-NN ids (F-01 not F-1)", () => {
    const envelopes: AgentResultEnvelope[] = [
      envelope(
        "feature-coverage-reviewer-agent",
        "success",
        Array.from({ length: 12 }, (_, i) => issue("info", { message: `m${i}` })),
      ),
    ];
    const findings = aggregateFindings({
      subject: SUBJECT,
      iteration: 1,
      envelopes,
      now: fixedNow(),
    });
    expect(findings.findings[0].id).toBe("F-01");
    expect(findings.findings[9].id).toBe("F-10");
    expect(findings.findings[11].id).toBe("F-12");
  });
});

// ---------------------------------------------------------------------------
// Dimension derivation in aggregator
// ---------------------------------------------------------------------------

describe("aggregateFindings — dimension derivation from reviewer name", () => {
  it("derives dimension from reviewer agent name when issue omits the dimension field", () => {
    const envelopes: AgentResultEnvelope[] = [
      envelope("strategy-reviewer-agent", "success", [
        issue("high", { message: "no dimension provided" }),
      ]),
    ];
    const findings = aggregateFindings({
      subject: SUBJECT,
      iteration: 1,
      envelopes,
      now: fixedNow(),
    });
    expect(findings.findings[0].dimension).toBe("strategy");
  });

  it("respects an explicit dimension override on the issue when present", () => {
    const envelopes: AgentResultEnvelope[] = [
      envelope("strategy-reviewer-agent", "success", [
        // Reviewer explicitly tags the issue as a phasing concern.
        issue("medium", {
          message: "really a phasing issue",
          dimension: "phasing",
        }),
      ]),
    ];
    const findings = aggregateFindings({
      subject: SUBJECT,
      iteration: 1,
      envelopes,
      now: fixedNow(),
    });
    expect(findings.findings[0].dimension).toBe("phasing");
  });

  it("the 6 canonical dimensions match the 6 canonical reviewer agents one-to-one", () => {
    expect(CANONICAL_DIMENSIONS.length).toBe(6);
    expect(CANONICAL_REVIEWER_AGENTS.length).toBe(6);
    for (let i = 0; i < 6; i++) {
      expect(CANONICAL_REVIEWER_AGENTS[i]).toBe(
        `${CANONICAL_DIMENSIONS[i]}-reviewer-agent`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Invariant enforcement
// ---------------------------------------------------------------------------

describe("aggregateFindings — invariant enforcement", () => {
  it("throws FindingsInvariantViolation when iteration is not a positive integer", () => {
    expect(() =>
      aggregateFindings({
        subject: SUBJECT,
        iteration: 0,
        envelopes: [],
        now: fixedNow(),
      }),
    ).toThrow(FindingsInvariantViolation);
    expect(() =>
      aggregateFindings({
        subject: SUBJECT,
        iteration: -1,
        envelopes: [],
        now: fixedNow(),
      }),
    ).toThrow(/FINDINGS_SCHEMA_INVALID/);
    expect(() =>
      aggregateFindings({
        subject: SUBJECT,
        iteration: 1.5,
        envelopes: [],
        now: fixedNow(),
      }),
    ).toThrow(/FINDINGS_SCHEMA_INVALID/);
  });

  it("throws FindingsInvariantViolation when subject is empty", () => {
    expect(() =>
      aggregateFindings({
        subject: "",
        iteration: 1,
        envelopes: [],
        now: fixedNow(),
      }),
    ).toThrow(FindingsInvariantViolation);
  });

  it("throws when an envelope references an unknown reviewer name", () => {
    const envelopes: AgentResultEnvelope[] = [
      envelope("nonexistent-reviewer-agent", "success", [issue("high")]),
    ];
    expect(() =>
      aggregateFindings({
        subject: SUBJECT,
        iteration: 1,
        envelopes,
        now: fixedNow(),
      }),
    ).toThrow(/unknown reviewer agent/);
  });

  it("the resulting blockingCount/advisoryCount always match the findings array", () => {
    // Property-style check across a few synthetic envelopes.
    const cases: AgentIssueSeverity[][] = [
      ["critical", "high", "medium", "low", "info", "advisory"],
      ["critical", "critical", "high"],
      ["medium", "medium", "low", "info"],
      [],
      ["advisory"],
    ];

    for (const severities of cases) {
      const envelopes: AgentResultEnvelope[] = [
        envelope(
          "feature-coverage-reviewer-agent",
          "success",
          severities.map((s) => issue(s)),
        ),
      ];
      const findings = aggregateFindings({
        subject: SUBJECT,
        iteration: 1,
        envelopes,
        now: fixedNow(),
      });

      const blocking = findings.findings.filter((f) => f.severity === "blocking").length;
      const advisory = findings.findings.filter(
        (f) => f.severity === "warning" || f.severity === "info",
      ).length;
      expect(findings.blockingCount).toBe(blocking);
      expect(findings.advisoryCount).toBe(advisory);
      expect(findings.findings.length).toBe(blocking + advisory);
    }
  });
});

// ---------------------------------------------------------------------------
// Locked W-01 timestamp precision
// ---------------------------------------------------------------------------

describe("aggregateFindings — locked W-01 timestamp precision", () => {
  it("producedAt is ISO 8601 with millisecond precision", () => {
    const findings = aggregateFindings({
      subject: SUBJECT,
      iteration: 1,
      envelopes: [],
      now: () => new Date("2026-06-13T12:34:56.789Z"),
    });
    expect(findings.producedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    expect(findings.producedAt).toBe("2026-06-13T12:34:56.789Z");
  });

  it("uses real wall-clock when now() is not injected and still satisfies W-01 shape", () => {
    const findings = aggregateFindings({
      subject: SUBJECT,
      iteration: 1,
      envelopes: [],
    });
    expect(findings.producedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });
});

// ---------------------------------------------------------------------------
// Location + suggestion + summary clipping
// ---------------------------------------------------------------------------

describe("aggregateFindings — finding row composition", () => {
  it("locationPath defaults to subject when issue.file is omitted", () => {
    const envelopes: AgentResultEnvelope[] = [
      envelope("feature-coverage-reviewer-agent", "success", [
        issue("high", { message: "no file given" }),
      ]),
    ];
    const findings = aggregateFindings({
      subject: SUBJECT,
      iteration: 1,
      envelopes,
      now: fixedNow(),
    });
    expect(findings.findings[0].locationPath).toBe(SUBJECT);
  });

  it("locationPath uses issue.file when provided", () => {
    const envelopes: AgentResultEnvelope[] = [
      envelope("feature-coverage-reviewer-agent", "success", [
        issue("high", {
          message: "elsewhere",
          file: "src/somewhere.ts",
          location: "function foo",
        }),
      ]),
    ];
    const findings = aggregateFindings({
      subject: SUBJECT,
      iteration: 1,
      envelopes,
      now: fixedNow(),
    });
    expect(findings.findings[0].locationPath).toBe("src/somewhere.ts");
    expect(findings.findings[0].locationAnchor).toBe("function foo");
  });

  it("suggestion is omitted from the output when not present on the issue", () => {
    const envelopes: AgentResultEnvelope[] = [
      envelope("feature-coverage-reviewer-agent", "success", [
        issue("high", { message: "no suggestion" }),
      ]),
    ];
    const findings = aggregateFindings({
      subject: SUBJECT,
      iteration: 1,
      envelopes,
      now: fixedNow(),
    });
    expect(findings.findings[0].suggestion).toBeUndefined();
  });

  it("suggestion is carried through when present", () => {
    const envelopes: AgentResultEnvelope[] = [
      envelope("feature-coverage-reviewer-agent", "success", [
        issue("high", {
          message: "do something",
          suggestion: "do the thing",
        }),
      ]),
    ];
    const findings = aggregateFindings({
      subject: SUBJECT,
      iteration: 1,
      envelopes,
      now: fixedNow(),
    });
    expect(findings.findings[0].suggestion).toBe("do the thing");
  });

  it("summary is clipped to summaryMaxLen and collapsed to a single line", () => {
    const long = "a".repeat(500);
    const envelopes: AgentResultEnvelope[] = [
      envelope("feature-coverage-reviewer-agent", "success", [
        issue("high", { message: `line1\n  line2  \n${long}` }),
      ]),
    ];
    const findings = aggregateFindings({
      subject: SUBJECT,
      iteration: 1,
      envelopes,
      now: fixedNow(),
      summaryMaxLen: 50,
    });
    expect(findings.findings[0].summary.length).toBeLessThanOrEqual(50);
    expect(findings.findings[0].summary).not.toContain("\n");
  });
});

// ---------------------------------------------------------------------------
// TOON encoder
// ---------------------------------------------------------------------------

describe("encodeFindingsToToon", () => {
  it("emits the exact shape shown in findings.schema.md", () => {
    const findings = aggregateFindings({
      subject: SUBJECT,
      iteration: 1,
      envelopes: [
        envelope("phasing-reviewer-agent", "success", [
          issue("critical", {
            message: "Wave 2 has 9 deliverables (>8 limit)",
            location: "##Execution Phases > Phase 3",
            suggestion: "Split Phase 3 into 3a (schema) and 3b (driver branch)",
          }),
        ]),
      ],
      now: () => new Date("2026-06-12T15:30:00.000Z"),
    });

    const toon = encodeFindingsToToon(findings);
    expect(toon).toContain(`subject: ${SUBJECT}`);
    expect(toon).toContain("harnessName: plan-review");
    expect(toon).toContain("iteration: 1");
    expect(toon).toContain("blockingCount: 1");
    expect(toon).toContain("advisoryCount: 0");
    expect(toon).toContain("producedAt: 2026-06-12T15:30:00.000Z");
    expect(toon).toContain(
      "findings[1]{id,dimension,severity,locationPath,locationAnchor,summary,suggestion,reviewerAgent}:",
    );
    expect(toon).toContain("phasing-reviewer-agent");
    expect(toon).toContain("F-01");
  });

  it("emits the empty-findings header form when findings is []", () => {
    const findings = aggregateFindings({
      subject: SUBJECT,
      iteration: 1,
      envelopes: CANONICAL_REVIEWER_AGENTS.map((n) =>
        envelope(n, "success", []),
      ),
      now: fixedNow(),
    });
    const toon = encodeFindingsToToon(findings);
    expect(toon).toContain("blockingCount: 0");
    expect(toon).toContain("advisoryCount: 0");
    expect(toon).toContain(
      "findings[0]{id,dimension,severity,locationPath,locationAnchor,summary,suggestion,reviewerAgent}:",
    );
  });

  it("quotes cells containing commas, quotes, or newlines per RFC 4180", () => {
    const findings = aggregateFindings({
      subject: SUBJECT,
      iteration: 1,
      envelopes: [
        envelope("strategy-reviewer-agent", "success", [
          issue("medium", {
            message: "issue, with comma",
            suggestion: 'fix "this" thing',
          }),
        ]),
      ],
      now: fixedNow(),
    });
    const toon = encodeFindingsToToon(findings);
    expect(toon).toContain('"issue, with comma"');
    expect(toon).toContain('"fix ""this"" thing"');
  });
});
