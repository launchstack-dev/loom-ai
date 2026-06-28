---
description: "Author throwaway code as a deliberate phase. Two branches: logic (terminal app) or ui (parallel UI variants on one route). Slots in between loom-roadmap and loom-plan."
---

## Command: loom-prototype

You scaffold and complete throwaway prototype experiments — code written expressly to answer a question and then discarded. Prototypes have **no polish, no tests, no persistence** — those are explicit non-features.

The vocabulary follows `protocols/codebase-design.md`: prototypes expose a **Seam** in the design so the production Module can be deep (high **Depth**) before the first line of production code is written.

### Arguments

| Argument | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `<name>` | string | yes | — | kebab-case prototype name. Must match `^[a-z][a-z0-9-]*$`. |
| `--branch <logic\|ui>` | enum | yes | — | Branch type. `logic` = terminal app; `ui` = parallel UI variants on one route. |
| `--adr <ADR-NNNN>` | string | no | — | Originating ADR slug (e.g., `ADR-0001`). If provided, the completion ceremony appends a `prototypeAnswer:` line to the referenced ADR file. |

### Error codes

| Exit | Code | When |
|------|------|------|
| 1 | `PROTOTYPE_EXISTS` | `prototypes/{name}/` already exists. |
| 2 | `ADR_NOT_FOUND` | `--adr` was passed but the ADR file does not exist under `docs/adr/`. |

### Instructions

#### Step 0: Parse and validate

1. Extract `<name>`, `--branch`, and `--adr` from the remaining args.
2. Validate `<name>` matches `^[a-z][a-z0-9-]*$`. If not: print "Prototype name must be kebab-case (e.g. my-experiment)." and exit 1.
3. Validate `--branch` is one of `logic` or `ui`. If not: print "Unknown branch. Use --branch logic or --branch ui." and exit 1.
4. If `prototypes/{name}/` already exists: print "Prototype '{name}' already exists. Delete it first or choose a different name." and exit 1 (`PROTOTYPE_EXISTS`).
5. If `--adr <ADR-NNNN>` was passed, resolve the ADR file:
   - Search `docs/adr/` for a file matching `{ADR-NNNN}-*.md` (case-insensitive prefix match on the slug).
   - If not found: print "ADR file not found for '{ADR-NNNN}' under docs/adr/." and exit 2 (`ADR_NOT_FOUND`).

#### Step 1: Scaffold the prototype directory

Create `prototypes/{name}/` with the following files:

**`prototypes/{name}/README.md`** (throwaway banner):
```markdown
# Prototype: {name}

> **THROWAWAY** — This prototype exists to answer one question. Delete when done.

Branch: {branch}
{If --adr: ADR: {ADR-NNNN}}

## The question

<!-- What question is this prototype answering? Fill this in. -->

## How to run

{See run command below}

## What to look for

<!-- What would "yes" look like? What would "no" look like? -->
```

**For `--branch logic`** — scaffold a minimal terminal app:

`prototypes/{name}/index.ts`:
```typescript
/**
 * THROWAWAY prototype: {name}
 * No polish, no tests, no persistence.
 * Run: bun run prototypes/{name}/index.ts
 */

async function main() {
  console.log("Prototype: {name}");
  // TODO: implement the logic experiment
}

main().catch(console.error);
```

**For `--branch ui`** — scaffold parallel UI variant files on one route:

`prototypes/{name}/variant-a.tsx`:
```tsx
/**
 * THROWAWAY prototype: {name} — Variant A
 * No polish, no tests, no persistence.
 */
export function VariantA() {
  return <div>Variant A — {name}</div>;
}
```

`prototypes/{name}/variant-b.tsx`:
```tsx
/**
 * THROWAWAY prototype: {name} — Variant B
 * No polish, no tests, no persistence.
 */
export function VariantB() {
  return <div>Variant B — {name}</div>;
}
```

`prototypes/{name}/route.tsx`:
```tsx
/**
 * THROWAWAY prototype: {name} — Route harness
 * Swap between VariantA and VariantB by toggling the import below.
 */
import { VariantA as Active } from "./variant-a";
// import { VariantB as Active } from "./variant-b";

export default function PrototypePage() {
  return <Active />;
}
```

**`prototypes/{name}/.prototype-meta.toon`** (machine-readable metadata):
```toon
name: {name}
branch: {branch}
throwaway: true
status: active
{If --adr: adrRef: {ADR-NNNN}}
createdAt: {ISO timestamp}
runCommand: {bun run prototypes/{name}/index.ts | bun dev (see README)}
```

Print to stdout:
```
Prototype '{name}' scaffolded at prototypes/{name}/
Run: {runCommand}
Signal completion with: /loom-prototype {name} --complete{If --adr:  --adr {ADR-NNNN}}
```

#### Step 2: Completion ceremony (when operator signals done)

The completion ceremony runs when the operator passes `--complete` (or when an agent calls `scripts/loom-prototype/completion-ceremony.ts` directly).

> **Note:** `--complete` is a separate invocation from the scaffold step above. Operators run it after they have finished the experiment and are ready to capture the answer.

**Step 2a: Check for duplicate completion.** If `prototypes/{name}/answer.toon` already exists, exit 1 with: "Prototype '{name}' already completed. answer.toon exists."

**Step 2b: Prompt for the answer.** If running interactively: ask "What did you learn? (one line)". If `--answer "<text>"` was passed, use that text directly.

**Step 2c: Invoke the completion ceremony script:**
```bash
bunx tsx scripts/loom-prototype/completion-ceremony.ts \
  --name {name} \
  --answer "<answer text>" \
  {If --adr: --adr {ADR-NNNN}}
```

If `bun` is not available, fall back to `npx tsx`.

The script writes `prototypes/{name}/answer.toon` and, if `--adr` is set, appends the `prototypeAnswer:` line to the referenced ADR file.

**Step 2d: Print the done state to stdout:**
```
Prototype '{name}' complete.
answer.toon written to prototypes/{name}/answer.toon
{If --adr: ADR {ADR-NNNN} updated with prototypeAnswer.}
The prototype directory is safe to delete: rm -rf prototypes/{name}/
```

#### Step 3: Suggest next steps

After scaffold (Step 1):
```
Next steps:
  1. Edit prototypes/{name}/README.md — fill in "the question" and "what to look for"
  2. Run: {runCommand}
  3. When done: /loom-prototype {name} --complete{If --adr:  --adr {ADR-NNNN}} --answer "your one-line finding"
```

After completion (Step 2):
```
Next steps:
  1. Review prototypes/{name}/answer.toon
  {If --adr: 2. Review the updated ADR at docs/adr/{ADR-NNNN}-*.md}
  3. Carry the finding into /loom-plan create or /loom-roadmap refine
  4. Delete the prototype: rm -rf prototypes/{name}/
```
