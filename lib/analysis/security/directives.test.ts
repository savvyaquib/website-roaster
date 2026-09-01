import { describe, expect, it } from "vitest";

import { effectiveSources, parseCsp, parseHsts } from "./directives";

describe("parseCsp", () => {
  it("splits directives and sources", () => {
    const parsed = parseCsp("default-src 'self'; script-src 'self' https://cdn.example");

    expect(parsed["default-src"]).toEqual(["'self'"]);
    expect(parsed["script-src"]).toEqual(["'self'", "https://cdn.example"]);
  });

  it("lowercases directive names but preserves source case", () => {
    // A nonce or hash is case-sensitive.
    const parsed = parseCsp("Script-SRC 'nonce-AbC123'");

    expect(parsed["script-src"]).toEqual(["'nonce-AbC123'"]);
  });

  it("keeps a directive with no sources", () => {
    expect(parseCsp("upgrade-insecure-requests")["upgrade-insecure-requests"]).toEqual(
      [],
    );
  });

  it("keeps the first of a repeated directive, as browsers do", () => {
    const parsed = parseCsp("script-src 'self'; script-src 'unsafe-inline'");

    expect(parsed["script-src"]).toEqual(["'self'"]);
  });

  it("tolerates irregular whitespace and trailing semicolons", () => {
    const parsed = parseCsp("  default-src   'self'  ;;  img-src * ; ");

    expect(parsed["default-src"]).toEqual(["'self'"]);
    expect(parsed["img-src"]).toEqual(["*"]);
  });

  it("returns nothing for an empty header", () => {
    expect(parseCsp("")).toEqual({});
  });
});

describe("effectiveSources", () => {
  it("prefers the directive's own sources", () => {
    const parsed = parseCsp("default-src 'none'; script-src 'self'");

    expect(effectiveSources(parsed, "script-src")).toEqual(["'self'"]);
  });

  it("falls back to default-src", () => {
    const parsed = parseCsp("default-src 'self'");

    expect(effectiveSources(parsed, "script-src")).toEqual(["'self'"]);
  });

  it("returns null when neither is present", () => {
    expect(effectiveSources(parseCsp("img-src 'self'"), "script-src")).toBeNull();
  });

  it("does not let frame-ancestors inherit from default-src", () => {
    // frame-ancestors is one of the directives browsers treat as standalone;
    // inheriting would report framing as protected when it is not.
    const parsed = parseCsp("default-src 'self'");

    expect(effectiveSources(parsed, "frame-ancestors")).toBeNull();
  });
});

describe("parseHsts", () => {
  it("reads max-age and flags", () => {
    expect(parseHsts("max-age=31536000; includeSubDomains; preload")).toEqual({
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    });
  });

  it("is case-insensitive", () => {
    expect(parseHsts("MAX-AGE=100; INCLUDESUBDOMAINS").includeSubDomains).toBe(true);
  });

  it("reads a quoted max-age", () => {
    expect(parseHsts('max-age="600"').maxAge).toBe(600);
  });

  it("distinguishes max-age=0 from an absent max-age", () => {
    // Zero switches HSTS off; absent means the header is malformed. They call
    // for different advice.
    expect(parseHsts("max-age=0").maxAge).toBe(0);
    expect(parseHsts("includeSubDomains").maxAge).toBeNull();
  });

  it("reports an unparseable max-age as absent", () => {
    expect(parseHsts("max-age=forever").maxAge).toBeNull();
    expect(parseHsts("max-age=-5").maxAge).toBeNull();
  });

  it("returns defaults for an empty header", () => {
    expect(parseHsts("")).toEqual({
      maxAge: null,
      includeSubDomains: false,
      preload: false,
    });
  });
});
