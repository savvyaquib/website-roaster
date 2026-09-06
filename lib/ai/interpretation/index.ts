/**
 * Phase 14 — AI interpretation.
 *
 * Import from `@/lib/ai/interpretation`; the internal modules are
 * implementation detail.
 */

export {
  DEFAULT_MAX_OUTPUT_TOKENS,
  interpretAnalysis,
  type InterpretationResult,
  type InterpretRequest,
} from "./interpret";

export {
  assembleEvidence,
  DEFAULT_EVIDENCE_LIMITS,
  evidenceToSearchText,
  type AssembledEvidence,
  type EvidenceLimits,
  type InterpretationInput,
} from "./evidence";

export {
  buildInterpretationPrompt,
  CONSTRAINTS,
  PROHIBITIONS,
  type PromptOptions,
} from "./prompt";

export {
  interpretationSchema,
  MAX_FIELD_LENGTH,
  MAX_PROBLEMS,
  MAX_STRENGTHS,
  MAX_SUMMARY_LENGTH,
} from "./schema";

export {
  checkProse,
  PROHIBITED_PHRASES,
  verifyInterpretation,
  type LocatedText,
  type VerificationInput,
} from "./verify";

export type {
  AiInterpretation,
  DraftProblem,
  DraftStrength,
  InterpretationDraft,
  InterpretedProblem,
  InterpretedStrength,
  Violation,
  ViolationKind,
} from "./types";

export { VIOLATION_KINDS } from "./types";
