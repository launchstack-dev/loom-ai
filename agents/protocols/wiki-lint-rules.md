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
| W-020 | Flow step-count out of range | warning | Flow page has < 2 steps or > 12 steps (too thin or too monolithic) | No — requires content review |
| W-021 | Flow touches stale | warning | A flow step's `touches` references a file that no longer exists | Yes — flag the row as stale (touches column annotated, no rewrite) |
| W-022 | Orphan contract | warning | Contract page has `producers[]` empty AND `consumers[]` empty | No — requires content review |
| W-023 | Flow exercises nothing | info | Flow page lacks any `crossRefs` of relationship `exercises` | No — requires content review |
| W-024 | One-sided exercised-by | warning | Component page referenced by 2+ flows as `exercised-by` lacks corresponding `exercises` back-link in the flow page | Yes — add inverse `exercises` cross-ref to the flow page |
| W-025 | Body exceeds token cap | warning at 1200 tokens, blocking at 2000 tokens | Page body (frontmatter excluded) exceeds the per-page token cap. Compute from `estimatedTokens - frontmatterTokens` or `Math.ceil(bodyCharCount / 4)`. | No — requires page split or trim |
| W-026 | Summary or required sections missing | warning (info for legacy placeholder) | `summary` missing, > 200 chars, contains markdown, OR required H2 sections per the page's category are missing from the body | Yes — insert missing H2 section stubs at end of body and update `bodySections[]` |
| W-027 | Field length cap exceeded | warning | Flow `steps[].outcome` row > 80 chars, OR contract `shape` field > 500 chars | No — requires field trim (move long content into body under `## Shape` or split step) |

## Execution/Project Checks

These checks detect drift between wiki knowledge and actual project state. They require reading files from `.plan-execution/`, `.plan-history/`, and the codebase.

| ID | Check | Severity | Description | Auto-fixable |
|----|-------|----------|-------------|-------------|
| E-001 | Contract drift | blocking | Contract files in `.plan-execution/contracts/` have been modified since Wave 0 completed, but no wiki page reflects the changes | No — contracts should be immutable |
| E-002 | Plan-reality divergence | warning | PLAN.md phases marked `completed` but wiki pages reference components described as unimplemented or pending | No — requires investigation |
| E-003 | Orphaned exports | warning | Exports listed in wave summaries (`.plan-execution/wave-N-summary.toon`) are not referenced by any wiki page | Yes — create stub pages |
| E-004 | Unaddressed review findings | warning | Review findings in `.plan-history/reviews/` with severity `critical` or `warning` have no corresponding wiki decision page explaining resolution | No — requires human decision |
| E-005 | Stale rolling context | info | `rolling-context.md` references waves older than cold tier threshold with information that contradicts wiki pages | No — requires context rebuild |
| E-006 | Unresolved cross-boundary requests | warning | Request files in `.plan-execution/ephemeral/requests/` have no corresponding resolution in wave summaries or wiki pages | No — requires investigation |

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
   - **W-020 (Flow step-count out of range)**: For each `flow-*` page, count rows in the `steps[]` typed array. Flag if `len(steps) < 2` or `len(steps) > 12`. Out-of-range `order` gaps (e.g., 1, 3, 4) are also flagged here.
   - **W-021 (Flow touches stale)**: For each `flow-*` page step, parse each path in the `touches` column (paths may be `+`-separated or comma-separated). For each path that looks like a file (not a `component-*` pageId), check existence on disk relative to the project root. Flag rows whose touches point to a non-existent file. Treat pageId references (e.g., `component-user-service`) as valid if the pageId exists in `index.toon`.
   - **W-022 (Orphan contract)**: For each `contract-*` page, check whether both `producers[]` and `consumers[]` are empty arrays. Flag if both are empty. A contract with no producers and no consumers is not actively used and likely abandoned or premature.
   - **W-023 (Flow exercises nothing)**: For each `flow-*` page, scan `crossRefs[]` and count entries with `relationship: exercises`. Flag at `info` severity if zero. A flow that exercises no components is suspicious — it either does nothing observable or the cross-refs were never populated.
   - **W-024 (One-sided exercised-by)**: For each `component-*` page, count entries in its `crossRefs[]` with `relationship: exercised-by`. For every flow page in those back-links, verify the flow has a corresponding `crossRefs[]` entry pointing at this component with `relationship: exercises`. Flag any flow missing the inverse, but only fire the W-024 finding for components with 2+ flows referencing them (lone-flow links are noisy; the 2+ threshold keeps signal high).
   - **W-025 (Body exceeds token cap)**: Compute body tokens for each page. Preferred path: read `estimatedTokens` from frontmatter, subtract frontmatter token cost (`Math.ceil(frontmatterCharCount / 4)`); the remainder is body tokens. Fallback (if `estimatedTokens` absent — brownfield): compute `Math.ceil(bodyCharCount / 4)` directly from the body text. Flag `warning` at `bodyTokens > 1200`, escalate to `blocking` at `bodyTokens > 2000`. Suggestion: split the page into a parent + linked sub-pages (flows via `triggers`, contracts via `replacedBy`/`supersedes`, components via `depends-on`).
   - **W-026 (Summary or required sections missing)**: Two-part check, combined into one rule because both fire on page-write hygiene.
     - **Part A (summary):** flag if `summary` is missing, has length > 200 chars, OR contains markdown syntax (heuristic: any of `**`, `__`, backticks, `[text](url)`, `#` at line start).
     - **Part B (required H2 sections):** look up the page's category in the Required H2 Sections table (`wiki-page.schema.md`). For each required section, scan the body for a matching `## <Section Name>` heading (case-insensitive, trim whitespace). Flag if any required section is absent.
     - **Legacy-placeholder carve-out:** if `summary` exactly equals `"(legacy — pending refresh)"` (the marker written by `/loom-upgrade` Rule 7 — the long em dash, not a hyphen), downgrade Part A's finding to `info` severity rather than `warning`. The placeholder is a deferred-fix marker, not a problem; it signals the page needs a real summary on its next write but should not flood the lint report after migration. Part B (missing H2 sections) is unaffected by the carve-out — required sections must still be present.
   - **W-027 (Field length cap exceeded)**: For each `flow-*` page, check every `steps[].outcome` row — flag if `len(outcome) > 80`. For each `contract-*` page, check `shape` field — flag if `len(shape) > 500`. Suggest moving the long shape into the body under `## Shape` and replacing the field with a compact summary.

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
7. **W-021** (flow touches stale): Annotate the offending `steps[]` row's `touches` column with a leading `STALE:` marker (e.g., `STALE:src/services/old.ts`). Does not rewrite the path or remove the row — surfaces the broken reference inline so the next ingest/refresh notices it. Recompute `staleness` for the page.
8. **W-024** (one-sided exercised-by): For each component with a `exercised-by` back-link to a flow that lacks the inverse, add a `crossRefs[]` entry `{pageId: <component-pageId>, relationship: exercises}` to the flow page. Recompute `estimatedTokens` and `updatedAt` for the modified flow page.
9. **W-026** (summary or required sections missing): Only the **missing H2 sections** half is auto-fixable. For each required section absent from the body, append an H2 stub at the end of the body in the order defined by the Required H2 Sections table for the page's category. Each stub is exactly two lines: `## <Section Name>` followed by `<!-- TODO: fill in this section -->`. After insertion, recompute `bodySections[]` in frontmatter to list the section names actually present (including stubs), recompute `estimatedTokens` over the new full-page char count, and update `updatedAt`. The `summary` half of W-026 (missing/too-long/markdown-in-summary) is NOT auto-fixed — the agent cannot write a meaningful elevator pitch without context. Surface as a remaining finding for human/agent rewrite. The legacy-placeholder carve-out (info-severity) is not auto-fixed either; the placeholder will be replaced on the page's next agent write.
10. **E-003** (orphaned exports): Create minimal stub pages for undocumented exports

All auto-fixes are logged to `log.toon` with operation `lint-fix`.

## Rule Detail Entries — W-020 through W-027

Detailed specifications for the flow/contract structural rules (W-020..W-024) and the context-efficiency rules (W-025..W-027). The W-014..W-019 range is intentionally reserved for future use; do not renumber to fill gaps.

### W-020 — Flow step-count out of range

- **Severity:** `warning`
- **Category:** `flow-step-count`
- **Detection:** Page has `category: flow`. Count rows in `steps[]`. Fire if `len(steps) < 2` OR `len(steps) > 12`. Also fire if `order` values are not a contiguous 1-indexed sequence (gaps allowed for in-flight revisions but still flagged).
- **Auto-fix:** none. Requires content review — the agent or human must split a monolithic flow into sub-flows (linked via `triggers`) or merge a stub flow into a parent flow.
- **Example bad input:**
  ```toon
  steps[1]{order,name,actor,touches,outcome,nextOnFail,errorExits}:
    1,Do the thing,service-layer,src/service.ts,Thing done,,
  ```
- **Example finding:**
  ```toon
  W-020,warning,flow-step-count,flow-trivial has 1 step (minimum 2),.loom/wiki/pages/flow-trivial.md,Merge into parent flow or expand to ≥2 steps
  ```

### W-021 — Flow touches stale

- **Severity:** `warning`
- **Category:** `flow-touches-stale`
- **Detection:** Page has `category: flow`. For each `steps[]` row, parse the `touches` column. Paths may be `+`-separated or comma-separated. For each token that looks like a file path (contains `/` or `.` and is NOT a `component-*`/`contract-*` pageId), verify the file exists on disk relative to the project root. Fire one finding per missing file. PageId references are validated against `index.toon` instead.
- **Auto-fix:** annotate the offending row's `touches` cell by prefixing the stale path with `STALE:` (e.g., `src/old.ts` → `STALE:src/old.ts`). Recompute the page's `staleness`. Does not delete the path or the row.
- **Example bad input:**
  ```toon
  steps[2]{order,name,actor,touches,outcome,nextOnFail,errorExits}:
    1,Load record,service-layer,src/services/deleted-service.ts,Loaded,,
    2,Save record,service-layer,src/services/user.ts,Saved,,
  ```
- **Example finding:**
  ```toon
  W-021,warning,flow-touches-stale,flow-user-update step 1 touches src/services/deleted-service.ts which no longer exists,.loom/wiki/pages/flow-user-update.md,Re-ingest with /loom-wiki ingest --flow or update step touches
  ```
- **Example post-fix `touches` column:** `STALE:src/services/deleted-service.ts`

### W-022 — Orphan contract

- **Severity:** `warning`
- **Category:** `orphan-contract`
- **Detection:** Page has `category: contract`. Fire if `producers[]` is empty AND `consumers[]` is empty. A contract with no producers and no consumers is unused — either premature (no implementation yet) or abandoned (callers removed without the contract being deprecated).
- **Auto-fix:** none. Requires investigation: either delete the contract, mark it `deprecatedAt` with `replacedBy`, or re-run ingest to discover producers/consumers that exist but weren't linked.
- **Example bad input:**
  ```toon
  pageId: contract-legacy-foo
  contractType: api
  producers[0]:
  consumers[0]:
  ```
- **Example finding:**
  ```toon
  W-022,warning,orphan-contract,contract-legacy-foo has no producers and no consumers,.loom/wiki/pages/contract-legacy-foo.md,Delete page, mark deprecatedAt+replacedBy, or re-ingest to link producers/consumers
  ```

### W-023 — Flow exercises nothing

- **Severity:** `info`
- **Category:** `flow-exercises-nothing`
- **Detection:** Page has `category: flow`. Count `crossRefs[]` entries with `relationship: exercises`. Fire if count is zero. A flow with no exercised components is suspicious — either it has no side effects (rare for a real flow) or cross-refs were never populated by the ingester or maintainer.
- **Auto-fix:** none. Cross-refs need real component pageIds, which require either explicit ingest (`/loom-wiki ingest --flow`) or human review.
- **Example bad input:**
  ```toon
  pageId: flow-something
  category: flow
  crossRefs[1]{pageId,relationship}:
    contract-something,implements
  ```
- **Example finding:**
  ```toon
  W-023,info,flow-exercises-nothing,flow-something has no exercises cross-refs,.loom/wiki/pages/flow-something.md,Run /loom-wiki ingest --flow to populate exercises cross-refs or add manually
  ```

### W-024 — One-sided exercised-by

- **Severity:** `warning`
- **Category:** `one-sided-exercised-by`
- **Detection:** Page has `category: component`. Count `crossRefs[]` entries with `relationship: exercised-by`. If count >= 2, verify each referenced flow has a corresponding `crossRefs[]` entry pointing back to this component with `relationship: exercises`. Fire one finding per missing inverse. The 2+ threshold suppresses noise from lone-flow pairings where one-sided refs are common during incremental ingest.
- **Auto-fix:** add the inverse `crossRefs[]` entry `{pageId: <component-pageId>, relationship: exercises}` to the flow page. Recompute the flow page's `estimatedTokens` and `updatedAt`. Logged to `log.toon` as `lint-fix` with the cross-ref payload.
- **Example bad input — component side:**
  ```toon
  pageId: component-user-service
  crossRefs[2]{pageId,relationship}:
    flow-user-signup,exercised-by
    flow-user-update,exercised-by
  ```
- **Example bad input — flow side (missing inverse on flow-user-update):**
  ```toon
  pageId: flow-user-update
  crossRefs[1]{pageId,relationship}:
    contract-user-update,implements
  ```
- **Example finding:**
  ```toon
  W-024,warning,one-sided-exercised-by,component-user-service back-linked by flow-user-update but flow lacks inverse exercises ref,.loom/wiki/pages/flow-user-update.md,Add crossRef {component-user-service, exercises} to flow (auto-fixable)
  ```
- **Example fix applied to flow page:**
  ```toon
  crossRefs[2]{pageId,relationship}:
    contract-user-update,implements
    component-user-service,exercises
  ```

### W-025 — Body exceeds token cap

- **Severity:** `warning` at `bodyTokens > 1200`; **`blocking`** at `bodyTokens > 2000`
- **Category:** `body-token-cap`
- **Detection:** Compute body tokens. Preferred path: `bodyTokens = estimatedTokens - Math.ceil(frontmatterCharCount / 4)`, where frontmatter is the fenced TOON block at the top of the file (including the fences). Fallback when `estimatedTokens` is absent (brownfield/legacy pages): `bodyTokens = Math.ceil(bodyCharCount / 4)`. Fire `warning` at 1200–2000 tokens, escalate to `blocking` above 2000.
- **Auto-fix:** none. Splitting a page requires deciding what content goes where — for flows, split via the `triggers` relationship; for contracts, version-split with `supersedes`/`replacedBy`; for components, factor sub-components linked via `depends-on`.
- **Example finding (warning):**
  ```toon
  W-025,warning,body-token-cap,component-user-service body is 1480 tokens (cap 1200),.loom/wiki/pages/component-user-service.md,Split into smaller component pages or trim narrative; bodies above 2000 tokens are blocking
  ```
- **Example finding (blocking):**
  ```toon
  W-025,blocking,body-token-cap,component-payment-engine body is 2240 tokens (blocking cap 2000),.loom/wiki/pages/component-payment-engine.md,MUST split before further changes — exceeds blocking cap
  ```

### W-026 — Summary or required sections missing

- **Severity:** `warning` (downgraded to `info` for the legacy-placeholder carve-out described below)
- **Category:** `summary-or-sections`
- **Detection — Part A (summary):** Fire if `summary` field is missing, has `len > 200`, or contains markdown syntax. Markdown heuristic: any of `**`, `__`, single-tick code spans, `[text](url)` link, or a leading `#` heading character at the start of any line within the field. Whitespace-only summary counts as missing.
- **Detection — Part B (required H2 sections):** Look up the page's `category` in the Required H2 Sections table (`wiki-page.schema.md` / `wiki-conventions.md`). For each required section, scan the body for a matching `## <Section Name>` heading (case-insensitive, ignoring surrounding whitespace). Fire one finding per missing section.
- **Legacy-placeholder carve-out (W-026 spec, not a separate rule):** when `summary` exactly equals the string `"(legacy — pending refresh)"` — the marker written by `/loom-upgrade` Rule 7 during the v1→v2 migration (note the long em dash `—`, not a hyphen `-`) — the Part A finding is downgraded to `info` severity rather than `warning`. The placeholder is a deferred-fix marker: it tells the next agent that writes this page to generate a real summary and replace the marker. This carve-out prevents post-migration W-026 flooding across legacy wikis. Part B (missing H2 sections) is unaffected — required sections are enforced at full warning severity regardless of the summary state. The carve-out terminates as soon as any agent writes the page (because the schema requires the agent to regenerate `summary` on write).
- **Auto-fix:** only the missing-H2-sections half. For each required section absent from the body, append `## <Section Name>\n\n<!-- TODO: fill in this section -->\n` at the end of the body, preserving the order from the Required H2 Sections table for the page's category. Then recompute `bodySections[]` in frontmatter, recompute `estimatedTokens`, and update `updatedAt`. The summary half is NOT auto-fixed (no way to synthesize a meaningful elevator pitch). The legacy placeholder is NOT auto-fixed (it self-resolves on next agent write).
- **Example bad input (component page missing Dependencies and Key Behaviors):**
  ```markdown
  # User Service

  ## Summary
  Handles user CRUD and permissions.
  ```
- **Example fixed output:**
  ```markdown
  # User Service

  ## Summary
  Handles user CRUD and permissions.

  ## Dependencies

  <!-- TODO: fill in this section -->

  ## Key Behaviors

  <!-- TODO: fill in this section -->
  ```
- **Example finding (legacy placeholder, info-severity):**
  ```toon
  W-026,info,summary-or-sections,component-old-thing has legacy placeholder summary (deferred until next agent write),.loom/wiki/pages/component-old-thing.md,Will be replaced on next agent write; no action required
  ```
- **Example finding (real warning):**
  ```toon
  W-026,warning,summary-or-sections,component-user-service summary contains markdown (** characters),.loom/wiki/pages/component-user-service.md,Rewrite summary as plain prose ≤200 chars
  W-026,warning,summary-or-sections,component-user-service missing required H2 section: Dependencies,.loom/wiki/pages/component-user-service.md,Add ## Dependencies section (auto-fixable)
  ```

### W-027 — Field length cap exceeded

- **Severity:** `warning`
- **Category:** `field-length-cap`
- **Detection:** For `flow-*` pages, scan each `steps[]` row and fire if `len(outcome) > 80`. For `contract-*` pages, fire if `len(shape) > 500`. Fire one finding per offending row/field.
- **Auto-fix:** none. Long outcomes should be split into multiple steps (each producing one outcome); long contract shapes should be moved into the page body under `## Shape` with `shape` shortened to a compact summary like `POST /api/users → 201 { id, email } | 400` (see contract example in `wiki-page.schema.md`).
- **Example bad input — flow outcome too long:**
  ```toon
  steps[1]{order,name,actor,touches,outcome,nextOnFail,errorExits}:
    1,Process payment,service-layer,src/payment.ts,Charges the user, sends a receipt email, updates the invoice, and notifies the accounting subsystem via webhook,,
  ```
- **Example finding:**
  ```toon
  W-027,warning,field-length-cap,flow-checkout step 1 outcome is 124 chars (cap 80),.loom/wiki/pages/flow-checkout.md,Split into multiple steps each producing one outcome
  ```
- **Example bad input — contract shape too long:**
  ```toon
  pageId: contract-mega-payload
  shape: <500+ char shape string with full nested type definition>
  ```
- **Example finding:**
  ```toon
  W-027,warning,field-length-cap,contract-mega-payload shape is 612 chars (cap 500),.loom/wiki/pages/contract-mega-payload.md,Move full shape into body under ## Shape and shorten the field to a compact summary
  ```
