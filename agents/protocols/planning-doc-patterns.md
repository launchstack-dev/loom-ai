---
description: "Planning Document Discovery Patterns"
---

# Planning Document Discovery Patterns

Canonical list of glob patterns and exclusions for discovering existing planning, design, requirements, and strategy documents in a codebase. Referenced by `planning-docs-agent`, `docs-auditor`, and `loom-init` pre-flight.

## Search Patterns (case-insensitive)

```
# Dedicated docs directories
docs/**/*.md, doc/**/*.md, documentation/**/*.md
wiki/**/*.md, .wiki/**/*.md
specs/**/*.md, design/**/*.md, rfcs/**/*.md, proposals/**/*.md

# ADR directories (multiple conventions)
docs/adr/**/*.md, docs/adrs/**/*.md, docs/decisions/**/*.md
docs/architecture/**/*.md, adr/**/*.md, adrs/**/*.md

# Root-level planning docs
PRD.md, REQUIREMENTS.md, SPEC.md, SPECIFICATION.md, DESIGN.md
ARCHITECTURE.md, VISION.md, STRATEGY.md, GOALS.md, MILESTONES.md
DECISIONS.md, CHANGELOG.md, CONTRIBUTING.md, TODO.md, BACKLOG.md, SCOPE.md

# OpenAPI / Swagger specs
openapi.yaml, openapi.yml, openapi.json
swagger.yaml, swagger.yml, swagger.json
**/openapi.*, **/swagger.*

# Project board exports
*.project.md, project-*.md

# GitHub-specific
.github/*.md, .github/**/*.md
```

## Supplementary Checks

- Files with "spec", "design", "prd", "rfc", "proposal", "adr" in their filename
- Directories named `planning`, `plans`, `requirements`, `specifications`
- Non-markdown formats: `*.rst`, `*.adoc` planning docs
- Ticket export files: `JIRA-*.md`

## Directory Exclusions

Skip these directories (in addition to `.gitignore` patterns):

```
node_modules, vendor, dist, build, .git
.next, .nuxt, .turbo, .cache, .eslintcache
coverage, .nyc_output
venv, env, .venv, __pycache__
target
```

Also skip auto-generated docs (TypeDoc output, Javadoc, Sphinx `_build/`).
