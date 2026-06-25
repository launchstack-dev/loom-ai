# Rubric: Out of Scope

The Out of Scope section explicitly lists things NOT being built. Its purpose is to prevent scope creep during planning and execution by naming plausible feature requests that someone might assume are included. A strong Out-of-Scope list is calibrated to the project's specific domain — generic exclusions ("we won't build a flight simulator") do no work. The items should be the requests most likely to surface during review or convergence so reviewers can immediately cite the section and refuse expansion without re-litigating.

## Green

> "- Real-time collaboration (WebSocket sync between users) — adds CRDT complexity and a long-lived connection layer that is not justified by the solo/small-team audience
> - Mobile app or native clients — web UI only; mobile users can use the responsive web app
> - Third-party OAuth providers (Google, GitHub login) — credential-based auth only; OAuth adds external dependency we explicitly avoid per C-02 (privacy-first)
> - Multi-tenancy / organization-level isolation — single-tenant self-hosted only; orgs needing isolation run separate instances
> - Internationalization (i18n) — English-only for v1; i18n revisited in v2 if demand surfaces"

This is green because every exclusion is a plausible feature request from the project's target audience (a self-hosted task tool reviewer would absolutely ask "where's mobile?" or "where's SSO?"). Each item carries a one-line rationale tying it back to a vision constraint, a constraint ID, or a deferral plan. A future reviewer who sees a PR adding WebSocket sync can cite this section and close the discussion in one comment. The list is sized to the schema minimum (at least 2) and exceeds it meaningfully.

## Yellow

> "- We won't build everything at once
> - Some features will be added later
> - Performance optimization is for v2"

This is yellow because the section exists with the right number of items but the items are vague ("everything", "some features") and would not stop a real scope-creep request. "Performance optimization is for v2" contradicts the Success Metrics section if that section already lists performance targets — which would surface as a Stage 4 cross-reference warning. Reviewer should echo: "list specific feature requests that are likely to come up — name the technologies or surfaces (WebSocket, mobile, SSO) you are explicitly refusing — so the section can be cited verbatim to close scope-expansion discussions."

## Red

> "## Out of Scope
>
> *(none)*"

This is red because the section is empty (or absent). The schema requires at least 2 items. An empty Out-of-Scope section means every feature request during execution must be re-evaluated from first principles, which defeats the section's purpose. It also signals to reviewers that the author has not seriously considered which adjacent features they will say no to — a roadmap that excludes nothing is committing to everything, and downstream convergence will surface the resulting contradictions as repeated late-stage scope debates. Reviewer must mark as blocking.
