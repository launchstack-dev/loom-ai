# Rubric: Risks & Mitigations

The Risks & Mitigations section enumerates known risks alongside concrete mitigation strategies. A strong risk entry has three fields: a specific risk description (not a generic category), a severity rating (high/medium/low), and an actionable mitigation that names what will be done if the risk materializes. Risk identification is a maturity signal — claiming zero risks suggests insufficient analysis, while listing only abstract "unknowns" suggests the team hasn't engaged seriously with the project's actual failure modes.

## Green

> "| Risk | Severity | Mitigation |
> |------|----------|------------|
> | Parallel planning doubles token cost at plan creation | medium | Both agents read the same compact input (roadmap feature, not full roadmap). Interpretation-reviewer reads summaries, not full outputs. Net cost increase ~40% at plan time, offset by fewer convergence iterations. |
> | OpenCode hooks don't intercept subagent tool calls (#5894) | high | Blocked until resolved. Budget and ownership enforcement has a real gap on OpenCode subagents. Do not ship until fixed. |
> | SQLite write contention under concurrent users | medium | Use WAL mode; document single-writer limitation in README and surface a 503 with retry-after on lock contention. |"

This is green because every risk is concrete (it names the specific failure mode — "parallel planning doubles cost", not "performance risks"), severity is rated, and mitigation is actionable. Two of the three mitigations name external references (a GitHub issue, a SQLite mode), making them verifiable. The third commits to surfacing a specific HTTP status code, which is testable. A reviewer can ask "did we put SQLite in WAL mode?" and the answer is yes/no.

## Yellow

> "| Risk | Severity | Mitigation |
> |------|----------|------------|
> | Performance issues | medium | We'll monitor and optimize |
> | Bugs | low | Write tests |
> | Scope creep | medium | Be careful |"

This is yellow because the risks are present in name but generic ("performance issues" applies to every project), and the mitigations are non-actionable ("we'll monitor", "be careful"). "Write tests" is already implied by the Success Metrics section — listing it as a risk mitigation adds no new commitment. Reviewer should echo: "name the specific performance failure mode (which endpoint? what threshold?); replace 'be careful' with a concrete mechanism like an Out-of-Scope section enforced at plan-review time."

## Red

> "## Risks & Mitigations
>
> *(no risks identified)*"

This is red because the section exists but is empty. Every non-trivial project has risks; an empty risks section signals that either the project hasn't been analyzed or the author is hiding known issues. The schema requires at least one risk. Reviewer must mark as blocking — an empty risks section is a stronger negative signal than weak risks, because it suggests the author either does not understand the project or is presenting a sanitized view that downstream agents cannot trust.


## Prescribe-to-10

If this dimension scored below 10, the reviewer MUST include specific prescriptive text: "To reach 10, this roadmap should <specific action>." No vague guidance — name the exact fix.
