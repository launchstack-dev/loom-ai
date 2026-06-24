---
name: shell-conventions
description: Shell-script conventions for new code in this repo — portability across BSD/GNU, locale-stable text matching, defensive parsing, never-suppress-errors, and the failure modes that bit us in PR #18.
triggers:
  - "**/*.sh"
  - "**/*.bash"
  - "scripts/**"
  - "hooks/*.sh"
---

# Shell Conventions

Project-wide rules for shell scripts in this repository (`scripts/`, `hooks/*.sh`,
`install.sh`, and any new `.sh` / `.bash` file). Each rule comes with the **bug
class it prevents** — derived from the 7 failure modes that slipped through
PR #18 across 7 rounds of code review. If you find existing code violating
these rules and the change is in scope, fix it; otherwise leave it and add a
comment naming the rule.

These rules apply when authoring new shell scripts. Existing code keeps its
existing patterns unless you're already touching it — never refactor working
code purely to satisfy these conventions.

## 1. Cross-shell portability (BSD vs GNU)

The same script runs on macOS (BSD coreutils) AND Ubuntu CI (GNU coreutils).
Most divergences are silent: the script "works" on dev and breaks on CI.

| Don't | Do | Why |
|---|---|---|
| `mktemp -d -t prefix` | `mktemp -d -t prefix.XXXXXX` | GNU mktemp requires ≥3 trailing X's; BSD is permissive. Bare form fails on Linux CI with "too few X's in template." |
| `sed -i 's/.../...' file` | `sed -i.bak 's/.../...' file && rm file.bak`<br>or:<br>`sed 's/.../...' file > tmp && mv tmp file` | GNU `sed -i` takes no arg, BSD requires one. |
| `readlink -f path` | Pure shell: `(cd "$(dirname "$path")" && pwd -P)/$(basename "$path")` | `readlink -f` is GNU-only; BSD has `-e` with different semantics. |
| `grep -P pattern` | `grep -E "$(... | perl ... )"` or restructure | `-P` (Perl regex) is GNU-only. |
| `date -d "yesterday"` | `date -v-1d` (BSD) — branch on `uname` | GNU/BSD date arg syntax is incompatible. |

**Detection in code review**: if you can't tell whether a flag works on both,
look it up before merging.

## 2. Never shell-interpolate into Python/Perl/awk string literals

This is the single class of bug that caused the most damage in PR #18.

**Don't:**
```sh
python3 -c "
import json
d = json.load(open('$SOME_PATH'))
...
"
```

If `$SOME_PATH` contains an apostrophe, backtick, or even a newline, the
Python literal becomes syntactically invalid. With `2>/dev/null` (see rule
3), you get an empty result and a misleading "could not resolve" error.

**Do** (quoted heredoc + argv):
```sh
python3 - "$SOME_PATH" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    d = json.load(f)
...
PY
```

The `<<'PY'` quoting tells the shell NOT to expand `$vars` inside the
heredoc, so the Python source is exactly what you wrote. Arguments come in
via `sys.argv` like a normal command.

Same rule for awk:
```sh
# Don't: awk "/$PATTERN/ { ... }"
# Do:    awk -v p="$PATTERN" '$0 ~ p { ... }'
```

## 3. Never `2>/dev/null` to suppress unknown failures

Suppressing stderr without capturing it masks every failure mode of the
underlying tool. When a regression happens (schema change, missing
dependency, parse error), you get a generic "command failed" error miles
from the root cause.

**Don't:**
```sh
RESULT=$(python3 -c "..." 2>/dev/null)
```

**Do** (capture, then surface on failure):
```sh
PY_ERR=$(mktemp)
# `trap` guarantees cleanup on ANY exit — success, error, signal — so the
# tempfile never leaks even when the failure path takes `exit 1`.
trap 'rm -f "$PY_ERR"' EXIT
RESULT=$(python3 -c "..." 2>"$PY_ERR" || true)
if [ -z "$RESULT" ]; then
  echo "FAIL: parse returned empty" >&2
  [ -s "$PY_ERR" ] && { echo "  underlying error:" >&2; sed 's/^/    /' "$PY_ERR" >&2; }
  exit 1
fi
```

The ONLY legitimate use of `2>/dev/null` is when you know exactly which
expected error you're discarding and the alternative is noisy output the
user doesn't care about (e.g. `command -v foo >/dev/null 2>&1` for a
boolean tool-existence probe).

## 4. Locale-stable text matching

`grep`, `sort`, `awk`, `comm` are all locale-sensitive. A macOS contributor's
default locale orders characters differently from a Linux CI container.
Unicode-aware modes on `LANG=C` runners break multi-byte regexes silently.

**Rules:**
- Pin `LC_ALL=C` for byte-order comparisons: `LC_ALL=C sort`, `LC_ALL=C comm`,
  `LC_ALL=C grep -qiE 'fail|error'`.
- Never include unicode glyphs in your patterns. Replace `grep '✘'` with
  `grep -i 'fail\|error'` or anchor on a stable substring nearby.
- Never include unicode glyphs in matchers either. Replace `awk '/❯/,/$/'`
  with `awk '/key@value/,/$/'` where `key@value` is the stable identifier
  the output prints.

**Real example from PR #18:** the load-failure detector originally used
`grep '✘'`. On GNU `grep` with `LC_ALL=C`, the multi-byte `✘` was
incorrectly tokenized; the grep silently missed real failures.

## 5. Defensive parsing — always assert shapes

When you parse JSON/YAML/TOML output, the shape is a contract you don't
control. Assume the producer can change it.

In bash:
```sh
# Don't trust an empty result as "no data" — check the parse exit code too
RESULT=$(jq -r '.foo // empty' file.json) || { echo "FAIL: jq parse"; exit 1; }
```

In embedded Python (see rule 2 for the heredoc shape):
```python
with open(sys.argv[1]) as f:
    d = json.load(f)
if isinstance(d, dict):                       # top-level shape guard
    for k, entries in d.get("plugins", {}).items():
        if k.startswith("loom@") and isinstance(entries, list):  # nested
            for e in entries:
                if isinstance(e, dict) and e.get("installPath"):  # leaf
                    print(e["installPath"])
                    sys.exit(0)
sys.exit(1)
```

Three guards, one per level. Without them a corrupted/empty/list-shaped
input raises `AttributeError` and the surrounding shell script reports
"could not resolve" instead of "JSON is malformed."

## 6. `set -euo pipefail` is the default

Every new shell script in this repo starts with:
```sh
#!/usr/bin/env bash
set -euo pipefail
```

- `-e`: exit on any unhandled non-zero
- `-u`: error on unset variable references
- `-o pipefail`: a pipeline's exit code is the rightmost non-zero command's

If you genuinely need a command to keep going on failure, opt in explicitly
with `|| true` and a comment explaining why. Don't disable `set -e`
silently for whole functions.

For POSIX `sh` scripts (anything starting `#!/bin/sh`), use `set -eu` (no
`pipefail` in POSIX) — and remember `bash`isms are forbidden (see rule 8).

## 7. Don't filter signal away when filtering noise

A common temptation when output is noisy: pipe through `grep -v ...` to
suppress the noise. This is the PR #18 round 6 trap.

**Bad** — silently discards real errors that happen to contain `/`:
```sh
echo "$OUTPUT" | grep -v "/" | grep -iE "fail|error"
```

**Better** — strip ONLY the specific metadata line you want to ignore:
```sh
echo "$OUTPUT" | grep -viE '^[[:space:]]*(path|description):' | grep -iE "fail|error"
```

The rule: filter on a **specific anchor** (line start, exact field name)
that you've verified exists in the noise but NOT in the signal. Filtering
on a substring that could appear in either is a false-negative waiting to
happen.

## 8. `#!/bin/sh` means POSIX — `#!/usr/bin/env bash` means bash

The shebang is a contract. Tools that probe scripts (e.g. `sh -n` for
syntax check) honor the shebang's runtime.

- `#!/bin/sh` — POSIX only. No arrays, no `[[ ]]`, no `local`, no `<<<`
  here-strings, no `${var,,}` case conversion. Check with `sh -n script`.
- `#!/usr/bin/env bash` — bash. Check with `bash -n script`.

Using `bash -n` on a `#!/bin/sh` script accepts bashisms that fail at
runtime. Using `sh -n` on a bash script rejects legitimate bash syntax.
Always match the parser to the shebang.

**Real example from PR #18:** gem suggested switching `sh -n run-hook.sh`
to `bash -n`. The script was `#!/bin/sh` — the suggestion was rejected
because it would have masked the exact class of bug (a bashism in a
sh-targeted script) that the check exists to catch.

## 9. Test sandboxes need fail-loud diagnostics

If you're writing a sandbox/harness/test script:

- **Preserve diagnostics on failure**. `trap cleanup EXIT` is dangerous when
  install fails mid-way — operator loses what landed. Either default to
  preserve-on-failure and require `FORCE_CLEANUP=1` for clean teardown, or
  use `trap cleanup_on_success EXIT; trap preserve_on_error ERR`.
- **Assert post-copy completeness**. `rsync` exits 23 (partial) and 24
  (source vanished) but `set -e` aborts with an opaque message. After any
  copy step, verify the required outputs exist:
  ```sh
  for req in plugin.json hooks/hooks.json commands/; do
    [ -e "$DEST/$req" ] || { echo "FAIL: $req missing"; exit 1; }
  done
  ```
- **Detect partial success in tool output**. `claude plugin install` can
  exit 0 with `✘ Failed to install` in stdout. Always grep the output for
  failure markers AND check exit code.

## 10. Stacked-PR awareness in workflows

When you `gh pr merge --delete-branch` (or `git push origin --delete`),
GitHub auto-closes any PR whose base is that branch — and the auto-close
is irreversible via API.

Before deleting a branch, check:
```sh
gh pr list --base "$BRANCH" --state open --json number,title
```

If anything comes back, retarget those PRs to a stable base first (usually
`main` after merge), then delete. The `deploy-guard.ts` hook enforces this
for `gh pr merge` and explicit `git push origin --delete` commands.

## What to do when these rules disagree with reality

If you find a script in this repo that violates these rules and tests still
pass, the rule is right and the script is on borrowed time. File an issue
or fix it in-scope when you next touch the file. Don't add a new violation
just because the surrounding code has old ones — see "Existing code keeps
its existing patterns" in the intro: this means *don't refactor working old
code as a side quest*, NOT *new code can match the old style*.

## Source

These rules were derived from a workflow audit after PR #18 went through 7
rounds of gemini-code-assist review. Each rule names the bug class it
prevents so the next reader understands the *why*, not just the *what*.
