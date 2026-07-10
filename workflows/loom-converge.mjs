// Loom convergence engine — Workflow driver (Fable Readiness M-2, C-04/C-07).
//
// This script is pure CHOREOGRAPHY. Every locked semantic — findings
// validation, breaker policy, state/iteration persistence, C-09/C-10 stdout,
// convergence-summary.toon — lives in `scripts/lib/engine/iterate.ts` (the
// step-recorder CLI), which agents run and whose JSON verdict they relay as
// structured output. No policy is duplicated here (C-01 DRY).
//
// Shape is model/config-chosen; this script enforces only CAPS (agent budget,
// iteration ceiling) and reports every clamp — no fixed fan-out literals
// (C-07). Launched by /loom-converge under the standard/minimal discipline
// profiles; the markdown driver remains the strict-profile fallback.
//
// args (hydrated by the /loom-converge command from converge.config):
//   { configPath: string, startedAt: string (ISO, passed in — no clocks here),
//     maxParallelAgents?: number }

export const meta = {
  name: 'loom-converge',
  description: 'Deterministic Loom convergence loop (target/criteria/document) over the step-recorder CLI',
  whenToUse: 'Invoked by the /loom-converge command when the discipline profile resolves to standard or minimal. Not for ad-hoc use — args must come from a preflighted converge.config.',
  phases: [
    { title: 'Preflight', detail: 'validate config, resolve harness/integrator, recover resume position' },
    { title: 'Iterate', detail: 'harness → reviewers (config-chosen panel) → record/breakers → integrator' },
    { title: 'Finalize', detail: 'write convergence-summary.toon via the CLI' },
  ],
}

const RELAY = 'Print nothing else in your final message: return ONLY the JSON object from the last stdout line of the command, as your structured output.'

const PREFLIGHT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    haltReason: { type: ['string', 'null'] },
    detail: { type: ['string', 'null'] },
    runId: { type: ['string', 'null'] },
    mode: { type: ['string', 'null'] },
    subject: { type: ['string', 'null'] },
    harness: { type: ['string', 'null'] },
    integrator: { type: ['string', 'null'] },
    integratorAgentFile: { type: ['string', 'null'] },
    integratorModel: { type: ['string', 'null'] },
    maxIterations: { type: ['number', 'null'] },
    agentBudget: { type: ['number', 'null'] },
    outputPath: { type: ['string', 'null'] },
    nextIteration: { type: ['number', 'null'] },
    totalAgentsSpawned: { type: ['number', 'null'] },
  },
  required: ['ok'],
}

const HARNESS_STEP_SCHEMA = {
  type: 'object',
  properties: {
    findingsReady: { type: 'boolean' },
    resultDir: { type: ['string', 'null'] },
    spawns: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          agentName: { type: 'string' },
          agentFile: { type: 'string' },
          model: { type: 'string' },
          subject: { type: 'string' },
        },
        required: ['agentName', 'agentFile'],
      },
    },
  },
  required: ['findingsReady', 'spawns'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    halt: { type: 'boolean' },
    haltReason: { type: ['string', 'null'] },
    status: { type: ['string', 'null'] },
    blockingCount: { type: 'number' },
    findingsBlockingCount: { type: ['number', 'null'] },
    gaps: {
      type: ['array', 'null'],
      items: {
        type: 'object',
        properties: {
          requirementId: { type: 'string' },
          requirementText: { type: 'string' },
          source: { type: 'string' },
        },
        required: ['requirementId'],
      },
    },
    priorBlockingCount: { type: ['number', 'null'] },
    fixed: { type: ['number', 'null'] },
    new: { type: ['number', 'null'] },
    consecutiveStalls: { type: ['number', 'null'] },
    errors: { type: ['array', 'null'], items: { type: 'string' } },
  },
  required: ['halt'],
}

const FINAL_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    status: { type: 'string' },
    haltReason: { type: ['string', 'null'] },
    finalBlockingCount: { type: 'number' },
    iterationsRun: { type: 'number' },
    summaryPath: { type: 'string' },
  },
  required: ['ok', 'status'],
}

// args may arrive JSON-stringified depending on the caller's encoding —
// normalize before reading (live-fire finding, e2e run wf_06989ddc).
const input = typeof args === 'string' ? JSON.parse(args) : (args ?? {})
const configPath = input.configPath
const startedAt = input.startedAt
const maxParallel = input.maxParallelAgents ?? 6
if (!configPath) {
  return { status: 'preflight-failed', haltReason: 'FINDINGS_SCHEMA_INVALID', detail: 'args.configPath missing' }
}

phase('Preflight')
const pre = await agent(
  `Run this command from the project root and relay its verdict:\n\n` +
    `  bunx tsx scripts/lib/engine/iterate.ts preflight --config ${configPath}\n\n` +
    RELAY,
  { label: 'engine:preflight', schema: PREFLIGHT_SCHEMA, effort: 'low' }
)
if (!pre || !pre.ok) {
  log(`Preflight failed: ${pre?.haltReason ?? 'no verdict'} — ${pre?.detail ?? ''}`)
  return { status: 'preflight-failed', haltReason: pre?.haltReason ?? null, detail: pre?.detail ?? null }
}

let iteration = pre.nextIteration
let agentsSpawned = pre.totalAgentsSpawned
let haltReason = null
let converged = false

phase('Iterate')
while (true) {
  // 1. Harness run. Two-phase harnesses (plan-review, code-review) write a
  // spawn-request on the first call; single-phase harnesses (test, debug)
  // produce findings directly.
  const step = await agent(
    `You are one step of the Loom convergence engine (iteration ${iteration}).\n` +
      `Run from the project root:\n\n` +
      `  bunx tsx ${pre.harness} --config ${configPath} --iteration ${iteration}\n\n` +
      `Then:\n` +
      `- If stderr says a spawn-request was written, read the TOON file it names ` +
      `(default .plan-execution/convergence/spawn-request.toon) and return ` +
      `{findingsReady: false, resultDir: <its resultDir>, spawns: [{agentName, agentFile, model, subject}...]}.\n` +
      `- If findings were produced directly at ${pre.outputPath}, return {findingsReady: true, spawns: []}.`,
    { label: `harness:iter-${iteration}`, phase: 'Iterate', schema: HARNESS_STEP_SCHEMA, effort: 'low' }
  )
  agentsSpawned += 1

  // 2. Reviewer fan-out — panel comes from the harness/config (C-07: no
  // literals here). Caps only: cut to maxParallel and to remaining budget,
  // and say so (no silent caps).
  if (step && !step.findingsReady && step.spawns.length > 0) {
    let panel = step.spawns
    if (panel.length > maxParallel) {
      log(`reviewer panel clamped ${panel.length} → ${maxParallel} (maxParallelAgents); dropped: ${panel.slice(maxParallel).map((s) => s.agentName).join(', ')}`)
      panel = panel.slice(0, maxParallel)
    }
    const remaining = Math.max(0, pre.agentBudget - agentsSpawned - 2) // reserve recorder-relay + integrator headroom
    if (panel.length > remaining) {
      log(`spawn round cut ${panel.length} → ${remaining} (agentBudget ${pre.agentBudget}, spawned ${agentsSpawned})`)
      panel = panel.slice(0, remaining)
    }
    await parallel(
      panel.map((spec) => () =>
        agent(
          `Read your instructions from ${spec.agentFile} first — they are your system prompt.\n` +
            `Review the subject: ${spec.subject ?? pre.subject}\n` +
            `Iteration: ${iteration}\n` +
            `Write your AgentResult envelope (TOON, per protocols/agent-result.schema.md) ` +
            `atomically to ${step.resultDir}/${spec.agentName}.toon (write .tmp then rename). ` +
            `Your final message can be one line; the envelope file is the deliverable.`,
          {
            label: `review:${spec.agentName}`,
            phase: 'Iterate',
            ...(spec.model && spec.model !== 'inherit' ? { model: spec.model } : {}),
          }
        )
      )
    )
    agentsSpawned += panel.length

    await agent(
      `Aggregate the reviewer results. Run from the project root:\n\n` +
        `  bunx tsx ${pre.harness} --config ${configPath} --iteration ${iteration} --results-dir ${step.resultDir}\n\n` +
        `Confirm ${pre.outputPath} was written; reply "done".`,
      { label: `aggregate:iter-${iteration}`, phase: 'Iterate', effort: 'low' }
    )
  }

  // 3. Record + breakers — the CLI owns the policy and the locked stdout.
  const verdict = await agent(
    `Run this command from the project root and relay its verdict:\n\n` +
      `  bunx tsx scripts/lib/engine/iterate.ts record --config ${configPath} ` +
      `--iteration ${iteration} --findings ${pre.outputPath} --agents-spawned ${agentsSpawned}\n\n` +
      RELAY,
    { label: `record:iter-${iteration}`, phase: 'Iterate', schema: VERDICT_SCHEMA, effort: 'low' }
  )
  if (!verdict) {
    haltReason = 'HARNESS_MISSING'
    break
  }
  log(`iteration ${iteration}: blocking ${verdict.priorBlockingCount ?? '?'} → ${verdict.blockingCount} (spawned ${agentsSpawned}/${pre.agentBudget})`)
  if (verdict.halt) {
    if (verdict.status === 'converged') converged = true
    else haltReason = verdict.haltReason
    break
  }

  // 4a. Goal-backward gaps (C-08): ONE bounded fix per uncovered requirement,
  // never an unbounded loop. Round fitted to the remaining budget, cut logged.
  const gaps = verdict.gaps ?? []
  if (gaps.length > 0) {
    let round = gaps
    const remaining = Math.max(0, pre.agentBudget - agentsSpawned - 1) // reserve integrator headroom
    if (round.length > remaining) {
      log(`gap-fix round cut ${round.length} → ${remaining} (agentBudget ${pre.agentBudget}, spawned ${agentsSpawned})`)
      round = round.slice(0, remaining)
    }
    await parallel(
      round.map((gap) => () =>
        agent(
          `Read your instructions from agents/fixer-agent.md first — they are your system prompt.\n` +
            `Bounded gap fix (convergence iteration ${iteration}): requirement ${gap.requirementId} ` +
            `(${gap.source}) is UNCOVERED — "${gap.requirementText}".\n` +
            `Deliver and wire exactly this one requirement (update .plan-execution/coverage-matrix.toon ` +
            `to coverageStatus covered with a testRef when done). Touch nothing outside this gap's scope.`,
          { label: `gap:${gap.requirementId}`, phase: 'Iterate' }
        )
      )
    )
    agentsSpawned += round.length
  }

  // 4b. Integrator — applies findings to the subject. Model resolved at
  // preflight per the mandatory chain.
  if (verdict.findingsBlockingCount === undefined || verdict.findingsBlockingCount > 0) {
    await agent(
      `Read your instructions from ${pre.integratorAgentFile} first — they are your system prompt.\n` +
        `Convergence iteration ${iteration}: apply the findings in ${pre.outputPath} ` +
        `to the subject (${pre.subject ?? 'per findings locations'}). Fix blocking findings only; ` +
        `do not expand scope (no new top-level Phase/F-NN/M-NN sections). ` +
        `Write file changes atomically.`,
      {
        label: `integrate:iter-${iteration}`,
        phase: 'Iterate',
        ...(pre.integratorModel && pre.integratorModel !== 'inherit' ? { model: pre.integratorModel } : {}),
      }
    )
    agentsSpawned += 1
  }
  iteration += 1
}

phase('Finalize')
const final = await agent(
  `Run this command from the project root and relay its verdict:\n\n` +
    `  bunx tsx scripts/lib/engine/iterate.ts finalize --config ${configPath}` +
    (haltReason ? ` --halt-reason ${haltReason}` : '') +
    (startedAt ? ` --started-at ${startedAt}` : '') +
    `\n\n` +
    RELAY,
  { label: 'engine:finalize', schema: FINAL_SCHEMA, effort: 'low' }
)

return {
  status: final?.status ?? (converged ? 'converged' : 'unknown'),
  haltReason: final?.haltReason ?? haltReason,
  finalBlockingCount: final?.finalBlockingCount ?? null,
  iterationsRun: final?.iterationsRun ?? null,
  summaryPath: final?.summaryPath ?? null,
  agentsSpawned,
}
