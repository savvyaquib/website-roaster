import type { LookupAddress } from "node:dns";
import { describe, expect, it } from "vitest";

import {
  BLOCKED_ADDRESS_ERROR_CODE,
  createPinnedLookup,
  type AddressResolver,
} from "./pinned-lookup";
import { publicHttpSecurityPolicy, type HttpSecurityPolicy } from "./policy";

/** Promise wrapper around the callback-style lookup, for readability. */
function resolveOnce(
  lookup: ReturnType<typeof createPinnedLookup>,
  hostname: string,
  all = false,
): Promise<{ error: NodeJS.ErrnoException | null; address: unknown; family?: number }> {
  return new Promise((resolve) => {
    lookup(hostname, { all } as never, (error, address, family) => {
      resolve({ error, address, family });
    });
  });
}

function resolverFor(addresses: readonly LookupAddress[]): AddressResolver {
  return () => Promise.resolve(addresses);
}

const allowAll: HttpSecurityPolicy = {
  validateUrl: () => ({ valid: true, normalizedUrl: "https://example.com/" }),
  validateAddress: () => null,
};

describe("createPinnedLookup", () => {
  it("returns a single validated address", async () => {
    const lookup = createPinnedLookup(
      allowAll,
      resolverFor([{ address: "93.184.216.34", family: 4 }]),
    );

    const { error, address, family } = await resolveOnce(lookup, "example.com");

    expect(error).toBeNull();
    expect(address).toBe("93.184.216.34");
    expect(family).toBe(4);
  });

  it("returns an array when the caller asked for all", async () => {
    const lookup = createPinnedLookup(
      allowAll,
      resolverFor([
        { address: "93.184.216.34", family: 4 },
        { address: "93.184.216.35", family: 4 },
      ]),
    );

    const { error, address } = await resolveOnce(lookup, "example.com", true);

    expect(error).toBeNull();
    // Pinning: one address, even though two were resolved and both allowed.
    expect(address).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it("refuses a public name that resolves to a private address", async () => {
    const lookup = createPinnedLookup(
      publicHttpSecurityPolicy,
      resolverFor([{ address: "10.0.0.1", family: 4 }]),
    );

    const { error } = await resolveOnce(lookup, "evil.example.com");

    expect(error?.code).toBe(BLOCKED_ADDRESS_ERROR_CODE);
    expect(error?.message).toContain("private_network");
  });

  it("refuses a name that resolves to the metadata endpoint", async () => {
    const lookup = createPinnedLookup(
      publicHttpSecurityPolicy,
      resolverFor([{ address: "169.254.169.254", family: 4 }]),
    );

    const { error } = await resolveOnce(lookup, "metadata.example.com");

    expect(error?.code).toBe(BLOCKED_ADDRESS_ERROR_CODE);
    expect(error?.message).toContain("metadata_endpoint");
  });

  it("refuses the whole connection when only one of several addresses is private", async () => {
    // Falling through to the public sibling would let a hostile resolver decide
    // which address we eventually reach.
    const lookup = createPinnedLookup(
      publicHttpSecurityPolicy,
      resolverFor([
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]),
    );

    const { error } = await resolveOnce(lookup, "mixed.example.com");

    expect(error?.code).toBe(BLOCKED_ADDRESS_ERROR_CODE);
    expect(error?.message).toContain("loopback");
  });

  it("refuses an IPv6 address in a blocked range", async () => {
    const lookup = createPinnedLookup(
      publicHttpSecurityPolicy,
      resolverFor([{ address: "::1", family: 6 }]),
    );

    const { error } = await resolveOnce(lookup, "v6.example.com");

    expect(error?.code).toBe(BLOCKED_ADDRESS_ERROR_CODE);
  });

  it("allows a public IPv6 address", async () => {
    const lookup = createPinnedLookup(
      publicHttpSecurityPolicy,
      resolverFor([{ address: "2606:4700:4700::1111", family: 6 }]),
    );

    const { error, address } = await resolveOnce(lookup, "v6.example.com");

    expect(error).toBeNull();
    expect(address).toBe("2606:4700:4700::1111");
  });

  it("reports an empty resolver answer as a DNS failure", async () => {
    const lookup = createPinnedLookup(publicHttpSecurityPolicy, resolverFor([]));

    const { error } = await resolveOnce(lookup, "nowhere.example.com");

    expect(error?.code).toBe("ENOTFOUND");
  });

  it("passes a resolver failure through unchanged", async () => {
    const failure: NodeJS.ErrnoException = new Error("not found");
    failure.code = "ENOTFOUND";

    const lookup = createPinnedLookup(publicHttpSecurityPolicy, () =>
      Promise.reject(failure),
    );

    const { error } = await resolveOnce(lookup, "nope.example.com");

    expect(error).toBe(failure);
  });

  it("refuses an answer that is not an IP address at all", async () => {
    const lookup = createPinnedLookup(
      publicHttpSecurityPolicy,
      resolverFor([{ address: "not-an-address", family: 4 }]),
    );

    const { error } = await resolveOnce(lookup, "broken.example.com");

    expect(error?.code).toBe(BLOCKED_ADDRESS_ERROR_CODE);
    expect(error?.message).toContain("not_an_ip_address");
  });
});
