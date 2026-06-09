## Subcommand: status

Show plan progress by reading execution state.

### Instructions

1. Check for `PLAN.md` -- if missing, report "No plan found."
2. Check for `.plan-execution/state.toon` -- if missing, report "Plan exists but execution has not started."
3. If state exists, display:
   - Current wave and total waves
   - Per-wave status (pending / in_progress / complete / failed)
   - Agent counts (running / done / failed)
   - Last activity timestamp
   - Scope coverage summary (if `scope-coverage.toon` exists)
4. If `planning/history/reviews/` has review files, show last review date and finding count.
5. If `.plan-execution/test-report.md` exists, show test summary.
