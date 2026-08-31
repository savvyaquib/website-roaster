import type { LookupAddress } from "node:dns";
import { describe, expect, it } from "vitest";

import { publicHttpSecurityPolicy, type HttpSecurityPolicy } from "@/lib/analysis/http";
import type { AddressResolver } from "@/lib/analysis/http";

import { createNavigationGuard } from "./navigation-guard";

function resolverFor(addresses: readonly LookupAddress[]): AddressResolver {
  return () => Promise.resolve(addresses);
}

const publicAddress: AddressResolver = resolverFor([
  { address: "93.184.216.34", family: 4 },
]);

function guardWith(
  policy: HttpSecurityPolicy = publicHttpSecurityPolicy,
  resolver: AddressResolver = publicAddress,
) {
  return createNavigationGuard({ policy, resolver });
}

describe("scheme handling", () => {
  it.each([
    ["a data URI", "data:image/png;base64,iVBORw0KGgo="],
    ["a blob URL", "blob:https://example.com/1234"],
    ["about:blank", "about:blank"],
  ])("allows %s without a lookup", async (_label, url) => {
    const guard = createNavigationGuard({
      policy: publicHttpSecurityPolicy,
      resolver: () => Promise.reject(new Error("should not resolve")),
    });

    expect(await guard.check(url)).toEqual({ allowed: true, reason: null });
  });

  it.each([
    ["a file URL", "file:///etc/passwd"],
    ["an FTP URL", "ftp://example.com/x"],
  ])("refuses %s", async (_label, url) => {
    const guard = guardWith();
    const decision = await guard.check(url);

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("unsupported_protocol");
  });

  it("refuses a malformed URL", async () => {
    const decision = await guardWith().check("http://[malformed");

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("malformed");
  });
});

describe("URL-level policy", () => {
  it("allows an ordinary public subresource", async () => {
    const decision = await guardWith().check("https://cdn.example.com/app.js");

    expect(decision).toEqual({ allowed: true, reason: null });
  });

  it.each([
    ["the metadata endpoint", "http://169.254.169.254/latest/meta-data/"],
    ["a private address", "http://192.168.1.1/admin"],
    ["loopback", "http://127.0.0.1:8080/"],
    ["localhost", "http://localhost/"],
    ["an internal hostname", "http://db.internal/"],
  ])("refuses %s", async (_label, url) => {
    const decision = await guardWith().check(url);

    expect(decision.allowed).toBe(false);
  });

  it("records refused URLs, deduplicated and in order", async () => {
    const guard = guardWith();

    await guard.check("http://169.254.169.254/a");
    await guard.check("http://192.168.1.1/b");
    await guard.check("http://169.254.169.254/a");

    expect(guard.blocked).toEqual(["http://169.254.169.254/a", "http://192.168.1.1/b"]);
  });

  it("does not record allowed URLs", async () => {
    const guard = guardWith();

    await guard.check("https://example.com/ok.js");

    expect(guard.blocked).toEqual([]);
  });
});

describe("address-level policy", () => {
  it("refuses a public hostname that resolves to a private address", async () => {
    // The attack Phase 1 cannot see: the name is fine, the address is not.
    const guard = guardWith(
      publicHttpSecurityPolicy,
      resolverFor([{ address: "10.0.0.1", family: 4 }]),
    );

    const decision = await guard.check("https://sneaky.example.com/x");

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("private_network");
  });

  it("refuses when any resolved address is private", async () => {
    const guard = guardWith(
      publicHttpSecurityPolicy,
      resolverFor([
        { address: "93.184.216.34", family: 4 },
        { address: "169.254.169.254", family: 4 },
      ]),
    );

    const decision = await guard.check("https://mixed.example.com/x");

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("metadata_endpoint");
  });

  it("allows a name that resolves entirely to public addresses", async () => {
    const guard = guardWith(
      publicHttpSecurityPolicy,
      resolverFor([
        { address: "93.184.216.34", family: 4 },
        { address: "2606:4700:4700::1111", family: 6 },
      ]),
    );

    expect(await guard.check("https://example.com/x")).toEqual({
      allowed: true,
      reason: null,
    });
  });

  it("lets an unresolvable host through so the browser reports the real error", async () => {
    // Refusing here would report a security block for what is actually a
    // broken DNS record, which would mislead the user (ADR-021).
    const guard = guardWith(publicHttpSecurityPolicy, () =>
      Promise.reject(new Error("ENOTFOUND")),
    );

    expect(await guard.check("https://nowhere.example.com/x")).toEqual({
      allowed: true,
      reason: null,
    });
  });
});

describe("resolution caching", () => {
  it("resolves each host once, however many requests it makes", async () => {
    let calls = 0;
    const guard = guardWith(publicHttpSecurityPolicy, () => {
      calls += 1;
      return Promise.resolve([{ address: "93.184.216.34", family: 4 }]);
    });

    for (let i = 0; i < 25; i += 1) {
      await guard.check(`https://cdn.example.com/asset-${i}.js`);
    }

    expect(calls).toBe(1);
  });

  it("resolves distinct hosts separately", async () => {
    const seen: string[] = [];
    const guard = guardWith(publicHttpSecurityPolicy, (hostname) => {
      seen.push(hostname);
      return Promise.resolve([{ address: "93.184.216.34", family: 4 }]);
    });

    await guard.check("https://a.example.com/x");
    await guard.check("https://b.example.com/x");
    await guard.check("https://a.example.com/y");

    expect(seen).toEqual(["a.example.com", "b.example.com"]);
  });

  it("caches concurrent lookups of the same host into one resolution", async () => {
    let calls = 0;
    const guard = guardWith(publicHttpSecurityPolicy, () => {
      calls += 1;
      return new Promise((resolve) =>
        setTimeout(() => resolve([{ address: "93.184.216.34", family: 4 }]), 10),
      );
    });

    await Promise.all([
      guard.check("https://cdn.example.com/1.js"),
      guard.check("https://cdn.example.com/2.js"),
      guard.check("https://cdn.example.com/3.js"),
    ]);

    expect(calls).toBe(1);
  });
});
