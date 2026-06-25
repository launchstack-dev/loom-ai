/**
 * F-04 `pr-state.toon` projection writer.
 *
 * Produces the synthetic `subject` file the F-04 convergence loop snapshots
 * each iteration. The shape is documented verbatim in
 * `protocols/converge.config.applications.md` § F-04 `pr-state.toon`
 * projection shape.
 *
 * Atomic write: `{path}.tmp` then rename, per `execution-conventions.md`.
 *
 * I/O boundary: every external command runs through the injected `GhRunner`.
 * Production wires `gh pr view --json ...`, `gh pr diff <N>`, `gh api ...`.
 * Tests inject a deterministic stub.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Narrow shell-runner contract — covers every `gh` call the writer makes.
 *
 * Implementations MUST return stdout as a UTF-8 string. Non-zero exits MUST
 * throw an Error whose `message` includes the failing command for diagnosis.
 */
export type GhRunner = (
  args: readonly string[],
) => Promise<string> | string;

/** One row in `files[]` per the F-04 projection. */
export interface PrStateFile {
  path: string;
  status: "added" | "modified" | "removed" | "renamed";
  additions: number;
  deletions: number;
}

/** One row in `comments[]` per the F-04 projection. */
export interface PrStateComment {
  id: string;
  author: string;
  path: string;
  line: number;
  body: string;
  createdAt: string;
}

/** The full `pr-state.toon` payload. */
export interface PrState {
  prNumber: number;
  baseSha: string;
  headSha: string;
  diffHash: string;
  producedAt: string;
  files: PrStateFile[];
  comments: PrStateComment[];
}

/** Options accepted by {@link writePrState}. */
export interface WritePrStateOptions {
  prNumber: number;
  /** Output path. Default: `.plan-execution/pr-review/pr-state.toon`. */
  outputPath?: string;
  /** Injected shell runner. Production: real `gh`. Tests: stub. */
  runner: GhRunner;
  /** Optional injected clock for deterministic `producedAt` in tests. */
  now?: () => Date;
}

// ---------------------------------------------------------------------------
// Default runner (production)
// ---------------------------------------------------------------------------

/**
 * Default {@link GhRunner} backed by `child_process.spawnSync`. Throws on
 * non-zero exit with stderr appended to the error message. Exported so callers
 * can use it as the production wiring without re-implementing.
 */
export function defaultGhRunner(args: readonly string[]): string {
  // Lazy require keeps `pr-state-writer` importable in bundle environments
  // where `child_process` is shimmed.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`gh ${args.join(" ")} failed to spawn: ${result.error.message}`);
  }
  if (typeof result.status === "number" && result.status !== 0) {
    const stderr = result.stderr ?? "";
    throw new Error(
      `gh ${args.join(" ")} exited ${result.status}: ${stderr.trim()}`,
    );
  }
  return result.stdout ?? "";
}

// ---------------------------------------------------------------------------
// gh response parsing
// ---------------------------------------------------------------------------

interface RawPrView {
  number: number;
  baseRefOid: string;
  headRefOid: string;
  files?: Array<{
    path: string;
    additions?: number;
    deletions?: number;
  }>;
}

interface RawComment {
  id: number | string;
  user?: { login?: string } | null;
  path?: string | null;
  line?: number | null;
  original_line?: number | null;
  body?: string | null;
  created_at?: string | null;
}

function statusFromCounts(additions: number, deletions: number): PrStateFile["status"] {
  if (deletions > 0 && additions === 0) return "removed";
  if (additions > 0 && deletions === 0) return "added";
  return "modified";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a {@link PrState} by shelling out to `gh` via the injected runner.
 * Pure w.r.t. the filesystem — callers feed the result to {@link writePrStateFile}
 * or {@link writePrState} for the atomic write.
 */
export async function buildPrState(opts: WritePrStateOptions): Promise<PrState> {
  const { prNumber, runner, now = () => new Date() } = opts;
  if (!Number.isInteger(prNumber) || prNumber < 1) {
    throw new Error(
      `pr-state-writer: prNumber must be a positive integer (got ${prNumber})`,
    );
  }

  const viewRaw = await runner([
    "pr",
    "view",
    String(prNumber),
    "--json",
    "number,baseRefOid,headRefOid,files",
  ]);
  let view: RawPrView;
  try {
    view = JSON.parse(viewRaw) as RawPrView;
  } catch (err) {
    throw new Error(
      `pr-state-writer: failed to parse gh pr view JSON: ${(err as Error).message}`,
    );
  }

  const diff = await runner(["pr", "diff", String(prNumber)]);

  // gh api accepts the `--paginate` flag for review-comments; we keep the
  // call simple and let the runner handle pagination if it chooses.
  const ownerRepoRaw = await runner([
    "repo",
    "view",
    "--json",
    "nameWithOwner",
    "--jq",
    ".nameWithOwner",
  ]);
  const nameWithOwner = ownerRepoRaw.trim();
  const commentsRaw = await runner([
    "api",
    `repos/${nameWithOwner}/pulls/${prNumber}/comments`,
  ]);
  let rawComments: RawComment[];
  try {
    const parsed = JSON.parse(commentsRaw);
    rawComments = Array.isArray(parsed) ? (parsed as RawComment[]) : [];
  } catch (err) {
    throw new Error(
      `pr-state-writer: failed to parse gh api comments JSON: ${(err as Error).message}`,
    );
  }

  const files: PrStateFile[] = (view.files ?? []).map((f) => {
    const additions = typeof f.additions === "number" ? f.additions : 0;
    const deletions = typeof f.deletions === "number" ? f.deletions : 0;
    return {
      path: f.path,
      status: statusFromCounts(additions, deletions),
      additions,
      deletions,
    };
  });

  const comments: PrStateComment[] = rawComments
    .filter((c): c is RawComment & { path: string } => typeof c.path === "string" && c.path.length > 0)
    .map((c) => {
      const line =
        typeof c.line === "number"
          ? c.line
          : typeof c.original_line === "number"
            ? c.original_line
            : 0;
      return {
        id: String(c.id),
        author: c.user?.login ?? "",
        path: c.path,
        line,
        body: c.body ?? "",
        createdAt: c.created_at ?? "",
      };
    });

  const diffHash = "sha256:" + createHash("sha256").update(diff).digest("hex");

  return {
    prNumber: view.number,
    baseSha: view.baseRefOid,
    headSha: view.headRefOid,
    diffHash,
    producedAt: now().toISOString(),
    files,
    comments,
  };
}

/** Atomically write a `PrState` to disk as TOON. Returns the absolute path. */
export function writePrStateFile(state: PrState, outputPath: string): string {
  const absPath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const text = encodePrStateToToon(state);
  const tmp = `${absPath}.tmp`;
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, absPath);
  return absPath;
}

/**
 * Convenience: build via `gh` and write atomically in one call. Returns the
 * `PrState` so callers (and the dispatcher harness) can extract `commentIds`.
 */
export async function writePrState(
  opts: WritePrStateOptions,
): Promise<{ state: PrState; outputPath: string }> {
  const state = await buildPrState(opts);
  const outputPath = writePrStateFile(
    state,
    opts.outputPath ?? ".plan-execution/pr-review/pr-state.toon",
  );
  return { state, outputPath };
}

// ---------------------------------------------------------------------------
// TOON encoder (matches the shape in converge.config.applications.md)
// ---------------------------------------------------------------------------

function csvQuote(raw: string): string {
  if (raw === "") return "";
  if (/[,\n"]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export function encodePrStateToToon(state: PrState): string {
  const header = [
    `prNumber: ${state.prNumber}`,
    `baseSha: ${state.baseSha}`,
    `headSha: ${state.headSha}`,
    `diffHash: ${state.diffHash}`,
    `producedAt: ${state.producedAt}`,
    "",
  ];

  const filesHeader = `files[${state.files.length}]{path,status,additions,deletions}:`;
  const fileRows = state.files.map((f) =>
    `  ${[csvQuote(f.path), f.status, String(f.additions), String(f.deletions)].join(",")}`,
  );

  const commentsHeader = `comments[${state.comments.length}]{id,author,path,line,body,createdAt}:`;
  const commentRows = state.comments.map((c) =>
    `  ${[
      csvQuote(c.id),
      csvQuote(c.author),
      csvQuote(c.path),
      String(c.line),
      csvQuote(c.body),
      csvQuote(c.createdAt),
    ].join(",")}`,
  );

  return [
    ...header,
    filesHeader,
    ...fileRows,
    "",
    commentsHeader,
    ...commentRows,
    "",
  ].join("\n");
}
