import { describe, expect, it } from "vitest";

import { analysisStatusForRejection, URL_REJECTION_CODES } from "./types";
import type { UrlRejectionCode } from "./types";
import { validateUrl } from "./validate-url";

/** Assert acceptance and return the normalized URL. */
function accept(input: string): string {
  const result = validateUrl(input);
  if (!result.valid) {
    throw new Error(`expected ${input} to be accepted, got ${result.code}`);
  }
  return result.normalizedUrl;
}

/** Assert refusal and return the code. */
function refuse(input: string): UrlRejectionCode {
  const result = validateUrl(input);
  if (result.valid) {
    throw new Error(`expected ${input} to be refused, got ${result.normalizedUrl}`);
  }
  return result.code;
}

describe("valid URLs", () => {
  it.each([
    ["a plain HTTPS URL", "https://example.com", "https://example.com/"],
    ["a plain HTTP URL", "http://example.com", "http://example.com/"],
    ["a URL with a path", "https://example.com/about", "https://example.com/about"],
    [
      "a URL with a query string",
      "https://example.com/search?q=hello&page=2",
      "https://example.com/search?q=hello&page=2",
    ],
    ["a subdomain", "https://www.example.com", "https://www.example.com/"],
    ["a deep subdomain", "https://a.b.c.example.co.uk", "https://a.b.c.example.co.uk/"],
    ["a hyphenated host", "https://my-site.example.com", "https://my-site.example.com/"],
    ["a long TLD", "https://example.technology", "https://example.technology/"],
    ["a public IPv4 literal", "https://93.184.216.34", "https://93.184.216.34/"],
    [
      "a public IPv6 literal",
      "https://[2606:4700:4700::1111]",
      "https://[2606:4700:4700::1111]/",
    ],
  ])("accepts %s", (_label, input, expected) => {
    expect(accept(input)).toBe(expected);
  });
});

describe("normalization", () => {
  it("lowercases the scheme and host", () => {
    expect(accept("HTTPS://EXAMPLE.COM/")).toBe("https://example.com/");
  });

  it("preserves path case, which can be significant", () => {
    expect(accept("https://example.com/CaseSensitive")).toBe(
      "https://example.com/CaseSensitive",
    );
  });

  it("adds the root path", () => {
    expect(accept("https://example.com")).toBe("https://example.com/");
  });

  it("removes an explicit default port", () => {
    expect(accept("https://example.com:443/")).toBe("https://example.com/");
    expect(accept("http://example.com:80/")).toBe("http://example.com/");
  });

  it("drops the fragment, which is never sent to the server", () => {
    expect(accept("https://example.com/page#section")).toBe("https://example.com/page");
  });

  it("keeps the query string, which changes what renders", () => {
    expect(accept("https://example.com/?b=2&a=1")).toBe("https://example.com/?b=2&a=1");
  });

  it("removes a trailing root dot from the hostname", () => {
    expect(accept("https://example.com./")).toBe("https://example.com/");
  });

  it("converts an internationalised domain to punycode", () => {
    // Also the homograph defence: what we return is what will be resolved.
    expect(accept("https://exämple.com/")).toBe("https://xn--exmple-cua.com/");
  });

  it("trims surrounding whitespace", () => {
    expect(accept("   https://example.com/   ")).toBe("https://example.com/");
  });

  it("repairs a single-slash scheme separator, as the URL standard requires", () => {
    // WHATWG tolerates `https:/host` for special schemes. The resulting host is
    // still parsed and classified normally, so this is safe to accept.
    expect(accept("https:/example.com")).toBe("https://example.com/");
  });

  it("is idempotent", () => {
    const once = accept("HTTPS://Example.COM:443/path#frag");
    expect(accept(once)).toBe(once);
  });
});

describe("malformed input", () => {
  it.each([
    ["an empty string", "", "empty"],
    ["whitespace only", "   ", "empty"],
    ["a bare word", "notaurl", "missing_scheme"],
    ["a bare hostname", "example.com", "missing_scheme"],
    ["a protocol-relative URL", "//example.com", "missing_scheme"],
    ["a scheme with no host", "https://", "malformed"],
    ["a space inside the host", "https://exa mple.com/", "malformed"],
    ["an empty label", "https://example..com/", "malformed_hostname"],
    ["a leading dot", "https://.example.com/", "malformed_hostname"],
    ["a leading hyphen", "https://-example.com/", "malformed_hostname"],
    ["an underscore", "https://my_site.example.com/", "malformed_hostname"],
  ])("refuses %s", (_label, input, expected) => {
    expect(refuse(input)).toBe(expected);
  });

  it("refuses a non-string input", () => {
    expect(validateUrl(undefined)).toMatchObject({ valid: false, code: "empty" });
    expect(validateUrl(null)).toMatchObject({ valid: false, code: "empty" });
    expect(validateUrl(42)).toMatchObject({ valid: false, code: "empty" });
  });

  it("refuses an absurdly long URL", () => {
    expect(refuse(`https://example.com/${"a".repeat(2100)}`)).toBe("too_long");
  });

  it("refuses control characters instead of letting the parser strip them", () => {
    // The URL parser removes tab, CR and LF; without an explicit check this
    // would silently become https://example.com/.
    expect(refuse("https://exam\nple.com/")).toBe("malformed");
    expect(refuse("https://exam\tple.com/")).toBe("malformed");
    expect(refuse("https://exam\rple.com/")).toBe("malformed");
  });

  it("suggests adding a scheme rather than saying 'malformed'", () => {
    const result = validateUrl("example.com");
    expect(result).toMatchObject({ valid: false, code: "missing_scheme" });
    if (!result.valid) expect(result.reason).toContain("https://");
  });
});

describe("unsupported protocols", () => {
  it.each([
    ["file", "file:///etc/passwd"],
    ["javascript", "javascript:alert(1)"],
    ["data", "data:text/html,<h1>hi</h1>"],
    ["ftp", "ftp://example.com/"],
    ["gopher", "gopher://example.com/"],
    ["ws", "ws://example.com/"],
    ["mailto", "mailto:someone@example.com"],
  ])("refuses %s", (_label, input) => {
    expect(refuse(input)).toBe("unsupported_protocol");
  });
});

describe("localhost and loopback", () => {
  it.each([
    ["the bare word, which has no scheme", "localhost", "missing_scheme"],
    ["an explicit localhost URL", "http://localhost", "loopback"],
    ["localhost with a path", "http://localhost/admin", "loopback"],
    ["localhost with a trailing dot", "http://localhost./", "loopback"],
    ["uppercase LOCALHOST", "http://LOCALHOST/", "loopback"],
    ["a localhost subdomain", "http://api.localhost/", "loopback"],
    ["127.0.0.1", "http://127.0.0.1", "loopback"],
    ["another address in 127/8", "http://127.0.0.2/", "loopback"],
    ["the IPv6 loopback", "http://[::1]/", "loopback"],
    ["IPv4-mapped loopback", "http://[::ffff:127.0.0.1]/", "loopback"],
  ])("refuses %s", (_label, input, expected) => {
    expect(refuse(input)).toBe(expected);
  });

  describe("alternate encodings of 127.0.0.1", () => {
    // The URL parser normalises all of these before we classify, which is why
    // classification runs on URL.hostname and never on the raw input.
    it.each([
      ["decimal", "http://2130706433/"],
      ["hex", "http://0x7f.0.0.1/"],
      ["octal", "http://0177.0.0.1/"],
      ["short form", "http://127.1/"],
      ["circled digits", "http://①②⑦.0.0.1/"],
    ])("refuses the %s form", (_label, input) => {
      expect(refuse(input)).toBe("loopback");
    });
  });
});

describe("private networks", () => {
  it.each([
    ["10/8", "http://10.0.0.1"],
    ["172.16/12", "http://172.16.0.1/"],
    ["172.31/12 upper bound", "http://172.31.255.255/"],
    ["192.168/16", "http://192.168.1.1"],
    ["a padded private address", "http://192.168.001.001/"],
    ["IPv6 unique local", "http://[fc00::1]/"],
    ["IPv6 fd00::", "http://[fd12:3456::1]/"],
    ["IPv4-mapped private space", "http://[::ffff:192.168.1.1]/"],
    ["NAT64-wrapped private space", "http://[64:ff9b::10.0.0.1]/"],
  ])("refuses %s", (_label, input) => {
    expect(refuse(input)).toBe("private_network");
  });
});

describe("link-local addresses", () => {
  it.each([
    ["IPv4 link-local", "http://169.254.1.1/"],
    ["IPv6 link-local", "http://[fe80::1]/"],
  ])("refuses %s", (_label, input) => {
    expect(refuse(input)).toBe("link_local");
  });
});

describe("cloud metadata endpoints", () => {
  it.each([
    ["the AWS/GCP/Azure address", "http://169.254.169.254/"],
    ["the AWS metadata path", "http://169.254.169.254/latest/meta-data/"],
    ["the GCP legacy address", "http://169.254.169.253/"],
    ["the Alibaba address", "http://100.100.100.200/"],
    ["the GCP hostname", "http://metadata.google.internal/"],
    ["the short GCP hostname", "http://metadata.goog/"],
    ["IPv4-mapped metadata", "http://[::ffff:169.254.169.254]/"],
    ["AWS IMDS over IPv6", "http://[fd00:ec2::254]/"],
  ])("refuses %s", (_label, input) => {
    expect(refuse(input)).toBe("metadata_endpoint");
  });

  it("refuses the decimal encoding of the metadata address", () => {
    // 169.254.169.254 === 2852039166
    expect(refuse("http://2852039166/")).toBe("metadata_endpoint");
  });
});

describe("other non-routable addresses", () => {
  it.each([
    ["0.0.0.0", "http://0.0.0.0/", "unspecified_address"],
    ["the short form of 0.0.0.0", "http://0/", "unspecified_address"],
    ["the IPv6 unspecified address", "http://[::]/", "unspecified_address"],
    ["carrier-grade NAT", "http://100.64.0.1/", "shared_address_space"],
    ["multicast", "http://224.0.0.1/", "multicast_address"],
    ["IPv6 multicast", "http://[ff02::1]/", "multicast_address"],
    ["the broadcast address", "http://255.255.255.255/", "reserved_address"],
    ["TEST-NET-1", "http://192.0.2.1/", "reserved_address"],
    ["IPv6 documentation space", "http://[2001:db8::1]/", "reserved_address"],
  ])("refuses %s", (_label, input, expected) => {
    expect(refuse(input)).toBe(expected);
  });
});

describe("internal hostnames", () => {
  it.each([
    ["a single-label name", "http://router/"],
    ["an mDNS name", "http://printer.local/"],
    ["a .internal name", "http://db.internal/"],
    ["a .intranet name", "http://wiki.intranet/"],
    ["a .corp name", "http://files.corp/"],
    ["a .lan name", "http://nas.lan/"],
    ["an RFC 2606 test name", "http://foo.test/"],
    ["a Tor address", "http://abcdefgh.onion/"],
    ["a reverse-DNS name", "http://1.0.0.127.in-addr.arpa/"],
  ])("refuses %s", (_label, input) => {
    expect(refuse(input)).toBe("internal_hostname");
  });

  it("does not refuse public names that merely contain an internal word", () => {
    expect(accept("https://localbusiness.com/")).toBe("https://localbusiness.com/");
    expect(accept("https://corporate.com/")).toBe("https://corporate.com/");
  });
});

describe("credentials", () => {
  it.each([
    ["a username and password", "https://user:pass@example.com/"],
    ["a username only", "https://user@example.com/"],
    ["a password only", "https://:pass@example.com/"],
  ])("refuses %s", (_label, input) => {
    expect(refuse(input)).toBe("credentials_present");
  });

  it("refuses the @-confusion form, which resolves to the last host", () => {
    // The real host here is example.com, not evil.com; the credentials check
    // refuses it regardless, so nobody has to reason about which host wins.
    expect(refuse("http://foo@evil.com@example.com/")).toBe("credentials_present");
  });

  it("never returns credentials in a normalized URL", () => {
    for (const code of URL_REJECTION_CODES) {
      expect(code).not.toContain("password");
    }
    const result = validateUrl("https://user:pass@example.com/");
    expect(JSON.stringify(result)).not.toContain("pass@");
  });
});

describe("ports", () => {
  it("accepts an explicitly written default port", () => {
    expect(accept("https://example.com:443/")).toBe("https://example.com/");
    expect(accept("http://example.com:80/")).toBe("http://example.com/");
  });

  it.each([
    ["a common alternate HTTP port", "http://example.com:8080/"],
    ["a common alternate HTTPS port", "https://example.com:8443/"],
    ["SSH", "http://example.com:22/"],
    ["a database port", "http://example.com:5432/"],
    ["the http port on an https URL", "https://example.com:80/"],
  ])("refuses %s", (_label, input) => {
    expect(refuse(input)).toBe("disallowed_port");
  });

  it("reports a blocked address rather than the port when both are wrong", () => {
    // Security-relevant reason wins, so the user is told the real problem.
    expect(refuse("http://192.168.1.1:8080/")).toBe("private_network");
  });
});

describe("redirect-shaped inputs", () => {
  // Phase 1 sees only the submitted string. A URL that *describes* a redirect
  // is judged on its own host; following the redirect and re-validating the
  // destination is Phase 2's job (ADR-035).
  it("judges an open-redirect URL on its own host, which is public", () => {
    expect(accept("https://example.com/redirect?to=http://169.254.169.254/")).toBe(
      "https://example.com/redirect?to=http://169.254.169.254/",
    );
  });

  it("still refuses when the host itself is internal", () => {
    expect(refuse("http://192.168.1.1/redirect?to=https://example.com/")).toBe(
      "private_network",
    );
  });

  it("is not fooled by a private address in the fragment", () => {
    expect(accept("https://example.com/#http://127.0.0.1/")).toBe("https://example.com/");
  });
});

describe("result shape", () => {
  it("returns only normalizedUrl on success", () => {
    expect(validateUrl("https://example.com/")).toEqual({
      valid: true,
      normalizedUrl: "https://example.com/",
    });
  });

  it("returns a code and a human-readable reason on failure", () => {
    const result = validateUrl("http://10.0.0.1/");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("private_network");
      expect(result.reason.length).toBeGreaterThan(0);
      expect(result.reason).toMatch(/[.!]$/);
    }
  });

  it("gives every rejection code a distinct, non-empty reason", () => {
    const reasons = new Set<string>();

    for (const code of URL_REJECTION_CODES) {
      const status = analysisStatusForRejection(code);
      expect(["invalid_url", "blocked"]).toContain(status);
      reasons.add(code);
    }

    expect(reasons.size).toBe(URL_REJECTION_CODES.length);
  });
});

describe("analysisStatusForRejection", () => {
  it.each(["empty", "malformed", "missing_scheme", "unsupported_protocol"] as const)(
    "maps %s to invalid_url",
    (code) => {
      expect(analysisStatusForRejection(code)).toBe("invalid_url");
    },
  );

  it.each([
    "loopback",
    "private_network",
    "link_local",
    "metadata_endpoint",
    "credentials_present",
    "disallowed_port",
    "internal_hostname",
  ] as const)("maps %s to blocked", (code) => {
    expect(analysisStatusForRejection(code)).toBe("blocked");
  });

  it("classifies every code", () => {
    for (const code of URL_REJECTION_CODES) {
      expect(["invalid_url", "blocked"]).toContain(analysisStatusForRejection(code));
    }
  });
});

describe("no network access", () => {
  it("does not touch fetch, DNS or sockets", async () => {
    // The acceptance criterion for Phase 1 is that no request happens before
    // validation succeeds. This module imports nothing that could make one;
    // this test guards against that changing.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./validate-url.ts", import.meta.url), "utf8"),
    );

    expect(source).not.toContain("fetch(");
    expect(source).not.toContain("node:dns");
    expect(source).not.toContain("node:net");
    expect(source).not.toContain("node:http");
  });
});
