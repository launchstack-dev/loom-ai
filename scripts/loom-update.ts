#!/usr/bin/env tsx
/**
 * `/loom-update` CLI entry-point (Phase 13).
 *
 * Flag dispatch:
 *   --check                     → drift detection; text or `--json` output
 *   --channel <curl|plugin>     → override the channel detected from install.toon
 *   --resume                    → resume from a killed mid-update marker
 *   --pin <version>             → pin to a specific version and apply
 *   --json                      → JSON output (only meaningful with --check)
 *   --rollback                  → restore prior version from v3 inventory snapshot
 *   --help                      → print usage, exit 0
 *
 * Exit codes:
 *   0  success
 *   1  warning / no-op (e.g. no marker to resume)
 *   2  hard failure (network, manifest, IO, parse)
 *
 * On plugin update success the final stdout line MUST be:
 *   `Claude Code restart required to load new plugin version`
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";

import {
  defaultInstallStatePath,
  readInstallState,
  writeInstallStateAtomic,
  type Channel,
  type InstallState,
} from "./lib/install-state.js";
import {
  check,
  renderCheckJSON,
  renderCheckText,
  type CheckDeps,
  type ManifestRegistry,
} from "./lib/update/check.js";
import { apply, type ApplyDeps } from "./lib/update/apply.js";
import { resume, UNRECOVERABLE_MESSAGE } from "./lib/update/resume.js";
import {
  defaultV3InventoryPath,
  rollback,
  type RollbackDeps,
} from "./lib/update/rollback.js";

const USAGE = `\
/loom-update [flags]

Update Loom — channel-aware (curl or plugin).

Flags:
  --check                Detect drift between installed and latest versions
  --channel <c>          Override channel: curl | plugin
  --resume               Resume from a killed mid-update marker
  --pin <version>        Pin to <version> (writes install.toon.pinnedVersion)
  --json                 With --check: emit JSON per update-check.schema.md
  --rollback             Restore prior version from v3 inventory snapshot
  --help                 Show this help and exit 0

Examples:
  /loom-update --check
  /loom-update --check --json
  /loom-update
  /loom-update --channel curl
  /loom-update --pin 0.2.0
  /loom-update --resume
  /loom-update --rollback
`;

const RESTART_LINE =
  "Claude Code restart required to load new plugin version";

// ---------------------------------------------------------------------------
// Argv parsing
// ---------------------------------------------------------------------------

export interface ParsedArgs {
  check: boolean;
  channel?: Channel;
  resume: boolean;
  pin?: string;
  json: boolean;
  rollback: boolean;
  help: boolean;
  error?: string;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    check: false,
    resume: false,
    json: false,
    rollback: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i];
    switch (tok) {
      case "--check":
        out.check = true;
        break;
      case "--resume":
        out.resume = true;
        break;
      case "--json":
        out.json = true;
        break;
      case "--rollback":
        out.rollback = true;
        break;
      case "--help":
      case "-h":
        out.help = true;
        break;
      case "--channel": {
        const v = argv[++i];
        if (v !== "curl" && v !== "plugin") {
          out.error = `--channel requires "curl" or "plugin"`;
          return out;
        }
        out.channel = v;
        break;
      }
      case "--pin":
        out.pin = argv[++i];
        if (!out.pin) {
          out.error = "--pin requires a version";
          return out;
        }
        break;
      default:
        out.error = `Unknown flag: ${tok}`;
        return out;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dependency seam
// ---------------------------------------------------------------------------

export interface MainDeps {
  argv?: string[];
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  /** Override install-state path resolution (tests). */
  installStatePath?: string;
  /** Override v3 inventory path resolution (tests). */
  v3InventoryPath?: string;
  /** Inject the manifest registry (tests / offline). */
  fetchManifest?: () => Promise<ManifestRegistry>;
  /** Inject `exec` (tests). */
  exec?: ApplyDeps["exec"];
}

async function defaultFetchManifest(): Promise<ManifestRegistry> {
  // Production loader: hit the public marketplace registry. The URL is
  // resolved indirectly so test environments can keep this loader out of the
  // hot path entirely via `MainDeps.fetchManifest`.
  const url =
    process.env.LOOM_MANIFEST_URL ??
    "https://raw.githubusercontent.com/launchstack-dev/loom-marketplace/main/manifest.json";
  const res = await fetch(url, { headers: { "user-agent": "loom-update" } });
  if (!res.ok) {
    throw new Error(`manifest fetch failed: ${res.status} ${res.statusText}`);
  }
  const j = (await res.json()) as { versions?: string[] };
  if (!Array.isArray(j.versions)) {
    throw new Error("manifest fetch: missing versions[]");
  }
  return { versions: j.versions };
}

function defaultExec(
  cmd: string,
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => (stdout += b.toString()));
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString()));
    child.on("close", (code) =>
      resolve({ exitCode: code ?? 1, stdout, stderr }),
    );
    child.on("error", (err) =>
      resolve({ exitCode: 1, stdout, stderr: stderr + String(err) }),
    );
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function main(deps: MainDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const argv = deps.argv ?? process.argv.slice(2);
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());

  const args = parseArgs(argv);
  if (args.error) {
    stderr.write(`${args.error}\n\n${USAGE}`);
    return 2;
  }
  if (args.help) {
    stdout.write(USAGE);
    return 0;
  }

  const statePath = deps.installStatePath ?? defaultInstallStatePath(env);
  const readState = () => readInstallState(statePath);
  const writeState = (s: InstallState) =>
    writeInstallStateAtomic(statePath, s);
  const fetchManifest = deps.fetchManifest ?? defaultFetchManifest;
  const execFn = deps.exec ?? defaultExec;

  // --rollback
  if (args.rollback) {
    const v3Path = deps.v3InventoryPath ?? defaultV3InventoryPath(env);
    const rdeps: RollbackDeps = {
      readInventory: () => (fs.existsSync(v3Path) ? fs.readFileSync(v3Path, "utf8") : null),
      log: (l) => stderr.write(`${l}\n`),
    };
    const outcome = rollback(rdeps);
    switch (outcome.kind) {
      case "ok":
        stdout.write(
          `Rolled back to v${outcome.restoredVersion} (${outcome.restoredCount} files restored)\n`,
        );
        return 0;
      case "noop":
        stderr.write(`Rollback skipped: ${outcome.reason}\n`);
        return 1;
      case "error":
        stderr.write(`${outcome.code}: ${outcome.message}\n`);
        return 2;
    }
  }

  // --check
  if (args.check) {
    const cdeps: CheckDeps = {
      readState,
      fetchManifest,
      now,
    };
    let result;
    try {
      result = await check(cdeps);
    } catch (e) {
      const msg = (e as Error).message;
      stderr.write(`${msg}\n`);
      return msg.startsWith("install-state-missing") ? 2 : 1;
    }
    if (args.json) {
      stdout.write(renderCheckJSON(result));
    } else {
      stdout.write(`${renderCheckText(result)}\n`);
    }
    return 0;
  }

  // --resume
  if (args.resume) {
    const adeps: ApplyDeps & { fetchManifest: () => Promise<ManifestRegistry> } = {
      readState,
      writeState,
      resolveLatestVersion: async () =>
        (await fetchManifest()).versions.slice(-1)[0] ?? "0.0.0",
      exec: execFn,
      now,
      log: (l) => stdout.write(`${l}\n`),
      fetchManifest,
    };
    const outcome = await resume(adeps);
    switch (outcome.kind) {
      case "noop":
        stderr.write(`Nothing to resume: ${outcome.reason}\n`);
        return 1;
      case "failed":
        stderr.write(`${outcome.message}\n`);
        if (outcome.message !== UNRECOVERABLE_MESSAGE) {
          stderr.write(`${UNRECOVERABLE_MESSAGE}\n`);
        }
        return 2;
      case "completed":
        if (outcome.result.restartRequired) {
          stdout.write(`${RESTART_LINE}\n`);
        }
        return 0;
    }
  }

  // Default path: apply.
  const state = readState();
  if (!state) {
    stderr.write(`install-state-missing: ~/.loom/install.toon not found\n`);
    return 2;
  }

  const adeps: ApplyDeps = {
    readState,
    writeState,
    resolveLatestVersion: async () =>
      (await fetchManifest()).versions.slice(-1)[0] ?? state.installedVersion,
    exec: execFn,
    now,
    log: (l) => stdout.write(`${l}\n`),
  };
  const result = await apply(adeps, {
    channelOverride: args.channel,
    pin: args.pin,
  });
  if (result.exitCode !== 0) {
    stderr.write(
      `Update failed (exit ${result.exitCode}) on ${result.channel} channel\n`,
    );
    return result.exitCode;
  }
  if (result.restartRequired) {
    stdout.write(`${RESTART_LINE}\n`);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Entry-point guard
// ---------------------------------------------------------------------------

const isEntry =
  // @ts-expect-error Bun-specific import.meta.main
  import.meta.main === true ||
  import.meta.url === `file://${process.argv[1]}` ||
  // tsx entry detection — process.argv[1] is the script after shebang
  (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url));

function fileURLToPath(u: string): string {
  return u.replace(/^file:\/\//, "");
}

if (isEntry) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`Internal error: ${(err as Error).stack}\n`);
      process.exit(2);
    },
  );
}
