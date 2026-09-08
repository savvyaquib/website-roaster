/**
 * Rate limiting.
 *
 * Source of truth: docs/DECISIONS.md ADR-020, ADR-032, ADR-061.
 *
 * A fixed window per client, held in memory. ADR-020 rules out Redis until a
 * demonstrated constraint requires it, and ADR-032 puts this on a single
 * long-running Node server, so an in-process counter is the honest match for
 * the architecture as it stands.
 *
 * ## What this does and does not protect against
 *
 * It stops one client starting analyses faster than a person could want them,
 * which is the abuse an anonymous public endpoint actually attracts: a script
 * pointing the analyzer at a list of hosts, and the disk growth every refused
 * submission causes (ADR-057).
 *
 * It does **not** survive a restart, and it is **per process** — two workers
 * would each allow the full rate. Both are consequences of not having shared
 * state, and both are recorded rather than papered over. The concurrency limit
 * in `lib/pipeline/limiter.ts` is the backstop that does bound total work.
 *
 * ## The client key is not trustworthy on its own
 *
 * A direct connection has no header to read, and behind a proxy
 * `x-forwarded-for` is set by that proxy — but it is also trivially spoofed by
 * a client if nothing strips it. `TRUSTED_PROXY=1` says a proxy in front is
 * rewriting the header, and only then is it believed. Without it, every request
 * shares one bucket, which is strict rather than lax: the failure mode is
 * throttling honest users, not letting an attacker past.
 */

/** Requests one client may start in a window. */
export const DEFAULT_LIMIT = 10;

/** The window, in milliseconds. */
export const DEFAULT_WINDOW_MS = 60_000;

/**
 * Distinct clients tracked at once.
 *
 * A bound, because an unbounded map keyed by attacker-supplied values is itself
 * a way to exhaust memory. At the cap the oldest entries go first.
 */
export const MAX_TRACKED_CLIENTS = 10_000;

export interface RateLimitOptions {
  readonly limit?: number;
  readonly windowMs?: number;
  readonly maxClients?: number;
  readonly now?: () => number;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  /** Requests still available in this window. */
  readonly remaining: number;
  /** Seconds until the window resets. For `Retry-After`. */
  readonly retryAfterSeconds: number;
}

export interface RateLimiter {
  check(key: string): RateLimitResult;
  /** Test-only: forget everything. */
  reset(): void;
}

interface Window {
  count: number;
  resetAt: number;
}

export function createRateLimiter(options: RateLimitOptions = {}): RateLimiter {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const maxClients = options.maxClients ?? MAX_TRACKED_CLIENTS;
  const now = options.now ?? Date.now;

  // Insertion-ordered, so evicting the oldest is `keys().next()`.
  const windows = new Map<string, Window>();

  return {
    check(key) {
      const current = now();
      const existing = windows.get(key);

      if (existing === undefined || current >= existing.resetAt) {
        if (windows.size >= maxClients && existing === undefined) {
          const oldest = windows.keys().next();
          if (!oldest.done) windows.delete(oldest.value);
        }

        windows.set(key, { count: 1, resetAt: current + windowMs });

        // A fresh window still has to respect the limit. It used to return
        // `allowed` unconditionally, so a limit of zero let the first request
        // of every window through.
        return limit < 1
          ? {
              allowed: false,
              remaining: 0,
              retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)),
            }
          : { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
      }

      existing.count += 1;

      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((existing.resetAt - current) / 1000),
      );

      return existing.count > limit
        ? { allowed: false, remaining: 0, retryAfterSeconds }
        : {
            allowed: true,
            remaining: Math.max(0, limit - existing.count),
            retryAfterSeconds: 0,
          };
    },

    reset() {
      windows.clear();
    },
  };
}

/**
 * Who a request is from, as far as anything here can tell.
 *
 * @param trustProxy whether an `x-forwarded-for` header should be believed.
 *   False by default: an unproxied deployment that trusted it would let any
 *   client choose its own bucket and defeat the limit entirely.
 */
export function clientKey(request: Request, trustProxy: boolean): string {
  if (!trustProxy) return "shared";

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded === null) return "shared";

  // The leftmost entry is the original client, as appended by the first proxy.
  const first = forwarded.split(",")[0]?.trim() ?? "";

  // Bounded, so a long header cannot become a long map key.
  return first.length === 0 ? "shared" : first.slice(0, 64);
}
