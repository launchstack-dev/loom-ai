/**
 * Phase 1 stand-in: actually apply Rule 12 + Rule 13 migrations to disk.
 * Writes v3 files atomically (.tmp + rename). Backup already done by caller.
 *
 * Rule 12: install-state.toon v2 → v3 (per-file sha256 + components[])
 * Rule 13: library.yaml v2 → v3 (loomCoreVersion/hooksVersion/releases[])
 *
 * Pure-function migrators do the transformation; this script is the
 * imperative runtime caller that Phase 1 will eventually formalize.
 */

import { readFileSync, writeFileSync, renameSync, statSync } from "node:fs";
import { createHash } from "node:crypto";

import { parseToon, parseToonArray } from "../hooks/lib/toon-reader.js";
import {
  detectInstallStateVersion,
  migrateInstallStateV2ToV3,
  type InstallStateV2,
  type InstallStateV2Item,
} from "../hooks/lib/install-state-migrator.js";
import {
  detectLibraryCatalogVersion,
  migrateLibraryCatalogV2ToV3,
  type LibraryCatalogV2,
} from "../hooks/lib/library-catalog-migrator.js";

const HOME = process.env.HOME ?? "";
const STATE_PATH = `${HOME}/.claude/skills/library/install-state.toon`;
const CATALOG_PATH = `${HOME}/.claude/skills/library/library.yaml`;

function atomicWrite(path: string, content: string) {
  const tmp = path + ".tmp";
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, path);
}

// ─────────────────────────────────────────────────────────────────────
// Rule 12: install-state v2 → v3
// ─────────────────────────────────────────────────────────────────────

console.log("\n=== Rule 12: install-state.toon v2 → v3 ===");
const stateContent = readFileSync(STATE_PATH, "utf-8");
const stateDetection = detectInstallStateVersion(stateContent);
console.log(`Detection: ${JSON.stringify(stateDetection)}`);

if (stateDetection.outdated) {
  const scalars = parseToon(stateContent);
  const items = parseToonArray(stateContent, "items") as unknown as InstallStateV2Item[];
  const v2: InstallStateV2 = {
    schemaVersion: 2,
    lastSynced: String(scalars["lastSynced"]),
    items,
  };

  const warnings: string[] = [];
  let readable = 0;
  let unreadable = 0;
  const v3 = migrateInstallStateV2ToV3(v2, {
    sha256Resolver: (p) => {
      try {
        const h = createHash("sha256").update(readFileSync(p)).digest("hex");
        readable++;
        return h;
      } catch {
        unreadable++;
        return null;
      }
    },
    onWarning: (m) => warnings.push(m),
  });

  // Serialize to TOON
  let toon = `schemaVersion: ${v3.schemaVersion}\n`;
  toon += `protocolVersion: ${v3.protocolVersion}\n`;
  toon += `lastSynced: ${v3.lastSynced}\n`;
  toon += `loomCoreVersion: ${v3.loomCoreVersion}\n`;
  toon += `loomHooksVersion: ${v3.loomHooksVersion}\n`;
  toon += `catalogVersion: ${v3.catalogVersion}\n\n`;
  toon += `components[${v3.components.length}]{name,version,kind,pinned,installedAt}:\n`;
  for (const c of v3.components) {
    toon += `  ${c.name},${c.version},${c.kind},${c.pinned},${c.installedAt}\n`;
  }
  toon += `\nitems[${v3.items.length}]{name,type,source,targetPath,sha256,component,installedAt}:\n`;
  for (const i of v3.items) {
    toon += `  ${i.name},${i.type},${i.source},${i.targetPath},${i.sha256},${i.component},${i.installedAt}\n`;
  }

  atomicWrite(STATE_PATH, toon);
  console.log(`✓ wrote v3: ${v3.items.length} items (${readable} readable, ${unreadable} unreadable)`);
  if (warnings.length) console.log(`  warnings: ${warnings.length} (first: ${warnings[0].slice(0, 80)}...)`);
} else {
  console.log("(already current — skipping)");
}

// ─────────────────────────────────────────────────────────────────────
// Rule 13: library.yaml v2 → v3
// ─────────────────────────────────────────────────────────────────────

console.log("\n=== Rule 13: library.yaml v2 → v3 ===");
const catalogContent = readFileSync(CATALOG_PATH, "utf-8");
const catDetection = detectLibraryCatalogVersion(catalogContent);
console.log(`Detection: ${JSON.stringify(catDetection)}`);

if (catDetection.outdated) {
  // Read freshly-written v3 install-state for versions (per Rule 12→13 ordering)
  const freshState = readFileSync(STATE_PATH, "utf-8");
  const freshScalars = parseToon(freshState);
  const coreVersion = String(freshScalars["loomCoreVersion"] ?? "0.0.0");
  const hooksVersion = String(freshScalars["loomHooksVersion"] ?? "0.0.0");

  // Hand-built v2 — parse the relevant top-level fields. YAML isn't a TOON parser,
  // so we extract `repo` line and pass the rest of the file through verbatim as opaque blobs.
  const repoMatch = /^repo:\s*(.+)$/m.exec(catalogContent);
  const repo = repoMatch ? repoMatch[1].trim() : "https://github.com/launchstack-dev/loom-ai";

  const v2: LibraryCatalogV2 = {
    catalog_version: 2,
    repo,
    default_dirs: {},  // passthrough placeholder
    library: {},        // passthrough placeholder
    kits: [],
  };

  const v3 = migrateLibraryCatalogV2ToV3(v2, {
    coreVersion,
    hooksVersion,
    // No initialRelease — pre-1.0 catalog, no signed releases exist yet
  });

  // Write v3 by patching the v2 YAML text: add top-level fields after catalog_version
  // and add releases:[] after them. Preserves default_dirs, library, kits blocks verbatim.
  const v3Yaml = catalogContent.replace(
    /^catalog_version:\s*2/m,
    `catalog_version: 3\nloomCoreVersion: ${v3.loomCoreVersion}\nloomHooksVersion: ${v3.loomHooksVersion}\n\nreleases: []  # populated by future signed-release pipeline`
  );

  atomicWrite(CATALOG_PATH, v3Yaml);
  console.log(`✓ wrote v3 catalog: loomCoreVersion=${v3.loomCoreVersion}, loomHooksVersion=${v3.loomHooksVersion}, releases=[]`);
} else {
  console.log("(already current — skipping)");
}

// ─────────────────────────────────────────────────────────────────────
// Verify
// ─────────────────────────────────────────────────────────────────────

console.log("\n=== Verify ===");
const stateAfter = detectInstallStateVersion(readFileSync(STATE_PATH, "utf-8"));
const catAfter = detectLibraryCatalogVersion(readFileSync(CATALOG_PATH, "utf-8"));
console.log(`install-state: ${JSON.stringify(stateAfter)}`);
console.log(`library.yaml:  ${JSON.stringify(catAfter)}`);
console.log(stateAfter.outdated || catAfter.outdated ? "\nFAILED: still outdated" : "\n✓ both files now v3");
