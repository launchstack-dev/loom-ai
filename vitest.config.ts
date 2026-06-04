export default {
  test: {
    exclude: [
      "**/node_modules/**",
      ".worktrees/**",
      "test/e2e/pass2-seeded-failure/**",
    ],
    // Many hook tests spawn `npx tsx <hook>` as a subprocess (cold-start each).
    // Under parallel test workers this can exceed vitest's 5s default. The hooks
    // themselves are fast — the latency is npm/npx/node startup under load.
    testTimeout: 30_000,
  },
};
