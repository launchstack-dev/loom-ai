```toon
pageId: component-deploy-guard
title: Deploy Guard Hook
category: component
domain: code
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-04-25T22:00:00Z
createdBy: human
updatedBy: human
sourceRefs[1]: hooks/deploy-guard.ts
crossRefs[2]{pageId,relationship}:
  component-hooks-system,depends-on
  convention-settings-json,relates-to
tags[4]: hooks, deploy, git, safety
staleness: fresh
confidence: high
```

# Deploy Guard Hook

`hooks/deploy-guard.ts` is a PreToolUse hook that intercepts Bash tool calls and blocks dangerous deployment operations — direct pushes to protected branches and production deploys to cloud services. It enforces a PR/review workflow for all production changes.

## Trigger

- **Event**: `PreToolUse`
- **Matcher**: `Bash`
- **Entry check**: Exits immediately with `allow()` if `tool_name !== "Bash"` or if the command string is empty

## Protected Branches

```typescript
const PROTECTED_BRANCHES = ["main", "master"];
```

Any `git push` targeting these branches is blocked. Force pushes (`--force`, `-f`, `--force-with-lease`) to protected branches produce a more strongly worded block message.

### Branch Detection Logic

The hook parses the git push command to extract the push target:
1. Strips flags (those starting with `-`)
2. Collects positional arguments after `push`
3. If two or more positionals exist, the second is the refspec; the branch name is the part after `:` (if present) or the whole refspec
4. Strips `refs/heads/` prefix if present

If no explicit target is detected (e.g., `git push origin`), the push is allowed — the hook only blocks when it can confidently identify a protected target.

Force pushes to non-protected branches produce an `allow()` with an informational message.

## Production Deploy Rules

The hook maintains an extensible `DEPLOY_RULES` array. Each rule has:
- `service`: human-readable name (for logging/debugging)
- `pattern`: regex tested against the full command string
- `reason`: block message shown to the agent

### Current Rules

| Service | Blocked Pattern | Allowed Alternatives |
|---------|----------------|---------------------|
| Convex | `convex deploy` | `convex dev`, `convex codegen`, `convex import`, `convex export` |
| Cloudflare Workers | `wrangler deploy`, `wrangler publish` | `wrangler dev`, `wrangler tail`, `wrangler secret` |
| Vercel | `vercel --prod`, `vercel deploy --prod` | `vercel dev` |
| Fly.io | `fly deploy` | — |

All rules match `npx <tool> <subcommand>` as well as bare `<tool> <subcommand>`.

## Extending DEPLOY_RULES

Add a new entry to the `DEPLOY_RULES` array in `hooks/deploy-guard.ts`:

```typescript
{
  service: "Railway",
  pattern: /\b(npx\s+)?railway\s+up\b/,
  reason:
    "Production deploy to Railway is blocked. Use `railway run` for local development.\n" +
    "Production deploys should go through CI/CD after PR review.",
},
```

Order within the array does not matter — the loop returns on first match.

## What Is Allowed vs Blocked

| Operation | Result |
|-----------|--------|
| `git push origin feature-branch` | Allowed |
| `git push origin main` | Blocked |
| `git push --force origin feature-branch` | Allowed (with info message) |
| `git push --force origin main` | Blocked (force push to protected) |
| `convex dev` | Allowed |
| `convex deploy` | Blocked |
| `wrangler dev` | Allowed |
| `wrangler deploy` | Blocked |
| `vercel` (no `--prod`) | Allowed |
| `vercel --prod` | Blocked |
| `fly deploy` | Blocked |

## Fail-Open Guarantee

Implemented via the `runHook` harness in `hooks/lib/run-hook.ts`. Any parsing error, regex error, or unexpected exception exits 0, allowing the operation. The hook never accidentally blocks legitimate commands due to a bug.
