/**
 * Dogfood test: run the v2→v3 migrator against this machine's real
 * `~/.claude/skills/library/install-state.toon`. READ-ONLY — never writes the
 * migrated v3 file back to disk. Prints detection, the v3 output, and the
 * warning stream so you can see exactly what a real `/loom-upgrade --project`
 * would do once Phase 1 wires the runtime.
 */

import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { parseToon, parseToonArray } from "../hooks/lib/toon-reader.js";
import {
  detectInstallStateVersion,
  migrateInstallStateV2ToV3,
  type InstallStateV2,
  type InstallStateV2Item,
} from "../hooks/lib/install-state-migrator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const HOME = process.env.HOME ?? "";
const STATE_PATH = `${HOME}/.claude/skills/library/install-state.toon`;

function header(label: string) {
  console.log("\n" + "─".repeat(70));
  console.log(label);
  console.log("─".repeat(70));
}

// 1. Read the on-disk v2 file
header("1. Reading " + STATE_PATH);
let content: string;
try {
  content = readFileSync(STATE_PATH, "utf-8");
  const size = statSync(STATE_PATH).size;
  console.log(`Size: ${size} bytes`);
} catch (err) {
  console.error("Could not read install-state.toon:", (err as Error).message);
  process.exit(1);
}

// 2. Detection
header("2. Detection");
const detection = detectInstallStateVersion(content);
console.log(JSON.stringify(detection, null, 2));

if (!detection.outdated) {
  console.log("\nNothing to migrate. Exiting.");
  process.exit(0);
}

// 3. Parse v2
header("3. Parsing v2 structure");
const scalars = parseToon(content);
const itemsRaw = parseToonArray(content, "items") as unknown as InstallStateV2Item[];
console.log(`Top-level scalars: ${Object.keys(scalars).join(", ")}`);
console.log(`items[] count: ${itemsRaw.length}`);

const v2: InstallStateV2 = {
  schemaVersion: 2,
  lastSynced: String(scalars["lastSynced"] ?? ""),
  items: itemsRaw,
};

// 4. Run migrator
header("4. Running migrateInstallStateV2ToV3 (real sha256, warnings collected)");

const warnings: string[] = [];
let unreadable = 0;
let readable = 0;

const v3 = migrateInstallStateV2ToV3(v2, {
  sha256Resolver: (path: string) => {
    try {
      const buf = readFileSync(path);
      readable++;
      return createHash("sha256").update(buf).digest("hex");
    } catch {
      unreadable++;
      return null;
    }
  },
  onWarning: (msg: string) => warnings.push(msg),
  // Real version values for this machine — leave loomCoreVersion/loomHooksVersion
  // as placeholder defaults since Phase 1 hasn't shipped real versioned releases yet.
});

console.log(`Items processed: ${v3.items.length}`);
console.log(`  readable (sha256 computed): ${readable}`);
console.log(`  unreadable (sha256 = ""):   ${unreadable}`);
console.log(`Warnings: ${warnings.length}`);

// 5. Show migrated structure (truncated)
header("5. Migrated v3 (top-level fields + first 3 items + first component)");
const preview = {
  schemaVersion: v3.schemaVersion,
  protocolVersion: v3.protocolVersion,
  lastSynced: v3.lastSynced,
  loomCoreVersion: v3.loomCoreVersion,
  loomHooksVersion: v3.loomHooksVersion,
  catalogVersion: v3.catalogVersion,
  components: v3.components,
  itemsCount: v3.items.length,
  firstThreeItems: v3.items.slice(0, 3),
};
console.log(JSON.stringify(preview, null, 2));

// 6. Show first few warnings
if (warnings.length > 0) {
  header("6. First 10 warnings (unreadable targetPaths)");
  warnings.slice(0, 10).forEach((w) => console.log("  • " + w));
  if (warnings.length > 10) {
    console.log(`  ... ${warnings.length - 10} more`);
  }
}

// 7. Spot-check correctness invariants
header("7. Invariants");
const allHaveSha = v3.items.every((i) => typeof i.sha256 === "string");
const allLoomCore = v3.items.every((i) => i.component === "loom-core");
const installedAtPreserved = v3.items.every(
  (i, idx) => i.installedAt === v2.items[idx].installedAt
);
const componentsCount = v3.components.length;
console.log(`  all items have sha256 field (string): ${allHaveSha}`);
console.log(`  all items.component === "loom-core":  ${allLoomCore}`);
console.log(`  installedAt preserved per item:        ${installedAtPreserved}`);
console.log(`  components[].length:                   ${componentsCount} (expected 1 for v2→v3)`);

header("DONE — install-state was NOT modified");
console.log("To actually migrate, Phase 1 must ship a runtime caller for the migrator.");
console.log("See PLAN-oss-launch.md.\n");
