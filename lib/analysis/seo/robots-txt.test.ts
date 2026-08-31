import { describe, expect, it } from "vitest";

import { parseRobotsTxt } from "./robots-txt";

describe("sitemap declarations", () => {
  it("collects sitemap URLs in order", () => {
    const parsed = parseRobotsTxt(
      ["Sitemap: https://example.com/a.xml", "Sitemap: https://example.com/b.xml"].join(
        "\n",
      ),
    );

    expect(parsed.sitemaps).toEqual([
      "https://example.com/a.xml",
      "https://example.com/b.xml",
    ]);
  });

  it("deduplicates repeated declarations", () => {
    const parsed = parseRobotsTxt(
      ["Sitemap: https://example.com/a.xml", "Sitemap: https://example.com/a.xml"].join(
        "\n",
      ),
    );

    expect(parsed.sitemaps).toEqual(["https://example.com/a.xml"]);
  });

  it("matches the directive case-insensitively", () => {
    expect(parseRobotsTxt("SITEMAP: https://example.com/s.xml").sitemaps).toEqual([
      "https://example.com/s.xml",
    ]);
  });

  it("reports no sitemaps for an empty file", () => {
    expect(parseRobotsTxt("").sitemaps).toEqual([]);
  });
});

describe("site-wide blocks", () => {
  it("detects a wildcard group disallowing everything", () => {
    const parsed = parseRobotsTxt("User-agent: *\nDisallow: /");

    expect(parsed.disallowsEverything).toBe(true);
  });

  it("does not treat an empty Disallow as a block", () => {
    // `Disallow:` with no value explicitly permits everything.
    expect(parseRobotsTxt("User-agent: *\nDisallow:").disallowsEverything).toBe(false);
  });

  it("does not treat a partial disallow as a site-wide block", () => {
    expect(parseRobotsTxt("User-agent: *\nDisallow: /admin/").disallowsEverything).toBe(
      false,
    );
  });

  it("ignores a block that targets one named crawler", () => {
    // Blocking a single misbehaving bot is normal and is not an SEO problem.
    const parsed = parseRobotsTxt("User-agent: BadBot\nDisallow: /");

    expect(parsed.disallowsEverything).toBe(false);
  });

  it("does not report a total block when an Allow carves out an exception", () => {
    const parsed = parseRobotsTxt("User-agent: *\nDisallow: /\nAllow: /public/");

    expect(parsed.disallowsEverything).toBe(false);
  });

  it("finds the wildcard group among several", () => {
    const parsed = parseRobotsTxt(
      [
        "User-agent: GoodBot",
        "Disallow: /admin/",
        "",
        "User-agent: *",
        "Disallow: /",
      ].join("\n"),
    );

    expect(parsed.disallowsEverything).toBe(true);
    expect(parsed.groupCount).toBe(2);
  });

  it("treats consecutive user-agent lines as one group", () => {
    const parsed = parseRobotsTxt(
      ["User-agent: A", "User-agent: *", "Disallow: /"].join("\n"),
    );

    expect(parsed.groupCount).toBe(1);
    expect(parsed.disallowsEverything).toBe(true);
  });
});

describe("tolerating real-world files", () => {
  it("ignores comments and blank lines", () => {
    const parsed = parseRobotsTxt(
      [
        "# a comment",
        "",
        "User-agent: *   # trailing comment",
        "Disallow: /",
        "",
        "Sitemap: https://example.com/s.xml",
      ].join("\n"),
    );

    expect(parsed.disallowsEverything).toBe(true);
    expect(parsed.sitemaps).toEqual(["https://example.com/s.xml"]);
  });

  it("ignores unknown directives", () => {
    const parsed = parseRobotsTxt("User-agent: *\nCrawl-delay: 10\nDisallow: /");

    expect(parsed.disallowsEverything).toBe(true);
  });

  it("ignores lines with no separator", () => {
    expect(() => parseRobotsTxt("this is not a directive")).not.toThrow();
    expect(parseRobotsTxt("this is not a directive").groupCount).toBe(0);
  });

  it("handles CRLF line endings", () => {
    const parsed = parseRobotsTxt("User-agent: *\r\nDisallow: /\r\n");

    expect(parsed.disallowsEverything).toBe(true);
  });

  it("ignores directives before any user-agent line", () => {
    expect(parseRobotsTxt("Disallow: /").disallowsEverything).toBe(false);
  });
});
