import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";

import { fetchPage } from "./fetch-page";
import { createPinnedLookup } from "./pinned-lookup";
import { publicHttpSecurityPolicy, type HttpSecurityPolicy } from "./policy";
import type { HttpFetchResult } from "./types";

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

/**
 * A policy that permits loopback and non-default ports so the tests can reach a
 * local server.
 *
 * Deliberately defined here rather than exported from the module: shipped code
 * contains no way to relax the production policy.
 */
const localPolicy: HttpSecurityPolicy = {
  validateUrl: (url) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return {
          valid: false,
          code: "unsupported_protocol",
          reason: "Only http and https.",
        };
      }
      return { valid: true, normalizedUrl: parsed.href };
    } catch {
      return { valid: false, code: "malformed", reason: "Not a URL." };
    }
  },
  validateAddress: () => null,
};

/** Run `body` against a temporary local server, then shut it down. */
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

/** Fetch through the real pinned lookup, with the loopback-permitting policy. */
function fetchLocal(url: string, overrides: Record<string, unknown> = {}) {
  return fetchPage(url, {
    policy: localPolicy,
    lookup: createPinnedLookup(localPolicy),
    timeoutMs: 5000,
    ...overrides,
  });
}

function expectOk(result: HttpFetchResult) {
  if (!result.ok) throw new Error(`expected success, got ${result.failure.code}`);
  return result.response;
}

function expectFailure(result: HttpFetchResult) {
  if (result.ok) throw new Error(`expected failure, got ${result.response.status}`);
  return result.failure;
}

const HTML = "<!doctype html><html><head><title>Hi</title></head><body>ok</body></html>";

function serveHtml(body = HTML): Handler {
  return (_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(body);
  };
}

describe("successful fetch", () => {
  it("collects status, headers, content type and body", async () => {
    await withServer(
      (_request, response) => {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "x-custom": "value",
        });
        response.end(HTML);
      },
      async (baseUrl) => {
        const page = expectOk(await fetchLocal(`${baseUrl}/`));

        expect(page.status).toBe(200);
        expect(page.statusText).toBe("OK");
        expect(page.finalUrl).toBe(`${baseUrl}/`);
        expect(page.contentType).toBe("text/html");
        expect(page.charset).toBe("utf-8");
        expect(page.isHtml).toBe(true);
        expect(page.html).toBe(HTML);
        expect(page.headers["x-custom"]).toBe("value");
        expect(page.redirects).toEqual([]);
      },
    );
  });

  it("reports observed sizes", async () => {
    await withServer(serveHtml(), async (baseUrl) => {
      const page = expectOk(await fetchLocal(`${baseUrl}/`));

      expect(page.transferredBytes).toBe(Buffer.byteLength(HTML));
      expect(page.decodedBytes).toBe(Buffer.byteLength(HTML));
    });
  });

  it("reports the declared length separately from the observed one", async () => {
    await withServer(
      (_request, response) => {
        response.writeHead(200, {
          "content-type": "text/html",
          "content-length": String(Buffer.byteLength(HTML)),
        });
        response.end(HTML);
      },
      async (baseUrl) => {
        const page = expectOk(await fetchLocal(`${baseUrl}/`));

        expect(page.contentLength).toBe(Buffer.byteLength(HTML));
        expect(page.transferredBytes).toBe(Buffer.byteLength(HTML));
      },
    );
  });

  it("reports a null declared length when the server sends chunked", async () => {
    // Nothing was declared, so nothing is claimed — "not measured", not zero.
    await withServer(serveHtml(), async (baseUrl) => {
      const page = expectOk(await fetchLocal(`${baseUrl}/`));

      expect(page.contentLength).toBeNull();
      expect(page.headers["transfer-encoding"]).toBe("chunked");
    });
  });

  it("records timing information", async () => {
    await withServer(serveHtml(), async (baseUrl) => {
      const page = expectOk(await fetchLocal(`${baseUrl}/`));

      expect(page.timing.totalMs).toBeGreaterThanOrEqual(0);
      expect(page.timing.ttfbMs).toBeGreaterThanOrEqual(0);
      expect(page.timing.downloadMs).toBeGreaterThanOrEqual(0);
      expect(page.totalElapsedMs).toBeGreaterThanOrEqual(0);
      // Plain HTTP has no TLS phase, and that is reported as "not measured"
      // rather than as zero.
      expect(page.timing.tlsMs).toBeNull();
    });
  });

  it("keeps Set-Cookie values separate rather than joining them", async () => {
    await withServer(
      (_request, response) => {
        response.writeHead(200, {
          "content-type": "text/html",
          "set-cookie": ["a=1; Path=/; HttpOnly", "b=2; Path=/; Secure"],
        });
        response.end(HTML);
      },
      async (baseUrl) => {
        const page = expectOk(await fetchLocal(`${baseUrl}/`));

        expect(page.setCookie).toEqual(["a=1; Path=/; HttpOnly", "b=2; Path=/; Secure"]);
        expect(page.headers["set-cookie"]).toBeUndefined();
      },
    );
  });

  it("decompresses a gzipped body and reports both sizes", async () => {
    // Large enough that compression actually shrinks it; gzipping 73 bytes does
    // not, so a tiny fixture would prove nothing about the two counters.
    const large = `<!doctype html><html><body>${"content ".repeat(2000)}</body></html>`;
    const compressed = zlib.gzipSync(Buffer.from(large));

    await withServer(
      (_request, response) => {
        response.writeHead(200, {
          "content-type": "text/html",
          "content-encoding": "gzip",
        });
        response.end(compressed);
      },
      async (baseUrl) => {
        const page = expectOk(await fetchLocal(`${baseUrl}/`));

        expect(page.html).toBe(large);
        expect(page.contentEncoding).toBe("gzip");
        expect(page.transferredBytes).toBe(compressed.length);
        expect(page.decodedBytes).toBe(Buffer.byteLength(large));
        expect(page.transferredBytes!).toBeLessThan(page.decodedBytes!);
      },
    );
  });

  it("decompresses a brotli body", async () => {
    const compressed = zlib.brotliCompressSync(Buffer.from(HTML));

    await withServer(
      (_request, response) => {
        response.writeHead(200, {
          "content-type": "text/html",
          "content-encoding": "br",
        });
        response.end(compressed);
      },
      async (baseUrl) => {
        const page = expectOk(await fetchLocal(`${baseUrl}/`));

        expect(page.html).toBe(HTML);
        expect(page.contentEncoding).toBe("br");
      },
    );
  });

  it("decodes a non-UTF-8 charset", async () => {
    const body = Buffer.from("<html><body>café</body></html>", "latin1");

    await withServer(
      (_request, response) => {
        response.writeHead(200, { "content-type": "text/html; charset=iso-8859-1" });
        response.end(body);
      },
      async (baseUrl) => {
        const page = expectOk(await fetchLocal(`${baseUrl}/`));

        expect(page.charset).toBe("iso-8859-1");
        expect(page.html).toContain("café");
      },
    );
  });

  it("treats application/xhtml+xml as HTML", async () => {
    await withServer(
      (_request, response) => {
        response.writeHead(200, { "content-type": "application/xhtml+xml" });
        response.end(HTML);
      },
      async (baseUrl) => {
        const page = expectOk(await fetchLocal(`${baseUrl}/`));

        expect(page.isHtml).toBe(true);
        expect(page.html).toBe(HTML);
      },
    );
  });
});

describe("error statuses are data, not failures", () => {
  it.each([404, 410, 451])("returns a %s response", async (status) => {
    await withServer(
      (_request, response) => {
        response.writeHead(status, { "content-type": "text/html" });
        response.end("<html><body>gone</body></html>");
      },
      async (baseUrl) => {
        const page = expectOk(await fetchLocal(`${baseUrl}/`));

        expect(page.status).toBe(status);
        expect(page.html).toContain("gone");
      },
    );
  });

  it.each([500, 502, 503])("returns a %s response", async (status) => {
    await withServer(
      (_request, response) => {
        response.writeHead(status, { "content-type": "text/html" });
        response.end("<html><body>broken</body></html>");
      },
      async (baseUrl) => {
        const page = expectOk(await fetchLocal(`${baseUrl}/`));

        expect(page.status).toBe(status);
      },
    );
  });
});

describe("non-HTML responses", () => {
  it.each([
    ["JSON", "application/json"],
    ["a PNG", "image/png"],
    ["a PDF", "application/pdf"],
    ["plain text", "text/plain"],
  ])("records %s without downloading the body", async (_label, contentType) => {
    await withServer(
      (_request, response) => {
        response.writeHead(200, {
          "content-type": contentType,
          "content-length": "12345",
        });
        response.end("x".repeat(12345));
      },
      async (baseUrl) => {
        const page = expectOk(await fetchLocal(`${baseUrl}/`));

        expect(page.status).toBe(200);
        expect(page.isHtml).toBe(false);
        expect(page.html).toBeNull();
        expect(page.contentType).toBe(contentType);
        // Declared size is still reported; observed size is "not measured".
        expect(page.contentLength).toBe(12345);
        expect(page.transferredBytes).toBeNull();
      },
    );
  });

  it("handles a response with no content type at all", async () => {
    await withServer(
      (_request, response) => {
        response.writeHead(200, {});
        response.end("something");
      },
      async (baseUrl) => {
        const page = expectOk(await fetchLocal(`${baseUrl}/`));

        expect(page.contentType).toBeNull();
        expect(page.isHtml).toBe(false);
        expect(page.html).toBeNull();
      },
    );
  });
});

describe("redirects", () => {
  it("follows a redirect and records the chain", async () => {
    await withServer(
      (request, response) => {
        if (request.url === "/start") {
          response.writeHead(302, { location: "/end" });
          response.end();
          return;
        }
        response.writeHead(200, { "content-type": "text/html" });
        response.end(HTML);
      },
      async (baseUrl) => {
        const page = expectOk(await fetchLocal(`${baseUrl}/start`));

        expect(page.status).toBe(200);
        expect(page.finalUrl).toBe(`${baseUrl}/end`);
        expect(page.redirects).toHaveLength(1);
        expect(page.redirects[0]).toMatchObject({
          url: `${baseUrl}/start`,
          status: 302,
          location: `${baseUrl}/end`,
        });
      },
    );
  });

  it("resolves a relative Location against the current URL", async () => {
    await withServer(
      (request, response) => {
        if (request.url === "/a/b") {
          response.writeHead(301, { location: "../c" });
          response.end();
          return;
        }
        response.writeHead(200, { "content-type": "text/html" });
        response.end(HTML);
      },
      async (baseUrl) => {
        const page = expectOk(await fetchLocal(`${baseUrl}/a/b`));

        expect(page.finalUrl).toBe(`${baseUrl}/c`);
      },
    );
  });

  it.each([301, 302, 303, 307, 308])("follows a %s", async (status) => {
    await withServer(
      (request, response) => {
        if (request.url === "/from") {
          response.writeHead(status, { location: "/to" });
          response.end();
          return;
        }
        response.writeHead(200, { "content-type": "text/html" });
        response.end(HTML);
      },
      async (baseUrl) => {
        const page = expectOk(await fetchLocal(`${baseUrl}/from`));

        expect(page.finalUrl).toBe(`${baseUrl}/to`);
        expect(page.redirects[0]?.status).toBe(status);
      },
    );
  });

  it("follows a chain up to the limit", async () => {
    await withServer(
      (request, response) => {
        const step = Number(request.url?.slice(1) ?? "0");
        if (step < 3) {
          response.writeHead(302, { location: `/${step + 1}` });
          response.end();
          return;
        }
        response.writeHead(200, { "content-type": "text/html" });
        response.end(HTML);
      },
      async (baseUrl) => {
        const page = expectOk(await fetchLocal(`${baseUrl}/0`, { maxRedirects: 5 }));

        expect(page.redirects).toHaveLength(3);
        expect(page.finalUrl).toBe(`${baseUrl}/3`);
      },
    );
  });

  it("refuses a chain longer than the limit", async () => {
    await withServer(
      (request, response) => {
        const step = Number(request.url?.slice(1) ?? "0");
        response.writeHead(302, { location: `/${step + 1}` });
        response.end();
      },
      async (baseUrl) => {
        const failure = expectFailure(
          await fetchLocal(`${baseUrl}/0`, { maxRedirects: 3 }),
        );

        expect(failure.code).toBe("too_many_redirects");
        expect(failure.redirects).toHaveLength(4);
      },
    );
  });

  it("detects a redirect loop", async () => {
    await withServer(
      (request, response) => {
        response.writeHead(302, {
          location: request.url === "/a" ? "/b" : "/a",
        });
        response.end();
      },
      async (baseUrl) => {
        const failure = expectFailure(await fetchLocal(`${baseUrl}/a`));

        expect(failure.code).toBe("redirect_loop");
      },
    );
  });

  it("treats a redirect status with no Location as a final response", async () => {
    await withServer(
      (_request, response) => {
        response.writeHead(302, { "content-type": "text/html" });
        response.end(HTML);
      },
      async (baseUrl) => {
        const page = expectOk(await fetchLocal(`${baseUrl}/`));

        expect(page.status).toBe(302);
        expect(page.redirects).toEqual([]);
      },
    );
  });

  it("blocks a redirect into private space", async () => {
    // The classic SSRF bypass: a public URL that redirects inward. Uses the
    // production policy for validation, so the real Phase 1 rules apply.
    await withServer(
      (_request, response) => {
        response.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
        response.end();
      },
      async (baseUrl) => {
        const failure = expectFailure(
          await fetchLocal(`${baseUrl}/`, {
            policy: {
              ...localPolicy,
              validateUrl: (url: string) =>
                url.startsWith(baseUrl)
                  ? localPolicy.validateUrl(url)
                  : publicHttpSecurityPolicy.validateUrl(url),
            },
          }),
        );

        expect(failure.code).toBe("blocked_redirect");
        expect(failure.message).toContain("metadata");
        expect(failure.status).toBe(302);
      },
    );
  });
});

describe("size limits", () => {
  it("refuses a body that declares itself too large", async () => {
    await withServer(
      (_request, response) => {
        response.writeHead(200, {
          "content-type": "text/html",
          "content-length": "999999",
        });
        response.end("x".repeat(999999));
      },
      async (baseUrl) => {
        const failure = expectFailure(
          await fetchLocal(`${baseUrl}/`, { maxBytes: 1000 }),
        );

        expect(failure.code).toBe("response_too_large");
        expect(failure.status).toBe(200);
      },
    );
  });

  it("aborts a chunked body that grows past the limit", async () => {
    await withServer(
      (_request, response) => {
        // No content-length, so the cap can only be enforced mid-stream.
        response.writeHead(200, { "content-type": "text/html" });
        const chunk = "x".repeat(1024);
        for (let i = 0; i < 200; i += 1) response.write(chunk);
        response.end();
      },
      async (baseUrl) => {
        const failure = expectFailure(
          await fetchLocal(`${baseUrl}/`, { maxBytes: 4096 }),
        );

        expect(failure.code).toBe("response_too_large");
      },
    );
  });

  it("guards against a decompression bomb", async () => {
    // A tiny transfer that expands enormously: the transferred-bytes cap alone
    // would not catch this.
    const bomb = zlib.gzipSync(Buffer.alloc(2 * 1024 * 1024, "a"));

    await withServer(
      (_request, response) => {
        response.writeHead(200, {
          "content-type": "text/html",
          "content-encoding": "gzip",
        });
        response.end(bomb);
      },
      async (baseUrl) => {
        expect(bomb.length).toBeLessThan(64 * 1024);

        const failure = expectFailure(
          await fetchLocal(`${baseUrl}/`, { maxBytes: 100 * 1024 }),
        );

        expect(failure.code).toBe("response_too_large");
      },
    );
  });

  it("accepts a body exactly at the limit", async () => {
    const body = "y".repeat(1000);

    await withServer(
      (_request, response) => {
        response.writeHead(200, { "content-type": "text/html" });
        response.end(body);
      },
      async (baseUrl) => {
        const page = expectOk(await fetchLocal(`${baseUrl}/`, { maxBytes: 1000 }));

        expect(page.decodedBytes).toBe(1000);
      },
    );
  });
});

describe("network failures", () => {
  it("times out when the server never responds", async () => {
    await withServer(
      () => {
        // Deliberately never respond.
      },
      async (baseUrl) => {
        const started = Date.now();
        const failure = expectFailure(
          await fetchLocal(`${baseUrl}/`, { timeoutMs: 200 }),
        );

        expect(failure.code).toBe("timeout");
        expect(Date.now() - started).toBeLessThan(3000);
      },
    );
  });

  it("times out when the body stalls midway", async () => {
    await withServer(
      (_request, response) => {
        response.writeHead(200, { "content-type": "text/html" });
        response.write("<html>");
        // Never finish the body.
      },
      async (baseUrl) => {
        const failure = expectFailure(
          await fetchLocal(`${baseUrl}/`, { timeoutMs: 200 }),
        );

        expect(failure.code).toBe("timeout");
      },
    );
  });

  it("reports a refused connection", async () => {
    // Start a server only to obtain a port nothing is listening on.
    let closedPort = 0;
    await withServer(serveHtml(), async (baseUrl) => {
      closedPort = Number(new URL(baseUrl).port);
    });

    const failure = expectFailure(await fetchLocal(`http://127.0.0.1:${closedPort}/`));

    expect(["connection_refused", "network_error"]).toContain(failure.code);
  });

  it("reports a DNS failure", async () => {
    const notFound: NodeJS.ErrnoException = new Error("getaddrinfo ENOTFOUND");
    notFound.code = "ENOTFOUND";

    const failure = expectFailure(
      await fetchLocal("http://does-not-exist.example/", {
        lookup: createPinnedLookup(localPolicy, () => Promise.reject(notFound)),
      }),
    );

    expect(failure.code).toBe("dns_failure");
  });

  it("reports a blocked address when a public name resolves inward", async () => {
    // Phase 1 cannot catch this: the *name* is fine, the address is not.
    const failure = expectFailure(
      await fetchLocal("http://sneaky.example/", {
        lookup: createPinnedLookup(publicHttpSecurityPolicy, () =>
          Promise.resolve([{ address: "10.0.0.1", family: 4 }]),
        ),
      }),
    );

    expect(failure.code).toBe("blocked");
  });

  it("reports a connection reset", async () => {
    await withServer(
      (_request, response) => {
        response.socket?.destroy();
      },
      async (baseUrl) => {
        const failure = expectFailure(await fetchLocal(`${baseUrl}/`));

        expect(["connection_reset", "network_error"]).toContain(failure.code);
      },
    );
  });
});

describe("input validation is reused from Phase 1", () => {
  it("refuses a malformed URL without making a request", async () => {
    const failure = expectFailure(await fetchPage("not a url"));

    expect(failure.code).toBe("invalid_url");
    expect(failure.redirects).toEqual([]);
  });

  it("refuses an unsupported protocol", async () => {
    const failure = expectFailure(await fetchPage("file:///etc/passwd"));

    expect(failure.code).toBe("invalid_url");
  });

  it("refuses a private address under the production policy", async () => {
    const failure = expectFailure(await fetchPage("http://192.168.1.1/"));

    expect(failure.code).toBe("blocked");
  });

  it("refuses the metadata endpoint under the production policy", async () => {
    const failure = expectFailure(await fetchPage("http://169.254.169.254/"));

    expect(failure.code).toBe("blocked");
  });

  it("refuses localhost under the production policy", async () => {
    const failure = expectFailure(await fetchPage("http://localhost/"));

    expect(failure.code).toBe("blocked");
  });
});

describe("request headers", () => {
  it("identifies itself and asks for HTML", async () => {
    let seen: IncomingMessage["headers"] | null = null;

    await withServer(
      (request, response) => {
        seen = request.headers;
        response.writeHead(200, { "content-type": "text/html" });
        response.end(HTML);
      },
      async (baseUrl) => {
        await fetchLocal(`${baseUrl}/`);

        expect(seen!["user-agent"]).toContain("WebsiteRoaster");
        expect(seen!["accept"]).toContain("text/html");
      },
    );
  });

  it("sends a custom user agent when asked", async () => {
    let seen = "";

    await withServer(
      (request, response) => {
        seen = request.headers["user-agent"] ?? "";
        response.writeHead(200, { "content-type": "text/html" });
        response.end(HTML);
      },
      async (baseUrl) => {
        await fetchLocal(`${baseUrl}/`, { userAgent: "CustomAgent/9" });

        expect(seen).toBe("CustomAgent/9");
      },
    );
  });
});
