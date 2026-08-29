import { describe, expect, it } from "vitest";

import {
  classifyHostname,
  isSyntacticallyValidHostname,
  normalizeHostname,
} from "./hostname";

describe("normalizeHostname", () => {
  it("lowercases", () => {
    expect(normalizeHostname("EXAMPLE.COM")).toBe("example.com");
  });

  it("strips the trailing root dot", () => {
    expect(normalizeHostname("example.com.")).toBe("example.com");
  });

  it("strips the root dot from localhost, which is the point", () => {
    // `localhost.` resolves to localhost but slips past a naive suffix check.
    expect(normalizeHostname("localhost.")).toBe("localhost");
  });
});

describe("isSyntacticallyValidHostname", () => {
  it.each([
    ["a normal name", "example.com"],
    ["a subdomain", "www.sub.example.co.uk"],
    ["digits", "123.example.com"],
    ["an internal hyphen", "my-site.example.com"],
    ["a punycode label", "xn--exmple-cua.com"],
  ])("accepts %s", (_label, value) => {
    expect(isSyntacticallyValidHostname(value)).toBe(true);
  });

  it.each([
    ["an empty string", ""],
    ["an empty label", "example..com"],
    ["a leading dot", ".example.com"],
    ["a leading hyphen", "-example.com"],
    ["a trailing hyphen", "example-.com"],
    ["an underscore", "my_site.example.com"],
    ["a space", "exa mple.com"],
    ["an over-long label", `${"a".repeat(64)}.com`],
    ["an over-long hostname", `${"a".repeat(60)}.`.repeat(5) + "com"],
  ])("rejects %s", (_label, value) => {
    expect(isSyntacticallyValidHostname(value)).toBe(false);
  });

  it("accepts a label of exactly 63 characters", () => {
    expect(isSyntacticallyValidHostname(`${"a".repeat(63)}.com`)).toBe(true);
  });
});

describe("classifyHostname", () => {
  it.each([
    ["localhost", "localhost", "loopback"],
    ["a localhost subdomain", "api.localhost", "loopback"],
    ["a bare single-label name", "router", "internal_hostname"],
    ["a bare metadata name", "metadata", "internal_hostname"],
    ["an mDNS name", "printer.local", "internal_hostname"],
    ["a .internal name", "db.internal", "internal_hostname"],
    ["a .intranet name", "wiki.intranet", "internal_hostname"],
    ["a .corp name", "files.corp", "internal_hostname"],
    ["a .lan name", "nas.lan", "internal_hostname"],
    ["a .home name", "hub.home", "internal_hostname"],
    ["an RFC 2606 test name", "foo.test", "internal_hostname"],
    ["an RFC 2606 invalid name", "foo.invalid", "internal_hostname"],
    ["a Tor address", "abcdefgh.onion", "internal_hostname"],
    ["a reverse-DNS name", "1.0.0.127.in-addr.arpa", "internal_hostname"],
    ["GCP metadata", "metadata.google.internal", "metadata_endpoint"],
    ["the short GCP metadata name", "metadata.goog", "metadata_endpoint"],
  ])("blocks %s", (_label, hostname, expected) => {
    expect(classifyHostname(hostname)).toBe(expected);
  });

  it.each([
    ["a normal site", "example.com"],
    ["a subdomain", "www.example.com"],
    ["a punycode host", "xn--exmple-cua.com"],
    ["a long TLD", "example.technology"],
    ["a name merely containing 'local'", "localbusiness.com"],
    ["a name merely containing 'corp'", "corporate.com"],
    ["a name ending in a word that only looks internal", "example.homes"],
  ])("allows %s", (_label, hostname) => {
    expect(classifyHostname(hostname)).toBeNull();
  });

  it("matches suffixes on label boundaries, not substrings", () => {
    // `notlocal` must not match the `local` suffix.
    expect(classifyHostname("notlocal")).toBe("internal_hostname"); // single label
    expect(classifyHostname("site.notlocal")).toBeNull();
  });
});
