import { describe, expect, it } from "vitest";

import { extractPageData } from "@/lib/analysis/dom";
import type { Finding } from "@/lib/types/finding";

import { analyzeSeo } from "./analyze-seo";
import type { SiteFiles } from "./types";

const URL = "https://example.com/";

/** A document that passes every DOM-level check, so tests can break one thing. */
const GOOD_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="A carefully written description of this page that is comfortably within the range search engines display.">
  <title>Excellent Widgets — Handmade in Britain</title>
  <link rel="canonical" href="https://example.com/">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization"}</script>
</head>
<body>
  <h1>Excellent widgets</h1>
  <h2>Why ours</h2>
  <p><a href="/about">About us</a></p>
  <img src="/hero.jpg" alt="A widget">
  <img src="/divider.png" alt="">
</body>
</html>`;

function analyze(html: string, siteFiles?: SiteFiles): Finding[] {
  return analyzeSeo({ page: extractPageData(html, URL), siteFiles });
}

function byId(findings: readonly Finding[], id: string): Finding | undefined {
  return findings.find((finding) => finding.id === id);
}

function ids(findings: readonly Finding[]): string[] {
  return findings.map((finding) => finding.id);
}

const goodSiteFiles: SiteFiles = {
  robotsTxt: {
    url: "https://example.com/robots.txt",
    status: 200,
    found: true,
    body: "User-agent: *\nDisallow:\nSitemap: https://example.com/sitemap.xml",
    error: null,
  },
  sitemap: {
    url: "https://example.com/sitemap.xml",
    status: 200,
    found: true,
    body: "<urlset></urlset>",
    error: null,
  },
  declaredSitemaps: ["https://example.com/sitemap.xml"],
};

describe("the analyzer contract", () => {
  const findings = analyze(GOOD_PAGE, goodSiteFiles);

  it("emits only SEO findings", () => {
    expect(findings.every((finding) => finding.category === "seo")).toBe(true);
  });

  it("gives every finding evidence", () => {
    // A finding without evidence is an opinion, and opinions do not get to
    // affect a score (ADR-008).
    expect(findings.every((finding) => finding.evidence.length > 0)).toBe(true);
  });

  it("gives every finding a non-empty explanation", () => {
    expect(findings.every((finding) => finding.explanation.length > 0)).toBe(true);
  });

  it("recommends an action on everything that is not a pass", () => {
    const actionable = findings.filter(
      (finding) => finding.status === "fail" || finding.status === "warn",
    );

    expect(actionable.every((finding) => (finding.recommendation ?? "").length > 0)).toBe(
      true,
    );
  });

  it("uses unique finding ids", () => {
    expect(new Set(ids(findings)).size).toBe(findings.length);
  });

  it("produces no numeric score", () => {
    // Scoring is Phase 12; an analyzer that scored would make the result
    // impossible to explain (ADR-001).
    for (const finding of findings) {
      expect(finding).not.toHaveProperty("score");
    }
  });

  it("is deterministic", () => {
    expect(analyze(GOOD_PAGE, goodSiteFiles)).toEqual(analyze(GOOD_PAGE, goodSiteFiles));
  });

  it("passes every check for a well-formed page", () => {
    expect(findings.filter((finding) => finding.status !== "pass")).toEqual([]);
  });
});

describe("title", () => {
  it("fails when there is no title", () => {
    const findings = analyze("<html lang=en><head></head><body></body></html>");

    expect(byId(findings, "seo.title.missing")?.status).toBe("fail");
    expect(byId(findings, "seo.title.missing")?.severity).toBe("serious");
  });

  it("distinguishes an empty title from a missing one", () => {
    const findings = analyze(
      "<html lang=en><head><title></title></head><body></body></html>",
    );

    expect(byId(findings, "seo.title.empty")).toBeDefined();
    expect(byId(findings, "seo.title.missing")).toBeUndefined();
  });

  it("warns about a truncated title and reports the measured length", () => {
    const long = "x".repeat(90);
    const findings = analyze(
      `<html lang=en><head><title>${long}</title></head><body></body></html>`,
    );

    const finding = byId(findings, "seo.title.too_long");
    expect(finding?.status).toBe("warn");
    expect(finding?.evidence[0]?.summary).toContain("90");
  });

  it("warns about a very short title", () => {
    const findings = analyze(
      "<html lang=en><head><title>Home</title></head><body></body></html>",
    );

    expect(byId(findings, "seo.title.too_short")?.status).toBe("warn");
  });
});

describe("meta description", () => {
  it("fails when absent", () => {
    expect(
      byId(
        analyze(GOOD_PAGE.replace(/<meta name="description"[^>]*>/, "")),
        "seo.description.missing",
      )?.status,
    ).toBe("fail");
  });

  it("warns when too long", () => {
    const long = "y".repeat(200);
    const html = GOOD_PAGE.replace(
      /<meta name="description" content="[^"]*">/,
      `<meta name="description" content="${long}">`,
    );

    expect(byId(analyze(html), "seo.description.too_long")?.status).toBe("warn");
  });
});

describe("indexing directives", () => {
  it("treats noindex as critical", () => {
    // The one directive that removes the page from search entirely.
    const html = GOOD_PAGE.replace(
      "<title>",
      '<meta name="robots" content="noindex, follow"><title>',
    );
    const finding = byId(analyze(html), "seo.robots_meta.noindex");

    expect(finding?.severity).toBe("critical");
    expect(finding?.status).toBe("fail");
  });

  it("treats robots: none as noindex", () => {
    const html = GOOD_PAGE.replace(
      "<title>",
      '<meta name="robots" content="none"><title>',
    );

    expect(byId(analyze(html), "seo.robots_meta.noindex")).toBeDefined();
  });

  it("warns about nofollow without calling it critical", () => {
    const html = GOOD_PAGE.replace(
      "<title>",
      '<meta name="robots" content="nofollow"><title>',
    );

    expect(byId(analyze(html), "seo.robots_meta.nofollow")?.severity).toBe("moderate");
  });

  it("passes when there is no robots meta tag", () => {
    expect(byId(analyze(GOOD_PAGE), "seo.robots_meta.absent")?.status).toBe("pass");
  });

  it("reports indexing findings before everything else", () => {
    // A page nobody can index has one problem worth reading first.
    const findings = analyze(GOOD_PAGE, goodSiteFiles);

    expect(findings[0]?.id).toMatch(/^seo\.robots_meta\./);
    expect(findings[1]?.id).toMatch(/^seo\.robots_txt\./);
  });
});

describe("headings", () => {
  it("fails when there is no h1", () => {
    const html = GOOD_PAGE.replace("<h1>Excellent widgets</h1>", "<h2>Widgets</h2>");

    expect(byId(analyze(html), "seo.h1.missing")?.status).toBe("fail");
  });

  it("warns about several h1 elements", () => {
    const html = GOOD_PAGE.replace("<h2>Why ours</h2>", "<h1>Another</h1>");

    expect(byId(analyze(html), "seo.h1.multiple")?.status).toBe("warn");
  });

  it("fails on an empty h1", () => {
    const html = GOOD_PAGE.replace("<h1>Excellent widgets</h1>", "<h1></h1>");

    expect(byId(analyze(html), "seo.h1.empty")?.status).toBe("fail");
  });

  it("warns when a heading level is skipped", () => {
    const html = GOOD_PAGE.replace("<h2>Why ours</h2>", "<h4>Why ours</h4>");
    const finding = byId(analyze(html), "seo.headings.skipped_level");

    expect(finding?.status).toBe("warn");
    expect(finding?.evidence[0]?.summary).toContain("h4");
  });

  it("reports a document with no headings at all", () => {
    const findings = analyze(
      "<html lang=en><head><title>A page with a decent title</title></head><body><p>x</p></body></html>",
    );

    expect(byId(findings, "seo.headings.none")?.status).toBe("fail");
  });
});

describe("images", () => {
  it("does not penalise a decorative image with an empty alt", () => {
    // alt="" is the correct marking for decoration. Treating it as missing
    // would punish sites for doing the right thing.
    const findings = analyze(GOOD_PAGE);

    expect(byId(findings, "seo.images.missing_alt")).toBeUndefined();
    expect(byId(findings, "seo.images.alt_ok")?.status).toBe("pass");
  });

  it("fails when an image has no alt attribute", () => {
    const html = GOOD_PAGE.replace(
      '<img src="/hero.jpg" alt="A widget">',
      '<img src="/hero.jpg">',
    );
    const finding = byId(analyze(html), "seo.images.missing_alt");

    expect(finding?.status).toBe("fail");
    expect(finding?.severity).toBe("moderate");
  });

  it("escalates when no image has alt text at all", () => {
    const html = GOOD_PAGE.replace(
      '<img src="/hero.jpg" alt="A widget">',
      '<img src="/hero.jpg">',
    ).replace('<img src="/divider.png" alt="">', '<img src="/divider.png">');

    expect(byId(analyze(html), "seo.images.missing_alt")?.severity).toBe("serious");
  });

  it("passes when the page has no images", () => {
    const html = GOOD_PAGE.replace(/<img[^>]*>/g, "");

    expect(byId(analyze(html), "seo.images.none")?.status).toBe("pass");
  });
});

describe("links", () => {
  it("warns when there are no internal links", () => {
    const html = GOOD_PAGE.replace('href="/about"', 'href="https://elsewhere.example/x"');

    expect(byId(analyze(html), "seo.links.no_internal")?.status).toBe("warn");
  });

  it("fails when there are no links at all", () => {
    const html = GOOD_PAGE.replace(/<a[^>]*>.*?<\/a>/g, "");

    expect(byId(analyze(html), "seo.links.none")?.status).toBe("fail");
  });

  it("warns about links with no text", () => {
    const html = GOOD_PAGE.replace(
      '<a href="/about">About us</a>',
      '<a href="/about"></a><a href="/more">More</a>',
    );

    expect(byId(analyze(html), "seo.links.empty_text")?.status).toBe("warn");
  });
});

describe("structured data", () => {
  it("passes on valid JSON-LD", () => {
    expect(byId(analyze(GOOD_PAGE), "seo.structured_data.ok")?.status).toBe("pass");
  });

  it("fails on JSON-LD that does not parse", () => {
    const html = GOOD_PAGE.replace(
      '{"@context":"https://schema.org","@type":"Organization"}',
      "{oops",
    );

    expect(byId(analyze(html), "seo.structured_data.invalid")?.status).toBe("fail");
  });

  it("warns rather than fails when there is none", () => {
    // Structured data is optional; absence is not an error.
    const html = GOOD_PAGE.replace(
      /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
      "",
    );
    const finding = byId(analyze(html), "seo.structured_data.absent");

    expect(finding?.status).toBe("warn");
    expect(finding?.severity).toBe("minor");
  });
});

describe("canonical, language and viewport", () => {
  it("warns when no canonical is declared", () => {
    const html = GOOD_PAGE.replace(/<link rel="canonical"[^>]*>/, "");

    expect(byId(analyze(html), "seo.canonical.missing")?.status).toBe("warn");
  });

  it("flags a canonical pointing at another site", () => {
    const html = GOOD_PAGE.replace(
      'href="https://example.com/"',
      'href="https://other.example/"',
    );

    expect(byId(analyze(html), "seo.canonical.cross_origin")?.status).toBe("warn");
  });

  it("fails when the language is not declared", () => {
    const html = GOOD_PAGE.replace('<html lang="en">', "<html>");

    expect(byId(analyze(html), "seo.language.missing")?.status).toBe("fail");
  });

  it("fails when the viewport is missing", () => {
    const html = GOOD_PAGE.replace(/<meta name="viewport"[^>]*>/, "");

    expect(byId(analyze(html), "seo.viewport.missing")?.severity).toBe("serious");
  });

  it("warns when the viewport does not adapt to device width", () => {
    const html = GOOD_PAGE.replace(
      'content="width=device-width, initial-scale=1"',
      'content="width=1024"',
    );

    expect(byId(analyze(html), "seo.viewport.no_device_width")?.status).toBe("warn");
  });
});

describe("site files", () => {
  it("reports could_not_determine when they were never fetched", () => {
    // The rule that makes the whole report trustworthy: not looking is not the
    // same as finding nothing wrong (ADR-021).
    const findings = analyze(GOOD_PAGE);

    expect(byId(findings, "seo.robots_txt.not_checked")?.status).toBe(
      "could_not_determine",
    );
    expect(byId(findings, "seo.sitemap.not_checked")?.status).toBe("could_not_determine");
  });

  it("never reports a pass for a file it did not retrieve", () => {
    const findings = analyze(GOOD_PAGE);
    const siteFileFindings = findings.filter(
      (finding) =>
        finding.id.startsWith("seo.robots_txt.") || finding.id.startsWith("seo.sitemap."),
    );

    expect(siteFileFindings.every((finding) => finding.status !== "pass")).toBe(true);
  });

  it("reports could_not_determine when retrieval failed", () => {
    const findings = analyze(GOOD_PAGE, {
      robotsTxt: {
        url: "https://example.com/robots.txt",
        status: null,
        found: false,
        body: null,
        error: "timeout",
      },
      sitemap: null,
      declaredSitemaps: [],
    });

    const finding = byId(findings, "seo.robots_txt.unreachable");
    expect(finding?.status).toBe("could_not_determine");
    expect(finding?.evidence[0]?.summary).toContain("timeout");
  });

  it("treats a site-wide crawler block as critical", () => {
    const findings = analyze(GOOD_PAGE, {
      ...goodSiteFiles,
      robotsTxt: {
        ...goodSiteFiles.robotsTxt!,
        body: "User-agent: *\nDisallow: /",
      },
    });

    expect(byId(findings, "seo.robots_txt.disallows_all")?.severity).toBe("critical");
  });

  it("warns when robots.txt is absent", () => {
    const findings = analyze(GOOD_PAGE, {
      ...goodSiteFiles,
      robotsTxt: {
        url: "https://example.com/robots.txt",
        status: 404,
        found: false,
        body: null,
        error: null,
      },
    });

    expect(byId(findings, "seo.robots_txt.missing")?.status).toBe("warn");
  });

  it("escalates a declared sitemap that cannot be served", () => {
    // Declaring a sitemap and not serving it is a broken promise, which is
    // worse than never declaring one.
    const findings = analyze(GOOD_PAGE, {
      ...goodSiteFiles,
      sitemap: {
        url: "https://example.com/sitemap.xml",
        status: 404,
        found: false,
        body: null,
        error: null,
      },
    });

    const finding = byId(findings, "seo.sitemap.missing");
    expect(finding?.status).toBe("fail");
    expect(finding?.severity).toBe("moderate");
  });

  it("only warns when no sitemap was declared or found", () => {
    const findings = analyze(GOOD_PAGE, {
      robotsTxt: {
        url: "https://example.com/robots.txt",
        status: 200,
        found: true,
        body: "User-agent: *\nDisallow:",
        error: null,
      },
      sitemap: {
        url: "https://example.com/sitemap.xml",
        status: 404,
        found: false,
        body: null,
        error: null,
      },
      declaredSitemaps: [],
    });

    const finding = byId(findings, "seo.sitemap.missing");
    expect(finding?.status).toBe("warn");
    expect(finding?.severity).toBe("minor");
  });
});

describe("a page with nothing right", () => {
  it("reports each problem separately rather than one summary", () => {
    const findings = analyze("<html><head></head><body><p>hello</p></body></html>");
    const failures = findings.filter((finding) => finding.status === "fail");

    expect(ids(failures)).toEqual(
      expect.arrayContaining([
        "seo.title.missing",
        "seo.description.missing",
        "seo.language.missing",
        "seo.viewport.missing",
        "seo.h1.missing",
        "seo.links.none",
      ]),
    );
  });
});
