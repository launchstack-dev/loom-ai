# Troubleshooting

Organized by **what you saw on your screen**, not by what subsystem emitted it. Search this page (Ctrl-F / Cmd-F) for a phrase from your error message before pinging anyone.

> If you came here because something blocked you and you're certain it shouldn't have: the contract-lock and file-ownership hooks have an escape hatch — see §5.

---

## 1. Install failures

| You see | Cause | Fix |
|---|---|---|
| `FAIL <file> (fetch failed — for private repos, install gh: https://cli.github.com/)` | `curl` couldn't reach GitHub. For private repos, `gh` not installed or not authenticated. | Public repo: check network/DNS. Private repo: `brew install gh && gh auth login`, then re-run install. |
| `FAIL <file> (fetch failed via curl and gh)` | Both `curl` and `gh` failed. | Check network. If `gh auth status` shows logged out, run `gh auth login`. Confirm the repo URL is reachable. |
| `FAIL <file> (empty response)` | Fetch succeeded but body was empty (CDN issue, wrong branch, deleted file). | Re-run installer. If persistent, check that the file exists on `main` of the repo. |
| `FAIL <file> (checksum mismatch)` + `expected: …` + `got: …` | Downloaded file's SHA-256 doesn't match `checksums.sha256`. File corrupted in transit, OR you're installing from a fork with stale checksums. | Re-run installer once (transient network corruption is the usual cause). If it persists, `checksums.sha256` is stale on the source repo — open an issue. |
| `ERROR: Could not fetch library.yaml. Check your network and try again.` | Catalog manifest fetch failed. Installer can't proceed without it. | Check network. If on a corporate VPN, try off-VPN once to confirm. |
| `WARNING: <N> file(s) failed to download.` (exit 1) | Partial install — some files made it, others didn't. | Re-run installer. Partial state is safe to retry; `install.sh` is idempotent. |
| `WARNING: Neither bun nor node found. Loom hooks (.ts files) will not execute.` | No TS runtime available. Install completes but hooks won't fire. | `brew install bun` (recommended) or install Node 18+. Then restart your Claude Code session. |
| `mkdir` / `mv` / permission denied | `~/.claude/` is not writable, OR `~/.cache/loom/` collides with a root-owned file. | `ls -la ~/.claude/` — fix ownership: `sudo chown -R "$USER" ~/.claude ~/.cache/loom`, then re-run. |
| `set: pipefail: no such option` or similar syntax error at the top of `install.sh` | Your shell is bash 3.x (macOS default). | macOS: `brew install bash` then run `bash install.sh` explicitly. Don't pipe to `sh`. |

---

## 2. `/loom` returns "Unknown command" or subcommands are missing

| You see | Cause | Fix |
|---|---|---|
| `/loom` → `Unknown command` | `~/.claude/commands/loom.md` is missing, OR your Claude Code session was running before install finished. | `ls ~/.claude/commands/loom.md`. If missing, re-run installer. If present, **restart your Claude Code session** — Claude Code only re-scans commands on session start. |
| `/loom-<subcommand>` not found, but `/loom` works | The subcommand kit isn't installed yet (Loom pulls on demand). | `/loom-library use <kit-name>` to install it. E.g., `/loom-library use loom-plan`. Check installed: `/loom-library list`. |
| New command exists in repo but Claude Code doesn't see it | Session running from before the command was installed. | Restart Claude Code, or run `/clear` and resume. |

---

## 3. "My edit got blocked" — hook messages

Loom enforces invariants by **blocking tool calls at the Claude Code hook layer**. This is intentional. The error message tells you which hook fired and why.

| Hook message (excerpt) | What happened | What to do |
|---|---|---|
| `File <name> is not in your file ownership boundary. Owned files: [...]` | `file-ownership` hook blocked a write — active wave doesn't own that file. | Drop a request at `.plan-execution/ephemeral/requests/<name>.toon` describing what you need; the orchestrator reviews. Or wait — most likely the wave plan is wrong and needs revisiting. |
| `Contracts are locked after Wave 0. File <path> is in the contracts directory.` | `contract-lock` hook blocked an edit to `contracts/**` after Wave 0 finished. | This is the big one — contracts are immutable for the rest of the run by design. If the contract is genuinely wrong, you have to **end the run, revise the plan/scope, and restart**. The escape hatch is `.plan-execution/ephemeral/requests/` if a downstream agent thinks the contract is wrong. |
| `Estimated prompt size <est> tokens exceeds budget cap <cap> tokens. Consider splitting the task.` | `context-budget` hook blocked an agent spawn — its prompt would exceed the cap (default 100k). | Split the task into smaller spawns, OR raise `agentBudgetCap` in `.claude/orchestration.toml` under `[settings.contextBudget]`. |
| `Agent budget exhausted: <N>/<max>. Pipeline should escalate.` | `budget-tracker` — total agents spawned hit the pipeline limit. | Decide: increase `agentBudget` in `converge.config` or accept current state and stop. |
| `Wiki files are managed by wiki agents during execution. File <name> is in .loom/wiki/.` | `wiki-write-guard` — only wiki agents may edit `.loom/wiki/` during execution. | Use `/loom-wiki ingest --diff` or `/loom-note --tag wiki "<observation>"`. Don't edit wiki pages directly during a run. |
| `Force push to <branch> is blocked.` | `deploy-guard` — protected against destructive pushes to `main`/`master`. | Use a feature branch + PR. If you genuinely need a force-push (history rewrite), do it from outside Claude Code. |
| `Direct push to <branch> is blocked. Create a feature branch and open a PR instead:` | `deploy-guard` — direct push to `main`/`master`. | Follow the printed recipe: `git checkout -b <branch> && git push -u origin <branch> && gh pr create`. |
| `Production deploy to {Convex|Vercel|Cloudflare|Fly.io} is blocked.` | `deploy-guard` — production deploy from a Claude Code session. | Use the `dev`/`local` variant (`convex dev`, `vercel dev`, `wrangler dev`). Production deploys go through CI/CD after PR review. |

**The general escape hatch** for file-ownership and contract-lock: write a request file at `.plan-execution/ephemeral/requests/<descriptive-name>.toon` explaining what you need and why. The orchestrator picks these up between waves.

---

## 4. Context running out

Loom watches your Claude Code context and warns you before it dies.

| You see | What it means | What to do |
|---|---|---|
| `[context warning] ~XX% context remaining` | 25–35% remaining; soft warning. | Plan a checkpoint soon. Finish what you're doing, then checkpoint. |
| `--- Context Checkpoint Suggestion ---` (mid-warning, 35–80% used) | Approaching critical territory. | When at a logical pause: `/loom pause --compact`, then `/clear`, then `/loom resume`. |
| `--- CONTEXT CHECKPOINT (CRITICAL) ---` (80%+ used) | Very low headroom. Hard recommendation. | Stop immediately. Run `/loom pause --compact`, then `/clear`, then `/loom resume` with the suggested resume command. |
| `[CONTEXT CRITICAL] ~XX% remaining` | Hooks are signaling you're about to lose context entirely. | Don't start anything new. Run the pause/clear/resume sequence above NOW. |

**Why this matters:** Loom writes stage summaries and rolling context to disk specifically so a `/clear` doesn't lose work. Resume re-hydrates from `.plan-execution/`. Trust the loop.

---

## 5. Convergence loop halted (5 terminal states)

`/loom-converge` exits in one of five named states. The state name tells you what to do.

| State you see | What happened | Recovery |
|---|---|---|
| `converged` — `[autoconverge] iteration N/max — converged (0 blocking findings)` | Work is done. Every blocking target passes. | Nothing to do. Optionally inspect `.plan-execution/convergence-summary.toon`. |
| `halted-stall` / `STALL` — *blockingCount unchanged across 2 consecutive iterations* | The integrator stopped making progress. | Read iteration N and N-1 logs in `.plan-execution/convergence/iterations/`. Likely the integrator prompt is too vague OR the task should be split. Fix and `/loom-converge --resume`. |
| `halted-regression` / `REGRESSION` — *blockingCount increased vs prior iteration* | The last integrator change made things worse. | If snapshots are enabled, restore the prior snapshot (path in the summary); fix the integrator logic; `/loom-converge --resume`. |
| `halted-budget` / `BUDGET_EXHAUSTED` — *Cumulative agent spawns exceeded N* | Hit the agent-spawn budget. | Raise `agentBudget` in `converge.config`, then `/loom-converge --resume`. |
| `halted-max-iter` / `MAX_ITERATIONS` — *Iteration count reached max without convergence* | Used up the iteration cap. | Either accept current state, OR re-run with `--max-iterations N` (NOT `--resume` — fresh run). |
| `halted-scope-expansion` (document mode) | Integrator added a new top-level Phase/Feature/Milestone (out of scope). | Approve the scope (re-run accepting it) OR restore prior snapshot. |

---

## 6. `/loom-plan execute` stuck or halted mid-wave

| Situation | Recovery |
|---|---|
| Halted mid-wave (Ctrl+C, error, machine reboot) | `/loom-plan execute --resume`. Driver picks up at the next task in the current wave. If a task was partially done, it re-runs. |
| Wave N broke Wave N-1's work (regression) | **Option A** (safest): `git reset --hard <pre-wave-tag>`, then `/loom-plan execute --resume` to re-run wave. **Option B:** fix manually then `--resume`. **Option C** (nuke): `rm -r .plan-execution/ && /loom-plan create` to restart the plan entirely. |
| `contract-lock` blocks a needed edit to `contracts/**` | Write a request to `.plan-execution/ephemeral/requests/`. Orchestrator reviews between waves. If the contract is fundamentally wrong, you have to end the run. |
| Stuck at `plan-review` or `plan-validate` stage (no progress) | `/loom-plan execute --resume`. If looping, read `rolling-context.md` for reviewer blockers, address them, then resume. |

---

## 7. Session corruption / "I'm stuck, blow it away"

| Situation | Recovery |
|---|---|
| Machine reboot mid-execution; state files still present | `/loom resume` — auto-detects highest-priority state file and restores. Priority order: `continue-here.toon` > `pipeline-state.toon` > `state.toon` > `convergence-state.toon`. |
| `.plan-execution/state.toon` corrupted (TOON parse error on resume) | Inspect the file manually. If unrecoverable: `rm .plan-execution/state.toon` and start fresh with `/loom-plan execute`. |
| State out of sync with git (commits orphaned by a merge) | **Known issue** — see `planning/notes/2026-06-13-orphaned-wave-1-postmortem.md`. Workaround: `git merge-base --is-ancestor <wave-commit-sha> HEAD` to check; cherry-pick missing commits if needed. Fix is in flight. |
| `pipeline-state.toon` hasn't been touched in 7+ days | `quality-gate` hook logs `pipeline-state.toon hasn't been touched in >7d — treating as abandoned`. Safe to archive: `mv .plan-execution/pipeline-state.toon planning/history/abandoned/`. |
| **Nuke recipe** — full reset | `rm -r .plan-execution/ && /loom-plan create`. Wiki and planning history are preserved. |

---

## 8. Known issues (read these if your symptom is weird)

- **Resume preflight gap (2026-06-13)** — `fileHashes` field defined in schema but never populated, plus no git-lineage tracking. If a mid-run PR merges and orphans a wave commit, resume detects file-hash drift inconsistently. Workaround in §7 above. Fix in flight per `planning/notes/2026-06-13-orphaned-wave-1-postmortem.md`.

- **No version-compat check between `~/.claude/commands/loom.md` and other Loom files yet.** If you have a stale `loom.md`, subcommands may not dispatch correctly. Workaround: `/loom-library use loom` to re-pull, or re-run `install.sh`.

---

## When to actually ping me

- Install failed AFTER you tried twice.
- An error message you can't find on this page.
- The docs told you to do X, X didn't work.
- A real product question (what would happen if…, can it do…, should I…).

Everything else, the answer is on this page or in [`first-30-minutes.md`](./first-30-minutes.md) / [`concepts.md`](./concepts.md) / [`cheatsheet.md`](./cheatsheet.md). If it's not, that's a doc bug — tell me what you searched for and couldn't find, and I'll patch it.
