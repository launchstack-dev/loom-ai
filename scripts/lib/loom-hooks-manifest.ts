/**
 * scripts/lib/loom-hooks-manifest.ts — the canonical Loom hook registration
 * manifest, extracted from scripts/register-loom-hooks.ts so that tests can
 * import it WITHOUT importing the CLI script (whose module body invokes
 * main()). Note 047 + PR #32 review: an earlier attempt guarded main() with
 * an argv[1] === __filename check, but that guard fails OPEN — any argv
 * mismatch (symlinked invocation, wrapper rewriting argv, runner realpath
 * differences) turned the script into a silent no-op with exit 0, and both
 * documented callers (loom-init, loom-auto) key on exit code alone. Keeping
 * the data in a side-effect-free module and main() unconditional in the
 * script eliminates the entrypoint-detection problem entirely.
 *
 * Derived from `.claude/settings.json` in the loom-ai repo (the source of
 * truth for the intended wiring). Event+matcher combinations are preserved
 * exactly.
 *
 * NOTE: `context-monitor` appears twice intentionally — once on PostToolUse
 * for ambient telemetry, once on Stop for the end-of-session snapshot. Both
 * entries are independent and registered separately.
 */

export type EventKind =
  | "SessionStart"
  | "PreToolUse"
  | "PostToolUse"
  | "SubagentStop"
  | "Stop";

export interface HookEntry {
  hookName: string;
  event: EventKind;
  matcher?: string; // omitted/empty for events without a matcher (SessionStart, SubagentStop, Stop, "*")
  timeoutMs: number;
}

export const LOOM_HOOKS: HookEntry[] = [
  // SessionStart — status banner + one-shot legacy migration.
  // loom-migration is idempotent: runs once per session, self-bails if no
  // migration is needed (Wave 5a).
  { hookName: "wiki-session-status", event: "SessionStart",                       timeoutMs: 5000  },
  { hookName: "loom-migration",      event: "SessionStart",                       timeoutMs: 10000 },
  // PreToolUse Write|Edit — gating
  { hookName: "contract-lock",       event: "PreToolUse",  matcher: "Write|Edit", timeoutMs: 10000 },
  { hookName: "file-ownership",      event: "PreToolUse",  matcher: "Write|Edit", timeoutMs: 10000 },
  { hookName: "wiki-write-guard",    event: "PreToolUse",  matcher: "Write|Edit", timeoutMs: 10000 },
  // PreToolUse Write|Edit — non-gating (warner)
  { hookName: "wiki-impact-warner",  event: "PreToolUse",  matcher: "Write|Edit", timeoutMs: 3000  },
  // PreToolUse Write|Edit — map-freshness precondition (C-08; dormant until .loom/wiki/maps/ exists)
  { hookName: "map-freshness",       event: "PreToolUse",  matcher: "Write|Edit", timeoutMs: 5000  },
  // PreToolUse Bash — gating + non-gating (warner) for /loom-git pr fan-in scan
  { hookName: "deploy-guard",        event: "PreToolUse",  matcher: "Bash",       timeoutMs: 10000 },
  { hookName: "loom-careful",        event: "PreToolUse",  matcher: "Bash",       timeoutMs: 5000  },
  { hookName: "preflight-worktree-scan", event: "PreToolUse", matcher: "Bash",    timeoutMs: 10000 },
  // PreToolUse Agent — preflight budget gate
  { hookName: "context-budget",      event: "PreToolUse",  matcher: "Agent",      timeoutMs: 10000 },
  { hookName: "budget-tracker",      event: "PreToolUse",  matcher: "Agent",      timeoutMs: 10000 },
  // PostToolUse Write|Edit — typecheck + language linters
  { hookName: "typecheck-on-write",  event: "PostToolUse", matcher: "Write|Edit", timeoutMs: 30000 },
  { hookName: "shellcheck-on-write", event: "PostToolUse", matcher: "Write|Edit", timeoutMs: 30000 },
  { hookName: "bash-portability-on-write", event: "PostToolUse", matcher: "Write|Edit", timeoutMs: 30000 },
  { hookName: "pylint-on-write",     event: "PostToolUse", matcher: "Write|Edit", timeoutMs: 30000 },
  // PostToolUse Bash — wiki ledger
  { hookName: "wiki-commit-ledger",  event: "PostToolUse", matcher: "Bash",       timeoutMs: 5000  },
  // PostToolUse * — ambient monitors
  { hookName: "context-monitor",     event: "PostToolUse", matcher: "",           timeoutMs: 10000 },
  { hookName: "checkpoint-trigger",  event: "PostToolUse", matcher: "",           timeoutMs: 10000 },
  // SubagentStop — post-agent bookkeeping (AgentResult validation + status timestamps)
  { hookName: "agent-result-validator", event: "SubagentStop",                    timeoutMs: 5000  },
  { hookName: "status-updater",      event: "SubagentStop",                       timeoutMs: 10000 },
  // Stop * — gating + end-of-session snapshot
  { hookName: "quality-gate",        event: "Stop",        matcher: "",           timeoutMs: 10000 },
  { hookName: "context-monitor",     event: "Stop",        matcher: "",           timeoutMs: 10000 },
];
