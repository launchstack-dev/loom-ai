#!/usr/bin/env -S bunx tsx
/**
 * scripts/loom-install.ts
 *
 * Direct-symlink install path for Loom (F-35, M-12 Distribution).
 * Alternative to the plugin marketplace channel — neither deprecates the other
 * (per roadmap C-07). Symlinks the Loom source tree into a host's skill dir.
 *
 * Usage:
 *   bin/loom-install [--link|--unlink|--check] [--host <host>]
 *
 * Hosts: claude-code (default), hermes, openclaw, codex
 *
 * Writes ~/.loom/install-manifest.toon per protocols/install-manifest.schema.toon.
 *
 * Conventions:
 *   - TOON on-disk format (per CLAUDE.md).
 *   - Atomic writes (write to .tmp, then rename).
 *   - Idempotent --link.
 *   - INSTALL_MANIFEST_INVALID (blocking) raised on parse failure during --unlink.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

type Host = "claude-code" | "hermes" | "openclaw" | "codex";
type Action = "link" | "unlink" | "check";

const VALID_HOSTS: readonly Host[] = ["claude-code", "hermes", "openclaw", "codex"] as const;

interface HostBinding {
  host: Host;
  path: string;
}

interface InstallManifest {
  schemaVersion: number;
  installMode: "direct-symlink" | "plugin";
  sourcePath: string;
  targetPath: string;
  installedAt: string;
  loomVersion: string;
  hostBindings: HostBinding[];
}

const MANIFEST_PATH = path.join(os.homedir(), ".loom", "install-manifest.toon");

function hostTargetPath(host: Host): string {
  const home = os.homedir();
  switch (host) {
    case "claude-code":
      return path.join(home, ".claude", "skills", "loom");
    case "hermes":
      return path.join(home, ".hermes", "skills", "loom");
    case "openclaw":
      return path.join(home, ".openclaw", "skills", "loom");
    case "codex":
      return path.join(home, ".codex", "skills", "loom");
  }
}

function repoRoot(): string {
  // scripts/loom-install.ts → parent is scripts/, grandparent is repo root.
  // `fileURLToPath` handles the Windows `/C:/…` leading-slash pitfall that
  // `new URL(import.meta.url).pathname` produces.
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function readLoomVersion(root: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function atomicWrite(target: string, content: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, target);
}

function renderManifest(m: InstallManifest): string {
  const rows = m.hostBindings.map((b) => `  ${b.host},${b.path}`).join("\n");
  return [
    `schemaVersion: ${m.schemaVersion}`,
    `installMode: ${m.installMode}`,
    `sourcePath: ${m.sourcePath}`,
    `targetPath: ${m.targetPath}`,
    `installedAt: ${m.installedAt}`,
    `loomVersion: "${m.loomVersion}"`,
    `hostBindings[${m.hostBindings.length}]{host,path}:`,
    rows,
    "",
  ].join("\n");
}

function parseManifest(text: string): InstallManifest {
  const lines = text.split(/\r?\n/);
  const out: Partial<InstallManifest> = { hostBindings: [] };
  let inTable = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line) continue;
    if (inTable) {
      if (/^\s{2,}\S/.test(line)) {
        const [host, ...rest] = line.trim().split(",");
        const p = rest.join(",");
        if (!VALID_HOSTS.includes(host as Host)) {
          throw new Error(`INSTALL_MANIFEST_INVALID: unknown host "${host}"`);
        }
        out.hostBindings!.push({ host: host as Host, path: p });
        continue;
      }
      inTable = false;
    }
    if (line.startsWith("hostBindings[")) {
      inTable = true;
      continue;
    }
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!m) continue;
    const [, key, valRaw] = m;
    const val = valRaw.replace(/^"(.*)"$/, "$1");
    switch (key) {
      case "schemaVersion":
        out.schemaVersion = Number(val);
        break;
      case "installMode":
        out.installMode = val as InstallManifest["installMode"];
        break;
      case "sourcePath":
        out.sourcePath = val;
        break;
      case "targetPath":
        out.targetPath = val;
        break;
      case "installedAt":
        out.installedAt = val;
        break;
      case "loomVersion":
        out.loomVersion = val;
        break;
    }
  }
  if (
    typeof out.schemaVersion !== "number" ||
    !out.installMode ||
    !out.sourcePath ||
    !out.targetPath ||
    !out.installedAt ||
    !out.loomVersion
  ) {
    throw new Error("INSTALL_MANIFEST_INVALID: missing required field");
  }
  return out as InstallManifest;
}

function readManifest(): InstallManifest | null {
  if (!fs.existsSync(MANIFEST_PATH)) return null;
  const text = fs.readFileSync(MANIFEST_PATH, "utf8");
  return parseManifest(text);
}

function ensureSymlink(source: string, target: string): { created: boolean; already: boolean } {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  let existingStat: fs.Stats | null = null;
  try {
    existingStat = fs.lstatSync(target);
  } catch {
    /* no target */
  }
  if (existingStat) {
    if (existingStat.isSymbolicLink()) {
      const current = fs.readlinkSync(target);
      if (path.resolve(current) === path.resolve(source)) {
        return { created: false, already: true };
      }
      fs.unlinkSync(target);
    } else {
      throw new Error(
        `Refusing to overwrite non-symlink at ${target}. Move it aside and retry.`,
      );
    }
  }
  // On Windows, creating a directory symlink (`dir`) requires elevated
  // Administrator privileges by default. Directory junctions (`junction`) do
  // not require elevation and behave equivalently for our purposes (symlink
  // to an existing local directory).
  const type = os.platform() === "win32" ? "junction" : "dir";
  fs.symlinkSync(source, target, type);
  return { created: true, already: false };
}

function removeSymlink(target: string): boolean {
  try {
    const st = fs.lstatSync(target);
    if (st.isSymbolicLink()) {
      fs.unlinkSync(target);
      return true;
    }
  } catch {
    /* no target */
  }
  return false;
}

interface Args {
  action: Action;
  host: Host;
}

function parseArgs(argv: string[]): Args {
  let action: Action | undefined;
  let host: Host = "claude-code";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--link":
        action = "link";
        break;
      case "--unlink":
        action = "unlink";
        break;
      case "--check":
        action = "check";
        break;
      case "--host": {
        const v = argv[++i];
        if (!v || !VALID_HOSTS.includes(v as Host)) {
          throw new Error(
            `Invalid --host "${v}". Must be one of: ${VALID_HOSTS.join(", ")}`,
          );
        }
        host = v as Host;
        break;
      }
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
        break;
      default:
        if (a.startsWith("--host=")) {
          const v = a.slice("--host=".length);
          if (!VALID_HOSTS.includes(v as Host)) {
            throw new Error(`Invalid --host "${v}"`);
          }
          host = v as Host;
        } else {
          throw new Error(`Unknown argument: ${a}`);
        }
    }
  }
  if (!action) action = "check";
  return { action, host };
}

function printHelp(): void {
  process.stdout.write(
    [
      "loom-install — direct-symlink install path for Loom",
      "",
      "Usage:",
      "  bin/loom-install [--link|--unlink|--check] [--host <host>]",
      "",
      "Actions:",
      "  --link       Symlink this repo into the host's skill directory (idempotent)",
      "  --unlink     Remove the symlink previously created by --link",
      "  --check      Print current install status (default)",
      "",
      "Options:",
      `  --host <h>   One of: ${VALID_HOSTS.join(", ")}  (default: claude-code)`,
      "",
      `Manifest: ${MANIFEST_PATH}`,
      "",
    ].join("\n"),
  );
}

function cmdCheck(host: Host, source: string): number {
  const target = hostTargetPath(host);
  let status = "not linked";
  let details = "";
  try {
    const st = fs.lstatSync(target);
    if (st.isSymbolicLink()) {
      const dest = fs.readlinkSync(target);
      if (path.resolve(dest) === path.resolve(source)) {
        status = "linked";
        details = ` (target=${target} -> ${dest})`;
      } else {
        status = "linked to different source";
        details = ` (target=${target} -> ${dest}; expected ${source})`;
      }
    } else {
      status = "occupied (not a symlink)";
      details = ` (target=${target})`;
    }
  } catch {
    details = ` (target=${target})`;
  }
  const manifest = readManifest();
  process.stdout.write(`host: ${host}\nstatus: ${status}${details}\n`);
  if (manifest) {
    process.stdout.write(
      `manifest: ${MANIFEST_PATH}\n` +
        `  installMode: ${manifest.installMode}\n` +
        `  sourcePath: ${manifest.sourcePath}\n` +
        `  loomVersion: ${manifest.loomVersion}\n` +
        `  hostBindings: ${manifest.hostBindings.map((b) => b.host).join(", ") || "(none)"}\n`,
    );
  } else {
    process.stdout.write(`manifest: (none at ${MANIFEST_PATH})\n`);
  }
  return 0;
}

function cmdLink(host: Host, source: string, loomVersion: string): number {
  const target = hostTargetPath(host);
  const result = ensureSymlink(source, target);
  process.stdout.write(
    result.already
      ? `Already linked: ${target} -> ${source}\n`
      : `Linked: ${target} -> ${source}\n`,
  );

  let manifest = readManifest();
  const now = new Date().toISOString();
  if (!manifest) {
    manifest = {
      schemaVersion: 1,
      installMode: "direct-symlink",
      sourcePath: source,
      targetPath: target,
      installedAt: now,
      loomVersion,
      hostBindings: [{ host, path: target }],
    };
  } else {
    manifest.installMode = "direct-symlink";
    manifest.sourcePath = source;
    manifest.targetPath = target;
    manifest.loomVersion = loomVersion;
    const existing = manifest.hostBindings.find((b) => b.host === host);
    if (existing) existing.path = target;
    else manifest.hostBindings.push({ host, path: target });
  }
  atomicWrite(MANIFEST_PATH, renderManifest(manifest));
  process.stdout.write(`Manifest updated: ${MANIFEST_PATH}\n`);
  return 0;
}

function cmdUnlink(host: Host): number {
  let manifest: InstallManifest | null;
  try {
    manifest = readManifest();
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 2;
  }
  const target = hostTargetPath(host);
  const removed = removeSymlink(target);
  process.stdout.write(
    removed
      ? `Removed symlink: ${target}\n`
      : `No symlink to remove at: ${target}\n`,
  );
  if (manifest) {
    manifest.hostBindings = manifest.hostBindings.filter((b) => b.host !== host);
    if (manifest.hostBindings.length === 0) {
      try {
        fs.unlinkSync(MANIFEST_PATH);
        process.stdout.write(`Manifest removed: ${MANIFEST_PATH}\n`);
      } catch {
        /* ignore */
      }
    } else {
      manifest.targetPath = manifest.hostBindings[0].path;
      atomicWrite(MANIFEST_PATH, renderManifest(manifest));
      process.stdout.write(`Manifest updated: ${MANIFEST_PATH}\n`);
    }
  }
  return 0;
}

function main(argv: string[]): number {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n\n`);
    printHelp();
    return 2;
  }
  const source = repoRoot();
  const loomVersion = readLoomVersion(source);
  switch (args.action) {
    case "check":
      return cmdCheck(args.host, source);
    case "link":
      return cmdLink(args.host, source, loomVersion);
    case "unlink":
      return cmdUnlink(args.host);
  }
}

// Only execute when invoked directly (not when imported for testing).
const invokedDirectly = (() => {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    const here = new URL(import.meta.url).pathname;
    return path.resolve(entry) === path.resolve(here);
  } catch {
    return true;
  }
})();

if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)));
}

export {
  parseArgs,
  parseManifest,
  renderManifest,
  hostTargetPath,
  MANIFEST_PATH,
  VALID_HOSTS,
};
export type { Args, Host, Action, InstallManifest, HostBinding };
