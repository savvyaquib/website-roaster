import { describe, expect, it } from "vitest";

import {
  clientKey,
  createRateLimiter,
  DEFAULT_LIMIT,
  DEFAULT_WINDOW_MS,
} from "./rate-limit";

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/analyze", { method: "POST", headers });
}

describe("the window", () => {
  it("allows up to the limit", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000 });

    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(true);
  });

  it("refuses the one after", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000 });

    for (let index = 0; index < 3; index += 1) limiter.check("a");

    expect(limiter.check("a").allowed).toBe(false);
  });

  it("counts down what is left", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000 });

    expect(limiter.check("a").remaining).toBe(2);
    expect(limiter.check("a").remaining).toBe(1);
    expect(limiter.check("a").remaining).toBe(0);
  });

  it("says how long to wait", () => {
    let clock = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => clock });

    limiter.check("a");
    clock += 10_000;

    expect(limiter.check("a").retryAfterSeconds).toBe(50);
  });

  it("never asks a client to retry in zero seconds", () => {
    let clock = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => clock });

    limiter.check("a");
    clock += 999;

    expect(limiter.check("a").retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("starts a fresh window once the old one passes", () => {
    let clock = 0;
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => clock });

    limiter.check("a");
    limiter.check("a");
    expect(limiter.check("a").allowed).toBe(false);

    clock += 1001;

    expect(limiter.check("a").allowed).toBe(true);
  });

  it("counts each client separately", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });

    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("b").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
  });

  it("has sane defaults", () => {
    // Ten analyses a minute is far above what a person does and far below what
    // a script wants.
    expect(DEFAULT_LIMIT).toBeGreaterThan(1);
    expect(DEFAULT_LIMIT).toBeLessThan(100);
    expect(DEFAULT_WINDOW_MS).toBe(60_000);
  });
});

describe("memory", () => {
  it("does not grow without bound", () => {
    // The map is keyed by a client-supplied value, so an unbounded one would
    // be its own way to exhaust memory.
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxClients: 10 });

    for (let index = 0; index < 1000; index += 1) limiter.check(`client-${index}`);

    // The earliest keys were evicted, so an early client gets a fresh window
    // rather than the limiter holding a thousand entries.
    expect(limiter.check("client-0").allowed).toBe(true);
  });

  it("keeps the most recent clients", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxClients: 5 });

    for (let index = 0; index < 5; index += 1) limiter.check(`client-${index}`);

    expect(limiter.check("client-4").allowed).toBe(false);
  });

  it("refuses everything when the limit is zero", () => {
    // A fresh window used to skip the check, so the first request of every
    // window went through however low the limit was.
    const limiter = createRateLimiter({ limit: 0, windowMs: 1000 });

    expect(limiter.check("a").allowed).toBe(false);
    expect(limiter.check("b").allowed).toBe(false);
  });

  it("never reports negative headroom", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });

    limiter.check("a");
    limiter.check("a");

    expect(limiter.check("a").remaining).toBeGreaterThanOrEqual(0);
  });

  it("forgets everything on reset", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });

    limiter.check("a");
    limiter.reset();

    expect(limiter.check("a").allowed).toBe(true);
  });
});

describe("identifying a client", () => {
  it("ignores x-forwarded-for by default", () => {
    // Nothing strips that header on a direct connection, so believing it would
    // let any client pick its own bucket and defeat the limit entirely.
    expect(clientKey(request({ "x-forwarded-for": "1.2.3.4" }), false)).toBe("shared");
  });

  it("reads it when a trusted proxy is in front", () => {
    expect(clientKey(request({ "x-forwarded-for": "1.2.3.4" }), true)).toBe("1.2.3.4");
  });

  it("takes the leftmost entry, which the first proxy appended", () => {
    expect(
      clientKey(request({ "x-forwarded-for": "1.2.3.4, 10.0.0.1, 10.0.0.2" }), true),
    ).toBe("1.2.3.4");
  });

  it("falls back to one bucket when the header is absent", () => {
    expect(clientKey(request(), true)).toBe("shared");
  });

  it("falls back when the header is empty", () => {
    expect(clientKey(request({ "x-forwarded-for": "   " }), true)).toBe("shared");
  });

  it("bounds the key, so a long header cannot become a long map key", () => {
    const key = clientKey(request({ "x-forwarded-for": "a".repeat(5000) }), true);

    expect(key.length).toBeLessThanOrEqual(64);
  });

  it("shares one bucket rather than none when it cannot tell clients apart", () => {
    // Strict, not lax: the failure mode is throttling honest traffic, never
    // letting an attacker past.
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });

    expect(limiter.check(clientKey(request(), false)).allowed).toBe(true);
    expect(limiter.check(clientKey(request(), false)).allowed).toBe(false);
  });
});
