/**
 * Hook: deploy-guard (PreToolUse — Bash)
 * Blocks dangerous deployment and push commands. Forces PR/review workflow.
 *
 * Protected actions:
 *   - git push to main/master (direct or force)
 *   - convex deploy (production deployment)
 *   - wrangler deploy/publish (Cloudflare Workers production)
 *
 * Allowed:
 *   - git push to feature branches
 *   - convex dev, convex codegen, convex import/export (local/safe)
 *   - wrangler dev, wrangler tail, wrangler secret (local/safe)
 *
 * Extensible: add new services to DEPLOY_RULES.
 * Fail-open: any parsing error allows the operation.
 */

import { runHook, allow, block } from "./lib/run-hook.js";
import { execFileSync } from "node:child_process";

// --- Git push protection ---

const PROTECTED_BRANCHES = ["main", "master"];

function extractPushTarget(command: string): string | undefined {
  if (!/\bgit\s+push\b/.test(command)) return undefined;

  const parts = command.trim().split(/\s+/);
  const pushIdx = parts.indexOf("push", parts.findIndex((p) => p === "git"));
  if (pushIdx < 0) return undefined;

  const positional: string[] = [];
  for (let i = pushIdx + 1; i < parts.length; i++) {
    const p = parts[i];
    if (p.startsWith("-")) {
      if (p === "--repo" || p === "--receive-pack" || p === "--push-option" || p === "-o") i++;
      continue;
    }
    positional.push(p);
  }

  for (const arg of positional) {
    const target = arg.includes(":") ? arg.split(":").pop()! : arg;
    const branch = target.replace(/^refs\/heads\//, "");
    if (PROTECTED_BRANCHES.includes(branch)) return branch;
  }

  return undefined;
}

function isForcePush(command: string): boolean {
  return /\s(--force|-f|--force-with-lease)\b/.test(command);
}

function checkGitPush(command: string): HookResult | undefined {
  if (!/\bgit\s+push\b/.test(command)) return undefined;

  const target = extractPushTarget(command);

  if (target && PROTECTED_BRANCHES.includes(target) && isForcePush(command)) {
    return block(
      `Force push to ${target} is blocked. This is destructive and can overwrite others' work.`
    );
  }

  if (target && PROTECTED_BRANCHES.includes(target)) {
    return block(
      `Direct push to ${target} is blocked. Create a feature branch and open a PR instead:\n` +
        `  git checkout -b <branch-name>\n` +
        `  git push -u origin <branch-name>\n` +
        `  gh pr create`
    );
  }

  if (isForcePush(command)) {
    process.stderr.write(`[deploy-guard] Force push detected. Proceeding since target is not a protected branch.\n`);
  }

  return undefined;
}

// --- Production deploy protection ---

interface DeployRule {
  /** Human-readable service name */
  service: string;
  /** Regex matching the dangerous command. Tested against the full command string. */
  pattern: RegExp;
  /** Block message explaining why and what to do instead. */
  reason: string;
}

/**
 * Add new services here. Each rule is a regex + block message.
 * Order doesn't matter — first match wins.
 */
const DEPLOY_RULES: DeployRule[] = [
  // Convex
  {
    service: "Convex",
    pattern: /\bconvex\s+deploy\b/,
    reason:
      "Production deploy to Convex is blocked. Use `convex dev` for local development.\n" +
      "Production deploys should go through CI/CD after PR review.",
  },
  // Cloudflare Workers
  {
    service: "Cloudflare",
    pattern: /\bwrangler\s+(deploy|publish)\b/,
    reason:
      "Production deploy to Cloudflare Workers is blocked. Use `wrangler dev` for local development.\n" +
      "Production deploys should go through CI/CD after PR review.",
  },
  // Vercel (if used in future)
  {
    service: "Vercel",
    pattern: /\bvercel\s+(--prod|deploy\s+--prod)\b/,
    reason:
      "Production deploy to Vercel is blocked. Use `vercel dev` for local development.\n" +
      "Production deploys should go through CI/CD after PR review.",
  },
  // Fly.io (if used in future)
  {
    service: "Fly.io",
    pattern: /\bfly\s+deploy\b/,
    reason:
      "Production deploy to Fly.io is blocked.\n" +
      "Production deploys should go through CI/CD after PR review.",
  },
];

function checkProductionDeploy(command: string): HookResult | undefined {
  for (const rule of DEPLOY_RULES) {
    if (rule.pattern.test(command)) {
      return block(rule.reason);
    }
  }
  return undefined;
}

// --- Stacked-PR auto-close protection ---
//
// `gh pr merge --delete-branch` and `git push origin --delete <branch>` delete
// the branch on the remote. If any OTHER open PR has that branch as its base,
// GitHub auto-closes the dependent PR — and the close is irreversible via API
// (you can't reopen a PR whose base branch was deleted). This bit us in the
// PR #15 → PR #16 sequence; the fix is to surface the dependency before delete.

/**
 * Extract the branch name targeted by a delete-branch command.
 * Returns undefined if the command isn't a branch-delete.
 */
function extractBranchDelete(command: string): string | undefined {
  // `git push origin --delete <branch>` or `git push origin -d <branch>`
  // Order can vary: `git push --delete origin <branch>`.
  const pushDelete = command.match(
    /\bgit\s+push\s+(?:origin\s+)?(?:--delete|-d)\s+(?:origin\s+)?([^\s]+)/,
  );
  if (pushDelete) return pushDelete[1];

  // `gh pr merge <num> --delete-branch` — the branch deleted is the PR's HEAD,
  // which we need to look up. The command itself doesn't name the branch.
  if (/\bgh\s+pr\s+merge\b.*--delete-branch\b/.test(command)) {
    const prNum = command.match(/\bgh\s+pr\s+merge\s+(\d+)/)?.[1];
    // execFileSync passes args as an argv array (no shell), so even if prNum
    // somehow contained shell metacharacters they cannot affect command parsing.
    // The /(\d+)/ regex already guarantees digits-only, but defense in depth.
    const ghArgs = prNum
      ? ["pr", "view", prNum, "--json", "headRefName", "--jq", ".headRefName"]
      : ["pr", "view", "--json", "headRefName", "--jq", ".headRefName"];
    try {
      const head = execFileSync("gh", ghArgs, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5_000,
      }).trim();
      return head || undefined;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

interface DependentPr {
  number: number;
  title: string;
}

/**
 * Query GitHub for open PRs whose base is the branch about to be deleted.
 * Returns [] if gh is unavailable, the network fails, or there are none.
 */
function findDependentPrs(branch: string): DependentPr[] {
  try {
    // execFileSync — branch name goes through argv as a literal, NEVER through
    // the shell. Defense against command injection if a branch name contains
    // shell metacharacters (`; rm -rf $HOME`, etc.).
    const json = execFileSync(
      "gh",
      ["pr", "list", "--base", branch, "--state", "open", "--json", "number,title"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 },
    );
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p): p is DependentPr =>
        typeof p === "object" &&
        p !== null &&
        typeof (p as DependentPr).number === "number" &&
        typeof (p as DependentPr).title === "string",
      );
  } catch {
    return [];
  }
}

function checkStackedPrDelete(command: string): HookResult | undefined {
  const branch = extractBranchDelete(command);
  if (!branch) return undefined;

  // Don't query for main/master — those are protected by checkGitPush already
  // and shouldn't reach this branch.
  if (PROTECTED_BRANCHES.includes(branch)) return undefined;

  const dependents = findDependentPrs(branch);
  if (dependents.length === 0) return undefined;

  const list = dependents.map((p) => `  - #${p.number} ${p.title}`).join("\n");
  return block(
    `Deleting branch "${branch}" would auto-close ${dependents.length} stacked PR(s):\n` +
      `${list}\n\n` +
      `GitHub's auto-close on base-branch-delete is IRREVERSIBLE via API — you cannot\n` +
      `reopen the dependent PRs afterward.\n\n` +
      `Fix: retarget the dependent PR(s) to a stable base first:\n` +
      dependents.map((p) => `  gh pr edit ${p.number} --base main`).join("\n") +
      `\nThen re-run the delete command.\n\n` +
      `Override (rare): if you intend the auto-close, run the operation in a shell\n` +
      `outside Claude Code.`,
  );
}

// --- Hook types (imported type isn't directly available) ---

type HookResult = { decision: "allow" | "block"; reason?: string; message?: string };

// --- Entry point ---

runHook("deploy-guard", async (input) => {
  if (input.tool_name !== "Bash") return allow();

  const command: string = input.tool_input?.command ?? "";
  if (!command) return allow();

  // Check git push first
  const pushResult = checkGitPush(command);
  if (pushResult) return pushResult;

  // Check stacked-PR delete BEFORE production-deploy because the delete patterns
  // can coexist with other terms; the dedicated check is more specific.
  const stackedResult = checkStackedPrDelete(command);
  if (stackedResult) return stackedResult;

  // Check production deploys
  const deployResult = checkProductionDeploy(command);
  if (deployResult) return deployResult;

  return allow();
});
