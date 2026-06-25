/**
 * schema-implementation-drift — flags `protocols/*.schema.md` files that
 * describe a contract no TS code under `scripts/` or `hooks/` references.
 *
 * Catches the PR #18 plugin-manifest.schema.md class: a schema doc kept
 * describing `entrypoints[]` long after the actual manifest had moved to
 * `agents` / `commands` / `skills` / `hooks` top-level fields. The doc was
 * still cited by `wave-1-manifest-agent` as the contract — drift waiting to
 * be discovered.
 *
 * Heuristic: for each `protocols/*.schema.md`, count references to its
 * basename in TS files. Zero references → `warn`. The check is intentionally
 * coarse — false positives (rare, fixable with an `// uses:` anchor comment)
 * are preferable to drift surviving silently.
 *
 * Severity `warn` on any orphan. Category `settings`. Emits
 * `DOCTOR_SCHEMA_DRIFT_SUSPECTED` so consumers can surface it.
 *
 * Default export is a class implementing `Check` so the dispatcher in
 * `scripts/lib/doctor/index.ts` discovers it via dynamic import.
 */

import * as fsSync from "node:fs";
import * as path from "node:path";

import type { Check, CheckCategory, InstallState } from "../check.interface";

type HealthCheck = {
  id: string;
  category: CheckCategory;
  status: "pass" | "warn" | "fail";
  message: string;
  fixCommand?: string | null;
  remediation?: string;
};

export interface SchemaDriftDeps {
  protocolsDir?: string;
  tsSearchDirs?: string[];
  readFile?: (p: string) => string;
  readdir?: (p: string) => string[];
  existsSync?: (p: string) => boolean;
  repoRoot?: string;
}

interface OrphanReport {
  schemaName: string;
  schemaPath: string;
}

const DEFAULT_READ_FILE = (p: string) => fsSync.readFileSync(p, "utf8");
const DEFAULT_READDIR = (p: string) => fsSync.readdirSync(p);
const DEFAULT_EXISTS = (p: string) => fsSync.existsSync(p);

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".worktrees",
  "dist",
  ".plan-execution",
  "__tests__",
]);

/**
 * Walk a directory and collect TS/TSX file paths. Bounded — uses lstatSync
 * (does NOT follow symlinks) and skips well-known non-source dirs. Skipping
 * symlinks keeps the walker from escaping the repo if a contributor has e.g.
 * `scripts/local -> /home/me/projects/...` in their checkout.
 */
function collectTsFiles(
  dir: string,
  readdir: (p: string) => string[],
  exists: (p: string) => boolean,
): string[] {
  if (!exists(dir)) return [];
  const out: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries: string[];
    try {
      entries = readdir(cur);
    } catch (err: any) {
      // ENOENT/ELOOP after a race is fine to skip silently; surface other
      // errors so the user can correlate spurious orphan-flag results with
      // a real filesystem issue (EACCES, EIO, EMFILE).
      if (err?.code && !["ENOENT", "ELOOP"].includes(err.code)) {
        process.stderr.write(
          `[schema-implementation-drift] readdir ${cur} failed: ${err.code}\n`,
        );
      }
      continue;
    }
    for (const name of entries) {
      if (SKIP_DIRS.has(name)) continue;
      const full = path.join(cur, name);
      let stat: fsSync.Stats;
      try {
        stat = fsSync.lstatSync(full);
      } catch (err: any) {
        if (err?.code && !["ENOENT", "ELOOP"].includes(err.code)) {
          process.stderr.write(
            `[schema-implementation-drift] lstat ${full} failed: ${err.code}\n`,
          );
        }
        continue;
      }
      if (stat.isSymbolicLink()) {
        // Skip symlinks to avoid walking outside the repo.
        continue;
      }
      if (stat.isDirectory()) {
        stack.push(full);
      } else if (
        stat.isFile() &&
        (full.endsWith(".ts") || full.endsWith(".tsx")) &&
        !full.endsWith(".test.ts") &&
        !full.endsWith(".test.tsx")
      ) {
        out.push(full);
      }
    }
  }
  return out;
}

/**
 * Return the list of schema docs with no TS reference under any of the
 * `tsSearchDirs`. Reference = the basename appears as a substring in any
 * TS file (cheap; some false positives via comments — see header).
 */
export function findOrphanSchemas(deps: Required<SchemaDriftDeps>): OrphanReport[] {
  const { protocolsDir, tsSearchDirs, readFile, readdir, existsSync } = deps;
  if (!existsSync(protocolsDir)) return [];

  const schemas: OrphanReport[] = [];
  let entries: string[];
  try {
    entries = readdir(protocolsDir);
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (!entry.endsWith(".schema.md")) continue;
    schemas.push({
      schemaName: entry,
      schemaPath: path.join(protocolsDir, entry),
    });
  }
  if (schemas.length === 0) return [];

  // Build a concatenated haystack of every TS file under the search dirs.
  // Memory-bounded — ~5 MB for a repo of Loom's size.
  let haystack = "";
  for (const dir of tsSearchDirs) {
    for (const tsFile of collectTsFiles(dir, readdir, existsSync)) {
      try {
        haystack += readFile(tsFile);
        haystack += "\n";
      } catch {
        // ignore unreadable files
      }
    }
  }

  return schemas.filter(({ schemaName }) => !haystack.includes(schemaName));
}

export default class SchemaImplementationDriftCheck implements Check {
  readonly id = "schema-implementation-drift";
  readonly category: CheckCategory = "settings";

  private readonly deps: Required<SchemaDriftDeps>;

  constructor(deps: SchemaDriftDeps = {}) {
    const repoRoot = deps.repoRoot ?? process.cwd();
    this.deps = {
      protocolsDir: deps.protocolsDir ?? path.join(repoRoot, "protocols"),
      tsSearchDirs:
        deps.tsSearchDirs ?? [
          path.join(repoRoot, "scripts"),
          path.join(repoRoot, "hooks"),
        ],
      readFile: deps.readFile ?? DEFAULT_READ_FILE,
      readdir: deps.readdir ?? DEFAULT_READDIR,
      existsSync: deps.existsSync ?? DEFAULT_EXISTS,
      repoRoot,
    };
  }

  async run(_state: InstallState): Promise<HealthCheck> {
    const orphans = findOrphanSchemas(this.deps);

    if (orphans.length === 0) {
      return {
        id: this.id,
        category: this.category,
        status: "pass",
        message: "Every protocols/*.schema.md is referenced by at least one TS file.",
      };
    }

    const list = orphans.map((o) => `  - ${o.schemaName}`).join("\n");
    return {
      id: this.id,
      category: this.category,
      status: "warn",
      message:
        `DOCTOR_SCHEMA_DRIFT_SUSPECTED: ${orphans.length} schema doc(s) ` +
        `have no TypeScript consumer:\n${list}`,
      remediation:
        "Search the codebase for the schema basename. If genuinely unused, " +
        "remove the doc or move it to docs/. If used by .md or .toon files only " +
        "(no TS consumer), add an `// uses: <schema-name>` anchor comment in any " +
        "TS file that semantically depends on it.",
    };
  }
}
