---
name: python-conventions
description: Python ecosystem conventions for new code — Polars over Pandas, uv/ruff/pytest tooling, atomic file writes, type hints on public functions, TOON format for Loom artifacts.
triggers:
  - "**/*.py"
  - "**/pyproject.toml"
  - "**/requirements.txt"
---

# Python Conventions

Project-wide rules for new Python code in this repository. These rules apply
when authoring `.py` files, editing `pyproject.toml`, or modifying
`requirements.txt`. Existing code keeps its existing patterns — never refactor
working code into a new style just to satisfy these conventions.

## 1. Data libraries — Polars over Pandas (for NEW code)

When writing new Python code from scratch, prefer **Polars** over Pandas:

- Faster on most workloads (multi-threaded, columnar, written in Rust).
- Lazy evaluation via `LazyFrame` enables query optimization before execution.
- Stronger type system — Polars schemas are explicit, Pandas object-dtype is not.

When reading or modifying **existing** code that already uses Pandas, **keep
Pandas**. Do not refactor to Polars. The refactor cost (test surface,
behavioral diffs in NaN handling, downstream callers) outweighs Polars'
benefits in established code paths.

Worked example (new code):

```python
import polars as pl

df = pl.scan_csv("usage.csv")           # lazy
result = (
    df.filter(pl.col("status") == "active")
      .group_by("tenant_id")
      .agg(pl.col("amount").sum().alias("total"))
      .collect()                         # materialize
)
```

## 2. Tooling — uv, ruff, pytest

Prefer these defaults for new Python projects:

- **uv** for venv creation and dependency management. Replaces `pip` + `venv`
  + `pip-tools` + most `pipx` use cases. Significantly faster.
- **ruff** for lint AND format. Replaces `flake8` + `black` + `isort` +
  `pyupgrade` in one tool.
- **pytest** for tests. Avoid `unittest` for new test files unless the
  surrounding codebase already standardizes on it.

Worked example:

```bash
uv venv                          # create .venv
uv pip install -e ".[dev]"       # install project + dev extras
uv run pytest                    # run tests in the project venv
ruff check --fix .               # lint + auto-fix
ruff format .                    # format
```

## 3. Atomic file writes

Any Python script that writes a file the user reads, or that downstream
tooling consumes, MUST use atomic writes — never write partial output that
could be read mid-flush.

Worked example:

```python
import os
from pathlib import Path

def write_atomic(path: Path, content: str) -> None:
    """Write `content` to `path` atomically via tmp + rename."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(content, encoding="utf-8")
    os.replace(tmp, path)            # atomic on POSIX and Windows NTFS
```

Never write directly to the destination path. A reader could observe a
half-written file, and a crash leaves the destination corrupt.

## 4. Type hints on public functions

Every function defined at module scope, or exported via `__all__`, MUST have
parameter type hints and a return type hint. Internal helpers (nested
functions, private `_helper` functions where the caller and types are obvious
from the local context) MAY skip hints, but should add them when types become
non-trivial.

Worked example:

```python
from typing import Iterable

def summarize_amounts(
    tenant_id: str,
    rows: Iterable[dict[str, float]],
) -> dict[str, float]:
    """Public function — fully typed."""
    total = sum(row["amount"] for row in rows)
    return {"tenant_id": tenant_id, "total": total}

def _normalize(name):
    """Private helper — hints optional when obvious."""
    return name.strip().lower()
```

Run `ruff check` with the `ANN` rule family enabled to enforce hints on
public surfaces.

## 5. TOON for Loom protocol artifacts

Any Python script in this repository that emits a Loom protocol artifact
(AgentResult, state file, stage context, progress heartbeat, scope coverage,
etc.) MUST emit **TOON** (Token-Oriented Object Notation), not JSON. TOON is
the canonical format for all Loom on-disk artifacts — see
`protocols/toon-format.md`.

No library is required. A small writer suffices:

```python
def to_toon_scalar(key: str, value: object) -> str:
    """Emit a flat scalar line: `key: value`."""
    return f"{key}: {value}"

def to_toon_inline_array(key: str, items: list[str]) -> str:
    """Emit an inline array: `key[N]: a, b, c`."""
    return f"{key}[{len(items)}]: " + ", ".join(items)

# Worked example — write a minimal AgentResult heartbeat
lines = [
    to_toon_scalar("agent", "my-python-tool"),
    to_toon_scalar("wave", 1),
    to_toon_scalar("status", "success"),
    to_toon_inline_array("filesCreated", ["out/report.toon"]),
]
write_atomic(Path(".plan-execution/ephemeral/progress/my-task.toon"),
             "\n".join(lines) + "\n")
```

When in doubt, look at how existing TOON files in `.plan-execution/` and
`protocols/` are structured and mirror that shape. JSON is reserved
for app-specific data being compared or generated (e.g., upstream API
responses) and standard tooling configs.
