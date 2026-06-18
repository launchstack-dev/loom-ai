#!/usr/bin/env -S bunx tsx
import {
  defaultPluginJsonPath,
  detectRuntimeVersion,
  runFirstRun,
} from './lib/first-run.js';

async function main(): Promise<void> {
  const outcome = await runFirstRun({
    env: process.env,
    now: () => new Date(),
    pluginJsonPath: defaultPluginJsonPath(),
    runtimeVersion: detectRuntimeVersion(),
  });
  if (outcome?.action) {
    process.stderr.write(`loom-first-run: ${outcome.action}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`loom-first-run failed: ${err?.message ?? err}\n`);
  process.exit(1);
});
