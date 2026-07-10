// Loom wave execution — Workflow driver (Fable Readiness M-2, C-04/C-07).
//
// Pure choreography over `scripts/lib/engine/execute-step.ts`, which owns all
// deterministic semantics (state.toon, rollback tags, wave summaries, and the
// auto quality-gate rules). This driver is the `--auto` execution path:
// human-gated runs stay on the markdown driver because a Workflow run cannot
// pause for approval.
//
// Shape comes from the PLAN itself (waves/tasks parsed by the preflight
// agent); this script enforces only caps (maxParallelAgents per round) and
// reports every clamp (C-07).
//
// args: { planPath: string, runId: string, startedAt: string,
//         maxParallelAgents?: number }

export const meta = {
  name: 'loom-execute',
  description: 'Deterministic Loom wave execution (auto mode) over the execute-step CLI',
  whenToUse: 'Invoked by /loom-plan execute --auto when the discipline profile resolves to standard or minimal. Human-gated runs use the markdown driver.',
  phases: [
    { title: 'Plan', detail: 'parse PLAN.md waves/tasks, init state + start tag' },
    { title: 'Waves', detail: 'per wave: implementers in parallel → wiring → verification → gate' },
    { title: 'Finalize', detail: 'terminal plan status via the CLI' },
  ],
}

const RELAY = 'Print nothing else in your final message: return ONLY the JSON object from the last stdout line of the command, as your structured output.'

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    waves: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'number' },
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                taskId: { type: 'string' },
                agent: { type: 'string' },
                agentFile: { type: 'string' },
                model: { type: 'string' },
                description: { type: 'string' },
                fileOwnership: { type: 'array', items: { type: 'string' } },
              },
              required: ['taskId', 'agent', 'description', 'fileOwnership'],
            },
          },
        },
        required: ['index', 'tasks'],
      },
    },
    wavesFile: { type: 'string' },
  },
  required: ['waves', 'wavesFile'],
}

const START_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    wave: { type: 'number' },
    tasks: { type: 'array' },
  },
  required: ['ok'],
}

const GATE_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    gate: { type: 'string' },
    gateReason: { type: 'string' },
    verification: { type: 'string' },
    failedTasks: { type: 'array', items: { type: 'string' } },
    retryTasks: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'gate'],
}

const FINAL_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    status: { type: 'string' },
    wavesSucceeded: { type: 'number' },
    wavesTotal: { type: 'number' },
  },
  required: ['ok', 'status'],
}

// args may arrive JSON-stringified depending on the caller's encoding —
// normalize before reading (live-fire finding, e2e run wf_06989ddc).
const input = typeof args === 'string' ? JSON.parse(args) : (args ?? {})
const planPath = input.planPath
const runId = input.runId
const maxParallel = input.maxParallelAgents ?? 6
if (!planPath) {
  return { status: 'failed', reason: 'args.planPath missing' }
}
const wavesFile = '.plan-execution/ephemeral/parsed-waves.json'

phase('Plan')
const plan = await agent(
  `Parse the execution plan at ${planPath} (schema: protocols/plan.schema.md).\n` +
    `For every "### Phase N — Wave W" section, extract each task: taskId, agent, ` +
    `the agent's .md file path (agents/<name>.md or .claude/agents/<name>.md), ` +
    `its resolved model per the mandatory chain (orchestration.toml registration ` +
    `-> agent frontmatter model: -> "inherit"), a one-line description, and the ` +
    `File Ownership list. Group tasks by wave index (Wave 0 = contracts).\n` +
    `Write the result as JSON to ${wavesFile} in the form ` +
    `{"waves":[{"index":0,"tasks":[...]}]} and ALSO return it as structured ` +
    `output with wavesFile set to that path.`,
  { label: 'plan:parse', schema: PLAN_SCHEMA }
)
if (!plan || plan.waves.length === 0) {
  return { status: 'failed', reason: 'plan parse produced no waves' }
}

await agent(
  `Run this command from the project root and relay its verdict:\n\n` +
    `  bunx tsx scripts/lib/engine/execute-step.ts init --plan ${planPath} --run-id ${runId} --waves-file ${plan.wavesFile}\n\n` +
    RELAY,
  { label: 'exec:init', schema: START_SCHEMA, effort: 'low' }
)

phase('Waves')
let failed = false
for (const wave of plan.waves) {
  let attempt = 0
  while (true) {
    attempt += 1
    const start = await agent(
      `Run this command from the project root and relay its verdict:\n\n` +
        `  bunx tsx scripts/lib/engine/execute-step.ts start-wave --wave ${wave.index}\n\n` +
        RELAY,
      { label: `wave-${wave.index}:start`, phase: 'Waves', schema: START_SCHEMA, effort: 'low' }
    )
    const active = (start?.tasks ?? []).filter(Boolean)
    if (active.length === 0) break

    // Implementer fan-out — one owner per file (enforced by the
    // file-ownership hook), rounds capped at maxParallel with the clamp
    // reported (C-07: no silent caps).
    const rounds = []
    for (let i = 0; i < active.length; i += maxParallel) rounds.push(active.slice(i, i + maxParallel))
    if (rounds.length > 1) {
      log(`wave ${wave.index}: ${active.length} tasks split into ${rounds.length} rounds of <= ${maxParallel} (maxParallelAgents)`)
    }
    const results = []
    for (const round of rounds) {
      const roundResults = await parallel(
        round.map((t) => () =>
          agent(
            `Read your instructions from ${t.agentFile ?? `agents/${t.agent}.md`} first — they are your system prompt.\n` +
              `Task ${t.taskId} (wave ${wave.index}, attempt ${t.retryCount + 1}): ${t.description}\n` +
              `File ownership (you may ONLY create/modify these): ${t.fileOwnership.join(', ')}\n` +
              `If you need a file outside your boundary, write a request to .plan-execution/ephemeral/requests/${t.taskId}.toon instead of editing it.\n` +
              `When done, return structured output: {taskId, status: "succeeded"|"failed", filesModified: [...], blockingIssues: <count>, summary: <1 line>}.`,
            {
              label: `impl:${t.taskId}`,
              phase: 'Waves',
              schema: {
                type: 'object',
                properties: {
                  taskId: { type: 'string' },
                  status: { type: 'string', enum: ['succeeded', 'failed'] },
                  filesModified: { type: 'array', items: { type: 'string' } },
                  blockingIssues: { type: 'number' },
                  summary: { type: 'string' },
                },
                required: ['taskId', 'status'],
              },
              ...(t.model && t.model !== 'inherit' ? { model: t.model } : {}),
            }
          )
        )
      )
      results.push(...roundResults.filter(Boolean))
    }

    // Serial wiring pass (skipped for Wave 0 — contracts have no cross-boundary work).
    if (wave.index > 0) {
      await agent(
        `Read your instructions from agents/wiring-agent.md first — they are your system prompt.\n` +
          `Wave ${wave.index} wiring: process cross-boundary requests in ` +
          `.plan-execution/ephemeral/requests/, update barrels/registrations/package files, ` +
          `and reply "done" with a one-line summary.`,
        { label: `wave-${wave.index}:wiring`, phase: 'Waves' }
      )
    }

    // Serial verification.
    const verification = await agent(
      `Read your instructions from agents/verification-agent.md first — they are your system prompt.\n` +
        `Verify wave ${wave.index}: run the verification pipeline ` +
        `([domain].verificationPipeline from .claude/orchestration.toml, or auto-detect), ` +
        `check file-ownership drift via git diff --name-only. Return structured output: ` +
        `{result: "pass"|"fail", failures: [...], failuresInOwnedFiles: true|false}.`,
      {
        label: `wave-${wave.index}:verify`,
        phase: 'Waves',
        schema: {
          type: 'object',
          properties: {
            result: { type: 'string', enum: ['pass', 'fail'] },
            failures: { type: 'array', items: { type: 'string' } },
            failuresInOwnedFiles: { type: 'boolean' },
          },
          required: ['result'],
        },
      }
    )

    // Record + gate via the CLI (it owns the auto-gate rules).
    const resultsFile = `.plan-execution/ephemeral/wave-${wave.index}-results.json`
    const gate = await agent(
      `Write this JSON to ${resultsFile}:\n` +
        JSON.stringify({ tasks: results, verification: verification ?? { result: 'fail' } }) +
        `\nThen run from the project root and relay the verdict:\n\n` +
        `  bunx tsx scripts/lib/engine/execute-step.ts record-wave --wave ${wave.index} --results-file ${resultsFile}\n\n` +
        RELAY,
      { label: `wave-${wave.index}:gate`, phase: 'Waves', schema: GATE_SCHEMA, effort: 'low' }
    )

    if (!gate || gate.gate === 'escalate') {
      log(`wave ${wave.index}: ESCALATE — ${gate?.gateReason ?? 'no gate verdict'}`)
      failed = true
      break
    }
    if (gate.gate === 'proceed') {
      log(`wave ${wave.index}: proceed — ${gate.gateReason}`)
      break
    }
    // retry — the CLI already reset retryable tasks to pending; loop re-runs
    // start-wave, which re-activates only unfinished tasks.
    log(`wave ${wave.index}: retry attempt ${attempt} — ${gate.gateReason}`)
    if (attempt >= 3) {
      log(`wave ${wave.index}: retry ceiling reached — escalating`)
      failed = true
      break
    }
  }
  if (failed) break
}

phase('Finalize')
const final = await agent(
  `Run this command from the project root and relay its verdict:\n\n` +
    `  bunx tsx scripts/lib/engine/execute-step.ts finalize --status ${failed ? 'failed' : 'completed'}\n\n` +
    RELAY,
  { label: 'exec:finalize', schema: FINAL_SCHEMA, effort: 'low' }
)

return {
  status: final?.status ?? (failed ? 'failed' : 'completed'),
  wavesSucceeded: final?.wavesSucceeded ?? null,
  wavesTotal: final?.wavesTotal ?? null,
}
