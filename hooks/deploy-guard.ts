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

  // Check production deploys
  const deployResult = checkProductionDeploy(command);
  if (deployResult) return deployResult;

  return allow();
});
