# Project Decisions

Locked decisions made during the discussion phase. Plan generation and execution
must honor these choices. To change a decision, re-run `/loom-roadmap --discuss`.

## D-01: CLI Argument Parsing
**Decision:** Use `process.argv` directly (no library)
**Rationale:** Project scope is 2 numbers + 1 operator + optional --help; a library adds unnecessary complexity
**Alternatives considered:** yargs (overkill for 3 positional args), commander (same)
**Impact:** low

## D-02: Project Structure
**Decision:** Single source file (`src/index.ts`) with inline helper functions
**Rationale:** A calculator with 4 operations does not warrant multi-file architecture
**Alternatives considered:** Separate modules per operation (unnecessary abstraction for this scope)
**Impact:** medium

## D-03: Error Handling Strategy
**Decision:** Print errors to stderr, exit with code 1
**Rationale:** Standard CLI convention; enables scripting and piping
**Alternatives considered:** Throw exceptions (less CLI-friendly), return error objects (over-engineering)
**Impact:** low
