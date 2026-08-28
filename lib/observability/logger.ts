/**
 * Minimal structured logger.
 *
 * Source of truth: CLAUDE.md § OBSERVABILITY.
 *
 * Analysis steps must be observable, and every analyzer from Phase 2 onwards
 * needs a consistent way to emit events. This exists now so that those phases
 * do not each invent their own `console.log` conventions.
 *
 * Deliberately not a dependency: one level filter and one JSON line is the
 * whole requirement today (ADR-023). If we later need transports, sampling or
 * log shipping, replace the sink — callers do not change.
 */

import { getServerEnv, type LogLevel } from "@/lib/config/env";

/** The levels that can actually appear in output. `silent` is a threshold, not a level. */
type EmittableLevel = Exclude<LogLevel, "silent">;

const LEVEL_RANK: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  /** Above every emittable level, so nothing passes the threshold. */
  silent: 100,
};

/**
 * Structured context attached to a log line.
 *
 * Values are restricted to primitives so that a log line is always trivially
 * serialisable and no accidental object graph (or secret-bearing object) is
 * dumped into the output.
 */
export type LogFields = Readonly<Record<string, string | number | boolean | null>>;

export interface LogRecord {
  readonly timestamp: string;
  readonly level: EmittableLevel;
  readonly scope: string;
  /** Stable event name, e.g. `analysis.started`. */
  readonly event: string;
  readonly fields?: LogFields;
}

/** Where finished records go. Swappable so tests can assert on output. */
export type LogSink = (record: LogRecord) => void;

export interface Logger {
  readonly scope: string;
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  /** Derive a logger for a narrower scope, e.g. `analysis` -> `analysis.seo`. */
  child(scope: string): Logger;
}

export interface LoggerOptions {
  /** Minimum level to emit. Defaults to the validated `LOG_LEVEL`. */
  readonly level?: LogLevel;
  /** Defaults to writing one JSON line to stdout/stderr. */
  readonly sink?: LogSink;
  /** Defaults to `Date.now`-based ISO timestamps. Injectable for tests. */
  readonly now?: () => Date;
}

/** Default sink: one JSON object per line. Errors go to stderr. */
export const consoleSink: LogSink = (record) => {
  const line = JSON.stringify(record);

  if (record.level === "error" || record.level === "warn") {
    process.stderr.write(`${line}\n`);
    return;
  }

  process.stdout.write(`${line}\n`);
};

export function createLogger(scope: string, options: LoggerOptions = {}): Logger {
  const sink = options.sink ?? consoleSink;
  const now = options.now ?? (() => new Date());
  const level = options.level ?? getServerEnv().logLevel;
  const threshold = LEVEL_RANK[level];

  function emit(recordLevel: EmittableLevel, event: string, fields?: LogFields): void {
    if (LEVEL_RANK[recordLevel] < threshold) {
      return;
    }

    sink({
      timestamp: now().toISOString(),
      level: recordLevel,
      scope,
      event,
      ...(fields === undefined ? {} : { fields }),
    });
  }

  return {
    scope,
    debug: (event, fields) => emit("debug", event, fields),
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
    child: (childScope) =>
      createLogger(`${scope}.${childScope}`, { ...options, level, sink, now }),
  };
}
