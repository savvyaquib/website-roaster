import { describe, expect, it } from "vitest";

import { parseSetCookie, parseSetCookies } from "./cookies";

describe("parseSetCookie", () => {
  it("reads the name and attributes", () => {
    const cookie = parseSetCookie(
      "sessionid=abc123; Path=/; Domain=example.com; Secure; HttpOnly; SameSite=Lax; Max-Age=3600",
    );

    expect(cookie).toEqual({
      name: "sessionid",
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      domain: "example.com",
      persistent: true,
    });
  });

  it("never captures the value", () => {
    // The value is frequently a live session token. Keeping it out of the data
    // structure is stronger than remembering to redact it downstream.
    const cookie = parseSetCookie("sid=SUPERSECRET; Secure");

    expect(JSON.stringify(cookie)).not.toContain("SUPERSECRET");
    expect(cookie).not.toHaveProperty("value");
  });

  it("reads attributes case-insensitively", () => {
    const cookie = parseSetCookie("a=1; SECURE; httponly; samesite=STRICT");

    expect(cookie?.secure).toBe(true);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("strict");
  });

  it("reports absent attributes as absent", () => {
    const cookie = parseSetCookie("a=1");

    expect(cookie).toEqual({
      name: "a",
      secure: false,
      httpOnly: false,
      sameSite: null,
      path: null,
      domain: null,
      persistent: false,
    });
  });

  it("treats an unrecognised SameSite value as absent", () => {
    expect(parseSetCookie("a=1; SameSite=Nonsense")?.sameSite).toBeNull();
  });

  it("distinguishes a session cookie from a persistent one", () => {
    expect(parseSetCookie("a=1")?.persistent).toBe(false);
    expect(parseSetCookie("a=1; Max-Age=60")?.persistent).toBe(true);
    expect(parseSetCookie("a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT")?.persistent).toBe(
      true,
    );
  });

  it("handles a value containing an equals sign", () => {
    const cookie = parseSetCookie("token=a=b=c; Secure");

    expect(cookie?.name).toBe("token");
    expect(cookie?.secure).toBe(true);
  });

  it("handles a value containing a comma, which is why headers are not joined", () => {
    const cookie = parseSetCookie("prefs=a,b,c; Path=/");

    expect(cookie?.name).toBe("prefs");
    expect(cookie?.path).toBe("/");
  });

  it("returns null when there is no usable name", () => {
    expect(parseSetCookie("")).toBeNull();
    expect(parseSetCookie("novalue")).toBeNull();
    expect(parseSetCookie("=orphaned")).toBeNull();
  });

  it("tolerates irregular spacing", () => {
    const cookie = parseSetCookie("  a = 1 ;   Secure ;  SameSite = Lax ");

    expect(cookie?.name).toBe("a");
    expect(cookie?.secure).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
  });
});

describe("parseSetCookies", () => {
  it("parses every header", () => {
    const cookies = parseSetCookies(["a=1; Secure", "b=2; HttpOnly"]);

    expect(cookies.map((cookie) => cookie.name)).toEqual(["a", "b"]);
  });

  it("drops headers it cannot read rather than failing", () => {
    const cookies = parseSetCookies(["a=1", "garbage", "b=2"]);

    expect(cookies.map((cookie) => cookie.name)).toEqual(["a", "b"]);
  });

  it("returns an empty list for no headers", () => {
    expect(parseSetCookies([])).toEqual([]);
  });
});
