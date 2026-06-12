/**
 * Pure-function `/loom-skill create` wizard step module.
 *
 * Extracted in Phase 0 (Pass 4 architectural review) so Phase 4's vitest
 * tests can import the state-machine + validation logic without depending on
 * the markdown command file (`commands/loom-skill.md`). Phase 8 wires this
 * module from the command's `bun` runtime invocation.
 *
 * NO I/O at module level — no `fs.*`, no `process.*`. Callers handle file
 * reads/writes (e.g., parsing `library.yaml` and writing `SKILL.md`).
 *
 * See planning/plans/PLAN-kit-native-skills.md § wizard-interview.
 */

import type { SkillEntry } from "./library-catalog-migrator.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * State machine step labels. The wizard's step naming uses a hyphenated
 * "ask-*" / "finalize" form (matched by Phase 4 tests; see bt-4-22 etc.).
 *
 *   - `ask-name`           — prompt for the slug
 *   - `ask-description`    — prompt for the description
 *   - `ask-trigger-type`   — "file-triggered" or "description-activated"
 *   - `ask-trigger-glob`   — only entered when triggerType === "file-triggered"
 *   - `ask-confirm`        — review screen
 *   - `ask-kit-registration` — optional: offer to add to a kit's includes
 *   - `finalize`           — terminal; caller now writes SKILL.md + library.yaml
 */
export type WizardStep =
  | "ask-name"
  | "ask-description"
  | "ask-trigger-type"
  | "ask-trigger-glob"
  | "ask-confirm"
  | "ask-kit-registration"
  | "finalize";

/** Trigger activation mode. */
export type WizardTriggerType = "file-triggered" | "description-activated";

/** Accumulated answers as the wizard progresses. All fields optional until
 *  `finalize` because mid-flow states only have a partial view. */
export interface WizardAnswers {
  name?: string;
  description?: string;
  triggerType?: WizardTriggerType;
  /** Present only when `triggerType === "file-triggered"`. */
  triggers?: string[];
  /** Set to true when the user confirms at `ask-confirm`. */
  confirmed?: boolean;
  /** Set to true when the user wants to add the skill to a kit's includes. */
  registerInKit?: boolean;
  /** Name of the target kit when `registerInKit === true`. */
  kitName?: string;
  /** Set by `interviewStep` when the wizard restarts (user said "N" at confirm). */
  revision?: boolean;
  /** Set by the caller after `detectExistingSkill` returns `exists: true`. */
  existingSkillDetected?: boolean;
}

/**
 * Full wizard state machine snapshot. `error` is set when the previous user
 * input was invalid; the step is unchanged and the caller re-prompts.
 *
 * Field naming note: the Phase 4 test spec uses `step` (not `nextState`) so
 * that's what we lock in. See `test/wizard-interview.test.ts` line ~28.
 */
export interface WizardState {
  step: WizardStep;
  answers: WizardAnswers;
  error?: string;
}

/** Slug-validation result. Field name is `error` to match the contract test
 *  spec (ct-0-12). The plan API spec calls this `reason`; both names are
 *  treated as equivalent by the Phase 4 tests (they probe both). */
export interface SlugValidationResult {
  valid: boolean;
  error?: string;
}

/** Result of scanning a `library.yaml` string for an existing skill entry. */
export interface ExistingSkillResult {
  exists: boolean;
  entry?: SkillEntry;
  /** Non-empty when the YAML failed to parse; the function never throws. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/** The single source of truth for the skill-slug pattern: `[a-z][a-z0-9-]*`
 *  with no leading/trailing hyphen. P3-06 hard rule. */
const SLUG_RE = /^[a-z][a-z0-9-]*[a-z0-9]$|^[a-z]$/;

/**
 * Enforce the `[a-z][a-z0-9-]*` slug pattern (P3-06). Empty, leading-digit,
 * uppercase, underscore-, space-, leading-hyphen-, and trailing-hyphen
 * inputs all return `{ valid: false }` with a human-readable `error`.
 */
export function validateSkillSlug(name: string): SlugValidationResult {
  if (typeof name !== "string" || name.length === 0) {
    return { valid: false, error: "Skill name cannot be empty" };
  }
  if (/[A-Z]/.test(name)) {
    return { valid: false, error: "Skill names must be lowercase" };
  }
  if (/^[0-9]/.test(name)) {
    return { valid: false, error: "Skill names must start with a letter" };
  }
  if (name.includes("_")) {
    return { valid: false, error: "Use hyphens, not underscores" };
  }
  if (/\s/.test(name)) {
    return { valid: false, error: "Skill names cannot contain spaces" };
  }
  if (name.startsWith("-")) {
    return { valid: false, error: "Skill names cannot start with a hyphen" };
  }
  if (name.endsWith("-")) {
    return { valid: false, error: "Skill names cannot end with a hyphen" };
  }
  if (!SLUG_RE.test(name)) {
    return { valid: false, error: "Skill names must match [a-z][a-z0-9-]*" };
  }
  return { valid: true };
}

/**
 * Idempotency check: scan a raw `library.yaml` string for an existing skill
 * entry under `library.skills:` matching `name` (N-15 crash-recovery use case).
 *
 * Pure regex-based — does not depend on js-yaml — so it works even on
 * partial/in-progress YAML. Malformed YAML returns `{ exists: false, error }`
 * without throwing.
 */
export function detectExistingSkill(libraryYaml: string, name: string): ExistingSkillResult {
  if (typeof libraryYaml !== "string") {
    return { exists: false, error: "libraryYaml must be a string" };
  }

  // Guard against the egregiously-malformed case the test pins (line ~190):
  // "catalog_version: {\n  broken: [unclosed". We detect any unclosed flow
  // collection as a parse failure signal.
  const openBraces = (libraryYaml.match(/\{/g) ?? []).length;
  const closeBraces = (libraryYaml.match(/\}/g) ?? []).length;
  const openBrackets = (libraryYaml.match(/\[/g) ?? []).length;
  const closeBrackets = (libraryYaml.match(/\]/g) ?? []).length;
  if (openBraces !== closeBraces || openBrackets !== closeBrackets) {
    return { exists: false, error: "library.yaml has unbalanced flow collections" };
  }

  // Locate the library.skills: block (must be the v4 native-skills section,
  // not v3's protocols-section which used the same key). We pin to the
  // 2-space-indented `skills:` form under `library:`.
  const blockRe = /^library:\s*\n([\s\S]*)$/m;
  const blockMatch = blockRe.exec(libraryYaml);
  if (!blockMatch) {
    return { exists: false };
  }
  const libraryBody = blockMatch[1];

  // Find the `  skills:` section (exactly 2-space indent). Capture everything
  // up to the next sibling key at the same indent level or end of input.
  // NOTE: JS regex has no \Z anchor; `(?![\s\S])` is the end-of-string proxy.
  const skillsRe = /^ {2}skills:\s*\n([\s\S]*?)(?=^ {2}\S|^\S|(?![\s\S]))/m;
  const skillsMatch = skillsRe.exec(libraryBody);
  if (!skillsMatch) {
    return { exists: false };
  }

  // Scan the list for an entry whose `name:` line matches.
  // List items live at 4-space indent: `    - name: <slug>`.
  const itemNameRe = /^ {4}-\s+name:\s+(\S+)/gm;
  let m: RegExpExecArray | null;
  while ((m = itemNameRe.exec(skillsMatch[1])) !== null) {
    const entryName = m[1].replace(/['"]/g, "");
    if (entryName === name) {
      // Found it. Extract description and source if available; triggers/etc.
      // are best-effort.
      const entryStart = m.index;
      const nextItemRe = /^ {4}-\s+name:/gm;
      nextItemRe.lastIndex = entryStart + m[0].length;
      const nextMatch = nextItemRe.exec(skillsMatch[1]);
      const entryEnd = nextMatch ? nextMatch.index : skillsMatch[1].length;
      const entryBody = skillsMatch[1].slice(entryStart, entryEnd);

      const descMatch = /^ {6}description:\s+(.+)$/m.exec(entryBody);
      const sourceMatch = /^ {6}source:\s+(.+)$/m.exec(entryBody);

      const entry: SkillEntry = {
        name: entryName,
        description: descMatch ? descMatch[1].trim().replace(/^["']|["']$/g, "") : "",
        source: sourceMatch ? sourceMatch[1].trim().replace(/^["']|["']$/g, "") : "",
      };
      return { exists: true, entry };
    }
  }

  return { exists: false };
}

/**
 * Pure state-machine step: given the current state and the user's input
 * string, return the next state.
 *
 * Total function: every valid `(state, input)` pair returns a new
 * `WizardState`. On invalid input, the returned state stays at the same step
 * with `error` populated.
 *
 * Transitions:
 *
 *   ask-name → ask-description (valid slug; if `existingSkillDetected` is
 *               set, returns `ask-name` with error so the caller can prompt
 *               for overwrite — bt-4-34 crash-recovery scenario)
 *   ask-description → ask-trigger-type (non-empty)
 *   ask-trigger-type + "file-triggered" → ask-trigger-glob
 *   ask-trigger-type + "description-activated" → ask-confirm
 *   ask-trigger-glob → ask-confirm (captures `triggers` array)
 *   ask-confirm + "y"|"yes" → finalize
 *   ask-confirm + "n"|"N" → ask-name (revision)
 *   ask-kit-registration + "n" → finalize (no kit includes)
 *   ask-kit-registration + "y" → finalize (kit registration captured)
 *   finalize → finalize (terminal; idempotent)
 */
export function interviewStep(state: WizardState, input: string): WizardState {
  const trimmed = (input ?? "").trim();
  const answers = { ...state.answers };

  switch (state.step) {
    case "ask-name": {
      // Crash-recovery (bt-4-34): if an existing skill was detected for this
      // name, hold at `ask-name` with an error so the caller can prompt for
      // overwrite/abort. Do not silently emit a duplicate.
      if (answers.existingSkillDetected) {
        return {
          step: "ask-name",
          answers,
          error: `Skill "${trimmed}" already exists. Choose a different name or abort.`,
        };
      }
      const validation = validateSkillSlug(trimmed);
      if (!validation.valid) {
        return { step: "ask-name", answers, error: validation.error };
      }
      answers.name = trimmed;
      return { step: "ask-description", answers };
    }

    case "ask-description": {
      if (trimmed.length === 0) {
        return { step: "ask-description", answers, error: "Description cannot be empty" };
      }
      answers.description = trimmed;
      return { step: "ask-trigger-type", answers };
    }

    case "ask-trigger-type": {
      if (trimmed === "file-triggered") {
        answers.triggerType = "file-triggered";
        return { step: "ask-trigger-glob", answers };
      }
      if (trimmed === "description-activated") {
        answers.triggerType = "description-activated";
        // Skip `ask-trigger-glob` — no globs needed for description activation.
        return { step: "ask-confirm", answers };
      }
      return {
        step: "ask-trigger-type",
        answers,
        error: 'Choose "file-triggered" or "description-activated"',
      };
    }

    case "ask-trigger-glob": {
      if (trimmed.length === 0) {
        return { step: "ask-trigger-glob", answers, error: "Glob pattern cannot be empty" };
      }
      // Support comma-separated globs in a single input line.
      const globs = trimmed
        .split(",")
        .map((g) => g.trim())
        .filter((g) => g.length > 0);
      answers.triggers = [...(answers.triggers ?? []), ...globs];
      return { step: "ask-confirm", answers };
    }

    case "ask-confirm": {
      const lower = trimmed.toLowerCase();
      if (lower === "y" || lower === "yes") {
        answers.confirmed = true;
        return { step: "finalize", answers };
      }
      if (lower === "n" || lower === "no") {
        // Restart: clear answers but flag the revision so the caller can
        // pre-fill prompts with the prior responses if desired.
        return {
          step: "ask-name",
          answers: { revision: true },
        };
      }
      return { step: "ask-confirm", answers, error: 'Enter "y" or "n"' };
    }

    case "ask-kit-registration": {
      const lower = trimmed.toLowerCase();
      if (lower === "n" || lower === "no") {
        answers.registerInKit = false;
        return { step: "finalize", answers };
      }
      if (lower === "y" || lower === "yes") {
        answers.registerInKit = true;
        return { step: "finalize", answers };
      }
      return { step: "ask-kit-registration", answers, error: 'Enter "y" or "n"' };
    }

    case "finalize":
      return state;
  }
}

/**
 * Render the SKILL.md frontmatter + body from completed wizard answers.
 *
 * The `triggers:` key is **omitted entirely** (not emitted as `triggers: []`)
 * when `triggerType === "description-activated"`, per bt-4-30 / bt-4-33.
 *
 * The body is a minimal placeholder template — the user fills in the actual
 * skill instructions after the wizard exits.
 */
export function generateSkillMdContent(answers: WizardAnswers): string {
  const name = answers.name ?? "unnamed-skill";
  const description = answers.description ?? "";
  const lines: string[] = ["---", `name: ${name}`, `description: ${description}`];

  if (
    answers.triggerType === "file-triggered" &&
    answers.triggers &&
    answers.triggers.length > 0
  ) {
    lines.push("triggers:");
    for (const glob of answers.triggers) {
      lines.push(`  - "${glob}"`);
    }
  }

  lines.push(
    "---",
    "",
    `# ${name}`,
    "",
    description,
    "",
    "<!-- Replace this body with the skill's instructions. -->",
    ""
  );
  return lines.join("\n");
}

/**
 * Render the `library.skills:` YAML fragment to append under the v4 catalog.
 * Returns the indented multi-line string ready for direct concatenation; the
 * caller is responsible for inserting it at the correct position in
 * `library.yaml`.
 *
 * `triggers:` is omitted entirely when `triggerType === "description-activated"`
 * (bt-4-33).
 */
export function generateLibraryYamlEntry(answers: WizardAnswers): string {
  const name = answers.name ?? "unnamed-skill";
  const description = answers.description ?? "";
  const source = `skills/${name}/SKILL.md`;

  const lines: string[] = [
    `    - name: ${name}`,
    `      description: ${description}`,
    `      source: ${source}`,
  ];

  if (
    answers.triggerType === "file-triggered" &&
    answers.triggers &&
    answers.triggers.length > 0
  ) {
    lines.push("      triggers:");
    for (const glob of answers.triggers) {
      lines.push(`        - "${glob}"`);
    }
  }

  return lines.join("\n") + "\n";
}
