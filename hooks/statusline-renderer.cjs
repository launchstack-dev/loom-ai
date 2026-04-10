// statusline-renderer.cjs — Loom + Claude Code status line
// Line 1: Claude Code session (model, task, dir, context bar)
// Line 2: Loom pipeline state (command, stage, phase progress, plan bar)
// Exit 0 ALWAYS.

const fs = require('fs');
const path = require('path');
const os = require('os');

const STALENESS_SECONDS = 300;
const SEP = ' \x1b[2m\u2502\x1b[0m '; // dim │

let input = '';
const stdinTimeout = setTimeout(() => render({}), 3000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try { render(input.trim() ? JSON.parse(input) : {}); }
  catch { render({}); }
});

function render(data) {
  try {
    const model = data.model?.display_name || null;
    const dir = data.workspace?.current_dir || process.cwd();
    const session = data.session_id || '';
    const remaining = data.context_window?.remaining_percentage;

    // Dump stdin for schema discovery (writes once per session)
    if (session) {
      try {
        const debugPath = path.join(os.tmpdir(), 'claude-statusline-schema.json');
        if (!fs.existsSync(debugPath)) {
          fs.writeFileSync(debugPath, JSON.stringify(data, null, 2));
        }
      } catch {}
    }

    // ── Line 1: Claude Code session ──
    const line1 = [];
    if (model) line1.push(`\x1b[2m${model}\x1b[0m`);

    // Current task from todos
    const task = readCurrentTask(session);
    if (task) line1.push(`\x1b[1m${task}\x1b[0m`);

    const home = os.homedir();
    const displayDir = dir.startsWith(home) ? '~' + dir.slice(home.length) : dir;
    line1.push(`\x1b[2m${displayDir}\x1b[0m`);

    // Session token usage + cost estimate
    const tokenSeg = buildTokenSegment(data, session, model);
    if (tokenSeg) line1.push(tokenSeg);

    const ctxBar = buildContextBar(remaining, session);
    if (ctxBar) line1.push(ctxBar);

    // ── Line 2: Loom state ──
    const root = findRoot(dir);
    let line2 = '';
    if (root) {
      line2 = buildLoomLine(root);
    }

    // ── Output ──
    let output = line1.join(SEP);
    if (line2) output += '\n' + line2;
    process.stdout.write(output);
  } catch {}
  process.exit(0);
}

// ═══════════════════════════════════════════════════════════
// Line 1 helpers
// ═══════════════════════════════════════════════════════════

function buildContextBar(remaining, session) {
  if (remaining == null) return '';
  const AUTO_COMPACT_BUFFER_PCT = 16.5;
  const usableRemaining = Math.max(0, ((remaining - AUTO_COMPACT_BUFFER_PCT) / (100 - AUTO_COMPACT_BUFFER_PCT)) * 100);
  const used = Math.max(0, Math.min(100, Math.round(100 - usableRemaining)));

  // Bridge file for context-monitor hook
  if (session) {
    try {
      const bridgePath = path.join(os.tmpdir(), `claude-ctx-${session}.json`);
      fs.writeFileSync(bridgePath, JSON.stringify({
        session_id: session, remaining_percentage: remaining,
        used_pct: used, timestamp: Math.floor(Date.now() / 1000)
      }));
    } catch {}
  }

  const filled = Math.floor(used / 10);
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(10 - filled);
  const label = '\x1b[2mctx\x1b[0m ';
  if (used < 50) return `${label}\x1b[32m${bar} ${used}%\x1b[0m`;
  if (used < 65) return `${label}\x1b[33m${bar} ${used}%\x1b[0m`;
  if (used < 80) return `${label}\x1b[38;5;208m${bar} ${used}%\x1b[0m`;
  return `${label}\x1b[5;31m\u{1F480} ${bar} ${used}%\x1b[0m`;
}

// Per-million pricing by model family (input/output)
const PRICING = {
  'opus':   { input: 15, output: 75 },
  'sonnet': { input: 3,  output: 15 },
  'haiku':  { input: 0.80, output: 4 },
};

function buildTokenSegment(data, session, modelName) {
  // Check all known field paths for token data
  const usage = data.usage || data.token_usage || data.session_usage || {};
  const inputTokens = usage.input_tokens ?? usage.total_input ?? data.total_input_tokens ?? null;
  const outputTokens = usage.output_tokens ?? usage.total_output ?? data.total_output_tokens ?? null;
  const totalTokens = usage.total_tokens ?? data.total_tokens ?? null;

  // If Claude Code provides token data directly, use it
  if (inputTokens != null || totalTokens != null) {
    const total = totalTokens ?? ((inputTokens || 0) + (outputTokens || 0));
    const cost = estimateCost(inputTokens || 0, outputTokens || 0, modelName);
    const tokStr = formatTokens(total);
    if (cost > 0) return `\x1b[2m${tokStr} ~$${cost.toFixed(2)}\x1b[0m`;
    return `\x1b[2m${tokStr}\x1b[0m`;
  }

  // Fallback: track via bridge file accumulation
  if (!session) return '';
  const trackPath = path.join(os.tmpdir(), `claude-session-tokens-${session}.json`);
  try {
    if (fs.existsSync(trackPath)) {
      const track = JSON.parse(fs.readFileSync(trackPath, 'utf-8'));
      if (track.total_tokens) {
        const tokStr = formatTokens(track.total_tokens);
        if (track.cost) return `\x1b[2m${tokStr} ~$${track.cost.toFixed(2)}\x1b[0m`;
        return `\x1b[2m${tokStr}\x1b[0m`;
      }
    }
  } catch {}

  return '';
}

function estimateCost(inputTokens, outputTokens, modelName) {
  if (!modelName) return 0;
  const key = Object.keys(PRICING).find(k => modelName.toLowerCase().includes(k));
  if (!key) return 0;
  const p = PRICING[key];
  return (inputTokens / 1e6) * p.input + (outputTokens / 1e6) * p.output;
}

function formatTokens(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M tok';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K tok';
  return n + ' tok';
}

function readCurrentTask(session) {
  if (!session) return '';
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const todosDir = path.join(claudeDir, 'todos');
  try {
    if (!fs.existsSync(todosDir)) return '';
    const files = fs.readdirSync(todosDir)
      .filter(f => f.startsWith(session) && f.includes('-agent-') && f.endsWith('.json'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(todosDir, f)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);
    if (files.length === 0) return '';
    const todos = JSON.parse(fs.readFileSync(path.join(todosDir, files[0].name), 'utf8'));
    const inProgress = todos.find(t => t.status === 'in_progress');
    return inProgress?.activeForm || '';
  } catch { return ''; }
}

// ═══════════════════════════════════════════════════════════
// Line 2: Loom state
// ═══════════════════════════════════════════════════════════

function buildLoomLine(root) {
  const statusFile = path.join(root, '.plan-execution', 'status.toon');
  const pipelineFile = path.join(root, '.plan-execution', 'pipeline-state.toon');
  const planFile = path.join(root, 'PLAN.md');

  const planMeta = readPlanMeta(planFile);
  const active = readActiveState(statusFile);
  const pipeline = readPipelineState(pipelineFile);

  if (active) return renderActiveLine(active, planMeta, pipeline, root);
  return renderIdleLine(planMeta, statusFile, root);
}

function readPlanMeta(planFile) {
  try {
    if (!fs.existsSync(planFile)) return null;
    const head = fs.readFileSync(planFile, 'utf-8').slice(0, 800);
    return {
      name: extractFrontmatter(head, 'name'),
      status: extractFrontmatter(head, 'status'),
      totalPhases: parseInt(extractFrontmatter(head, 'totalPhases')) || 0,
      totalWaves: parseInt(extractFrontmatter(head, 'totalWaves')) || 0,
    };
  } catch { return null; }
}

function extractFrontmatter(text, key) {
  const m = text.match(new RegExp(`^${key}:\\s*["']?([^"'\\n]+)`, 'm'));
  return m ? m[1].trim() : '';
}

function readPipelineState(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const content = fs.readFileSync(file, 'utf-8');
    return {
      currentStage: toonGet(content, 'currentStage'),
      outerIteration: toonGet(content, 'outerIteration'),
      fixCycleCount: toonGet(content, 'fixCycleCount'),
      agentsSpawned: toonGet(content, 'agentsSpawned'),
      maxAgents: toonGet(content, 'maxAgents'),
    };
  } catch { return null; }
}

function renderActiveLine(active, planMeta, pipeline, root) {
  const parts = [];

  // Command + stage breadcrumb: loom-auto › executing
  let breadcrumb = '';
  if (active.command) breadcrumb = active.command;
  if (active.phase && active.phase !== active.command) {
    breadcrumb += ` \x1b[2m\u203a\x1b[0m\x1b[1;34m ${active.phase}`;
  }
  if (breadcrumb) parts.push(breadcrumb);

  // Wave progress with bar: ████░░░░ W2/4
  if (active.wave != null && active.totalWaves != null) {
    const w = parseInt(active.wave);
    const tw = parseInt(active.totalWaves);
    if (tw > 0) {
      const bar = progressBar(w, tw, 8);
      parts.push(`${bar} W${w}/${tw}`);
    }
  }

  // Agent count
  if (active.agentsDone != null && active.agentsTotal != null) {
    parts.push(`agents(${active.agentsDone}/${active.agentsTotal})`);
  } else if (active.agentsSpawned != null && parseInt(active.agentsSpawned) > 0) {
    parts.push(`${active.agentsSpawned} agents`);
  }

  // Failures / findings
  if (active.agentsFailed && parseInt(active.agentsFailed) > 0) {
    parts.push(`\x1b[31mFAIL:${active.agentsFailed}\x1b[1;34m`);
  }
  if (active.findings && parseInt(active.findings) > 0) {
    parts.push(`findings:${active.findings}`);
  }

  // Plan progress bar (overall): Phase 5/8
  if (planMeta && planMeta.totalPhases > 0 && active.wave != null) {
    // Estimate completed phases from wave progress
    // Each wave may have multiple phases; use wave ratio as approximation
    const w = parseInt(active.wave);
    const tw = parseInt(active.totalWaves) || planMeta.totalWaves;
    const estPhase = Math.round((w / Math.max(tw, 1)) * planMeta.totalPhases);
    parts.push(`\x1b[2mPh ${estPhase}/${planMeta.totalPhases}\x1b[0m\x1b[1;34m`);
  }

  // Git branch
  const branch = gitBranch(root);
  if (branch) parts.push(`\x1b[2m${branch}\x1b[0m\x1b[1;34m`);

  return `\x1b[1;34m\u{1F9F5} ${parts.join(SEP)}\x1b[0m`;
}

function renderIdleLine(planMeta, statusFile, root) {
  const parts = [];

  // Plan name + status with completion bar
  if (planMeta && planMeta.name) {
    let planSeg = planMeta.name;
    if (planMeta.status) {
      const icon = planMeta.status === 'completed' ? '\x1b[32m\u2713\x1b[0m\x1b[34m'
        : planMeta.status === 'in-progress' ? '\x1b[33m\u25B6\x1b[0m\x1b[34m'
        : '';
      planSeg += ` ${icon} ${planMeta.status}`;
    }
    if (planMeta.totalPhases > 0) {
      planSeg += ` (${planMeta.totalPhases} phases, ${planMeta.totalWaves} waves)`;
    }
    parts.push(planSeg);
  }

  // Last result from stale status.toon
  try {
    if (fs.existsSync(statusFile)) {
      const content = fs.readFileSync(statusFile, 'utf-8');
      const stage = toonGet(content, 'stage') || toonGet(content, 'stageName');
      const cmd = toonGet(content, 'command');
      if (stage === 'complete' || stage === 'Complete') {
        parts.push(`\x1b[32mlast: ${cmd || 'pipeline'} \u2713\x1b[0m\x1b[34m`);
      } else if (stage === 'escalated' || stage === 'failed') {
        parts.push(`\x1b[31mlast: ${cmd || 'pipeline'} \u2717\x1b[0m\x1b[34m`);
      }
    }
  } catch {}

  // Git branch
  const branch = gitBranch(root);
  if (branch) parts.push(`\x1b[2m${branch}\x1b[0m\x1b[34m`);

  if (parts.length === 0) return '';
  return `\x1b[34m\u{1F9F5} ${parts.join(SEP)}\x1b[0m`;
}

// ═══════════════════════════════════════════════════════════
// Shared helpers
// ═══════════════════════════════════════════════════════════

function progressBar(current, total, width) {
  const pct = Math.min(current / Math.max(total, 1), 1);
  const filled = Math.round(pct * width);
  return '\x1b[36m' + '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled) + '\x1b[0m\x1b[1;34m';
}

function gitBranch(root) {
  try {
    const { execSync } = require('child_process');
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: root, timeout: 100, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch { return ''; }
}

function findRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(dir, '.plan-execution')) || fs.existsSync(path.join(dir, 'PLAN.md'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function toonGet(content, key) {
  const m = content.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : null;
}

function readActiveState(statusFile) {
  try {
    if (!fs.existsSync(statusFile)) return null;
    const content = fs.readFileSync(statusFile, 'utf-8');
    const updatedAt = toonGet(content, 'updatedAt');
    if (!updatedAt) return null;
    const fileTime = new Date(updatedAt).getTime();
    if (isNaN(fileTime) || (Date.now() - fileTime) / 1000 > STALENESS_SECONDS) return null;
    return {
      command: toonGet(content, 'command') || toonGet(content, 'stage'),
      phase: toonGet(content, 'phase') || toonGet(content, 'stageName'),
      wave: toonGet(content, 'wave'),
      totalWaves: toonGet(content, 'totalWaves'),
      agentsDone: toonGet(content, 'agentsDone'),
      agentsTotal: toonGet(content, 'agentsTotal'),
      agentsFailed: toonGet(content, 'agentsFailed'),
      agentsSpawned: toonGet(content, 'agentsSpawned'),
      findings: toonGet(content, 'findings'),
    };
  } catch { return null; }
}
