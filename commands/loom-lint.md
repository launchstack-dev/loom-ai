# Structural Health Check

You run comprehensive structural health checks across project artifacts — wiki integrity, contract drift, plan-reality divergence, and execution state consistency. Produces a prioritized findings report and can auto-fix where safe.

## Requirements

$ARGUMENTS

Parse arguments:
- No args: run all checks (wiki + execution)
- `--wiki`: wiki-only checks (W-* rules)
- `--contracts`: contract drift detection only (E-001)
- `--plan`: plan-reality divergence only (E-002)
- `--execution`: all execution checks (E-*)
- `--fix`: auto-fix where possible (orphaned index entries, missing cross-refs, count drift)
- `--severity <level>`: minimum severity to report: `blocking`, `warning`, `info` (default: `info`)

## Instructions

### Step 0: Read Protocols

Read these files for context:
- `~/.claude/agents/protocols/wiki-lint-rules.md` — full check catalog with IDs, severity, auto-fix rules
- `~/.claude/agents/protocols/wiki-conventions.md` — staleness model, cross-ref rules
- `~/.claude/agents/protocols/toon-format.md` — TOON format reference

### Step 1: Pre-flight

1. Check if `.loom/wiki/` exists. If not and wiki checks requested:
   ```
   Wiki not found at .loom/wiki/. Skipping wiki checks.
   Run `/loom-init` to create the wiki.
   ```
   If only wiki checks requested (`--wiki`): stop here.

2. Read `.loom/wiki/index.toon` if wiki exists.
3. Check if `.plan-execution/` exists for execution checks.

### Step 2: Spawn wiki-lint-agent

If wiki checks are in scope:

```
subagent_type: "general-purpose"
```

Prompt: "Read your instructions from `~/.claude/agents/wiki-lint-agent.md` first." Then provide:
- Check scope: `{wiki | all | execution — based on flags}`
- Severity filter: `{--severity value or "info"}`
- Wiki path: `.loom/wiki`
- Fix mode: `{report | fix — based on --fix flag}`

### Step 3: Execution Checks

If execution checks are in scope AND `.plan-execution/` exists:

Run the E-* checks inline (these are structural comparisons, not agent work):

1. **E-001 (Contract drift):** Read `contracts/manifest.toon`, check if contract files differ from wiki page `sourceRefs` timestamps.
2. **E-002 (Plan-reality divergence):** Read PLAN.md phase statuses, cross-reference with wiki pages.
3. **E-003 (Orphaned exports):** Read wave summaries, check export coverage in wiki.
4. **E-004 (Unaddressed review findings):** Read `.plan-history/reviews/`, check for decision pages.
5. **E-005 (Stale rolling context):** Check rolling-context.md against wiki content.
6. **E-006 (Unresolved requests):** Check `.plan-execution/requests/` for open entries.

### Step 4: Aggregate and Report

Combine findings from wiki-lint-agent and execution checks. Display sorted by severity:

```
## Lint Report

### Blocking ({N})
  E-001  Contract drift        contracts/types.ts modified after Wave 0 without wiki update

### Warning ({N})
  W-001  Orphaned page         tech-debt-old-migrations not in index.toon
  W-004  Broken cross-ref      component-auth-middleware → decision-old-auth (not found)
  E-004  Unaddressed finding   Critical security finding sec-003 has no wiki decision page

### Info ({N})
  W-013  Source ref stale       component-user-service ← src/services/user.ts modified
  W-003  Stale page             convention-error-handling last updated 45 days ago

---
Summary: {blocking} blocking, {warning} warning, {info} info
{if --fix: "Auto-fixed: {N} issues"}
```

### Step 5: Auto-fix (if --fix)

For issues marked auto-fixable in `wiki-lint-rules.md`:
1. Apply each fix (details in the lint rules doc)
2. Display what was fixed:
   ```
   ## Auto-fixes Applied

   W-001  Added tech-debt-old-migrations to index.toon
   W-004  Removed broken cross-ref decision-old-auth from component-auth-middleware
   W-008  Updated pageCount in index.toon (was 46, now 47)
   ```
3. Re-run a quick verification to confirm fixes resolved the issues

## Error Handling

- **No wiki and no execution state:** "Nothing to lint. Run `/loom-init` to create a wiki, or `/loom-execute-plan` to generate execution artifacts."
- **Lint agent fails:** Report any findings collected before failure. Suggest re-running with a narrower scope.
- **Auto-fix fails on a specific issue:** Log the failure, continue with remaining fixes.

## Status Line

```toon
command: lint
phase: {preflight | checking-wiki | checking-execution | fixing | complete}
findings: {count}
updatedAt: {ISO timestamp}
```
