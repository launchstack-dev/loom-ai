export default {
  test: {
    exclude: [
      "**/node_modules/**",
      ".worktrees/**",
      "test/e2e/pass2-seeded-failure/**",
      // Sub-project with its own vitest config + deps (ajv, @toon-format/toon);
      // run via `cd test/protocol && bunx vitest run`.
      "test/protocol/**",
      // Test fixtures that import `bun:test`, not meant for the root runner.
      "test/fixtures/**",
      // Uses Bun.spawnSync — only runnable under `bun test`, not `bunx vitest`.
      "test/debug-harness.test.ts",
    ],
    // Many hook tests spawn `npx tsx <hook>` as a subprocess (cold-start each).
    // Under parallel test workers this can exceed vitest's 5s default. The hooks
    // themselves are fast — the latency is npm/npx/node startup under load.
    testTimeout: 30_000,
    // Serialize test FILES (tests within a file still run in parallel). Without
    // this, dozens of files each spawn `bunx tsx <hook>` concurrently and the
    // subprocess coldstarts race — hooks exit 1 from transient resource pressure,
    // producing ~39 spurious failures that all pass in isolation.
    fileParallelism: false,
  },
};
