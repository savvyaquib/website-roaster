/**
 * Choosing a provider.
 *
 * Source of truth: docs/DECISIONS.md ADR-004, ADR-016, ADR-054.
 *
 * The one place in the application that maps a provider name to an adapter.
 * Everything else takes an `AiProvider` — or an `AiAvailability` — and never
 * learns which vendor is behind it (ADR-004).
 *
 * ## Unavailable is a first-class answer
 *
 * `resolveAiProvider` returns an availability rather than throwing or returning
 * a bare null, because a caller needs to say *why* AI is missing from a report.
 * ADR-016's degraded path is only honest if it can distinguish "nobody
 * configured a key" from "the provider is down".
 */

import type { AiConfig } from "./config";
import { parseAiEnv } from "./config";
import { AiError } from "./errors";
import { createGeminiProvider } from "./providers/gemini";
import type { AiProvider, FetchLike } from "./types";

export type AiAvailability =
  | {
      readonly available: true;
      readonly provider: AiProvider;
      /** A description safe to log or show, carrying no secret. */
      readonly description: string;
    }
  | {
      readonly available: false;
      readonly reason: string;
      /** The same fact as an error, for callers that report failures uniformly. */
      readonly error: AiError;
    };

export interface ResolveOptions {
  /** Injectable so tests never touch the network. */
  readonly fetchImpl?: FetchLike;
  readonly now?: () => number;
}

/**
 * Build the configured provider, if there is one.
 *
 * Performs no I/O: a provider is constructed, not contacted. An unusable key is
 * discovered on the first call, as a normalized `authentication_failed`.
 */
export function resolveAiProvider(
  config: AiConfig,
  options: ResolveOptions = {},
): AiAvailability {
  if (config.status === "disabled") {
    return {
      available: false,
      reason: config.reason,
      error: new AiError({
        code: "not_configured",
        provider: "none",
        message: config.reason,
      }),
    };
  }

  const provider = createProvider(config, options);

  return {
    available: true,
    provider,
    description: `provider=${provider.name} model=${provider.model}`,
  };
}

/**
 * The registry.
 *
 * A `switch` rather than a lookup table, so adding a provider without handling
 * it here is a type error rather than a runtime surprise.
 */
function createProvider(
  config: Extract<AiConfig, { status: "configured" }>,
  options: ResolveOptions,
): AiProvider {
  switch (config.provider) {
    case "gemini":
      return createGeminiProvider({
        apiKey: config.apiKey,
        ...(config.model === null ? {} : { model: config.model }),
        timeoutMs: config.timeoutMs,
        ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
        ...(options.now === undefined ? {} : { now: options.now }),
      });
  }
}

/**
 * Resolve straight from an environment source.
 *
 * A convenience for callers that have no reason to hold a config. Server-side
 * only — `process.env` is the expected argument, and it must never be reached
 * for in client code (ADR-018).
 */
export function resolveAiProviderFromEnv(
  source: Readonly<Record<string, string | undefined>>,
  options: ResolveOptions = {},
): AiAvailability {
  return resolveAiProvider(parseAiEnv(source), options);
}
