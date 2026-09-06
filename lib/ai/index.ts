/**
 * Phase 14 foundation — the AI provider abstraction.
 *
 * Import from `@/lib/ai`. The internal modules are implementation detail, and
 * `@/lib/ai/providers/*` is off limits to the rest of the application: nothing
 * outside this directory should know which vendor is configured (ADR-004).
 *
 * The exception is `@/lib/ai/config`, which `lib/config/env.ts` imports so that
 * environment parsing stays in one place.
 */

export {
  AI_PROVIDER_NAMES,
  DEFAULT_AI_TIMEOUT_MS,
  describeAiConfig,
  MAX_AI_TIMEOUT_MS,
  MIN_AI_TIMEOUT_MS,
  parseAiEnv,
  type AiConfig,
  type AiEnvSource,
  type AiProviderName,
} from "./config";

export {
  AI_ERROR_CODES,
  AiError,
  previewText,
  redactSecrets,
  type AiErrorCode,
  type AiErrorOptions,
} from "./errors";

export { extractJson, parseStructuredOutput, type JsonExtraction } from "./json";

export {
  resolveAiProvider,
  resolveAiProviderFromEnv,
  type AiAvailability,
  type ResolveOptions,
} from "./resolve-provider";

export type {
  AiCallOptions,
  AiImage,
  AiProvider,
  AiRequest,
  AiResponseMeta,
  AiResult,
  AiUsage,
  FetchLike,
  JsonSchema,
  JsonValue,
  ResponseSchema,
  SchemaParseResult,
} from "./types";
