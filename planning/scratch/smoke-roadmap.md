---
schemaVersion: 1
title: Smoke Test Roadmap — convergence-generalization Wave 5
created: 2026-06-13
purpose: throwaway target for /loom-plan create --autoconverge smoke verification
status: scratch
---

# Smoke Test Roadmap

## Vision
Verify the /loom-plan create --autoconverge wrapper resolves the document-mode loop end-to-end in a fresh session. Intentionally minimal so a single iteration converges
cheaply.

## Milestones

### M-01: Add a hello-world script
**Acceptance:** A scripts/hello.ts file exists that prints "hello world" when run with `bun run scripts/hello.ts`.

## Features

### F-01: hello.ts entry point
**Description:** A single TypeScript file that imports nothing and prints "hello world" to stdout.
**Acceptance:** `bun run scripts/hello.ts` exits 0 with stdout `hello world\n`.
