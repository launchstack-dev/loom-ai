---
pageId: decision-distribution-plugin-first
category: decision
tags[5]: distribution,plugin,curl,marketplace,file-based-install
updatedAt: 2026-07-01T00:00:00Z
updatedBy: wiki-maintainer-agent
staleness: fresh
summary: Debate resolved to keep plugin as first-class distribution channel; marketplace listing is the discovery path; owner plugin-friction is P0; curl install elevated to co-equal status. File-based-only pivot rejected.
estimatedTokens: 580
bodySections[3]: Summary,Rationale,Alternatives Considered
sourceRefs[1]:
  .plan-execution/debate-20260701T215846.toon
crossRefs[0]:
---

## Summary

On 2026-07-01 a structured debate concluded that Loom's plugin-first distribution model should be retained. The marketplace listing remains the primary discovery channel; plugin friction experienced by the repo owner is treated as a P0 defect (not as evidence the model is wrong); and the `curl | sh` installation path is elevated to co-equal status alongside the plugin path. A full pivot to file-based install (pocock/gstack style) was rejected. Confidence in the decision is **medium** (the owner-friction signal was real and the curl path was under-invested before this decision).

## Rationale

1. **Discovery and activation are constraints in series.** Marketplace listing is where users discover Loom; the plugin install is the activation step. Collapsing discovery into a file-download flow (no marketplace presence) removes the top-of-funnel without solving activation.

2. **Customization audience self-routes off plugin.** Advanced users who want registry-owned root or deep customization already exit the plugin flow at install time. The plugin path is not a barrier for them.

3. **Marketplace listing IS a plugin install.** Verified against Claude Code docs: the marketplace entry is welded to the plugin mechanism — there is no "marketplace listing without plugin" option. A file-based-only pivot would require abandoning marketplace discoverability entirely.

4. **Hooks are not plugin-exclusive.** `register-loom-hooks.ts` demonstrates that hook registration works independently of the plugin. The curl path can deliver full hook wiring without requiring the plugin to be the install vector.

5. **Owner friction is a defect, not a signal to pivot.** The debate surfaced that the first-run experience for the repository owner (not external users) was genuinely rough. This is a P0 DX defect to fix in the plugin install flow — it does not invalidate the model.

## Alternatives Considered

| Alternative | Verdict | Reason rejected |
|---|---|---|
| Full pivot to file-based install (pocock/gstack style) | Rejected | Loses marketplace discoverability; hooks are already plugin-independent so the gain is marginal |
| Marketplace listing without plugin (listing-only) | Not viable | Claude Code docs confirm marketplace listing is welded to plugin install |
| Plugin as primary + curl as secondary (status quo ante) | Superseded | curl path elevated to co-equal; both paths must reach feature parity |
| Defer curl elevation until plugin friction fixed | Rejected | Parallel tracks; fixing owner friction and elevating curl are independent workstreams |
