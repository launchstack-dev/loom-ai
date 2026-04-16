---
description: "profile, validate, lineage, test — data engineering quality gates and pipeline tools"
---
# Data Engineering

You manage data engineering workflows for Loom: profiling data sources, validating pipeline quality, tracking data lineage, and generating data-specific tests.

## Requirements

$ARGUMENTS

Parse the first positional argument as the subcommand:
- No args: show available subcommands
- `profile`: scan project for data sources, schemas, and pipeline definitions
- `validate`: run data quality gate against the current codebase
- `lineage`: trace and display data source-to-target flow
- `test`: generate data-specific tests

## Subcommand: (none -- help)

Display:
```
loom data: — Data engineering quality gates and pipeline tools

Subcommands:
  profile    Scan project for data sources, schemas, pipeline definitions
  validate   Run data quality gate against the current codebase
  lineage    Trace and display data source-to-target flow
  test       Generate data-specific tests (schema, row counts, nulls, freshness)

Examples:
  loom data:profile
  loom data:validate
  loom data:lineage
  loom data:test
  loom data:test --run
```

## Subcommand: profile

Scan the current project for data engineering artifacts and report what's found.

### Instructions

1. Scan for data stack indicators:
   - `dbt_project.yml` → dbt project (read for project name, version, profile)
   - `models/` directory with `.sql` files → dbt models
   - Files containing `@asset` or `@op` decorators → Dagster
   - Files containing `DAG(` or `@dag` → Airflow
   - `*.bq.sql` or `bigquery` in configs → BigQuery
   - `bauplan.yml` or bauplan imports → Bauplan
   - Plain `.sql` files with CREATE/INSERT/MERGE → raw SQL pipelines

2. For each detected stack, report:
   - Stack name and version (from config files)
   - Model/transform count
   - Source definitions (tables, datasets referenced)
   - Test coverage (existing data tests found)
   - Schema definitions found

3. Display summary:
```
## Data Profile

Stack: dbt (v1.7.0)
Models: 23 (staging: 8, intermediate: 6, marts: 9)
Sources: 3 (postgres.public, s3.events, api.users)
Tests: 47 (schema: 32, data: 15)
Freshness: 2 sources have freshness checks

Schema coverage: 21/23 models have schema.yml entries
Missing: models/staging/stg_raw_events.sql, models/intermediate/int_user_sessions.sql
```

## Subcommand: validate

Run the data quality gate against the current codebase.

### Instructions

1. Spawn data-quality-gate agent (general-purpose):
   ```
   "Read your instructions from ~/.claude/agents/data-quality-gate.md first.
    Validate the current project's data pipeline code against declared schemas and contracts.
    Project root: {cwd}
    Scope: full (all pipeline files)"
   ```
2. Display the gate result:
   - If gate: pass → "✓ All data quality checks passed ({N} checks across 5 dimensions)"
   - If gate: fail → Display each failing check with file:line, dimension, and suggested fix
   - If gate: warn → Display warnings inline

## Subcommand: lineage

Trace data flow and display source-to-target mappings.

### Instructions

1. Spawn data-lineage-tracker agent (general-purpose):
   ```
   "Read your instructions from ~/.claude/agents/data-lineage-tracker.md first.
    Trace data lineage for the current project.
    Event type: manual
    Wiki path: .loom/wiki"
   ```
2. Display the lineage summary from the agent's output
3. If wiki pages were written, report: "Lineage pages written to .loom/wiki/pages/lineage-*.md"

## Subcommand: test

Generate data-specific tests.

### Arguments
- No args: generate tests for all detected pipeline code
- `--run`: generate AND run tests
- `--framework <name>`: force a specific test framework (dbt-test, great-expectations, sql-assert)

### Instructions

1. Spawn data-test-generator agent (general-purpose):
   ```
   "Read your instructions from ~/.claude/agents/data-test-generator.md first.
    Generate data tests for the current project.
    Framework: {detected or --framework value}
    Scope: {all or specific paths}"
   ```
2. Display test generation summary
3. If `--run`: execute the generated tests and report results

## Suggested orchestration.toml Configuration

Projects using the data engineering kit should add this to `.claude/orchestration.toml`:

```toml
# Data Engineering Kit — register agents at pipeline insertion points
# Install with: /loom-library use data-engineering

[[kit.data-engineering.agents]]
name = "data-schema-reviewer"
source = "~/.claude/agents/data-schema-reviewer.md"
model = "sonnet"
insertionPoint = "pre-verify"
outputRole = "reviewer"
condition = "**/*.sql OR **/dbt_project.yml OR **/models/**"

[[kit.data-engineering.agents]]
name = "data-lineage-tracker"
source = "~/.claude/agents/data-lineage-tracker.md"
model = "sonnet"
insertionPoint = "post-execute"
outputRole = "producer"

[[kit.data-engineering.agents]]
name = "data-test-generator"
source = "~/.claude/agents/data-test-generator.md"
model = "sonnet"
insertionPoint = "post-verify"
outputRole = "producer"

[[kit.data-engineering.gates]]
name = "data-quality-gate"
source = "~/.claude/agents/data-quality-gate.md"
model = "sonnet"
insertionPoint = "pre-execute"
failAction = "halt"
condition = "**/*.sql OR **/dbt_project.yml OR **/models/**"

[kit.data-engineering.settings]
nullabilityThreshold = "halt"
freshnessRequired = true
strictTypes = true
```
