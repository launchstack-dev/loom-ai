/**
 * Hook: loom-careful (PreToolUse — Bash)
 *
 * Blocks destructive Bash commands unless the user has explicitly overridden
 * via env LOOM_CAREFUL_OVERRIDE=1. Emits Claude Code hook JSON
 * `{decision: "deny", reason: "..."}` on block; fail-open on any parse error
 * or on non-Bash tool calls.
 *
 * Blocklist patterns:
 *   - rm -rf /  |  rm -rf ~  |  rm -rf .  |  rm -rf *
 *   - DROP TABLE  |  DROP DATABASE  |  TRUNCATE TABLE
 *   - git push --force  |  git push -f  |  git reset --hard
 *   - chmod -R 777
 *   - dd if=... of=/dev/...
 *   - mkfs  |  > /dev/sda*
 *
 * Registration: declared in skills/library.yaml under library.infrastructure.
 * Contract: PLAN-gstack-adoption.md Phase 2 F-06 CAREFUL_BLOCKED error code.
 */

import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

interface HookInput {
  tool_name?: string;
  tool_input?: {
    command?: string;
  };
}

const CAREFUL_BLOCKED = "CAREFUL_BLOCKED";

interface Rule {
  id: string;
  test: (cmd: string) => boolean;
  message: string;
}

const RULES: Rule[] = [
  {
    id: "rm-rf-root",
    // Matches `rm -rf /`, `rm -rf ~`, `rm -rf .`, `rm -rf *` (with variations)
    test: (c) =>
      /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*|-rf|-fr)\s+(\/|~|\.|\*)(\s|$|\/)/.test(
        c
      ),
    message: "rm -rf against /, ~, ., or * is blocked by /loom-careful.",
  },
  {
    id: "sql-destructive",
    test: (c) => /\b(DROP\s+(TABLE|DATABASE)|TRUNCATE\s+TABLE)\b/i.test(c),
    message: "DROP TABLE / DROP DATABASE / TRUNCATE TABLE blocked by /loom-careful.",
  },
  {
    id: "git-force-push",
    test: (c) => /\bgit\s+push\s+(--force\b|-f\b|--force-with-lease\s*=?)/.test(c),
    message: "git push --force (and -f) blocked by /loom-careful.",
  },
  {
    id: "git-reset-hard",
    test: (c) => /\bgit\s+reset\s+--hard\b/.test(c),
    message: "git reset --hard blocked by /loom-careful.",
  },
  {
    id: "chmod-777-recursive",
    test: (c) => /\bchmod\s+-R\s+777\b/.test(c),
    message: "chmod -R 777 blocked by /loom-careful.",
  },
  {
    id: "dd-dev",
    test: (c) => /\bdd\s+.*\bif=.*\bof=\/dev\//.test(c) || /\bdd\s+.*\bof=\/dev\//.test(c),
    message: "dd targeting /dev/* blocked by /loom-careful.",
  },
  {
    id: "mkfs",
    test: (c) => /\bmkfs(\.[a-z0-9]+)?\b/.test(c),
    message: "mkfs blocked by /loom-careful.",
  },
  {
    id: "redirect-dev-sda",
    test: (c) => />\s*\/dev\/sd[a-z]/.test(c),
    message: "Redirecting output to /dev/sd* blocked by /loom-careful.",
  },
];

function evaluate(command: string): { blocked: boolean; ruleId?: string; message?: string } {
  for (const rule of RULES) {
    if (rule.test(command)) {
      return { blocked: true, ruleId: rule.id, message: rule.message };
    }
  }
  return { blocked: false };
}

function readStdinSync(): string {
  try {
    // Node 20 supports readFileSync on stdin fd 0.
    return fs.readFileSync(0, "utf-8");
  } catch {
    return "";
  }
}

function main(): void {
  // Fail-open by default: any thrown error falls through to exit 0.
  try {
    const raw = readStdinSync();
    if (!raw.trim()) {
      process.exit(0);
    }

    let input: HookInput;
    try {
      input = JSON.parse(raw);
    } catch {
      // Malformed JSON: fail open.
      process.exit(0);
    }

    if (input.tool_name !== "Bash") {
      process.exit(0);
    }
    const command = input.tool_input?.command;
    if (!command || typeof command !== "string") {
      // Non-blocking on missing tool_input per spec.
      process.exit(0);
    }

    if (process.env.LOOM_CAREFUL_OVERRIDE === "1") {
      process.exit(0);
    }

    const verdict = evaluate(command);
    if (verdict.blocked) {
      const reason = `[${CAREFUL_BLOCKED}] ${verdict.message} Set LOOM_CAREFUL_OVERRIDE=1 to bypass.`;
      process.stdout.write(JSON.stringify({ decision: "deny", reason }));
      process.exit(2);
    }
    process.exit(0);
  } catch {
    process.exit(0);
  }
}

// Exported for unit tests.
export { evaluate, RULES, CAREFUL_BLOCKED };

// Entrypoint: only run when invoked as a script (ESM-safe equivalent of
// `require.main === module` — compares the CLI entry path against this
// module's own URL).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
