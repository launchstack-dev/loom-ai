# Rubric: Tool Selection

The Tech Stack section locks the strategic technology choices — runtime, language, framework, database, test runner, and key dependencies — before phase planning begins. A strong tool selection names each choice with a version constraint and a one-line purpose, so reviewers can see *why* each tool earns its place. Tool selection is not "the list of everything we'll npm-install" — it is the small set of architectural commitments that constrain every downstream plan phase.

## Green

> "| Layer | Technology | Version | Purpose |
> |-------|-----------|---------|---------|
> | Runtime | Node.js | 20+ | Server runtime with stable test support |
> | Language | TypeScript | 5.x | Type safety across API surface |
> | Framework | Express | 4.18 | Minimal HTTP server; no heavy abstractions |
> | Database | SQLite via better-sqlite3 | latest | Embedded, local-first, single-file backup |
> | Testing | Vitest | latest | Faster than Jest, native ESM, TS-first |
> | Validation | Zod | 3.x | Runtime schema validation reused by tests |"

This is green because every entry names the layer, the concrete technology, a version pin, and a purpose tied to the project's vision (e.g., "local-first" in the database row mirrors the privacy-first vision). The purpose column makes the tradeoffs legible — a reviewer can ask "why Express over Fastify?" and the document has already answered "minimal HTTP server; no heavy abstractions." Versions are bounded enough to constrain `package.json` resolution without over-pinning patch versions.

## Yellow

> "| Layer | Technology |
> |-------|-----------|
> | Backend | Node.js + TypeScript |
> | DB | Postgres or SQLite |
> | Tests | Whatever the team picks |"

This is yellow because the structure exists but the commitments are absent. "Postgres or SQLite" is a deferred decision masquerading as a choice — downstream phases cannot generate a schema until one is picked. "Whatever the team picks" pushes a tool-selection decision into execution time, which is exactly when it is most expensive to revise. Purposes and versions are missing. Reviewer should echo: "every Tech Stack row must commit to one technology with a version constraint and a one-line purpose; defer-or-decide language belongs in Open Questions, not in the locked stack."

## Red

> "We'll use modern tools and best practices."

This is red because no technology is named at any layer. There is no table, no version, no purpose. Downstream agents (contracts-agent, verification-agent) cannot generate type files, database migrations, or test commands because they have nothing to read. The Constraints & Decisions section cannot reference the stack because there is no stack to reference. Reviewer must mark as blocking — the roadmap is structurally incomplete until at least the runtime, language, and primary data store are named.


## Prescribe-to-10

If this dimension scored below 10, the reviewer MUST include specific prescriptive text: "To reach 10, this roadmap should <specific action>." No vague guidance — name the exact fix.
