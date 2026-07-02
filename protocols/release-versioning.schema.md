# Release Versioning Schema (C-04)

Milestone-boundary semver releases, version-slot lifecycle, and the
tag-namespace policy. Artifacts: a git `v*` tag + a changelog section in
`planning/history/changelog.md`. Schema type: `ReleaseVersion` in
`lib/types.ts`. Runner: `bun scripts/loom-release.ts`.

## Milestone semver

- The semver bump is **derived from conventional commits** since the last
  `v*` tag (`feat` ⇒ minor, `fix` ⇒ patch, `BREAKING CHANGE` ⇒ major).
- Tags are cut at **milestone boundaries only** (C-04): each release maps to
  one `M-\d{2}` milestone.
- `version-gate.ts` (CI) fails a release-worthy change that lands at a
  milestone boundary without a bump (`VERSION_GATE_FAILED`).
- Release metrics are filled from `MetricsSnapshot`, never prose estimates.

```toon
releaseVersion:
  semver: 1.1.0
  tagRef: refs/tags/v1.1.0
  milestone: M-02
  commitRange: v1.0.0..v1.1.0
  status: released
  metrics[N]{metric,value}:
    typecheck-errors,0
    scorecard-overall,8.4
```

```toon
fields[6]{field,type,constraints,validation}:
  semver,string,\d+.\d+.\d+,derived from conventional commits; version-gate enforces bump
  tagRef,string,refs/tags/v{semver},v* namespace is semver-only after Phase 10 (defect 13)
  milestone,string,M-\d{2},tags cut at milestone boundaries only (C-04)
  commitRange,string,{prevTag}..{tag},must be non-empty
  status,enum,see state machine,—
  metrics,table,pre-registered names only,filled from MetricsSnapshot never prose
```

## Version-slot lifecycle (status state machine)

```toon
states[6]{state,description,entry,terminal}:
  draft,Version derived; changelog section drafted,loom-release.ts --dry-run (default),false
  gated,Version-gate CI evaluating the bump,version-gate.ts run on the release PR,false
  rejected,Gate failed (missing bump / derivation ambiguity),VERSION_GATE_FAILED,true (this attempt)
  tagged,v{semver} tag created locally,gate passed; loom-release.ts executes,false
  released,Tag pushed; release.yml produced changelog + tarball,release.yml success,true
  yanked,Release withdrawn; tag retained; installs refused,maintainer action,true
```

```toon
transitions[5]{from,to,trigger,sideEffects}:
  draft,gated,Release PR opened,version-gate check runs
  gated,tagged,loom-release.ts --milestone M-NN,tag created; changelog header written with metric placeholders
  gated,rejected,version-gate exit 1,stderr lists unversioned commits
  tagged,released,release.yml completes,tarball + checksums.sha256 published; MetricsSnapshot pinned
  released,yanked,maintainer yanks,InstallManifest verification refuses the release's checksums
```

```toon
invalidTransitions[3]{from,to,error,message}:
  draft,tagged,VERSION_GATE_FAILED,Cannot tag without passing the version gate
  released,tagged,TAG_MIGRATION_CONFLICT,Released tags are immutable; cut a new patch version
  yanked,released,VALIDATION_ERROR,Yank is terminal; re-release under a new version
```

## Tag-namespace rules

- After Phase 10 the `v*` namespace contains **ONLY** semver tags; a non-semver
  tag in `v*` is `TAG_NAMESPACE_POLLUTED` (version-gate.ts, exit 1).
- The 17 legacy `plan-exec-*` tags are migrated to `refs/exec/*` by
  `bun scripts/ci/migrate-exec-tags.ts`.
- **Move, never delete** (irreversibility mitigation): each tag is copied to
  `refs/exec/{name}` and verified via `git rev-parse` BEFORE the
  `plan-exec-*` ref is removed. Aborts mid-run leave both refs in place
  (idempotent re-run). A pre-migration `git bundle` of all refs is written to
  `planning/reports/tag-backup.bundle`.

```toon
tagNamespaces[3]{namespace,contains,policy}:
  refs/tags/v*,semver release tags only,immutable once released; semver-only after Phase 10
  refs/exec/*,migrated plan-exec-* execution tags,move-only; never deleted
  plan-exec-*,legacy execution tags (17),migrated out to refs/exec/* in Phase 10
```

## Indexes

```toon
indexes[3]{index,fields,type,purpose}:
  pk_release,semver,PRIMARY,Version lookup
  uq_tag,tagRef,UNIQUE,One tag per version
  idx_milestone,milestone,INDEX,Milestone -> release mapping
```

## Cascade behavior

```toon
cascades[3]{parent,child,onDelete,onUpdate}:
  ReleaseVersion,InstallManifest,Yanked release keeps manifests (audit trail) but install.sh refuses its checksums,—
  ReleaseVersion,changelog section,Tag deletion forbidden once released (move-only policy),—
  plan-exec-* tags,refs/exec/*,MOVED never deleted (irreversibility mitigation),n/a
```

## Error codes

```toon
errors[4]{code,exit,emittedBy,retryable}:
  VERSION_GATE_FAILED,1,version-gate.ts,No — bump or amend
  VERSION_DERIVATION_FAILED,1,loom-release.ts,No — fix commit messages
  TAG_NAMESPACE_POLLUTED,1,version-gate.ts,No — migrate the tag
  TAG_MIGRATION_CONFLICT,1,migrate-exec-tags.ts,No — manual resolution; source tag left intact
```
