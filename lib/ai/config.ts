/**
 * AI configuration, read from the environment.
 *
 * Source of truth: docs/DECISIONS.md ADR-016, ADR-018, ADR-054.
 *
 * ## Misconfiguration never throws
 *
 * Every other variable in `lib/config/env.ts` fails loudly: an invalid value
 * raises `EnvValidationError` and the process does not start. **AI
 * configuration is deliberately the exception.**
 *
 * ADR-016 requires the deterministic report to work without AI. If a typo in
 * `AI_PROVIDER` could stop the application booting, then a variable that exists
 * only to enable an optional enhancement would be able to take down the part
 * that does not need it. So a missing, incomplete or invalid AI configuration
 * produces a `disabled` config carrying the reason, which callers surface and
 * logs record. Nothing else about the application changes.
 *
 * The reason is always specific — "AI_API_KEY is not set" rather than
 * "unavailable" — because a silently disabled feature with no explanation is
 * how an operator loses an afternoon.
 */

/** Adapters this application can construct. Add a name when a file backs it. */
export const AI_PROVIDER_NAMES = ["gemini"] as const;

export type AiProviderName = (typeof AI_PROVIDER_NAMES)[number];

export const DEFAULT_AI_TIMEOUT_MS = 30_000;

/** Bounds on `AI_TIMEOUT_MS`. Outside these, the value is ignored, not fatal. */
export const MIN_AI_TIMEOUT_MS = 1_000;
export const MAX_AI_TIMEOUT_MS = 120_000;

export type AiConfig =
  | {
      readonly status: "configured";
      readonly provider: AiProviderName;
      /** Server-side only. Never logged, never returned to a client (ADR-018). */
      readonly apiKey: string;
      /** Null means "the adapter's default model". */
      readonly model: string | null;
      readonly timeoutMs: number;
    }
  | { readonly status: "disabled"; readonly reason: string };

/** Raw environment source, narrowed so tests can supply one. */
export type AiEnvSource = Readonly<Record<string, string | undefined>>;

function read(source: AiEnvSource, key: string): string | null {
  const raw = source[key];
  const trimmed = raw?.trim() ?? "";

  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Parse the AI variables.
 *
 * Pure, and total: it returns a config for every input and throws for none.
 *
 * @param warnings collects non-fatal problems worth logging, such as an
 *   out-of-range timeout that was ignored. Configuration still succeeds.
 */
export function parseAiEnv(source: AiEnvSource, warnings: string[] = []): AiConfig {
  const providerName = read(source, "AI_PROVIDER");
  const apiKey = read(source, "AI_API_KEY");

  if (providerName === null && apiKey === null) {
    return {
      status: "disabled",
      reason: "AI_PROVIDER and AI_API_KEY are not set.",
    };
  }

  if (providerName === null) {
    return {
      status: "disabled",
      reason: `AI_API_KEY is set but AI_PROVIDER is not. Set it to one of: ${AI_PROVIDER_NAMES.join(", ")}.`,
    };
  }

  if (!(AI_PROVIDER_NAMES as readonly string[]).includes(providerName)) {
    return {
      status: "disabled",
      reason: `AI_PROVIDER "${providerName}" is not a supported provider. Supported: ${AI_PROVIDER_NAMES.join(", ")}.`,
    };
  }

  if (apiKey === null) {
    return {
      status: "disabled",
      reason: `AI_PROVIDER is "${providerName}" but AI_API_KEY is not set.`,
    };
  }

  return {
    status: "configured",
    provider: providerName as AiProviderName,
    apiKey,
    model: read(source, "AI_MODEL"),
    timeoutMs: readTimeout(source, warnings),
  };
}

function readTimeout(source: AiEnvSource, warnings: string[]): number {
  const raw = read(source, "AI_TIMEOUT_MS");
  if (raw === null) return DEFAULT_AI_TIMEOUT_MS;

  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    warnings.push(
      `AI_TIMEOUT_MS "${raw}" is not an integer; using ${DEFAULT_AI_TIMEOUT_MS}ms.`,
    );
    return DEFAULT_AI_TIMEOUT_MS;
  }

  if (parsed < MIN_AI_TIMEOUT_MS || parsed > MAX_AI_TIMEOUT_MS) {
    warnings.push(
      `AI_TIMEOUT_MS ${parsed} is outside ${MIN_AI_TIMEOUT_MS}-${MAX_AI_TIMEOUT_MS}; using ${DEFAULT_AI_TIMEOUT_MS}ms.`,
    );
    return DEFAULT_AI_TIMEOUT_MS;
  }

  return parsed;
}

/**
 * A description of the configuration that is safe to log or display.
 *
 * Never includes the key. Not even a prefix of it: a partial secret is still a
 * secret, and this string is designed to be pasted into a support thread.
 */
export function describeAiConfig(config: AiConfig): string {
  if (config.status === "disabled") {
    return `AI disabled: ${config.reason}`;
  }

  return `AI enabled: provider=${config.provider} model=${config.model ?? "(adapter default)"} timeout=${config.timeoutMs}ms`;
}
