import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";

import { createPinnedLookup, type HttpSecurityPolicy } from "@/lib/analysis/http";

import { fetchSiteFiles } from "./fetch-site-files";

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

/** Permits the local test server. Shipped code contains no such bypass. */
const localPolicy: HttpSecurityPolicy = {
  validateUrl: (url) => {
    try {
      return { valid: true, normalizedUrl: new URL(url).href };
    } catch {
      return { valid: false, code: "malformed", reason: "Not a URL." };
    }
  },
  validateAddress: () => null,
};

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

function localOptions() {
  return {
    fetchOptions: {
      policy: localPolicy,
      lookup: createPinnedLookup(localPolicy),
      timeoutMs: 5000,
    },
  };
}

describe("retrieving site files", () => {
  it("fetches robots.txt as plain text through the Phase 2 client", async () => {
    // The Phase 2 client downloads HTML only by default; robots.txt is
    // text/plain, so this also proves the downloadMediaTypes extension works.
    await withServer(
      (request, response) => {
        if (request.url === "/robots.txt") {
          response.writeHead(200, { "content-type": "text/plain" });
          response.end("User-agent: *\nDisallow:\n");
          return;
        }
        response.writeHead(404).end();
      },
      async (baseUrl) => {
        const files = await fetchSiteFiles(`${baseUrl}/page`, localOptions());

        expect(files.robotsTxt?.found).toBe(true);
        expect(files.robotsTxt?.status).toBe(200);
        expect(files.robotsTxt?.body).toContain("User-agent: *");
      },
    );
  });

  it("requests robots.txt from the origin, not the page path", async () => {
    const requested: string[] = [];

    await withServer(
      (request, response) => {
        requested.push(request.url ?? "");
        response.writeHead(404).end();
      },
      async (baseUrl) => {
        await fetchSiteFiles(`${baseUrl}/deep/nested/page`, localOptions());

        expect(requested).toContain("/robots.txt");
      },
    );
  });

  it("prefers the sitemap declared in robots.txt over the conventional path", async () => {
    const requested: string[] = [];
    // The handler needs the server's own URL to write an absolute Sitemap
    // directive, and that is only known once it is listening.
    let origin = "";

    await withServer(
      (request, response) => {
        requested.push(request.url ?? "");

        if (request.url === "/robots.txt") {
          response.writeHead(200, { "content-type": "text/plain" });
          response.end(`Sitemap: ${origin}/custom-sitemap.xml\n`);
          return;
        }
        if (request.url === "/custom-sitemap.xml") {
          response.writeHead(200, { "content-type": "application/xml" });
          response.end("<urlset></urlset>");
          return;
        }
        response.writeHead(404).end();
      },
      async (baseUrl) => {
        origin = baseUrl;

        const files = await fetchSiteFiles(`${baseUrl}/`, localOptions());

        expect(files.declaredSitemaps).toEqual([`${baseUrl}/custom-sitemap.xml`]);
        expect(files.sitemap?.found).toBe(true);
        expect(files.sitemap?.url).toBe(`${baseUrl}/custom-sitemap.xml`);
        // The conventional path is not tried when a declaration exists.
        expect(requested).not.toContain("/sitemap.xml");
      },
    );
  });

  it("falls back to /sitemap.xml when robots.txt declares none", async () => {
    const requested: string[] = [];

    await withServer(
      (request, response) => {
        requested.push(request.url ?? "");

        if (request.url === "/robots.txt") {
          response.writeHead(200, { "content-type": "text/plain" });
          response.end("User-agent: *\nDisallow:\n");
          return;
        }
        if (request.url === "/sitemap.xml") {
          response.writeHead(200, { "content-type": "application/xml" });
          response.end("<urlset></urlset>");
          return;
        }
        response.writeHead(404).end();
      },
      async (baseUrl) => {
        const files = await fetchSiteFiles(`${baseUrl}/`, localOptions());

        expect(requested).toContain("/sitemap.xml");
        expect(files.sitemap?.found).toBe(true);
        expect(files.declaredSitemaps).toEqual([]);
      },
    );
  });

  it("reports a missing robots.txt without treating it as an error", async () => {
    await withServer(
      (_request, response) => {
        response.writeHead(404, { "content-type": "text/plain" });
        response.end("nope");
      },
      async (baseUrl) => {
        const files = await fetchSiteFiles(`${baseUrl}/`, localOptions());

        expect(files.robotsTxt?.found).toBe(false);
        expect(files.robotsTxt?.status).toBe(404);
        expect(files.robotsTxt?.error).toBeNull();
        // A 404 body is not the file's content.
        expect(files.robotsTxt?.body).toBeNull();
      },
    );
  });

  it("records a retrieval failure rather than throwing", async () => {
    let closedPort = 0;
    await withServer(
      (_request, response) => response.writeHead(200).end(),
      async (baseUrl) => {
        closedPort = Number(new URL(baseUrl).port);
      },
    );

    const files = await fetchSiteFiles(`http://127.0.0.1:${closedPort}/`, localOptions());

    expect(files.robotsTxt?.found).toBe(false);
    expect(files.robotsTxt?.error).not.toBeNull();
  });

  it("reports nothing checked when the page URL has no origin", async () => {
    const files = await fetchSiteFiles("not-a-url");

    expect(files).toEqual({ robotsTxt: null, sitemap: null, declaredSitemaps: [] });
  });

  it("refuses a private origin under the production policy", async () => {
    // No fetchOptions, so the real policy applies and nothing is contacted.
    const files = await fetchSiteFiles("http://192.168.1.1/");

    expect(files.robotsTxt?.found).toBe(false);
    expect(files.robotsTxt?.error).toBe("blocked");
  });
});
