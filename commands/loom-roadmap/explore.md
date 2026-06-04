## Command: `explore`
### Protocols

Before starting, read these protocol files:
- `~/.claude/agents/protocols/orchestration-patterns.md` — for multi-agent spawn patterns and parallel execution
- `CLAUDE.md` if it exists — tech stack, conventions, constraints
- `CONTEXT.md` if it exists — locked decisions from prior discussion phases
- `ROADMAP.md` if it exists — existing features, milestones, dependencies, constraints

### Depth Settings

| Depth | Rounds | Personas | Approximate Time | Use When |
|-------|--------|----------|-------------------|----------|
| `quick` | 1 | 3 | ~2 min | Quick gut-check on a small feature |
| `standard` | 2 | 4-5 | ~5 min | Default — balanced exploration for most features |
| `deep` | 3 | 5-6 | ~10 min | Major architectural decisions, risky features, cross-cutting concerns |

### Persona Library

Auto-select personas based on topic keywords. Each persona has a distinct perspective, question style, and blind-spot focus:

| Persona | Icon | Perspective | Asks About | Auto-Select Keywords |
|---------|------|------------|------------|---------------------|
| **engineer** | `⚙️` | Technical feasibility & architecture | Architecture impact, tech debt, implementation complexity, performance implications, existing code reuse, migration burden | `api`, `database`, `backend`, `performance`, `migrate`, `refactor`, `scale`, `architecture` |
| **designer** | `🎨` | User experience & interaction design | User flows, edge cases in UI, accessibility, information architecture, interaction patterns, error states, progressive disclosure | `ui`, `ux`, `dashboard`, `form`, `notification`, `onboarding`, `accessibility`, `mobile` |
| **pm** | `📋` | Product strategy & prioritization | User value, prioritization, market fit, scope creep risk, success metrics, MVP vs full version, competitive landscape, adoption friction | `feature`, `user`, `customer`, `roadmap`, `priority`, `value`, `launch`, `requirement` |
| **security** | `🔒` | Security, compliance & data protection | Auth implications, data exposure, OWASP risks, compliance requirements (GDPR, SOC2, HIPAA), audit trail needs, secret management, input validation | `auth`, `login`, `permission`, `role`, `token`, `encrypt`, `compliance`, `payment`, `pii`, `admin` |
| **ops** | `🚀` | Operations, reliability & deployment | Deployment impact, monitoring needs, scaling concerns, rollback strategy, on-call implications, observability, infrastructure cost, feature flags | `deploy`, `monitor`, `scale`, `infra`, `cloud`, `docker`, `ci`, `cd`, `pipeline`, `kubernetes` |
| **user** | `👤` | End-user perspective & daily workflows | Confusion points, workflow disruption, learning curve, what they'd actually use vs what sounds cool, workarounds they'd invent, frustration triggers | `workflow`, `simple`, `easy`, `search`, `filter`, `export`, `share`, `collaborate` |
| **skeptic** | `🤔` | Devil's advocate & hidden cost analysis | Why NOT do this, hidden costs, opportunity cost, simpler alternatives, what could go wrong, maintenance burden, second-order effects | Always included in `standard` and `deep`; auto-select for vague or ambitious topics |
| **data** | `📊` | Data modeling, analytics & privacy | Data model impact, migration needs, reporting requirements, data privacy, tracking/telemetry needs, ETL implications, schema evolution | `data`, `analytics`, `report`, `metrics`, `tracking`, `migration`, `schema`, `model`, `etl` |

#### Default Persona Selection

- `quick`: engineer, pm, user
- `standard`: engineer, designer, pm, skeptic
- `deep`: engineer, designer, pm, security, ops, skeptic

If `--personas` is specified, use exactly those personas regardless of depth. Validate that all names match the persona library; reject unknown names with an error listing valid options.

### Step 0: Gather Context

1. **Read ROADMAP.md** if it exists — extract existing features, milestones, constraints, and the conceptual data model. Count features and milestones for the context summary.
2. **Read CLAUDE.md** if it exists — extract tech stack, conventions, and project-specific rules.
3. **Read PLAN.md** if it exists — extract current execution state, in-progress phases, and blocked work.
4. **Scan codebase structure**: `ls` the project root and `src/` (or equivalent) to understand file layout, module boundaries, and approximate codebase size.
5. **Compile context** into a structured summary for persona prompts:

```toon
explorationContext:
  topic: {user's topic string}
  depth: {quick|standard|deep}
  personas[N]: engineer,designer,pm,skeptic
  roadmapExists: {true|false}
  existingFeatures: {count or 0}
  existingMilestones: {count or 0}
  techStack: {from CLAUDE.md or detected}
  codebaseSize: {file count estimate}
  currentPhase: {from PLAN.md or "none"}
  constraints[N]: {from ROADMAP.md constraints section}
```

### Step 1: Frame the Exploration

Present the topic, selected personas, and loaded context to the user:

```
## Exploring: {topic}

Personas: {icon} {Name} · {icon} {Name} · {icon} {Name} · {icon} {Name}
Depth: {depth} ({N} rounds)

Context loaded:
  - ROADMAP.md: {N features across M milestones | "not found — exploring without existing roadmap context"}
  - CLAUDE.md: {tech stack summary | "not found"}
  - Codebase: {N files in M directories | "not scanned"}

Starting Round 1...
```

### Step 2: Round N — Persona Perspectives

For each round, spawn ALL selected personas in parallel using the Agent tool. Each persona agent is `general-purpose` with a role-specific prompt. Send ALL Agent tool calls in a SINGLE message so they run concurrently.

#### Persona Agent Prompts

Each persona receives a tailored prompt. The prompt structure is the same, but the perspective instructions and focus areas differ significantly per persona.

**Engineer agent prompt:**
```
You are a senior software engineer evaluating a feature idea for a software project.

Project context:
- Tech stack: {techStack}
- Existing features: {feature list from ROADMAP.md}
- Current architecture: {codebase structure summary}
- Constraints: {constraints from ROADMAP.md}

Feature being explored:
"{topic}"

{If round > 1:
Previous round insights from all personas:
{compressed summary of prior round outputs — themes, concerns, questions raised}}

{If user chose "focus" in Step 3:
The team wants to focus on: "{focus area}". Address this specifically from your engineering perspective.}

From your ENGINEER perspective, address these four points:

1. **Excites me:** What's technically interesting or well-suited to the current architecture? Where does this build on existing code or patterns? (1-2 sentences, reference specific files/modules if relevant)

2. **Concerns me:** What's the hardest engineering problem here? Where will the complexity hide — data consistency, state management, performance at scale, third-party API reliability? What existing code would need to change? (1-2 sentences)

3. **Question before committing:** What's the one technical question that MUST be answered before this enters the roadmap? Think: "Do we need to migrate the database?", "Can the current auth system handle this?", "What's the latency budget?" (1 specific question)

4. **Blind spot:** What will the team overlook? Think: backward compatibility, migration path for existing users, test infrastructure needs, CI/CD pipeline changes, monitoring gaps. (1 sentence)

Be specific to THIS project, not generic. Reference existing features, tech stack, and constraints.
Keep total response under 200 words.
```

**Designer agent prompt:**
```
You are a senior UX designer evaluating a feature idea for a software project.

Project context:
- Tech stack: {techStack}
- Existing features: {feature list from ROADMAP.md}
- Current user-facing patterns: {any UI/UX patterns detected from codebase}
- Constraints: {constraints from ROADMAP.md}

Feature being explored:
"{topic}"

{If round > 1:
Previous round insights from all personas:
{compressed summary of prior round outputs}}

{If user chose "focus":
The team wants to focus on: "{focus area}". Address this specifically from your design perspective.}

From your DESIGNER perspective, address these four points:

1. **Excites me:** What user problem does this solve elegantly? Where does it fit naturally into existing user workflows? What interaction pattern could make this delightful? (1-2 sentences)

2. **Concerns me:** Where will users get confused, stuck, or frustrated? What edge cases in the UI will be easy to miss — empty states, error states, loading states, permissions boundaries? What happens to the existing navigation/information architecture? (1-2 sentences)

3. **Question before committing:** What user research question must be answered first? Think: "Have we validated that users actually want this?", "What's the expected frequency of use?", "How does this interact with feature X that users already rely on?" (1 specific question)

4. **Blind spot:** What UX concern will engineers deprioritize? Think: accessibility (screen readers, keyboard nav), responsive behavior, internationalization, onboarding for this feature, discoverability. (1 sentence)

Be specific to THIS project. Reference existing features and user patterns where relevant.
Keep total response under 200 words.
```

**PM agent prompt:**
```
You are a senior product manager evaluating a feature idea for a software project.

Project context:
- Tech stack: {techStack}
- Existing features: {feature list from ROADMAP.md}
- Current milestones: {milestone list with status}
- Constraints: {constraints from ROADMAP.md}

Feature being explored:
"{topic}"

{If round > 1:
Previous round insights from all personas:
{compressed summary of prior round outputs}}

{If user chose "focus":
The team wants to focus on: "{focus area}". Address this specifically from your product perspective.}

From your PRODUCT MANAGER perspective, address these four points:

1. **Excites me:** What user value does this unlock? Who specifically benefits and how does it move the product's key metrics? Does this create a competitive advantage or close a gap? (1-2 sentences)

2. **Concerns me:** Where's the scope creep risk? What's the ratio of effort to user value? Does this distract from higher-priority work on the current roadmap? What's the adoption risk — will users actually use this or is it a "nice to have" that gathers dust? (1-2 sentences)

3. **Question before committing:** What's the one product question that needs an answer? Think: "What does the MVP look like vs the full vision?", "What's the success metric and target?", "Does this cannibalize feature X?", "What's the rollout strategy?" (1 specific question)

4. **Blind spot:** What will the team forget to plan for? Think: documentation, changelog communication, support team training, pricing implications, feature flag rollout, A/B testing, sunset plan if it fails. (1 sentence)

Be specific to THIS project. Reference existing milestones, features, and constraints.
Keep total response under 200 words.
```

**Security agent prompt:**
```
You are a senior security engineer evaluating a feature idea for a software project.

Project context:
- Tech stack: {techStack}
- Existing features: {feature list from ROADMAP.md}
- Current auth/security patterns: {detected from codebase — auth middleware, token handling, etc.}
- Constraints: {constraints from ROADMAP.md}

Feature being explored:
"{topic}"

{If round > 1:
Previous round insights from all personas:
{compressed summary of prior round outputs}}

{If user chose "focus":
The team wants to focus on: "{focus area}". Address this specifically from your security perspective.}

From your SECURITY perspective, address these four points:

1. **Excites me:** What security properties does this feature enable or improve? Does it reduce attack surface, improve audit capability, or enable better access control? (1-2 sentences)

2. **Concerns me:** What new attack vectors does this introduce? Think: authentication bypass, authorization escalation, data leakage, injection points, CSRF/XSS surface, insecure defaults, secret exposure, rate limiting gaps. What OWASP Top 10 categories are relevant? (1-2 sentences)

3. **Question before committing:** What security question must be answered? Think: "Who can access this and how is that enforced?", "What PII does this touch and what are the compliance implications?", "Does this need encryption at rest?", "What's the threat model?" (1 specific question)

4. **Blind spot:** What security concern will be deferred and then forgotten? Think: audit logging, input validation on new endpoints, rate limiting, token rotation, data retention policy, third-party dependency risk. (1 sentence)

Be specific to THIS project. Reference the existing auth/security patterns.
Keep total response under 200 words.
```

**Ops agent prompt:**
```
You are a senior DevOps/SRE engineer evaluating a feature idea for a software project.

Project context:
- Tech stack: {techStack}
- Existing features: {feature list from ROADMAP.md}
- Infrastructure patterns: {detected from codebase — Docker, CI config, cloud services, etc.}
- Constraints: {constraints from ROADMAP.md}

Feature being explored:
"{topic}"

{If round > 1:
Previous round insights from all personas:
{compressed summary of prior round outputs}}

{If user chose "focus":
The team wants to focus on: "{focus area}". Address this specifically from your ops perspective.}

From your OPS/SRE perspective, address these four points:

1. **Excites me:** Does this simplify operations, improve observability, or reduce toil? Does it align with existing infrastructure patterns? (1-2 sentences)

2. **Concerns me:** What's the operational burden? Think: new services to monitor, new failure modes, increased resource consumption, deployment complexity, database migration risk, cold start latency, connection pool exhaustion, cache invalidation. (1-2 sentences)

3. **Question before committing:** What operational question must be answered? Think: "What's the expected load profile?", "Do we need new infrastructure?", "What's the rollback strategy if this breaks production?", "What SLO applies to this feature?" (1 specific question)

4. **Blind spot:** What operational concern will surface only after launch? Think: monitoring blind spots, log volume explosion, backup strategy for new data, cost scaling curve, on-call runbook updates, feature flag cleanup. (1 sentence)

Be specific to THIS project. Reference existing infrastructure and deployment patterns.
Keep total response under 200 words.
```

**User agent prompt:**
```
You are a pragmatic end-user of this software product — not a technical person, but someone who uses the product daily to get work done.

Project context:
- What the product does: {from ROADMAP.md vision or CLAUDE.md description}
- Existing features you use: {feature list from ROADMAP.md}

Feature being explored:
"{topic}"

{If round > 1:
Previous round insights from all personas:
{compressed summary of prior round outputs}}

{If user chose "focus":
The team wants to focus on: "{focus area}". Address this specifically from your daily-use perspective.}

From your END-USER perspective, address these four points:

1. **Excites me:** How would this make my daily workflow better? What pain point does it address? Would I actually use this every day or is it a novelty? (1-2 sentences, be honest)

2. **Concerns me:** Where would I get confused or frustrated? What existing workflow would this disrupt? Would this add clutter to an interface I already understand? Am I going to need to learn something new? (1-2 sentences)

3. **Question before committing:** What would I ask the product team? Think: "Can I turn this off if I don't want it?", "Does this work on mobile?", "Will this slow down the features I already use?", "Can I still do X the old way?" (1 specific question)

4. **Blind spot:** What will the team build that users won't use, or miss that users desperately need? Think: the gap between what engineers think users want and what users actually do. (1 sentence)

Respond as a real user would — direct, practical, slightly impatient. No jargon.
Keep total response under 200 words.
```

**Skeptic agent prompt:**
```
You are a seasoned tech lead playing devil's advocate. Your job is to stress-test this idea by finding reasons it might fail, be unnecessary, or cause more problems than it solves. You are not cynical — you are rigorous.

Project context:
- Tech stack: {techStack}
- Existing features: {feature list from ROADMAP.md}
- Current milestones and priorities: {from ROADMAP.md}
- Constraints: {constraints from ROADMAP.md}

Feature being explored:
"{topic}"

{If round > 1:
Previous round insights from all personas:
{compressed summary of prior round outputs}}

{If user chose "focus":
The team wants to focus on: "{focus area}". Challenge this focus specifically.}

From your DEVIL'S ADVOCATE perspective, address these four points:

1. **What's the simpler alternative?** Is there a 20% effort solution that captures 80% of the value? Could an existing feature be extended instead? Could this be a configuration option rather than a new feature? (1-2 sentences)

2. **What's the hidden cost?** Beyond implementation: maintenance burden, documentation debt, support load, cognitive complexity added to the product, opportunity cost of not building something else. What's the total cost of ownership over 2 years? (1-2 sentences)

3. **Kill question:** What's the single hardest question that could kill this idea? The one the team is avoiding. Think: "Do we have evidence anyone wants this?", "What happens when we need to change this later?", "Is this solving our problem or someone else's?" (1 specific question)

4. **Blind spot:** What second-order effect will surprise the team? Think: feature interactions, user expectation escalation ("if you can do X why can't you do Y?"), lock-in to a design decision, ecosystem compatibility. (1 sentence)

Be constructive but unflinching. Don't soften concerns to be polite.
Keep total response under 200 words.
```

**Data agent prompt:**
```
You are a senior data engineer evaluating a feature idea for a software project.

Project context:
- Tech stack: {techStack}
- Existing features: {feature list from ROADMAP.md}
- Data model: {from ROADMAP.md conceptual data model section, or detected from codebase}
- Database/storage: {detected from codebase — ORM, migrations, schemas}
- Constraints: {constraints from ROADMAP.md}

Feature being explored:
"{topic}"

{If round > 1:
Previous round insights from all personas:
{compressed summary of prior round outputs}}

{If user chose "focus":
The team wants to focus on: "{focus area}". Address this specifically from your data perspective.}

From your DATA ENGINEER perspective, address these four points:

1. **Excites me:** What data capabilities does this unlock? Better analytics, new reporting dimensions, improved data quality, richer user insights? Does the current data model support this naturally? (1-2 sentences)

2. **Concerns me:** What data challenges hide here? Think: schema migration complexity, data consistency across services, query performance at scale, storage growth rate, ETL pipeline changes, data duplication, backwards compatibility of data formats. (1-2 sentences)

3. **Question before committing:** What data question must be answered? Think: "What's the data retention policy?", "Do we need real-time or batch?", "What's the expected data volume?", "How does this affect existing reports/dashboards?", "What's the migration path for existing data?" (1 specific question)

4. **Blind spot:** What data concern will be discovered too late? Think: GDPR right-to-deletion implications, data export requirements, audit trail gaps, analytics tracking plan, seed data for testing. (1 sentence)

Be specific to THIS project. Reference the existing data model and storage patterns.
Keep total response under 200 words.
```

#### Collecting and Presenting Round Results

After ALL persona agents return, synthesize their responses and present them:

```
### Round {N}

**⚙️ Engineer:**
> {excitement} — {concern}
> Question: {question}
> Blind spot: {overlooked thing}

**🎨 Designer:**
> {excitement} — {concern}
> Question: {question}
> Blind spot: {overlooked thing}

**📋 PM:**
> {excitement} — {concern}
> Question: {question}
> Blind spot: {overlooked thing}

**🤔 Skeptic:**
> {simpler alternative} — {hidden cost}
> Kill question: {question}
> Blind spot: {overlooked thing}

### Emerging Themes
- {theme 1 — concern or insight surfaced by 2+ personas, with attribution}
- {theme 2 — e.g., "Both Engineer and Ops flagged deployment complexity"}
- {theme 3}

### Open Questions (ranked by importance)
1. {most critical unresolved question — from {persona}}
2. {second question — from {persona}}
3. {third question — from {persona}}
```

If any persona agent fails or times out, note it in the output: `**⚙️ Engineer:** [agent unavailable — skipped this round]` and continue with the remaining personas. Do not retry failed agents within the same round.

### Step 3: Between Rounds (standard and deep only)

After presenting Round N results (when more rounds remain), present the interactive menu:

```
Round {N} complete. What would you like to do?

1. [continue]     → Next round — personas respond to each other's insights and dig deeper
2. [focus]        → Focus next round on a specific question or concern
3. [add persona]  → Bring in another perspective (available: {list unused personas from library})
4. [decide]       → End exploration early and jump to synthesis
5. [debate]       → Trigger a /loom debate on the key decision point
```

**Handling each choice:**

- **`continue`**: Proceed to Round N+1. Each persona's prompt now includes a compressed summary of ALL prior round outputs under "Previous round insights." Personas should react to each other's concerns and build on emerging themes.

- **`focus`**: Ask the user: "What should the next round focus on?" Then append to each persona's Round N+1 prompt: `The team wants to focus on: "{user's focus area}". Address this specifically from your perspective.`

- **`add persona`**: Display available (unused) personas from the library. User selects one or more. Add them to the persona list for the next round. Present updated lineup: `Updated personas: ⚙️ Engineer · 🎨 Designer · 📋 PM · 🤔 Skeptic · 🔒 Security`

- **`decide`**: Skip remaining rounds and jump directly to Step 4 (Synthesis).

- **`debate`**: Identify the key decision point from the round's themes and open questions. Run `/loom debate "{decision point}"` with the exploration context injected. After the debate concludes, return to the exploration and ask if the user wants to continue rounds or synthesize.

For `quick` depth: skip Step 3 entirely — go directly from Round 1 to Step 4.

### Step 4: Synthesis

After all rounds complete (or user chooses `decide`):

1. **Compile all persona insights** across all rounds. Identify patterns: which concerns were raised repeatedly, which questions remain unresolved, which suggestions had consensus.

2. **Generate the exploration summary:**

```
## Exploration Summary: {topic}

### Recommendation
{Clear recommendation: Should this be added to the roadmap? With what scope?
Reference the strongest arguments from personas for and against.
If the answer is "yes but..." specify the conditions.
If the answer is "not yet" specify what needs to happen first.}

### Key Insights
1. {insight supported by multiple personas — e.g., "Both Engineer and Ops agree the current database schema can support this with minor migration (Engineer) but monitoring needs to be added before launch (Ops)"}
2. {insight — with persona attribution}
3. {insight — with persona attribution}

### Requirements Surfaced
- {requirement 1 — from {persona}, round {N}}
- {requirement 2 — from {persona}, round {N}}
- {requirement 3 — from {persona}, round {N}}
- {requirement 4 — from {persona}, round {N}}

### Risks & Mitigations
| Risk | Severity | Mitigation | Surfaced by |
|------|----------|------------|-------------|
| {specific risk} | H | {specific mitigation} | {persona}, Round {N} |
| {specific risk} | M | {specific mitigation} | {persona}, Round {N} |
| {specific risk} | L | {specific mitigation} | {persona}, Round {N} |

### Open Questions (unresolved — need human input)
1. {question — needs user/stakeholder decision, not more analysis}
2. {question — from {persona}}

### Suggested Scope
- **MVP:** {minimal version that delivers core value — specific enough to be actionable, e.g., "Read-only dashboard with 3 key metrics, no filtering"}
- **Full:** {complete vision — what this looks like when fully built out}
- **Skip if:** {conditions under which this feature should NOT be built — e.g., "user research shows <5% would use it", "existing feature X already covers 90% of the use case"}

### Personas Consulted
| Persona | Rounds | Key Contribution |
|---------|--------|-----------------|
| ⚙️ Engineer | 1, 2 | {one-line summary of most important contribution} |
| 🎨 Designer | 1, 2 | {one-line summary} |
| 📋 PM | 1, 2 | {one-line summary} |
| 🤔 Skeptic | 1, 2 | {one-line summary} |
```

3. **Save exploration to disk** in TOON format:

Create `.plan-history/explorations/` directory if it doesn't exist. Save to `.plan-history/explorations/{date}-{slug}.toon`:

```toon
type: exploration
topic: {topic}
slug: {slugified topic}
exploredAt: {ISO 8601}
depth: {quick|standard|deep}
rounds: {N}
status: complete

personas[N]{name,rounds,keyContribution}:
  engineer,1-2,{one-line summary}
  designer,1-2,{one-line summary}
  pm,1-2,{one-line summary}
  skeptic,1-2,{one-line summary}

recommendation: {1-2 sentence recommendation}

keyInsights[N]: {insight 1}, {insight 2}, {insight 3}

requirementsSurfaced[N]{requirement,source,round}:
  {requirement 1},{persona},{round}
  {requirement 2},{persona},{round}

risks[N]{risk,severity,mitigation,source}:
  {risk},{H|M|L},{mitigation},{persona}

openQuestions[N]: {question 1}, {question 2}

suggestedScope:
  mvp: {mvp description}
  full: {full description}
  skipIf: {skip conditions}
```

### Step 5: Optional Actions

After presenting the synthesis, offer follow-up actions:

```
Exploration complete. What would you like to do next?

1. [add to roadmap]  → Add "{topic}" to ROADMAP.md with surfaced requirements as acceptance criteria
2. [debate]          → Deep-dive debate on: "{key decision point from synthesis}"
3. [explore more]    → Run another exploration round with different personas or focus
4. [save & exit]     → Exploration saved to .plan-history/explorations/{file}. Done.
```

**If `--add` was passed** (or user selects option 1): Run `/loom-roadmap add "{topic}"` and include the surfaced requirements as acceptance criteria context. Pass the MVP scope as the initial feature description. Pass risks as notes in the phase entry.

**If `--debate` was passed** (or user selects option 2): Identify the most contentious or unresolved decision point from the synthesis. Run `/loom debate "{decision point}"` with the exploration summary injected as context so debate participants have full background.

### Wiki Update (non-blocking)

If `.loom/wiki/` exists, spawn the wiki-maintainer-agent (general-purpose) with:
- Instruction: "Read your instructions from `~/.claude/agents/wiki-maintainer-agent.md` first."
- Event type: `exploration-complete`
- Event data in TOON format:

```toon
wikiEvent:
  type: exploration-complete
  topic: {topic}
  exploredAt: {ISO 8601}
  recommendation: {recommendation}
  keyInsights[N]: {insights}
  requirementsSurfaced[N]: {requirements}
  risks[N]: {risks}
  suggestedScope:
    mvp: {mvp}
    full: {full}
```

- Wiki path: `.loom/wiki`

This is fire-and-forget — do not block the exploration output on wiki completion.

### Error Handling

- **No topic provided:** Print usage with examples:
  ```
  Usage: /loom-roadmap explore "topic" [--personas list] [--depth quick|standard|deep] [--add] [--debate]

  Examples:
    /loom-roadmap explore "real-time collaboration"
    /loom-roadmap explore "should we add AI-powered search?"
    /loom-roadmap explore "migration to microservices" --depth deep
    /loom-roadmap explore "payment processing" --personas engineer,security,pm
  ```

- **Invalid persona name:** Reject with error listing valid persona names from the library.

- **Agent failure (single persona):** Continue with remaining personas. Note the gap in the round output and synthesis: `Note: {persona} agent was unavailable in Round {N}. Insights from this perspective may be incomplete.`

- **Agent failure (all personas in a round):** Warn the user and offer to retry the round or skip to synthesis with available data.

- **No ROADMAP.md:** Exploration still works — it just won't reference existing features or constraints. Note this at the start: `Note: No ROADMAP.md found. Exploring without existing roadmap context. Feature references will be generic.`

- **User aborts mid-round** (Ctrl+C or explicit abort): Save partial exploration to `.plan-history/explorations/{date}-{slug}.toon` with `status: partial` and include whatever rounds completed. Display: `Partial exploration saved. Resume with: /loom-roadmap explore "{topic}" --depth {depth}`

---

