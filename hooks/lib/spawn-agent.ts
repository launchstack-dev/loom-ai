/**
 * Spawn-request contract for standalone TS harnesses.
 *
 * Context: a standalone Bun/Node script (e.g., `scripts/plan-review-harness.ts`)
 * cannot invoke Claude Code's Agent tool directly — that tool is only
 * available to a running agent. To bridge the gap, the harness writes a
 * `SpawnAgentRequest` TOON file to disk and exits. The calling agent (the
 * convergence-driver) reads the request, spawns the requested agents via its
 * own `Agent` tool, writes each `AgentResult` envelope to a known location,
 * then re-invokes the harness in a fulfillment mode (typically with a
 * `--results-dir` flag).
 *
 * This module is the SOLE writer of spawn-request files. It does NOT invoke
 * any LLM API, does NOT spawn processes, and does NOT touch the network. It
 * is a contract module — the actual `Agent.tool()` invocation is the
 * convergence-driver's responsibility, documented in
 * `agents/convergence-driver.md` § Harness Spawn Fulfillment.
 *
 * Atomic write: temp + rename. Same pattern as
 * `hooks/lib/iteration-snapshot.ts`. Tests inject `_writeFileImpl` to bypass
 * filesystem I/O.
 *
 * The plan-review harness uses the ONE-PHASE-VIA-INJECTION pattern: it
 * accepts an optional `--results-dir` flag. If the directory exists and
 * contains all expected AgentResult files, the harness skips the spawn
 * request entirely and aggregates directly. Otherwise it writes the request
 * and exits 0 with a stderr message instructing the driver to fulfill the
 * spawns and re-invoke. See `scripts/plan-review-harness.ts`.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A single requested agent spawn. The driver MUST:
 *   1. Read `agentFile` to confirm it exists and pick up the frontmatter.
 *   2. Pass `model` on the Agent tool call (per CLAUDE.md model-resolution rule).
 *   3. Forward `subject` and any `extraInputs` to the agent's prompt.
 *   4. Write the resulting `AgentResult` envelope to
 *      `{resultDir}/{agentName}.toon`.
 */
export interface SpawnAgentSpec {
  /** Schema-side name; carried through to `findings.toon`'s `reviewerAgent` column. */
  agentName: string;
  /** Path to the actual agent definition file (relative to repo root). */
  agentFile: string;
  /** Model resolved from the agent file's frontmatter `model:` field. */
  model: string;
  /** Subject path the agent should read (the planning document). */
  subject: string;
  /** Optional additional inputs the driver passes through verbatim. */
  extraInputs?: Record<string, string>;
}

/** Top-level spawn-request envelope written to disk. */
export interface SpawnAgentRequest {
  /** UUID or content-derived hash. The driver may use this for idempotency. */
  requestId: string;
  /** Path of the script that wrote this request (relative to repo root). */
  requestedBy: string;
  /** ISO 8601 ms-precision timestamp (locked W-01). */
  createdAt: string;
  /** Spawns the driver must fulfill, in order. */
  spawns: SpawnAgentSpec[];
  /** Directory where the driver must write each AgentResult. */
  resultDir: string;
  /** Exact bash command the driver re-runs after fulfillment. */
  rerunCommand: string;
}

/** Function signature for the optional test-only `_writeFileImpl` seam. */
export type WriteFileImpl = (args: {
  absPath: string;
  bytes: Buffer;
}) => void;

/** Options accepted by {@link writeSpawnRequest}. */
export interface WriteSpawnRequestOptions {
  /** Test-only seam: replace the atomic-write primitive. */
  _writeFileImpl?: WriteFileImpl;
}

// ---------------------------------------------------------------------------
// Encoder
// ---------------------------------------------------------------------------

/** CSV-safe quoting for typed-array rows (RFC 4180 rules). */
function csvQuote(raw: string): string {
  if (raw === "") return "";
  if (/[,\n"]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

/**
 * Encode `extraInputs` as a JSON object string for embedding in a typed-array
 * cell. The driver parses this back to an object. Empty object encodes to ``.
 */
function encodeExtraInputs(input?: Record<string, string>): string {
  if (!input || Object.keys(input).length === 0) return "";
  return JSON.stringify(input);
}

/** Encode a `SpawnAgentRequest` as TOON text. */
export function encodeSpawnRequestToToon(request: SpawnAgentRequest): string {
  const header = [
    `requestId: ${request.requestId}`,
    `requestedBy: ${request.requestedBy}`,
    `createdAt: ${request.createdAt}`,
    `resultDir: ${request.resultDir}`,
    `rerunCommand: ${csvQuote(request.rerunCommand)}`,
    "",
  ];

  const arrayHeader = `spawns[${request.spawns.length}]{agentName,agentFile,model,subject,extraInputs}:`;
  const rows = request.spawns.map((s) => {
    const cells = [
      s.agentName,
      s.agentFile,
      s.model,
      s.subject,
      encodeExtraInputs(s.extraInputs),
    ].map(csvQuote);
    return `  ${cells.join(",")}`;
  });

  return [...header, arrayHeader, ...rows, ""].join("\n");
}

// ---------------------------------------------------------------------------
// Atomic write
// ---------------------------------------------------------------------------

/**
 * Production atomic-write implementation: write to `.tmp`, then rename.
 * The rename is atomic on POSIX filesystems for files on the same volume.
 */
const defaultWriteFile: WriteFileImpl = ({ absPath, bytes }) => {
  const tmp = `${absPath}.tmp`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, absPath);
};

/**
 * Write a `SpawnAgentRequest` atomically to `filePath`. The parent directory
 * is created with `mkdir -p` semantics if it does not yet exist.
 *
 * This function is the SOLE writer of spawn-request TOON files. Callers
 * (notably `scripts/plan-review-harness.ts`) MUST use it instead of writing
 * TOON by hand — it guarantees the on-disk format matches the schema.
 *
 * The driver's responsibility (NOT this function's): read the request, spawn
 * each agent via its Agent tool, write each AgentResult to
 * `{resultDir}/{agentName}.toon`, then re-invoke `rerunCommand`.
 */
export function writeSpawnRequest(
  request: SpawnAgentRequest,
  filePath: string,
  options: WriteSpawnRequestOptions = {},
): void {
  const { _writeFileImpl = defaultWriteFile } = options;
  const absPath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const bytes = Buffer.from(encodeSpawnRequestToToon(request), "utf8");
  _writeFileImpl({ absPath, bytes });
}
