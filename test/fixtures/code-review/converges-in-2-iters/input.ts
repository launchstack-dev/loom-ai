// Fixture for F-01 code-review harness convergence test.
// Seeded with code-quality issues that the reviewer envelopes flag.

export function getUserById(id: string): unknown {
  // SEC: string interpolation in SQL — security-reviewer flags this.
  const query = `SELECT * FROM users WHERE id = '${id}'`;
  return db.query(query);
}

// ARCH: route handler imports directly from db layer.
import { db } from "../db/connection";

export async function loadConfig() {
  try {
    return JSON.parse(await readFile("config.json", "utf8"));
  } catch (e) {
    // SILENT: swallowed error — silent-failure-hunter flags this.
    return {};
  }
}

declare const readFile: (path: string, enc: string) => Promise<string>;
