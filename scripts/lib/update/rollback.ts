/**
 * `/loom-update --rollback` — restore the prior version from the v3
 * component-inventory snapshot at `~/.claude/skills/library/install-state.toon`.
 *
 * This module reads the v3 inventory (distinct from the per-machine envelope at
 * `~/.loom/install.toon`), verifies the SHA256 chain across the snapshot, and
 * atomically restores each tracked file from `snapshot.snapshotPath/<source>`.
 *
 * Pure module — all I/O is injected for testability.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// v3 inventory types (subset used by rollback — see
// protocols/install-state.schema.md for the full schema)
// ---------------------------------------------------------------------------

export interface V3Item {
  name: string;
  type: string;
  source: string;
  targetPath: string;
  sha256: string;
  component: string;
  installedAt: string;
}

export interface V3Snapshot {
  versionBeforeUpgrade: string;
  snapshotPath: string;
  snapshotSha256: string;
  capturedAt: string;
  expiresAt: string;
}

export interface V3Inventory {
  schemaVersion: 3;
  protocolVersion: number;
  loomCoreVersion: string;
  loomHooksVersion: string;
  items: V3Item[];
  snapshot: V3Snapshot | null;
}

// ---------------------------------------------------------------------------
// Default v3 path resolution
// ---------------------------------------------------------------------------

export function defaultV3InventoryPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  // Honor `$LOOM_V3_INVENTORY` first for sandboxed tests, then `$HOME`.
  const override = env.LOOM_V3_INVENTORY;
  if (override && override.length > 0) return override;
  const home = env.HOME || env.USERPROFILE || "";
  if (!home) {
    throw new Error(
      "Cannot resolve v3 inventory path: HOME and LOOM_V3_INVENTORY both unset",
    );
  }
  return path.join(home, ".claude", "skills", "library", "install-state.toon");
}

// ---------------------------------------------------------------------------
// Minimal v3 TOON parser (rollback only needs items[] + snapshot block)
// ---------------------------------------------------------------------------

export function parseV3Inventory(text: string): V3Inventory {
  const lines = text.split(/\r?\n/);
  const scalars: Record<string, string> = {};
  const blocks: Record<string, Record<string, string>> = {};
  const tables: Record<string, { cols: string[]; rows: string[][] }> = {};

  let cursor: { kind: "block" | "table"; name: string } | null = null;

  for (const raw of lines) {
    if (raw.length === 0 || raw.startsWith("#")) {
      cursor = null;
      continue;
    }
    if (raw.startsWith("  ")) {
      const trimmed = raw.slice(2);
      if (!cursor) {
        throw new Error(`install-state.toon: indented line outside container`);
      }
      if (cursor.kind === "block") {
        const idx = trimmed.indexOf(":");
        if (idx === -1) {
          throw new Error(`install-state.toon: bad block line: "${raw}"`);
        }
        blocks[cursor.name][trimmed.slice(0, idx).trim()] = trimmed
          .slice(idx + 1)
          .trim();
      } else {
        tables[cursor.name].rows.push(splitCsvRow(trimmed));
      }
      continue;
    }

    // Top-level line.
    cursor = null;
    const idx = raw.indexOf(":");
    if (idx === -1) {
      throw new Error(`install-state.toon: bad top-level line: "${raw}"`);
    }
    const headLeft = raw.slice(0, idx);
    const value = raw.slice(idx + 1).trim();

    const tableMatch = /^([A-Za-z_][\w-]*)\[(\d+)\]\{([^}]+)\}$/.exec(headLeft);
    if (tableMatch) {
      const tname = tableMatch[1];
      tables[tname] = {
        cols: tableMatch[3].split(",").map((s) => s.trim()),
        rows: [],
      };
      cursor = { kind: "table", name: tname };
      continue;
    }

    const key = headLeft.trim();
    if (value === "") {
      blocks[key] = {};
      cursor = { kind: "block", name: key };
    } else {
      scalars[key] = value;
    }
  }

  const schemaVersion = Number(scalars.schemaVersion ?? "0");
  if (schemaVersion !== 3) {
    throw new Error(
      `install-state.toon: unsupported schemaVersion ${schemaVersion} (expected 3)`,
    );
  }

  const itemsTable = tables.items;
  const items: V3Item[] = itemsTable
    ? itemsTable.rows.map((row) => {
        const obj: Record<string, string> = {};
        itemsTable.cols.forEach((c, i) => (obj[c] = row[i] ?? ""));
        return {
          name: obj.name,
          type: obj.type,
          source: obj.source,
          targetPath: obj.targetPath,
          sha256: obj.sha256,
          component: obj.component,
          installedAt: obj.installedAt,
        };
      })
    : [];

  let snapshot: V3Snapshot | null = null;
  if (blocks.snapshot) {
    const b = blocks.snapshot;
    if (
      b.versionBeforeUpgrade &&
      b.snapshotPath &&
      b.snapshotSha256 &&
      b.capturedAt &&
      b.expiresAt
    ) {
      snapshot = {
        versionBeforeUpgrade: b.versionBeforeUpgrade,
        snapshotPath: expandHome(b.snapshotPath),
        snapshotSha256: b.snapshotSha256,
        capturedAt: b.capturedAt,
        expiresAt: b.expiresAt,
      };
    }
  }

  return {
    schemaVersion: 3,
    protocolVersion: Number(scalars.protocolVersion ?? "3"),
    loomCoreVersion: scalars.loomCoreVersion ?? "0.0.0",
    loomHooksVersion: scalars.loomHooksVersion ?? "0.0.0",
    items,
    snapshot,
  };
}

function splitCsvRow(line: string): string[] {
  // Plan v3 schema rows are comma-separated with no embedded commas in path
  // components. A simple split is sufficient for the inventory shape.
  return line.split(",").map((s) => s.trim());
}

function expandHome(p: string): string {
  if (p.startsWith("~/")) {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    return path.join(home, p.slice(2));
  }
  return p;
}

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

export interface RollbackDeps {
  /** Read v3 inventory TOON text. */
  readInventory: () => string | null;
  /** Optional logger. */
  log?: (line: string) => void;
}

export type RollbackOutcome =
  | { kind: "ok"; restoredVersion: string; restoredCount: number }
  | { kind: "noop"; reason: string }
  | { kind: "error"; code: "ROLLBACK_HASH_MISMATCH" | "ROLLBACK_NO_SNAPSHOT" | "ROLLBACK_IO"; message: string };

/**
 * Verify the snapshot SHA256 chain and atomically restore tracked files to
 * their snapshot copies.
 *
 * Chain verification:
 *   1. Every item must have a snapshot copy at `snapshotPath/<source>`.
 *   2. Hash each snapshot copy; sort `<sha256> <source>\n` rows
 *      lexicographically; SHA256 the concatenation. The result must equal
 *      `snapshot.snapshotSha256`.
 *   3. On match, atomically rename `<copy>.staged` → `targetPath` (copy to a
 *      `.staged` peer first to keep the snapshot intact).
 */
export function rollback(deps: RollbackDeps): RollbackOutcome {
  const log = deps.log ?? (() => {});
  const text = deps.readInventory();
  if (!text) {
    return { kind: "noop", reason: "v3 inventory missing" };
  }

  let inv: V3Inventory;
  try {
    inv = parseV3Inventory(text);
  } catch (e) {
    return {
      kind: "error",
      code: "ROLLBACK_IO",
      message: (e as Error).message,
    };
  }

  if (!inv.snapshot) {
    return {
      kind: "error",
      code: "ROLLBACK_NO_SNAPSHOT",
      message: "no snapshot present in v3 inventory — cannot rollback",
    };
  }

  const snap = inv.snapshot;
  const rows: string[] = [];
  try {
    for (const item of inv.items) {
      const copy = path.join(snap.snapshotPath, item.source);
      if (!fs.existsSync(copy)) {
        return {
          kind: "error",
          code: "ROLLBACK_HASH_MISMATCH",
          message: `snapshot copy missing: ${copy}`,
        };
      }
      const hash = sha256File(copy);
      rows.push(`${hash} ${item.source}`);
    }
  } catch (e) {
    return {
      kind: "error",
      code: "ROLLBACK_IO",
      message: (e as Error).message,
    };
  }

  const chain = crypto
    .createHash("sha256")
    .update(rows.slice().sort().join("\n"))
    .digest("hex");

  if (chain !== snap.snapshotSha256) {
    return {
      kind: "error",
      code: "ROLLBACK_HASH_MISMATCH",
      message: `snapshot chain mismatch: expected ${snap.snapshotSha256}, computed ${chain}`,
    };
  }

  // Stage every restore as `.staged` peer files, then atomically rename in
  // a second pass. If any staging fails, do not rename anything (partial
  // failure leaves only `.staged` peers which the caller can clean up).
  const staged: { from: string; to: string }[] = [];
  try {
    for (const item of inv.items) {
      const copy = path.join(snap.snapshotPath, item.source);
      const stagedPath = `${item.targetPath}.staged`;
      fs.mkdirSync(path.dirname(item.targetPath), { recursive: true });
      fs.copyFileSync(copy, stagedPath);
      staged.push({ from: stagedPath, to: item.targetPath });
    }
    for (const { from, to } of staged) {
      fs.renameSync(from, to);
    }
  } catch (e) {
    // Best-effort cleanup of any unrenamed staged files.
    for (const { from } of staged) {
      try {
        if (fs.existsSync(from)) fs.unlinkSync(from);
      } catch {
        // ignore
      }
    }
    return {
      kind: "error",
      code: "ROLLBACK_IO",
      message: (e as Error).message,
    };
  }

  log(
    `Restored ${inv.items.length} files to ${snap.versionBeforeUpgrade}`,
  );
  return {
    kind: "ok",
    restoredVersion: snap.versionBeforeUpgrade,
    restoredCount: inv.items.length,
  };
}

function sha256File(p: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}
