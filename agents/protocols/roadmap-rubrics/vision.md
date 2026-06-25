---
description: "Rubric: Vision"
---

# Rubric: Vision

The Vision section answers three coupled questions in 2-5 sentences: **what** is being built, **for whom**, and **why now**. A strong vision is falsifiable (a different audience or different timing would change the answer), bounded (it implies what is NOT being built), and grounded (it names a concrete pain or shift in the world, not a generic aspiration). It is the document's hardest-to-revise commitment — everything downstream inherits its framing.

## Green

> "A lightweight task-management API for solo developers and 2-5-person teams who want a self-hosted, privacy-first alternative to Trello. Built now because every existing solution requires a cloud account and none support local-first data, while small-team demand for self-hosting has measurably grown since the 2024 SaaS-pricing wave. Scope is deliberately limited to boards, tasks, and assignment — no real-time collaboration, no mobile clients."

This is green because the **what** ("task-management API"), **for whom** ("solo developers and 2-5-person teams who want self-hosted, privacy-first"), and **why now** ("SaaS-pricing wave / local-first demand") are each concrete and falsifiable. A reader can immediately tell whether a proposed feature serves this audience. The closing sentence does explicit scope-exclusion work, which means the Out-of-Scope section can cite it as a derivation rather than re-litigate the framing.

## Yellow

> "A modern task-management tool for developers. Existing options are bloated and we want something simpler and more performant. Built with TypeScript and SQLite for reliability."

This is yellow because the **what** is generic ("task-management tool"), the **for whom** drifts ("developers" is too broad to constrain scope — solo? enterprise? open-source maintainers?), and the **why now** is missing entirely (the rationale collapses into "existing options are bloated", which is a competitor critique, not a strategic justification). The closing sentence describes implementation, not vision. The reviewer agent should echo: "audience is unbounded — narrow it to a concrete user segment; add a why-now clause that names the shift in the world that makes this the right moment."

## Red

> "A platform for productivity."

This is red because all three required answers are absent. "Platform" reveals nothing about what is being built. "Productivity" is not an audience. There is no temporal framing. A roadmap with this vision cannot constrain its own scope, prioritization, or success metrics — every feature is equally defensible because nothing is excluded. Reviewer must mark as blocking and refuse to evaluate downstream dimensions until the vision is rewritten.
