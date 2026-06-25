/**
 * Doctor dispatcher (Phase 9A1).
 *
 * Discovers every `scripts/lib/doctor/checks/*.ts` module **at runtime** via
 * `fs.readdirSync` + dynamic `import()`. Static imports of `checks/*` are
 * forbidden — they would defeat the parallel-compile pattern with Phase 9A2
 * (the dispatcher must compile cleanly with an empty `checks/` directory).
 *
 * Public contract: `runChecks(opts)` returns a `DoctorReport` conforming to
 * `protocols/doctor-report.schema.md` (`schemaVersion: 1`).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { Check, InstallState } from "./check.interface.js";

import type { RenderableCheck, RenderableReport } from "./render.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export interface DiscoveryDeps {
  /** Absolute path to the `checks/` directory. Defaults to sibling `checks/`. */
  checksDir?: string;
  /** Injectable filesystem reader (for tests). */
  readdir?: (dir: string) => string[];
  /** Injectable dynamic importer (for tests). */
  importModule?: (specifier: string) => Promise<unknown>;
}

const DEFAULT_CHECKS_DIR = path.join(__dirname, "checks");

/**
 * Dynamically discover every check module in `checksDir` and return their
 * `Check` exports. Modules MUST export a `check: Check` named export OR a
 * default export of type `Check`. Files starting with `_` or containing
 * `.test.` are skipped.
 */
export async function discoverChecks(
  deps: DiscoveryDeps = {},
): Promise<Check[]> {
  const dir = deps.checksDir ?? DEFAULT_CHECKS_DIR;
  const readdir = deps.readdir ?? ((d: string) => fs.readdirSync(d));
  const importModule =
    deps.importModule ?? ((spec: string) => import(spec));

  let entries: string[];
  try {
    entries = readdir(dir);
  } catch (err) {
    // No checks directory present (e.g. Phase 9A2 hasn't landed yet). The
    // dispatcher is intentionally tolerant — return an empty registry so the
    // CLI surface still ships before sibling phases compile.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const candidates = entries
    .filter(
      (f) =>
        (f.endsWith(".ts") || f.endsWith(".js") || f.endsWith(".mjs")) &&
        !f.startsWith("_") &&
        !f.includes(".test."),
    )
    .sort();

  const checks: Check[] = [];
  for (const file of candidates) {
    const abs = path.join(dir, file);
    const mod = (await importModule(pathToFileURL(abs).href)) as Record<
      string,
      unknown
    >;
    const exported = mod.check ?? mod.default;
    if (!exported) continue;
    // Accept either a pre-built instance (`{run: ...}`) OR a zero-arg-default
    // constructor — the Phase 9A2a/b check modules export classes. Falling
    // back to `new exported()` honors the constructor pattern those modules
    // ship without forcing every check author to also export a singleton.
    let instance: Check | undefined;
    if (typeof (exported as { run?: unknown }).run === "function") {
      instance = exported as Check;
    } else if (typeof exported === "function") {
      try {
        instance = new (exported as new () => Check)();
      } catch {
        continue;
      }
    }
    if (!instance || typeof instance.run !== "function") continue;
    checks.push(instance);
  }
  return checks;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export interface RunChecksOptions {
  /** Run only the named check (registry id). */
  only?: string;
  /** Injected install state (Phase 9B / state-loader supplies this). */
  state: InstallState;
  /** Discovery overrides (tests). */
  discovery?: DiscoveryDeps;
  /** Clock injection — defaults to `() => new Date()`. */
  now?: () => Date;
  /** Install source for the envelope header. */
  installSource: "plugin" | "curl" | "unknown";
  /** Settings tier for the envelope header. */
  tier: "local" | "project" | "mixed";
}

interface RawCheckResult {
  id?: string;
  category?: string;
  status?: "pass" | "warn" | "fail";
  message?: string;
  remediation?: string;
}

function coerceCheckResult(check: Check, raw: unknown): RenderableCheck {
  const r = (raw ?? {}) as RawCheckResult;
  return {
    id: r.id ?? check.id,
    category: r.category ?? check.category,
    status: r.status ?? "fail",
    message: r.message ?? "",
    remediation: r.remediation,
  };
}

function deriveOverall(
  checks: RenderableCheck[],
): { overallStatus: RenderableReport["overallStatus"]; exitCode: 0 | 1 | 2 } {
  let anyWarn = false;
  let anyFail = false;
  for (const c of checks) {
    if (c.status === "warn") anyWarn = true;
    else if (c.status === "fail") anyFail = true;
  }
  if (anyFail) return { overallStatus: "problems", exitCode: 1 };
  if (anyWarn) return { overallStatus: "warnings", exitCode: 1 };
  return { overallStatus: "clean", exitCode: 0 };
}

export async function runChecks(
  opts: RunChecksOptions,
): Promise<RenderableReport> {
  const now = opts.now ?? (() => new Date());

  let registry: Check[];
  try {
    registry = await discoverChecks(opts.discovery);
  } catch (err) {
    return {
      schemaVersion: 1,
      generatedAt: now().toISOString(),
      installSource: opts.installSource,
      tier: opts.tier,
      overallStatus: "problems",
      exitCode: 2,
      checks: [
        {
          id: "dispatcher-internal-error",
          category: "channel",
          status: "fail",
          message: `Dispatcher discovery failed: ${(err as Error).message}`,
          remediation: "Re-run /loom-doctor --bundle and file an issue.",
        },
      ],
    };
  }

  const selected = opts.only
    ? registry.filter((c) => c.id === opts.only)
    : registry;

  const results: RenderableCheck[] = [];
  for (const check of selected) {
    try {
      const raw = await check.run(opts.state);
      results.push(coerceCheckResult(check, raw));
    } catch (err) {
      results.push({
        id: check.id,
        category: check.category,
        status: "fail",
        message: `Check threw: ${(err as Error).message}`,
        remediation: "Re-run /loom-doctor --bundle and file an issue.",
      });
    }
  }

  const { overallStatus, exitCode } = deriveOverall(results);

  return {
    schemaVersion: 1,
    generatedAt: now().toISOString(),
    installSource: opts.installSource,
    tier: opts.tier,
    overallStatus,
    exitCode,
    checks: results,
  };
}
