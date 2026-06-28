/**
 * scripts/lib/frontmatter.ts
 *
 * Shared YAML-style frontmatter parser (F-07 extraction).
 * Extracted from scripts/out-of-scope/suppress.ts and
 * scripts/triage/30day-sweep.ts to eliminate byte-identical duplication.
 *
 * Parses frontmatter delimited by `---` lines, returning a flat
 * Record<string, string> of key-value pairs.
 */

/**
 * Parse the YAML-style frontmatter block from a Markdown file.
 * Frontmatter is delimited by `---` lines at the start of the content.
 * Returns an empty object if no frontmatter is found.
 */
export function parseFrontmatter(content: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) return {};

  const result: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim().replace(/^["']|["']$/g, "");
    result[key] = value;
  }
  return result;
}
