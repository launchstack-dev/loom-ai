# Wiki Lint Rules

Structural health check rules for the wiki-lint-agent and `/loom-lint` command. These rules detect inconsistencies, staleness, and drift across wiki pages and execution artifacts.

## Wiki Checks

These checks apply to the wiki structure in `.loom/wiki/`.

| ID | Check | Severity | Description | Auto-fixable |
|----|-------|----------|-------------|-------------|
| W-001 | Orphaned page | warning | Page file exists in `pages/` but is not listed in `index.toon` | Yes — add to index |
| W-002 | Missing page | blocking | Page is listed in `index.toon` but file does not exist in `pages/` | Yes — remove from index |
| W-003 | Stale page | info | Page `staleness` is `stale` (updatedAt exceeds 2x threshold) | No — requires content review |
| W-004 | Broken cross-ref | warning | `crossRefs` entry references a `pageId` that does not exist | Yes — remove broken ref |
| W-005 | Duplicate pageId | blocking | Two or more page files have the same `pageId` in frontmatter | No — requires manual resolution |
| W-006 | Missing cross-refs | info | Page body mentions entities matching other page titles but has no corresponding `crossRefs` entry | Yes — add cross-ref |
| W-007 | Contradiction | warning | Two pages make conflicting claims about the same entity (detected via keyword + assertion comparison) | No — requires human review |
| W-008 | Index count drift | warning | `pageCount` in `index.toon` does not match actual file count in `pages/` | Yes — recount and update |
| W-009 | Log integrity | info | `entryCount` in `log.toon` does not match actual entry count | Yes — recount and update |
| W-010 | Category count drift | warning | Category counts in `index.toon` do not match actual page distribution | Yes — recount and update |
| W-011 | Frontmatter missing | blocking | Page file exists but has no valid TOON frontmatter block | No — requires page rebuild |
| W-012 | PageId-filename mismatch | blocking | Page's `pageId` does not match its filename (without `.md`) | Yes — rename file to match |
| W-013 | Source ref stale | info | A `sourceRefs` file has been modified more recently than the page's `updatedAt` | No — requires content review |

## Execution/Project Checks

These checks detect drift between wiki knowledge and actual project state. They require reading files from `.plan-execution/`, `.plan-history/`, and the codebase.

| ID | Check | Severity | Description | Auto-fixable |
|----|-------|----------|-------------|-------------|
| E-001 | Contract drift | blocking | Contract files in `.plan-execution/contracts/` have been modified since Wave 0 completed, but no wiki page reflects the changes | No — contracts should be immutable |
| E-002 | Plan-reality divergence | warning | PLAN.md phases marked `completed` but wiki pages reference components described as unimplemented or pending | No — requires investigation |
| E-003 | Orphaned exports | warning | Exports listed in wave summaries (`.plan-execution/wave-N-summary.toon`) are not referenced by any wiki page | Yes — create stub pages |
| E-004 | Unaddressed review findings | warning | Review findings in `.plan-history/reviews/` with severity `critical` or `warning` have no corresponding wiki decision page explaining resolution | No — requires human decision |
| E-005 | Stale rolling context | info | `rolling-context.md` references waves older than cold tier threshold with information that contradicts wiki pages | No — requires context rebuild |
| E-006 | Unresolved cross-boundary requests | warning | Request files in `.plan-execution/requests/` have no corresponding resolution in wave summaries or wiki pages | No — requires investigation |

## How Checks Are Executed

### Wiki checks (W-*)

1. Read `index.toon` to get the page catalog
2. List all `.md` files in `pages/` directory
3. For each check, iterate pages and apply the rule:
   - **W-001**: File exists but not in index → orphaned
   - **W-002**: In index but file missing → missing
   - **W-003**: Compute staleness from `updatedAt` → flag if stale
   - **W-004**: For each `crossRefs` entry, verify target pageId exists in index
   - **W-005**: Collect all pageIds, check for duplicates
   - **W-006**: Read page body, extract entity mentions, compare against index titles
   - **W-007**: For each entity mentioned in 2+ pages, compare assertions (heuristic — look for contradictory adjectives, numbers, or statuses)
   - **W-008 through W-010**: Count-based consistency checks
   - **W-011 through W-013**: Frontmatter validation and filename consistency

### Execution checks (E-*)

1. Check if `.plan-execution/` exists (skip all E-* checks if not)
2. Read `state.toon` for wave status and file hashes
3. Read wave summaries for export lists
4. Read `.plan-history/reviews/` for unaddressed findings
5. Cross-reference against wiki pages

## Output Format

Wiki-lint-agent returns findings in the standard reviewer format:

```toon
reviewer: wiki-lint-agent
findings[N]{id,severity,category,description,file,suggestion}:
  W-001,warning,orphaned-page,Page tech-debt-old-migrations not in index.toon,.loom/wiki/pages/tech-debt-old-migrations.md,Add to index.toon or delete page
  W-004,warning,broken-crossref,component-auth-middleware references decision-old-auth which does not exist,.loom/wiki/pages/component-auth-middleware.md,Update crossRef to decision-auth-strategy or remove
  W-013,info,source-ref-stale,component-user-service sourceRef src/services/user.ts modified after page,.loom/wiki/pages/component-user-service.md,Re-run /loom-ingest --source src/services/user.ts
summary:
  blocking: 0
  warning: 2
  info: 1
```

## Auto-Fix Rules

When `/loom-lint --fix` is used, auto-fixable checks are resolved:

1. **W-001** (orphaned page): Read page frontmatter, add entry to `index.toon`
2. **W-002** (missing page): Remove entry from `index.toon`
3. **W-004** (broken cross-ref): Remove the broken `crossRefs` entry from the page
4. **W-006** (missing cross-refs): Add `crossRefs` entries with `relates-to` relationship
5. **W-008/W-009/W-010** (count drift): Recompute counts from actual data
6. **W-012** (pageId-filename mismatch): Rename file to match `pageId`
7. **E-003** (orphaned exports): Create minimal stub pages for undocumented exports

All auto-fixes are logged to `log.toon` with operation `lint-fix`.
