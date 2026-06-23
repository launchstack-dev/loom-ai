#!/usr/bin/env tsx
/**
 * install-source-digest — weekly opt-in aggregator for `install.toon.source`
 * self-reports posted to a designated GitHub Discussions thread.
 *
 * Closes the strategy-review "lying schema" gap noted in
 * `planning/plans/PLAN-plugin-marketplace-merged.md` Phase 4 without standing
 * up a telemetry server. Users opt in by posting the line
 *
 *     install.toon.source: <bucket>
 *
 * in their own words anywhere in a comment on the designated thread. No PII
 * is collected — the script only counts buckets and emits a TOON summary that
 * a workflow can then post back as a comment.
 *
 * Usage:
 *
 *   bunx tsx scripts/install-source-digest.ts --fixture <path-to-json>
 *   bunx tsx scripts/install-source-digest.ts                  # uses GH API (future)
 *
 * Today the fixture-driven mode is the only supported path. The GitHub API
 * fetch path is intentionally left unimplemented — when a real discussion
 * thread is provisioned the workflow YAML will feed a JSON dump of the thread
 * to this script. Treating the fetch as out-of-script keeps the script
 * deterministic and lets the workflow handle auth/rate limits.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const VALID_BUCKETS = [
  "curl-script",
  "marketplace-browse",
  "self-hosted-url",
  "direct-link",
  "migration",
] as const;
type Bucket = (typeof VALID_BUCKETS)[number];

interface Comment {
  id: string;
  createdAt: string;
  author: string;
  body: string;
}

interface Thread {
  discussion: {
    id: string;
    url: string;
    title: string;
    comments: Comment[];
  };
}

export interface DigestSummary {
  generatedAt: string;
  threadUrl: string;
  totalComments: number;
  reportedComments: number;
  unparseableComments: number;
  /** Buckets ordered alphabetically; zero-count buckets are included. */
  buckets: Array<{ bucket: Bucket; count: number }>;
}

const LINE_RE = /install\.toon\.source\s*:\s*([a-z0-9][a-z0-9-]*)/i;

/** Parse a single comment body and return the bucket reported, or null. */
export function parseCommentBucket(body: string): Bucket | null {
  const m = body.match(LINE_RE);
  if (!m) return null;
  const value = m[1].toLowerCase();
  if ((VALID_BUCKETS as readonly string[]).includes(value)) {
    return value as Bucket;
  }
  return null;
}

/** Compute the summary from a parsed Thread. */
export function summarize(thread: Thread, now: Date): DigestSummary {
  const counts = new Map<Bucket, number>();
  for (const b of VALID_BUCKETS) counts.set(b, 0);

  let reported = 0;
  let unparseable = 0;
  for (const c of thread.discussion.comments) {
    const bucket = parseCommentBucket(c.body);
    if (bucket === null) {
      unparseable += 1;
      continue;
    }
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    reported += 1;
  }

  const buckets = [...VALID_BUCKETS]
    .sort()
    .map((bucket) => ({ bucket, count: counts.get(bucket) ?? 0 }));

  return {
    generatedAt: now.toISOString(),
    threadUrl: thread.discussion.url,
    totalComments: thread.discussion.comments.length,
    reportedComments: reported,
    unparseableComments: unparseable,
    buckets,
  };
}

/** Render the summary as TOON for the discussion comment body. */
export function renderToon(summary: DigestSummary): string {
  const lines: string[] = [];
  lines.push(`generatedAt: ${summary.generatedAt}`);
  lines.push(`threadUrl: ${summary.threadUrl}`);
  lines.push(`totalComments: ${summary.totalComments}`);
  lines.push(`reportedComments: ${summary.reportedComments}`);
  lines.push(`unparseableComments: ${summary.unparseableComments}`);
  lines.push(`buckets[${summary.buckets.length}]{bucket,count}:`);
  for (const row of summary.buckets) {
    lines.push(`  ${row.bucket},${row.count}`);
  }
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { fixture: string | null } {
  let fixture: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--fixture") {
      fixture = argv[i + 1] ?? null;
      i++;
    } else if (a.startsWith("--fixture=")) {
      fixture = a.slice("--fixture=".length);
    }
  }
  return { fixture };
}

function main(): void {
  const { fixture } = parseArgs(process.argv.slice(2));
  if (!fixture) {
    process.stderr.write(
      "install-source-digest: --fixture <path> is required (GH API mode not yet implemented)\n",
    );
    process.exit(2);
  }
  const abs = path.resolve(fixture);
  const text = fs.readFileSync(abs, "utf8");
  const thread = JSON.parse(text) as Thread;
  if (!thread.discussion || !Array.isArray(thread.discussion.comments)) {
    process.stderr.write(
      `install-source-digest: fixture ${abs} missing discussion.comments[]\n`,
    );
    process.exit(2);
  }
  const summary = summarize(thread, new Date());
  process.stdout.write(renderToon(summary));
}

// Only run main() when executed directly (not when imported as a module).
// Works under both CJS (require.main === module) and ESM (compare argv[1] to
// this module's filename via import.meta.url translation done by tsx).
const isDirectInvocation = (() => {
  try {
    if (typeof require !== "undefined" && require.main === module) return true;
  } catch {
    // ESM: `require` undefined.
  }
  const entry = process.argv[1] ?? "";
  return entry.endsWith("install-source-digest.ts") ||
    entry.endsWith("install-source-digest.js");
})();

if (isDirectInvocation) {
  main();
}
