#!/usr/bin/env bunx tsx
/**
 * loom-browser daemon (M-11 F-33)
 *
 * Persistent Chromium daemon at .loom/browser/. Best-effort: if puppeteer-core
 * or playwright is not installed, falls back to STUB mode that logs commands
 * to .loom/browser/queue.toon for the operator to run manually.
 *
 * Subcommands: start | stop | status | exec <cmd>
 *
 * State: .loom/browser/state.toon per protocols/browser-state.schema.toon
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawn } from "node:child_process";

const BROWSER_DIR = path.join(process.cwd(), ".loom", "browser");
const STATE_FILE = path.join(BROWSER_DIR, "state.toon");
const PID_FILE = path.join(BROWSER_DIR, "daemon.pid");
const QUEUE_FILE = path.join(BROWSER_DIR, "queue.toon");
const COOKIES_DIR = path.join(BROWSER_DIR, "cookies");
const DEFAULT_CDP_PORT = 9222;

// ---------- utils ----------

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function atomicWrite(filePath: string, content: string) {
  ensureDir(path.dirname(filePath));
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}

function nowISO(): string {
  return new Date().toISOString();
}

function detectChromiumBinary(): string | null {
  const candidates: string[] = [];
  const platform = os.platform();
  if (platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    );
  } else if (platform === "linux") {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/brave-browser"
    );
  } else if (platform === "win32") {
    const pf = process.env["PROGRAMFILES"] ?? "C:\\Program Files";
    const pfx86 = process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)";
    candidates.push(
      path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(pfx86, "Google", "Chrome", "Application", "chrome.exe")
    );
  }
  if (process.env["CHROME_PATH"]) candidates.unshift(process.env["CHROME_PATH"]);
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      // ignore
    }
  }
  return null;
}

function readStateFile(): Record<string, string | number | boolean> | null {
  if (!fs.existsSync(STATE_FILE)) return null;
  const raw = fs.readFileSync(STATE_FILE, "utf-8");
  const out: Record<string, string | number | boolean> = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([a-zA-Z][a-zA-Z0-9]*):\s*(.*)$/);
    if (!m) continue;
    const [, key, val] = m;
    if (val === "true") out[key] = true;
    else if (val === "false") out[key] = false;
    else if (/^-?\d+$/.test(val)) out[key] = parseInt(val, 10);
    else out[key] = val;
  }
  return out;
}

function writeState(state: {
  daemonPid: number;
  daemonPort: number;
  startedAt: string;
  chromiumBinaryPath: string;
  cdpEndpoint: string;
  cookiesLoaded: boolean;
  injectionDefenseEnabled: boolean;
}) {
  const toon = [
    "schemaVersion: 1",
    `daemonPid: ${state.daemonPid}`,
    `daemonPort: ${state.daemonPort}`,
    `startedAt: ${state.startedAt}`,
    `chromiumBinaryPath: ${state.chromiumBinaryPath}`,
    `cdpEndpoint: ${state.cdpEndpoint}`,
    "activeTabs[0]{tabId,url,title}:",
    `cookiesLoaded: ${state.cookiesLoaded}`,
    `injectionDefenseEnabled: ${state.injectionDefenseEnabled}`,
    "",
  ].join("\n");
  atomicWrite(STATE_FILE, toon);
}

function isPidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function appendQueue(cmd: string) {
  ensureDir(BROWSER_DIR);
  const line = `- ${nowISO()} ${cmd}\n`;
  fs.appendFileSync(QUEUE_FILE, line);
}

function countCookieFiles(): number {
  if (!fs.existsSync(COOKIES_DIR)) return 0;
  return fs
    .readdirSync(COOKIES_DIR)
    .filter((f) => f.endsWith(".toon")).length;
}

// ---------- subcommands ----------

function statusCmd(): number {
  const state = readStateFile();
  if (!state) {
    console.log("phase: stopped");
    return 0;
  }
  const pid = typeof state["daemonPid"] === "number" ? state["daemonPid"] : 0;
  if (pid > 0 && !isPidAlive(pid)) {
    console.log("phase: crashed");
    console.log(`daemonPid: ${pid}`);
    return 0;
  }
  console.log(`phase: ${pid > 0 ? "running" : "stopped"}`);
  for (const [k, v] of Object.entries(state)) {
    console.log(`${k}: ${v}`);
  }
  return 0;
}

function startCmd(): number {
  const existing = readStateFile();
  if (existing && typeof existing["daemonPid"] === "number") {
    const pid = existing["daemonPid"];
    if (pid > 0 && isPidAlive(pid)) {
      console.error("BROWSER_ALREADY_RUNNING");
      console.error(`daemonPid: ${pid}`);
      return 1;
    }
  }

  ensureDir(BROWSER_DIR);
  const binary = detectChromiumBinary();
  const cookiesLoaded = countCookieFiles() > 0;

  if (!binary) {
    console.error("BROWSER_NO_BINARY — falling back to stub mode");
    writeState({
      daemonPid: 0,
      daemonPort: 0,
      startedAt: nowISO(),
      chromiumBinaryPath: "",
      cdpEndpoint: "",
      cookiesLoaded,
      injectionDefenseEnabled: true,
    });
    appendQueue("start (stub mode — no Chromium binary)");
    console.log("phase: stub");
    return 0;
  }

  // Try to spawn Chromium in headless mode with CDP enabled.
  // Best-effort: if spawn fails (missing perms, sandbox issue), degrade to stub.
  const port = DEFAULT_CDP_PORT;
  const userDataDir = path.join(BROWSER_DIR, "profile");
  ensureDir(userDataDir);
  try {
    const child = spawn(
      binary,
      [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${userDataDir}`,
        "--headless=new",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-features=Translate",
      ],
      { detached: true, stdio: "ignore" }
    );
    child.unref();
    const pid = child.pid ?? 0;
    if (pid > 0) {
      fs.writeFileSync(PID_FILE, String(pid));
    }
    writeState({
      daemonPid: pid,
      daemonPort: port,
      startedAt: nowISO(),
      chromiumBinaryPath: binary,
      cdpEndpoint: `ws://127.0.0.1:${port}/devtools/browser/pending`,
      cookiesLoaded,
      injectionDefenseEnabled: true,
    });
    console.log(`phase: running`);
    console.log(`daemonPid: ${pid}`);
    console.log(`daemonPort: ${port}`);
    return 0;
  } catch (err) {
    console.error(`BROWSER_SPAWN_FAILED: ${(err as Error).message}`);
    writeState({
      daemonPid: 0,
      daemonPort: 0,
      startedAt: nowISO(),
      chromiumBinaryPath: binary,
      cdpEndpoint: "",
      cookiesLoaded,
      injectionDefenseEnabled: true,
    });
    appendQueue("start (stub mode — spawn failed)");
    return 0;
  }
}

function stopCmd(): number {
  const state = readStateFile();
  if (!state) {
    console.log("phase: stopped (no state file)");
    return 0;
  }
  const pid = typeof state["daemonPid"] === "number" ? state["daemonPid"] : 0;
  if (pid > 0 && isPidAlive(pid)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // ignore
    }
  }
  writeState({
    daemonPid: 0,
    daemonPort: 0,
    startedAt: (state["startedAt"] as string) ?? "",
    chromiumBinaryPath: (state["chromiumBinaryPath"] as string) ?? "",
    cdpEndpoint: "",
    cookiesLoaded: false,
    injectionDefenseEnabled: true,
  });
  if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
  console.log("phase: stopped");
  return 0;
}

function execCmd(args: string[]): number {
  if (args.length === 0) {
    console.error("USAGE: loom-browser exec <cmd> [args...]");
    return 2;
  }
  const cmd = args.join(" ");
  const state = readStateFile();
  const running =
    state !== null &&
    typeof state["daemonPid"] === "number" &&
    state["daemonPid"] > 0 &&
    isPidAlive(state["daemonPid"]);
  if (!running) {
    console.error("BROWSER_NOT_RUNNING — command queued");
    appendQueue(`exec ${cmd}`);
    return 0;
  }
  // Best-effort: without a bundled CDP client we log to queue for a downstream
  // client to pick up. Real client integration is a follow-on within M-11's
  // downstream milestones (M-07, M-13).
  appendQueue(`exec ${cmd}`);
  console.log(`queued: ${cmd}`);
  return 0;
}

// ---------- entry ----------

function main(argv: string[]): number {
  const sub = argv[2];
  const rest = argv.slice(3);
  switch (sub) {
    case "start":
      return startCmd();
    case "stop":
      return stopCmd();
    case "status":
      return statusCmd();
    case "exec":
      return execCmd(rest);
    default:
      console.error("USAGE: loom-browser <start|stop|status|exec>");
      return 2;
  }
}

process.exit(main(process.argv));
