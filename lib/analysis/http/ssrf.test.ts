/**
 * SSRF regression tests for the retrieval layer.
 *
 * Source of truth: docs/DECISIONS.md ADR-035, ADR-041.
 *
 * These exist because the SSRF defence is layered across phases, and a layer
 * that quietly stops applying would not fail any other test. The URL checks are
 * covered in the Phase 1 suite; what is proven here is the part that only shows
 * up in combination — that **address** validation applies to every redirect
 * hop, not only to the first request.
 */

import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";

import { fetchPage } from "./fetch-page";
import { createPinnedLookup, type AddressResolver } from "./pinned-lookup";
import { publicHttpSecurityPolicy, type HttpSecurityPolicy } from "./policy";

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

async function withServer(
  handler: Handler,
  body: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  try {
    await body(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/**
 * Permits the local server, and permits `sneaky.example` at the **URL** layer
 * so the test turns on whether the **address** layer catches it.
 */
function policyFor(baseUrl: string): HttpSecurityPolicy {
  return {
    validateUrl: (url) => {
      if (url.startsWith(baseUrl) || url.startsWith("http://sneaky.example")) {
        try {
          return { valid: true, normalizedUrl: new URL(url).href };
        } catch {
          return { valid: false, code: "malformed", reason: "Not a URL." };
        }
      }
      return publicHttpSecurityPolicy.validateUrl(url);
    },
    // The real address rules, except for the loopback the test server runs on.
    validateAddress: (address) =>
      address === "127.0.0.1" ? null : publicHttpSecurityPolicy.validateAddress(address),
  };
}

/** Resolves the test server normally and `sneaky.example` to private space. */
const rebindingResolver: AddressResolver = (hostname) => {
  if (hostname === "127.0.0.1") {
    return Promise.resolve([{ address: "127.0.0.1", family: 4 }]);
  }
  if (hostname === "sneaky.example") {
    return Promise.resolve([{ address: "10.0.0.1", family: 4 }]);
  }
  const error: NodeJS.ErrnoException = new Error("not found");
  error.code = "ENOTFOUND";
  return Promise.reject(error);
};

describe("address validation on redirects", () => {
  it("blocks a redirect to a public name that resolves to a private address", async () => {
    // The URL layer cannot catch this: `sneaky.example` is a perfectly ordinary
    // public hostname. Only resolving it and checking the answer does.
    await withServer(
      (_request, response) => {
        response.writeHead(302, { location: "http://sneaky.example/admin" });
        response.end();
      },
      async (baseUrl) => {
        const policy = policyFor(baseUrl);

        const result = await fetchPage(`${baseUrl}/start`, {
          policy,
          lookup: createPinnedLookup(policy, rebindingResolver),
          timeoutMs: 5000,
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.failure.code).toBe("blocked");
          // The hop was followed and recorded before the address check refused
          // the connection, which is what makes this the second layer.
          expect(result.failure.redirects).toHaveLength(1);
        }
      },
    );
  });

  it("blocks a redirect to the metadata endpoint at the URL layer", async () => {
    await withServer(
      (_request, response) => {
        response.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
        response.end();
      },
      async (baseUrl) => {
        const policy = policyFor(baseUrl);

        const result = await fetchPage(`${baseUrl}/start`, {
          policy,
          lookup: createPinnedLookup(policy, rebindingResolver),
          timeoutMs: 5000,
        });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.failure.code).toBe("blocked_redirect");
      },
    );
  });

  it("refuses a redirect carrying credentials", async () => {
    // Credentials in a Location would be forwarded to the target and end up in
    // logs and in the shareable report.
    await withServer(
      (_request, response) => {
        response.writeHead(302, { location: "https://user:pass@example.com/" });
        response.end();
      },
      async (baseUrl) => {
        const policy = policyFor(baseUrl);

        const result = await fetchPage(`${baseUrl}/start`, {
          policy,
          lookup: createPinnedLookup(policy, rebindingResolver),
          timeoutMs: 5000,
        });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.failure.code).toBe("blocked_redirect");
      },
    );
  });

  it("validates each hop of a multi-step chain, not only the first", async () => {
    await withServer(
      (request, response) => {
        if (request.url === "/one") {
          response.writeHead(302, { location: "/two" });
          response.end();
          return;
        }
        if (request.url === "/two") {
          response.writeHead(302, { location: "http://sneaky.example/" });
          response.end();
          return;
        }
        response.writeHead(200, { "content-type": "text/html" });
        response.end("<html></html>");
      },
      async (baseUrl) => {
        const policy = policyFor(baseUrl);

        const result = await fetchPage(`${baseUrl}/one`, {
          policy,
          lookup: createPinnedLookup(policy, rebindingResolver),
          timeoutMs: 5000,
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.failure.code).toBe("blocked");
          expect(result.failure.redirects).toHaveLength(2);
        }
      },
    );
  });
});

describe("credentials are never sent to a target", () => {
  it("sends no cookie or authorization header", async () => {
    // There is no cookie jar and no auth, so a redirect to another origin
    // cannot leak credentials from a previous hop.
    let seen: IncomingMessage["headers"] | null = null;

    await withServer(
      (request, response) => {
        seen = request.headers;
        response.writeHead(200, { "content-type": "text/html" });
        response.end("<html></html>");
      },
      async (baseUrl) => {
        const policy = policyFor(baseUrl);

        await fetchPage(`${baseUrl}/`, {
          policy,
          lookup: createPinnedLookup(policy, rebindingResolver),
          timeoutMs: 5000,
        });

        expect(seen).not.toBeNull();
        expect(seen!["cookie"]).toBeUndefined();
        expect(seen!["authorization"]).toBeUndefined();
      },
    );
  });
});

describe("the production defaults are strict", () => {
  it.each([
    ["loopback", "http://127.0.0.1/"],
    ["a private address", "http://10.0.0.1/"],
    ["the metadata endpoint", "http://169.254.169.254/"],
    ["localhost", "http://localhost/"],
    ["a file URL", "file:///etc/passwd"],
  ])("refuses %s with no options supplied", async (_label, url) => {
    const result = await fetchPage(url);

    expect(result.ok).toBe(false);
  });
});
