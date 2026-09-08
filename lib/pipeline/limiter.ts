/**
 * How many analyses may run at once.
 *
 * Source of truth: docs/DECISIONS.md ADR-020, ADR-032, ADR-061.
 *
 * Until now the API started every accepted analysis immediately and awaited
 * none of them, so N simultaneous requests meant N simultaneous analyses, each
 * holding sockets and — once the browser pass is wired in — a Chromium process.
 * ADR-032 called concurrency "a real constraint" and left the limit to this
 * phase.
 *
 * ## The queue is what `queued` always meant
 *
 * ADR-011 has had a `queued` state since Phase 0, and until now it lasted
 * microseconds because nothing ever waited. With a limit it becomes real: an
 * analysis beyond the concurrency cap sits in `queued` until a slot frees, and
 * the API and the UI already know how to show that.
 *
 * ## Refusing is better than queueing forever
 *
 * Past a bounded queue depth the answer is 503 rather than an unbounded backlog
 * of work nobody is still waiting for. A queue that accepts everything is a way
 * of failing later and less clearly.
 *
 * No timers, no intervals: a waiter is a promise resolved by whichever slot is
 * released. Nothing here keeps the process alive.
 */

/** Analyses running at once. One browser each, eventually (ADR-032). */
export const DEFAULT_MAX_CONCURRENT = 2;

/** Analyses waiting for a slot before new ones are refused. */
export const DEFAULT_MAX_QUEUED = 20;

export class QueueFullError extends Error {
  constructor(depth: number) {
    super(`The analyzer is busy: ${depth} analyses are already waiting.`);
    this.name = "QueueFullError";
  }
}

export interface LimiterOptions {
  readonly maxConcurrent?: number;
  readonly maxQueued?: number;
}

export interface ConcurrencyLimiter {
  /**
   * Wait for a slot, then run.
   *
   * @throws {QueueFullError} when the queue is already at its depth. Nothing is
   *   run and nothing is queued.
   */
  run<T>(task: () => Promise<T>): Promise<T>;
  readonly active: number;
  readonly queued: number;
}

export function createConcurrencyLimiter(
  options: LimiterOptions = {},
): ConcurrencyLimiter {
  const maxConcurrent = Math.max(1, options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT);
  const maxQueued = Math.max(0, options.maxQueued ?? DEFAULT_MAX_QUEUED);

  let active = 0;
  const waiting: (() => void)[] = [];

  function release(): void {
    active -= 1;

    const next = waiting.shift();
    if (next !== undefined) next();
  }

  async function acquire(): Promise<void> {
    if (active < maxConcurrent) {
      active += 1;
      return;
    }

    if (waiting.length >= maxQueued) throw new QueueFullError(waiting.length);

    await new Promise<void>((resolve) => {
      waiting.push(() => {
        active += 1;
        resolve();
      });
    });
  }

  return {
    async run(task) {
      await acquire();

      try {
        return await task();
      } finally {
        // Always, however the task ended. A slot leaked here would shrink the
        // pool one analysis at a time until nothing could run at all.
        release();
      }
    },

    get active() {
      return active;
    },

    get queued() {
      return waiting.length;
    },
  };
}
