# Project Decisions

Locked decisions made during the discussion phase. Plan generation and execution
must honor these choices. To change a decision, re-run `/loom-roadmap --discuss`.

## D-01: Reviewer Agent Registration
**Decision:** Register via orchestration.toml only (not hardcoded into loom-review-code.md)
**Rationale:** Clean separation, follows existing extensibility pattern, users can enable/disable per-project
**Alternatives considered:** Hardcoding into loom-review-code.md (guaranteed to work but bloats command, harder to customize)
**Impact:** medium

## D-02: Convergence Pattern Scope
**Decision:** Full first-class pattern type — converge joins debate/chain/vote/triage in orchestration-patterns.md and pattern-executor.md
**Rationale:** Consistent with existing architecture, gets budget accounting and error handling for free
**Alternatives considered:** Composite pattern built from chain (simpler but doesn't fit — converge is iterative, chain is linear)
**Impact:** high

## D-03: Agent Model Selection
**Decision:** All reviewers on sonnet (matches security-reviewer precedent); convergence-driver on opus (complex orchestration reasoning); other convergence agents on sonnet
**Rationale:** Sonnet is proven balance for review workloads; convergence-driver needs deeper reasoning for iteration/circuit-breaking logic
**Alternatives considered:** All sonnet (convergence-driver may be too complex), all opus (unnecessary cost for reviewers)
**Impact:** low
