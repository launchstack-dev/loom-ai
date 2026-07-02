/**
 * lib/index.ts — barrel for the neutral shared core (PLAN-exceed-gstack
 * Phase 2b, C-02).
 *
 * The single import surface for BOTH hooks/ and scripts/. Importing this
 * barrel from either side resolves to the same modules — no duplication.
 * Reimplementing any of these exports outside lib/ is banned by lint
 * (eslint.config.js).
 *
 * Module registry: protocols/shared-core.schema.md (signatures FROZEN).
 */

// SharedCoreModule "toon" (Phase 2a)
export { parseToon, serializeToon, ToonParseError } from "./toon.js";

// SharedCoreModule "csv" (Phase 2a)
export { splitCsvLine, joinCsvLine } from "./csv.js";

// SharedCoreModule "atomic-fs" (Phase 2b)
export { atomicWrite, atomicWriteText } from "./atomic-fs.js";

// SharedCoreModule "entry-guard" (Phase 2b)
export { isMain } from "./entry-guard.js";

// Shared type contracts (Phase 0) — type-only, zero runtime cost.
export type * from "./types.js";
