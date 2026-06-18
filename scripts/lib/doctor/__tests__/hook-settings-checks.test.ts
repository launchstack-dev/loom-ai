import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import HookFilesPresentCheck from "../checks/hook-files-present";
import RunnerResolutionCheck from "../checks/runner-resolution";
import AnchorFormCheck from "../checks/anchor-form";
import OrphanEntriesCheck from "../checks/orphan-entries";
import BareAnchorCheck from "../checks/bare-anchor";
import PermissionsDerivedCheck, {
  derivePermissions,
} from "../checks/permissions-derived";

// -----------------------------------------------------------------------------
// Fixture helpers
// -----------------------------------------------------------------------------

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loom-doctor-checks-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function write(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function pluginHooksJson() {
  return JSON.stringify({
    hooks: {
      SessionStart: [
        {
          hooks: [
            {
              type: "command",
              command:
                'sh "${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.sh" "${CLAUDE_PLUGIN_ROOT}/hooks/wiki-session-status.ts"',
            },
          ],
        },
      ],
      PreToolUse: [
        {
          matcher: "Write|Edit",
          hooks: [
            {
              type: "command",
              command:
                'sh "${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.sh" "${CLAUDE_PLUGIN_ROOT}/hooks/deploy-guard.ts"',
            },
          ],
        },
      ],
    },
  });
}

// -----------------------------------------------------------------------------
// hook-files-present
// -----------------------------------------------------------------------------

describe("HookFilesPresentCheck", () => {
  it("passes when all referenced hook files exist", async () => {
    const root = tmp;
    write(path.join(root, "hooks", "hooks.json"), pluginHooksJson());
    write(path.join(root, "hooks", "wiki-session-status.ts"), "// stub");
    write(path.join(root, "hooks", "deploy-guard.ts"), "// stub");

    const check = new HookFilesPresentCheck({ installRoot: root });
    const res = (await check.run(undefined)) as { status: string; id: string; category: string };
    expect(res.id).toBe("hook-files-present");
    expect(res.category).toBe("hook-wiring");
    expect(res.status).toBe("pass");
  });

  it("fails when a referenced hook file is missing", async () => {
    const root = tmp;
    write(path.join(root, "hooks", "hooks.json"), pluginHooksJson());
    // Intentionally omit deploy-guard.ts.
    write(path.join(root, "hooks", "wiki-session-status.ts"), "// stub");

    const check = new HookFilesPresentCheck({ installRoot: root });
    const res = (await check.run(undefined)) as { status: string; message: string };
    expect(res.status).toBe("fail");
    expect(res.message).toMatch(/deploy-guard\.ts/);
  });
});

// -----------------------------------------------------------------------------
// runner-resolution
// -----------------------------------------------------------------------------

describe("RunnerResolutionCheck", () => {
  it("passes when bun resolves", async () => {
    const check = new RunnerResolutionCheck({ probe: (rt) => rt === "bun" });
    const res = (await check.run(undefined)) as { status: string; message: string };
    expect(res.status).toBe("pass");
    expect(res.message).toMatch(/bun/);
  });

  it("warns when neither bun nor node resolves", async () => {
    const check = new RunnerResolutionCheck({ probe: () => false });
    const res = (await check.run(undefined)) as { status: string };
    expect(res.status).toBe("warn");
  });
});

// -----------------------------------------------------------------------------
// anchor-form
// -----------------------------------------------------------------------------

describe("AnchorFormCheck", () => {
  it("passes when plugin-anchor entries match plugin installSource", async () => {
    const sp = path.join(tmp, "settings.json");
    write(
      sp,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Write",
              hooks: [
                {
                  type: "command",
                  command:
                    'sh "${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.sh" "${CLAUDE_PLUGIN_ROOT}/hooks/deploy-guard.ts"',
                },
              ],
            },
          ],
        },
      })
    );
    const check = new AnchorFormCheck({
      installSource: "plugin",
      settingsPaths: [sp],
    });
    const res = (await check.run(undefined)) as { status: string };
    expect(res.status).toBe("pass");
  });

  it("fails when curl-anchor entries appear under plugin installSource", async () => {
    const sp = path.join(tmp, "settings.json");
    write(
      sp,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Write",
              hooks: [
                {
                  type: "command",
                  command:
                    'sh "${CLAUDE_PROJECT_DIR}/hooks/run-hook.sh" "${CLAUDE_PROJECT_DIR}/hooks/deploy-guard.ts"',
                },
              ],
            },
          ],
        },
      })
    );
    const check = new AnchorFormCheck({
      installSource: "plugin",
      settingsPaths: [sp],
    });
    const res = (await check.run(undefined)) as { status: string; message: string };
    expect(res.status).toBe("fail");
    expect(res.message).toMatch(/wrong anchor/);
  });

  it("accepts absolute paths for curl installSource", async () => {
    const sp = path.join(tmp, "settings.json");
    write(
      sp,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Write",
              hooks: [
                {
                  type: "command",
                  command:
                    'sh /Users/dev/loom/hooks/run-hook.sh /Users/dev/loom/hooks/deploy-guard.ts',
                },
              ],
            },
          ],
        },
      })
    );
    const check = new AnchorFormCheck({
      installSource: "curl",
      settingsPaths: [sp],
    });
    const res = (await check.run(undefined)) as { status: string };
    expect(res.status).toBe("pass");
  });
});

// -----------------------------------------------------------------------------
// orphan-entries
// -----------------------------------------------------------------------------

describe("OrphanEntriesCheck", () => {
  it("passes when all referenced hook scripts exist", async () => {
    const root = tmp;
    write(path.join(root, "hooks", "deploy-guard.ts"), "// stub");
    const sp = path.join(root, "settings.json");
    write(
      sp,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Write",
              hooks: [
                {
                  type: "command",
                  command:
                    'sh "${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.sh" "${CLAUDE_PLUGIN_ROOT}/hooks/deploy-guard.ts"',
                },
              ],
            },
          ],
        },
      })
    );
    const check = new OrphanEntriesCheck({ installRoot: root, settingsPaths: [sp] });
    const res = (await check.run(undefined)) as { status: string };
    expect(res.status).toBe("pass");
  });

  it("warns when a referenced hook script is missing", async () => {
    const root = tmp;
    // deploy-guard.ts intentionally absent.
    const sp = path.join(root, "settings.json");
    write(
      sp,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Write",
              hooks: [
                {
                  type: "command",
                  command:
                    'sh "${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.sh" "${CLAUDE_PLUGIN_ROOT}/hooks/deploy-guard.ts"',
                },
              ],
            },
          ],
        },
      })
    );
    const check = new OrphanEntriesCheck({ installRoot: root, settingsPaths: [sp] });
    const res = (await check.run(undefined)) as { status: string; fixCommand?: string | null };
    expect(res.status).toBe("warn");
    expect(res.fixCommand).toBe("/loom-doctor --fix");
  });
});

// -----------------------------------------------------------------------------
// bare-anchor
// -----------------------------------------------------------------------------

describe("BareAnchorCheck", () => {
  it("passes when no bare-anchor entries exist", async () => {
    const sp = path.join(tmp, "settings.json");
    write(
      sp,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Write",
              hooks: [
                {
                  type: "command",
                  command:
                    'sh "${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.sh" "${CLAUDE_PLUGIN_ROOT}/hooks/deploy-guard.ts"',
                },
              ],
            },
          ],
        },
      })
    );
    const check = new BareAnchorCheck({ settingsPaths: [sp] });
    const res = (await check.run(undefined)) as { status: string };
    expect(res.status).toBe("pass");
  });

  it("warns on legacy bare scripts/run-hook.sh entries", async () => {
    const sp = path.join(tmp, "settings.json");
    write(
      sp,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Write",
              hooks: [
                {
                  type: "command",
                  command: "sh scripts/run-hook.sh hooks/deploy-guard.ts",
                },
              ],
            },
          ],
        },
      })
    );
    const check = new BareAnchorCheck({ settingsPaths: [sp] });
    const res = (await check.run(undefined)) as { status: string; fixCommand?: string | null };
    expect(res.status).toBe("warn");
    expect(res.fixCommand).toBe("/loom-doctor --fix");
  });
});

// -----------------------------------------------------------------------------
// permissions-derived
// -----------------------------------------------------------------------------

describe("PermissionsDerivedCheck", () => {
  it("derivePermissions produces hooks:<event> + tools:<name> union", () => {
    const derived = derivePermissions({
      hooks: {
        SessionStart: [{ hooks: [{ command: "x" }] }],
        PreToolUse: [{ matcher: "Write|Edit", hooks: [{ command: "x" }] }],
      },
    });
    expect(derived).toEqual([
      "hooks:PreToolUse",
      "hooks:SessionStart",
      "tools:Edit",
      "tools:Write",
    ]);
  });

  it("passes when plugin.json matches derived permissions", async () => {
    const hooksPath = path.join(tmp, "hooks", "hooks.json");
    const pluginPath = path.join(tmp, ".claude-plugin", "plugin.json");
    write(
      hooksPath,
      JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: [{ command: "x" }] }],
          PreToolUse: [{ matcher: "Write|Edit", hooks: [{ command: "x" }] }],
        },
      })
    );
    write(
      pluginPath,
      JSON.stringify({
        permissions: ["hooks:SessionStart", "hooks:PreToolUse", "tools:Write", "tools:Edit"],
      })
    );
    const check = new PermissionsDerivedCheck({
      pluginJsonPath: pluginPath,
      hooksJsonPath: hooksPath,
    });
    const res = (await check.run(undefined)) as { status: string; category: string };
    expect(res.status).toBe("pass");
    expect(res.category).toBe("settings");
  });

  it("fails when plugin.json#permissions[] diverges from hooks.json", async () => {
    const hooksPath = path.join(tmp, "hooks", "hooks.json");
    const pluginPath = path.join(tmp, ".claude-plugin", "plugin.json");
    write(
      hooksPath,
      JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: [{ command: "x" }] }],
          PreToolUse: [{ matcher: "Write|Edit", hooks: [{ command: "x" }] }],
        },
      })
    );
    // Missing tools:Edit, with stray extra entry.
    write(
      pluginPath,
      JSON.stringify({
        permissions: ["hooks:SessionStart", "hooks:PreToolUse", "tools:Write", "hooks:Stop"],
      })
    );
    const check = new PermissionsDerivedCheck({
      pluginJsonPath: pluginPath,
      hooksJsonPath: hooksPath,
    });
    const res = (await check.run(undefined)) as { status: string; message: string };
    expect(res.status).toBe("fail");
    expect(res.message).toMatch(/missing:/);
    expect(res.message).toMatch(/tools:Edit/);
    expect(res.message).toMatch(/extra:/);
  });
});
