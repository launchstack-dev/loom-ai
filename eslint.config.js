"use strict";

/**
 * eslint.config.js — flat config carrying the C-02 shared-core ban
 * (PLAN-exceed-gstack Phase 2b, F-02, defect 8).
 *
 * `no-restricted-syntax` bans LOCAL reimplementations of the lib/ shared-core
 * primitives (CSV split/join, TOON parse/serialize, atomic write) outside
 * lib/. `no-restricted-imports` bans importing the known legacy duplicates
 * instead of lib/.
 *
 * Two-tier severity so `bunx eslint .` exits 0 against the current repo
 * while still hard-failing NEW divergence:
 *
 *   - error — any file outside lib/ and outside the legacy tier. A new file
 *     that reimplements a banned primitive fails the pr-gate lint job.
 *   - warn  — the pre-existing duplicates under hooks/** and scripts/**
 *     (plus the enumerated LEGACY_FILES below). Phases 11a/11b
 *     strangler-migrate these callers onto lib/ and delete the local
 *     copies; when a tier empties, flip it to error / delete its entry.
 *
 * Dependency note: parsing .ts requires `@typescript-eslint/parser`
 * (devDependency added by the wave wiring, alongside `eslint`). Until it is
 * installed the config degrades to JS-only linting with a loud warning —
 * this keeps the Phase 1 pr-gate lint job green (it was passing vacuously
 * before this config existed) instead of hard-failing on a missing module.
 */

let tsParser = null;
try {
  // eslint-disable-next-line no-undef
  tsParser = require("@typescript-eslint/parser");
} catch {
  // eslint-disable-next-line no-undef
  console.warn(
    "[eslint.config.js] @typescript-eslint/parser is not installed — the " +
      "C-02 shared-core ban is INACTIVE for .ts files. Run `bun install` " +
      "(eslint + @typescript-eslint/parser are devDependencies).",
  );
}

// ---------------------------------------------------------------------------
// Banned reimplementation name sets (C-02, protocols/shared-core.schema.md).
// Names observed in the legacy duplicates plus the sanctioned lib/ exports —
// declaring ANY of these outside lib/ is a reimplementation.
// ---------------------------------------------------------------------------

const CSV_NAMES =
  "splitCsv|splitCsvLine|splitCsvRow|splitCsvCells|parseCsvRow|parseCsvLine|joinCsv|joinCsvLine";
const TOON_NAMES =
  "parseToon|serializeToon|toonParse|toonSerialize|stringifyToon|toonStringify|renderToon|writeToon|toToon";
const ATOMIC_NAMES =
  "atomicWrite|atomicWriteText|writeAtomic|atomicWriteFile|writeFileAtomic";

const FN_DECL = (names) => `FunctionDeclaration[id.name=/^(${names})$/]`;
const FN_EXPR = (names) =>
  `VariableDeclarator[id.name=/^(${names})$/][init.type=/^(ArrowFunctionExpression|FunctionExpression)$/]`;

function banRules(severity) {
  return {
    "no-restricted-syntax": [
      severity,
      {
        selector: FN_DECL(CSV_NAMES),
        message:
          "C-02: local CSV splitters are banned outside lib/ — import { splitCsvLine, joinCsvLine } from lib/ (lib/csv.ts).",
      },
      {
        selector: FN_EXPR(CSV_NAMES),
        message:
          "C-02: local CSV splitters are banned outside lib/ — import { splitCsvLine, joinCsvLine } from lib/ (lib/csv.ts).",
      },
      {
        selector: FN_DECL(TOON_NAMES),
        message:
          "C-02: hand-rolled TOON parsers/serializers are banned outside lib/ — import { parseToon, serializeToon } from lib/ (lib/toon.ts).",
      },
      {
        selector: FN_EXPR(TOON_NAMES),
        message:
          "C-02: hand-rolled TOON parsers/serializers are banned outside lib/ — import { parseToon, serializeToon } from lib/ (lib/toon.ts).",
      },
      {
        selector: FN_DECL(ATOMIC_NAMES),
        message:
          "C-02: copy-pasted atomic writers are banned outside lib/ — import { atomicWrite, atomicWriteText } from lib/ (lib/atomic-fs.ts).",
      },
      {
        selector: FN_EXPR(ATOMIC_NAMES),
        message:
          "C-02: copy-pasted atomic writers are banned outside lib/ — import { atomicWrite, atomicWriteText } from lib/ (lib/atomic-fs.ts).",
      },
    ],
    "no-restricted-imports": [
      severity,
      {
        patterns: [
          {
            group: ["**/hooks/lib/toon-reader*", "./toon-reader*", "./lib/toon-reader*"],
            importNames: ["parseToon"],
            message:
              "C-02: import parseToon from lib/ (lib/toon.ts) — the hooks/lib/toon-reader.ts copy is strangled in Phase 11a.",
          },
          {
            group: ["**/loom-change/init*", "./init*"],
            importNames: ["atomicWriteText"],
            message:
              "C-02: import atomicWriteText from lib/ (lib/atomic-fs.ts) — the scripts/loom-change/init.ts copy is strangled in Phase 11b.",
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Legacy tier — pre-existing duplicates the Phase 11a/11b migrations shrink.
// Directory globs cover the bulk (hooks/**, scripts/**); LEGACY_FILES
// enumerates stragglers elsewhere. Remove entries as they are migrated.
// ---------------------------------------------------------------------------

const LEGACY_FILES = [
  // parseCsvRow duplicate (pre-dates lib/csv.ts)
  "tests/commands/loom-which.test.ts",
];

// ---------------------------------------------------------------------------
// Compat stub plugin — the repo carries `eslint-disable @typescript-eslint/*`
// directives written for editors running the full typescript-eslint plugin.
// This config deliberately loads only the parser (the C-02 ban needs no
// plugin rules), so those directives would otherwise error as "definition
// for rule not found". No-op definitions keep them resolvable.
// ---------------------------------------------------------------------------

const TS_STUB_RULE_NAMES = [
  "ban-types",
  "consistent-indexed-object-style",
  "no-empty-interface",
  "no-empty-object-type",
  "no-explicit-any",
  "no-extraneous-class",
  "no-redundant-type-constituents",
  "no-unnecessary-condition",
  "no-unused-vars",
  "no-var-requires",
  "unbound-method",
  "unified-signatures",
];

const tsStubPlugin = {
  meta: { name: "typescript-eslint-directive-compat" },
  rules: Object.fromEntries(
    TS_STUB_RULE_NAMES.map((name) => [
      name,
      { meta: { schema: [] }, create: () => ({}) },
    ]),
  ),
};

const tsConfigs = tsParser
  ? [
      // Parser for every .ts file (lib/ included — it must parse cleanly).
      {
        files: ["**/*.ts"],
        languageOptions: {
          parser: tsParser,
          ecmaVersion: "latest",
          sourceType: "module",
        },
        plugins: { "@typescript-eslint": tsStubPlugin },
        // The stub rules never fire, so their disable directives always look
        // "unused" — do not flag them.
        linterOptions: { reportUnusedDisableDirectives: "off" },
      },
      // New-divergence tier: error everywhere outside lib/.
      {
        files: ["**/*.ts"],
        ignores: ["lib/**"],
        rules: banRules("error"),
      },
      // Legacy tier: warn until Phases 11a/11b delete the duplicates.
      {
        files: ["hooks/**/*.ts", "scripts/**/*.ts", ...LEGACY_FILES],
        rules: banRules("warn"),
      },
    ]
  : [];

module.exports = [
  {
    ignores: [
      "node_modules/**",
      "**/node_modules/**",
      ".worktrees/**",
      "dist/**",
      "**/dist/**",
      "coverage/**",
      ".plan-execution/**",
      // Fixture/sub-project trees with their own toolchains and deliberate
      // divergence (canned harnesses, seeded failures, sample apps).
      "test-fixtures/**",
      "test/fixtures/**",
      "test/e2e/**",
      "test/protocol/**",
      "tests/fixtures/**",
    ],
  },
  // Plain JS/CJS (espree). Repo has no "type" field — .js is CommonJS.
  {
    files: ["**/*.js", "**/*.cjs"],
    languageOptions: { ecmaVersion: "latest", sourceType: "commonjs" },
    rules: banRules("error"),
  },
  {
    files: ["**/*.mjs"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module" },
    rules: banRules("error"),
  },
  // Legacy tier for JS under the legacy dirs.
  {
    files: [
      "hooks/**/*.js",
      "hooks/**/*.cjs",
      "scripts/**/*.js",
      "scripts/**/*.cjs",
    ],
    rules: banRules("warn"),
  },
  ...tsConfigs,
];
