```toon
pageId: decision-sign-off-purity
title: Sign-Off as Sole Path to Converged
category: decision
domain: code
createdAt: 2026-06-17T00:00:00Z
updatedAt: 2026-06-17T00:00:00Z
createdBy: wiki-maintainer-agent
updatedBy: wiki-maintainer-agent
summary: Structural guarantee — only /loom-roadmap sign-off can write sign_off_state = signed-off, enforced by file isolation and a CI grep guard.
estimatedTokens: 500
bodySections[3]: Summary, Rationale, Alternatives Considered
subtype:
sourceRefs[3]: planning/plans/PLAN-roadmap-converge-harness.md, commands/loom-roadmap/sign-off.md, scripts/roadmap-converge/sign-off.ts
crossRefs[3]{pageId,relationship}:
  concept-roadmap-convergence,decides
  component-roadmap-converge-driver,relates-to
  component-roadmap-converge-state,relates-to
tags[5]: sign-off, decision, F-15, M-07, regression-guard
staleness: fresh
confidence: high
```

# Sign-Off as Sole Path to Converged

## Summary

A roadmap reaches the terminal `converged` state ONLY via an explicit user invocation of `/loom-roadmap sign-off`. No reviewer, integrator, driver, or hook may auto-fire sign-off, even when every dimension is green and every open question is resolved. The most the loop can do automatically is set `sign_off_state = "eligible"`.

The guarantee is structural, not procedural:

1. `/loom-roadmap sign-off` is the only command file allowed to invoke `scripts/roadmap-converge/sign-off.ts`.
2. `sign_off.ts` is the only file allowed to write the literal string `sign_off_state = "signed-off"`.
3. A vitest grep test enforces (2) by scanning every `.ts` file in `scripts/roadmap-converge/` except `sign-off.ts` for that literal and failing the suite on any match.
4. The CI verification command makes the grep run during the standard pipeline:
   ```bash
   ! grep -RIn 'sign_off_state\s*=\s*"signed-off"' scripts/roadmap-converge/ \
       | grep -v 'scripts/roadmap-converge/sign-off.ts'
   ```

## Rationale

Roadmap convergence is **subjective**. Reviewer agents grade against pedagogical rubrics, not deterministic targets — meaning "all dimensions green" is an inference, not a proof. Sign-off is the human gate that converts that inference into project consent. If automation could close the gate, the loop's user-facing contract (the human owns the meaning of "done") would collapse to whatever the rubric authors believed at the time the rubrics were written.

The structural enforcement matters because the cost of a stray automated sign-off is high: the converged state is treated as the source of truth by downstream tooling, and re-opening it requires manual re-run with `--force`. Procedural conventions (code review, docstring warnings) are not enough — F-15 commits to a mechanically-checkable invariant so that a future agent or contributor cannot accidentally route around it.

The 30-second diff view rendered before confirmation is the second half of the contract: it ensures the human has the relevant evidence (what changed since the last sign-off) in front of them at the moment of consent. Empty-diff and no-pager fallbacks keep the rendering robust without ever short-circuiting the prompt.

## Alternatives Considered

- **Auto-sign-off when all-green AND zero unresolved.** Rejected: collapses the subjective gate; makes the loop trust the rubrics absolutely.
- **Sign-off as a flag on `/loom-roadmap converge`** (e.g., `--auto-sign-off`). Rejected: keeps the structural-guarantee surface ambiguous and gives automation an obvious vector.
- **Convention-only enforcement** (docstring warnings, code review). Rejected: not mechanically checkable; degrades silently as the codebase grows.
- **Separate sign-off agent** instead of a separate script file. Rejected: agents are invoked from multiple call sites; the grep guard requires file-level isolation.
