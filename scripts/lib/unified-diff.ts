/**
 * scripts/lib/unified-diff.ts
 *
 * Shared minimal unified-diff renderer (F-09 extraction).
 * Extracted from scripts/migrate-context-split.ts and
 * scripts/migrate-convergence-state.ts to eliminate byte-identical duplication.
 *
 * No external dependencies — suitable for dry-run output in CLI migrators.
 */

/**
 * Minimal unified-diff renderer. Compares two strings line-by-line and
 * emits a `--- before / +++ after` block with `+`/`-` markers.
 * Returns `--- {label} (unchanged)\n` when before === after.
 */
export function unifiedDiff(before: string, after: string, label: string): string {
  if (before === after) return `--- ${label} (unchanged)\n`;
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  const lines: string[] = [`--- ${label} (before)`, `+++ ${label} (after)`];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    const av = a[i];
    const bv = b[i];
    if (av === bv) {
      if (av !== undefined) lines.push(` ${av}`);
    } else {
      if (av !== undefined) lines.push(`-${av}`);
      if (bv !== undefined) lines.push(`+${bv}`);
    }
  }
  return lines.join("\n") + "\n";
}
