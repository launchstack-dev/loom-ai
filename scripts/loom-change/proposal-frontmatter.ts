/**
 * proposal.md frontmatter reader for the /loom-change query subcommands.
 *
 * The proposal file is the durable, authoritative record per
 * change-proposal.schema.md. It opens with a fenced ` ```toon ` code block
 * holding the ChangeProposal frontmatter, followed by Markdown sections.
 *
 * This helper extracts the frontmatter block and parses the fields the query
 * commands need. It deliberately covers only the *read* path; Phase 6's
 * mutation subcommands are responsible for writing proposal.md and will own
 * their own emitter.
 *
 * Field names are LOCKED per Phase 0 (see plan-spec-upgrades.md):
 *   changeId, status, intent, scope, approach, affectedSpecs, deltas,
 *   linkedPlan, reviewedBy, reviewedAt, reviewNotes, approvedBy, approvedAt,
 *   createdAt, archivedAt.
 */

import { CHANGE_STATUSES, type ChangeStatus } from "../../hooks/lib/change-state.js";

export interface ProposalScope {
  included: string[];
  excluded: string[];
}

/**
 * Lightweight delta header — *just enough* for `/loom-change diff` to surface
 * counts and domains. The full DeltaBlock body lives in the Markdown beneath
 * the frontmatter and is not parsed by this helper; `diff.ts` parses those
 * body sections directly when it needs to render them.
 */
export interface ProposalFrontmatter {
  changeId: string;
  status: ChangeStatus | string;
  intent: string;
  scope: ProposalScope;
  approach: string;
  affectedSpecs: string[];
  linkedPlan: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  archivedAt: string | null;
}

/**
 * Extract the leading ` ```toon ` fenced block from a proposal.md document.
 *
 * Returns `null` when the file does not begin with a TOON frontmatter block
 * (callers should treat this as a parse error).
 */
export function extractFrontmatterBlock(raw: string): string | null {
  const lines = raw.split("\n");
  // Allow leading blank lines and comment lines before the fence.
  let i = 0;
  while (i < lines.length && /^\s*$/.test(lines[i])) i++;
  if (i >= lines.length) return null;
  if (!/^```\s*toon\s*$/.test(lines[i])) return null;
  const bodyLines: string[] = [];
  i++;
  while (i < lines.length) {
    if (/^```\s*$/.test(lines[i])) {
      return bodyLines.join("\n");
    }
    bodyLines.push(lines[i]);
    i++;
  }
  return null; // unclosed fence
}

/**
 * Parse proposal.md raw text into a typed ProposalFrontmatter.
 *
 * Throws when required fields are missing or malformed. Optional/nullable
 * fields default to `null` when the TOON value is empty (`key:` with nothing
 * after the colon).
 */
export function parseProposalFrontmatter(raw: string): ProposalFrontmatter {
  const block = extractFrontmatterBlock(raw);
  if (block === null) {
    throw new Error("proposal.md does not begin with a ```toon frontmatter block");
  }

  const lines = block.split("\n");
  const scalars = new Map<string, string>();
  const simpleArrays = new Map<string, string[]>();

  // Scope is nested:
  //   scope:
  //     included[N]: a, b, c
  //     excluded[N]: x, y
  // We track when we're inside the scope block to attach the included/excluded
  // arrays to it.
  let inScopeBlock = false;
  let scopeIncluded: string[] = [];
  let scopeExcluded: string[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Detect scope: opener.
    if (/^scope:\s*$/.test(trimmed)) {
      inScopeBlock = true;
      continue;
    }

    // Indented child of scope block.
    if (inScopeBlock && line.startsWith("  ")) {
      const inc = /^\s*included\[(\d+)\]\s*:\s*(.*)$/.exec(line);
      if (inc) {
        scopeIncluded = parseArrayValue(inc[2], Number(inc[1]));
        continue;
      }
      const exc = /^\s*excluded\[(\d+)\]\s*:\s*(.*)$/.exec(line);
      if (exc) {
        scopeExcluded = parseArrayValue(exc[2], Number(exc[1]));
        continue;
      }
      // Tolerate other indented lines under scope (forward-compat).
      continue;
    } else if (inScopeBlock && !line.startsWith("  ")) {
      inScopeBlock = false;
    }

    // Array header (simple): `name[N]: a, b, c`.
    const arrayHeader = /^([A-Za-z_][A-Za-z0-9_]*)\[(\d+)\]\s*:\s*(.*)$/.exec(trimmed);
    if (arrayHeader) {
      // Skip typed arrays — `name[N]{...}:` — proposal frontmatter shouldn't
      // have them at top level; if one appears, fall through silently.
      if (!arrayHeader[3].startsWith("{")) {
        const items = parseArrayValue(arrayHeader[3], Number(arrayHeader[2]));
        simpleArrays.set(arrayHeader[1], items);
        continue;
      }
    }

    // Flat scalar.
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    scalars.set(key, value);
  }

  const required = (name: string): string => {
    const v = scalars.get(name);
    if (v === undefined || v === "") {
      throw new Error(`proposal.md frontmatter missing required field '${name}'`);
    }
    return v;
  };

  const optional = (name: string): string | null => {
    const v = scalars.get(name);
    if (v === undefined || v === "") return null;
    return v;
  };

  const status = required("status");
  if (!(CHANGE_STATUSES as readonly string[]).includes(status)) {
    // Forward-compat: surface as a warning via the caller; don't hard-fail
    // here because the proposal might legitimately be in a future state we
    // don't know about (the schema is the spec; this code is not gatekeeper).
    // The caller is free to validate further.
  }

  return {
    changeId: required("changeId"),
    status,
    intent: required("intent"),
    scope: { included: scopeIncluded, excluded: scopeExcluded },
    approach: required("approach"),
    affectedSpecs: simpleArrays.get("affectedSpecs") ?? [],
    linkedPlan: optional("linkedPlan"),
    reviewedBy: optional("reviewedBy"),
    reviewedAt: optional("reviewedAt"),
    reviewNotes: optional("reviewNotes"),
    approvedBy: optional("approvedBy"),
    approvedAt: optional("approvedAt"),
    createdAt: required("createdAt"),
    archivedAt: optional("archivedAt"),
  };
}

function parseArrayValue(rest: string, declaredCount: number): string[] {
  if (declaredCount === 0) return [];
  const trimmed = rest.trim();
  if (trimmed.length === 0) return [];
  // Items are comma-separated; commas inside double-quotes are preserved.
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '"') {
      const next = trimmed[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.length > 0 || out.length < declaredCount) out.push(current.trim());
  return out.filter((s) => s.length > 0);
}
