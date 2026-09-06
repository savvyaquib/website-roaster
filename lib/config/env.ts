/**
 * Server environment parsing and validation.
 *
 * Source of truth: docs/DECISIONS.md ADR-018 (Provider Secrets).
 *
 * Rules enforced here:
 *
 *  - environment access is centralised; application code reads `getServerEnv()`
 *    rather than `process.env` directly, so that every variable has one
 *    documented type and one validation site;
 *  - this module is server-only. Importing it in the browser throws, which
 *    prevents a secret from being accidentally bundled into client code.
 *
 * Variables are added here as the phases that need them are implemented. Do not
 * add a variable before something reads it.
 */

import { parseAiEnv, type AiConfig } from "@/lib/ai/config";

export const NODE_ENVS = ["development", "test", "production"] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface ServerEnv {
  readonly nodeEnv: NodeEnv;
  readonly logLevel: LogLevel;
  /**
   * AI provider configuration.
   *
   * Parsed by `lib/ai/config.ts`, which owns the vendor vocabulary. Unlike
   * every other variable here, an invalid value **does not throw**: AI is an
   * optional enhancement and must never be able to stop the deterministic
   * report from working (ADR-016). Problems arrive as `status: "disabled"`
   * with a reason, and as entries in `aiWarnings`.
   */
  readonly ai: AiConfig;
  /** Non-fatal AI configuration problems, for logging at startup. */
  readonly aiWarnings: readonly string[];
}

/** Raw environment source. Narrower than `process.env` so tests can supply one. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

export class EnvValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join("\n  - ")}`);
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

function readEnum<T extends string>(
  source: EnvSource,
  key: string,
  allowed: readonly T[],
  fallback: T,
  issues: string[],
): T {
  const raw = source[key];

  if (raw === undefined || raw === "") {
    return fallback;
  }

  if ((allowed as readonly string[]).includes(raw)) {
    return raw as T;
  }

  issues.push(`${key} must be one of ${allowed.join(", ")} (received "${raw}")`);
  return fallback;
}

/**
 * Validate an environment source into a typed configuration object.
 *
 * Pure: it reads nothing global, so it is directly testable.
 *
 * @throws {EnvValidationError} if any variable is present but invalid.
 */
export function parseServerEnv(source: EnvSource): ServerEnv {
  const issues: string[] = [];

  const nodeEnv = readEnum(source, "NODE_ENV", NODE_ENVS, "development", issues);
  const logLevel = readEnum(
    source,
    "LOG_LEVEL",
    LOG_LEVELS,
    nodeEnv === "test" ? "silent" : "info",
    issues,
  );

  if (issues.length > 0) {
    throw new EnvValidationError(issues);
  }

  // Parsed after the throw above, and never contributing to it: an AI
  // misconfiguration disables AI rather than stopping the application
  // (ADR-016). See lib/ai/config.ts.
  const aiWarnings: string[] = [];
  const ai = parseAiEnv(source, aiWarnings);

  return Object.freeze({
    nodeEnv,
    logLevel,
    ai,
    aiWarnings: Object.freeze(aiWarnings),
  });
}

let cached: ServerEnv | undefined;

/**
 * The validated environment for this process.
 *
 * Memoised, because the environment cannot change while the process is running
 * and repeated validation would just be noise.
 *
 * @throws {Error} if called from browser code.
 * @throws {EnvValidationError} if the environment is invalid.
 */
export function getServerEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error(
      "getServerEnv() was called in the browser. Server configuration must never reach client code (ADR-018).",
    );
  }

  cached ??= parseServerEnv(process.env);
  return cached;
}

/** Test-only: clear the memoised environment. */
export function resetServerEnvCache(): void {
  cached = undefined;
}
