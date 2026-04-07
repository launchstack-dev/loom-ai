# Project Decisions

Locked decisions made during the discussion phase. Plan generation and execution
must honor these choices. To change a decision, re-run `/loom-roadmap --discuss`.

## D-01: Argument Parsing Strategy
**Decision:** Manual process.argv parsing
**Rationale:** Zero dependencies for a simple CLI with only 3 positional args and one flag; adding a library like commander is overkill
**Alternatives considered:** commander (full-featured but heavy for this scope), yargs (similar overkill)
**Impact:** low

## D-02: Project Structure
**Decision:** Modular src/ layout with separate files for types, operations, validation, and CLI entry point
**Rationale:** Enables testability and clean phase decomposition for multi-agent execution; aligns with existing tsconfig rootDir: src
**Alternatives considered:** Single-file (simpler but not testable in isolation, poor phase separation)
**Impact:** medium
