#!/usr/bin/env bunx tsx
/**
 * loom-setup:browser-cookies (M-11 F-34)
 *
 * Import real Chrome/Chromium/Brave/Edge cookies from the operator's
 * local browser profile into .loom/browser/cookies/{domain}.toon so the
 * /loom-browser daemon can pick them up on next start.
 *
 * Best-effort: if `chrome-cookies-secure` is not installed, prints an
 * instructive stderr message and exits non-zero.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const BROWSER_DIR = path.join(process.cwd(), ".loom", "browser");
const COOKIES_DIR = path.join(BROWSER_DIR, "cookies");
const DOMAIN_CONFIG = path.join(BROWSER_DIR, "cookie-domains.toon");

interface CookieRow {
  name: string;
  value: string;
  path: string;
  expiresAt: string; // ISO 8601
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
}

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

function detectCookieStore(): { browser: string; path: string } | null {
  const platform = os.platform();
  const home = os.homedir();
  const candidates: Array<{ browser: string; path: string }> = [];

  if (platform === "darwin") {
    const base = path.join(home, "Library", "Application Support");
    candidates.push(
      { browser: "chrome", path: path.join(base, "Google", "Chrome", "Default", "Cookies") },
      { browser: "chromium", path: path.join(base, "Chromium", "Default", "Cookies") },
      { browser: "brave", path: path.join(base, "BraveSoftware", "Brave-Browser", "Default", "Cookies") },
      { browser: "edge", path: path.join(base, "Microsoft Edge", "Default", "Cookies") }
    );
  } else if (platform === "linux") {
    const base = path.join(home, ".config");
    candidates.push(
      { browser: "chrome", path: path.join(base, "google-chrome", "Default", "Cookies") },
      { browser: "chromium", path: path.join(base, "chromium", "Default", "Cookies") },
      { browser: "brave", path: path.join(base, "BraveSoftware", "Brave-Browser", "Default", "Cookies") },
      { browser: "edge", path: path.join(base, "microsoft-edge", "Default", "Cookies") }
    );
  } else if (platform === "win32") {
    const local = process.env["LOCALAPPDATA"] ?? path.join(home, "AppData", "Local");
    candidates.push(
      { browser: "chrome", path: path.join(local, "Google", "Chrome", "User Data", "Default", "Cookies") },
      { browser: "chromium", path: path.join(local, "Chromium", "User Data", "Default", "Cookies") },
      { browser: "brave", path: path.join(local, "BraveSoftware", "Brave-Browser", "User Data", "Default", "Cookies") },
      { browser: "edge", path: path.join(local, "Microsoft", "Edge", "User Data", "Default", "Cookies") }
    );
  }

  for (const c of candidates) {
    if (fs.existsSync(c.path)) return c;
  }
  return null;
}

function readDomainConfig(): string[] | null {
  if (!fs.existsSync(DOMAIN_CONFIG)) return null;
  const raw = fs.readFileSync(DOMAIN_CONFIG, "utf-8");
  const m = raw.match(/^domains\[\d+\]:\s*(.+)$/m);
  if (!m) return null;
  return m[1].split(",").map((s) => s.trim()).filter(Boolean);
}

function serializeCookieFile(domain: string, sourceBrowser: string, cookies: CookieRow[]): string {
  const lines = [
    "schemaVersion: 1",
    `domain: ${domain}`,
    `extractedAt: ${nowISO()}`,
    `sourceBrowser: ${sourceBrowser}`,
    `cookies[${cookies.length}]{name,value,path,expiresAt,httpOnly,secure,sameSite}:`,
  ];
  for (const c of cookies) {
    // TOON row - escape commas in value by wrapping (naive; values with commas rare in cookies)
    const safeVal = c.value.replace(/,/g, "%2C");
    lines.push(
      `  ${c.name},${safeVal},${c.path},${c.expiresAt},${c.httpOnly},${c.secure},${c.sameSite}`
    );
  }
  lines.push("");
  return lines.join("\n");
}

async function importForDomain(domain: string, store: { browser: string; path: string }): Promise<CookieRow[]> {
  // Try dynamic import of chrome-cookies-secure. If it fails, throw so caller
  // can degrade gracefully.
  let lib: { getCookies: (url: string, format: string, callback: (err: Error | null, cookies: unknown) => void) => void } | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lib = (await import("chrome-cookies-secure" as string)) as any;
  } catch {
    throw new Error("MISSING_LIB");
  }
  return new Promise((resolve, reject) => {
    lib!.getCookies(`https://${domain}`, "puppeteer", (err, cookies) => {
      if (err) return reject(err);
      const rows: CookieRow[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const c of cookies as any[]) {
        rows.push({
          name: String(c.name ?? ""),
          value: String(c.value ?? ""),
          path: String(c.path ?? "/"),
          expiresAt:
            typeof c.expires === "number" && c.expires > 0
              ? new Date(c.expires * 1000).toISOString()
              : "",
          httpOnly: Boolean(c.httpOnly),
          secure: Boolean(c.secure),
          sameSite: String(c.sameSite ?? "lax").toLowerCase(),
        });
      }
      resolve(rows);
    });
  });
}

async function main(): Promise<number> {
  const store = detectCookieStore();
  if (!store) {
    console.error(
      "COOKIE_STORE_NOT_FOUND — no Chrome/Chromium/Brave/Edge profile detected on this platform."
    );
    return 1;
  }
  console.log(`sourceBrowser: ${store.browser}`);
  console.log(`sourcePath: ${store.path}`);

  const domains = readDomainConfig();
  if (!domains || domains.length === 0) {
    console.error(
      "NO_DOMAIN_CONFIG — write a domain list to .loom/browser/cookie-domains.toon:"
    );
    console.error("  domains[2]: example.com, api.example.com");
    console.error(
      "(Interactive picker not implemented in stub — provide config to proceed.)"
    );
    return 1;
  }

  ensureDir(COOKIES_DIR);
  let ok = 0;
  let failed = 0;
  for (const domain of domains) {
    try {
      const rows = await importForDomain(domain, store);
      const filePath = path.join(COOKIES_DIR, `${domain}.toon`);
      atomicWrite(filePath, serializeCookieFile(domain, store.browser, rows));
      console.log(`exported: ${domain} (${rows.length} cookies)`);
      ok++;
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === "MISSING_LIB") {
        console.error(
          "MISSING_LIB — install `chrome-cookies-secure` to decrypt cookies:"
        );
        console.error("  bun add -d chrome-cookies-secure");
        console.error("  # or: npm i -D chrome-cookies-secure");
        return 1;
      }
      console.error(`FAILED ${domain}: ${msg}`);
      failed++;
    }
  }
  console.log(`summary: ok=${ok} failed=${failed}`);
  return failed > 0 ? 1 : 0;
}

main().then((code) => process.exit(code));
