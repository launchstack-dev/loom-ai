#!/usr/bin/env tsx
/**
 * generate-changelog — prepend a `## vX.Y.Z (YYYY-MM-DD)` block to CHANGELOG.md
 * by reading `git log` since the prior tag and grouping commits by
 * conventional-commit prefix.
 *
 * Groups: feat, fix, chore, docs, refactor, test. Anything else falls under
 * "other". Idempotent: if the target version's heading already exists in
 * CHANGELOG.md the script exits 0 without re-writing.
 *
 * Usage:
 *   bunx tsx scripts/generate-changelog.ts --tag v0.1.0
 *   bunx tsx scripts/generate-changelog.ts --tag v0.1.0-test --dry-run    # print, no write
 *
 * Atomic write: writes to CHANGELOG.md.tmp, renames to CHANGELOG.md.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

const GROUPS = ["feat", "fix", "refactor", "test", "docs", "chore"] as const;
type Group = (typeof GROUPS)[number] | "other";

export interface Commit {
  sha: string;
  subject: string;
}

export interface GroupedChanges {
  feat: string[];
  fix: string[];
  refactor: string[];
  test: string[];
  docs: string[];
  chore: string[];
  other: string[];
}

const CONVENTIONAL_RE = /^(feat|fix|chore|docs|refactor|test)(\([^)]+\))?!?:\s*(.+)$/i;

export function classify(subject: string): Group {
  const m = CONVENTIONAL_RE.exec(subject);
  if (!m) return "other";
  const prefix = m[1].toLowerCase() as Group;
  return prefix;
}

export function groupCommits(commits: Commit[]): GroupedChanges {
  const groups: GroupedChanges = {
    feat: [], fix: [], refactor: [], test: [], docs: [], chore: [], other: [],
  };
  for (const c of commits) {
    const g = classify(c.subject);
    groups[g].push(`${c.subject} (${c.sha.slice(0, 7)})`);
  }
  return groups;
}

export interface GitOps {
  priorTag(currentTag: string): string | undefined;
  commitsSince(priorTag: string | undefined): Commit[];
}

export function defaultGitOps(cwd: string): GitOps {
  function run(args: string[]): string {
    return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  }
  return {
    priorTag(currentTag) {
      try {
        const tags = run(["tag", "--sort=-v:refname"]).split("\n").filter(Boolean);
        const idx = tags.indexOf(currentTag);
        if (idx >= 0 && idx + 1 < tags.length) return tags[idx + 1];
        // currentTag not yet created — return the most recent existing tag
        if (idx < 0 && tags.length > 0) return tags[0];
        return undefined;
      } catch {
        return undefined;
      }
    },
    commitsSince(priorTag) {
      const range = priorTag ? `${priorTag}..HEAD` : "HEAD";
      const out = run(["log", range, "--pretty=format:%H%x09%s"]);
      if (!out) return [];
      return out.split("\n").map((line) => {
        const [sha, subject] = line.split("\t");
        return { sha, subject: subject ?? "" };
      });
    },
  };
}

export function renderEntry(args: {
  tag: string;
  date: string;
  grouped: GroupedChanges;
}): string {
  const { tag, date, grouped } = args;
  const lines: string[] = [];
  lines.push(`## ${tag} (${date})`);
  lines.push("");
  const labels: Record<Group, string> = {
    feat: "Features",
    fix: "Fixes",
    refactor: "Refactors",
    test: "Tests",
    docs: "Docs",
    chore: "Chores",
    other: "Other",
  };
  let anyContent = false;
  for (const g of [...GROUPS, "other"] as Group[]) {
    const items = grouped[g];
    if (items.length === 0) continue;
    anyContent = true;
    lines.push(`### ${labels[g]}`);
    lines.push("");
    for (const it of items) lines.push(`- ${it}`);
    lines.push("");
  }
  if (!anyContent) {
    lines.push("_No commits since prior tag._");
    lines.push("");
  }
  return lines.join("\n");
}

export function applyEntry(args: {
  changelogPath: string;
  tag: string;
  entry: string;
}): { skipped: boolean; reason?: string } {
  const { changelogPath, tag, entry } = args;
  const headingMatcher = new RegExp(`^##\\s+${tag.replace(/[.+]/g, "\\$&")}\\b`, "m");
  const header = "# Changelog\n\nAll notable changes to Loom are recorded here. Releases follow semver and are produced by the release pipeline (Phase 6).\n\n";
  let existing = "";
  if (fs.existsSync(changelogPath)) {
    existing = fs.readFileSync(changelogPath, "utf8");
    if (headingMatcher.test(existing)) {
      return { skipped: true, reason: "already-present" };
    }
  } else {
    existing = header;
  }
  // Insert entry after the introductory header block (before any prior version sections).
  let next: string;
  if (existing.startsWith("# Changelog")) {
    const firstVersionIdx = existing.search(/^##\s+/m);
    if (firstVersionIdx === -1) {
      next = existing.endsWith("\n") ? existing + entry : `${existing}\n${entry}`;
    } else {
      next = existing.slice(0, firstVersionIdx) + entry + existing.slice(firstVersionIdx);
    }
  } else {
    next = header + entry + existing;
  }
  const tmp = `${changelogPath}.tmp`;
  fs.writeFileSync(tmp, next, "utf8");
  fs.renameSync(tmp, changelogPath);
  return { skipped: false };
}

function parseArgs(argv: string[]) {
  let tag: string | undefined;
  let dryRun = false;
  let cwd = process.cwd();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tag") tag = argv[++i];
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--cwd") cwd = argv[++i];
    else if (a?.startsWith("--tag=")) tag = a.slice("--tag=".length);
  }
  return { tag, dryRun, cwd };
}

function main() {
  const { tag, dryRun, cwd } = parseArgs(process.argv.slice(2));
  if (!tag) throw new Error("--tag <vX.Y.Z> is required");
  const git = defaultGitOps(cwd);
  const prior = git.priorTag(tag);
  const commits = git.commitsSince(prior);
  const grouped = groupCommits(commits);
  const date = new Date().toISOString().slice(0, 10);
  const entry = renderEntry({ tag, date, grouped });

  const changelogPath = path.join(cwd, "CHANGELOG.md");
  if (dryRun) {
    process.stdout.write(`# dry-run: would prepend the following to ${changelogPath}\n# prior tag: ${prior ?? "(none)"}\n# commit count: ${commits.length}\n\n${entry}`);
    return;
  }
  const result = applyEntry({ changelogPath, tag, entry });
  if (result.skipped) {
    process.stdout.write(`generate-changelog: skipped (${result.reason}) for ${tag}\n`);
  } else {
    process.stdout.write(`generate-changelog: wrote entry for ${tag} to ${changelogPath}\n`);
  }
}

const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();
if (isMain) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`generate-changelog: ${(err as Error).message}\n`);
    process.exit(1);
  }
}
