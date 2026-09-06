/**
 * Phase 15 — the roast engine.
 *
 * Import from `@/lib/roast`; the internal modules are implementation detail.
 */

export { generateRoast, type RoastRequest } from "./generate-roast";

export {
  buildDeterministicRoast,
  NOTHING_TO_ROAST,
  type DeterministicRoastInput,
} from "./fallback";

export { buildRoastPrompt, ROAST_RULES, type RoastPromptOptions } from "./prompt";

export { MAX_LINES, MAX_PUNCHLINE_LENGTH, roastSchema } from "./schema";

export {
  DEFAULT_LINE_COUNT,
  observationFor,
  roastableFindings,
  selectRoastTargets,
} from "./select";

export {
  CATEGORY_PUNCHLINES,
  punchlineFor,
  SEVERITY_PUNCHLINES,
  SPECIFIC_PUNCHLINES,
} from "./templates";

export { ABUSE_PATTERNS, verifyRoast, type RoastVerificationInput } from "./verify";

export type { DraftRoastLine, Roast, RoastDraft, RoastLine, RoastSource } from "./types";
