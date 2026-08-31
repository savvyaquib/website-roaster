import { describe, expect, it } from "vitest";

import { classifyLink, hostOf, resolveBaseUrl, resolveUrl } from "./urls";

const PAGE = "https://example.com/blog/post";

describe("resolveUrl", () => {
  it.each([
    ["an absolute URL", "https://other.com/x", "https://other.com/x"],
    ["a root-relative path", "/about", "https://example.com/about"],
    ["a document-relative path", "sibling", "https://example.com/blog/sibling"],
    ["a parent-relative path", "../up", "https://example.com/up"],
    ["a protocol-relative URL", "//cdn.example.com/a.js", "https://cdn.example.com/a.js"],
    ["a query-only reference", "?page=2", "https://example.com/blog/post?page=2"],
    ["a fragment", "#section", "https://example.com/blog/post#section"],
  ])("resolves %s", (_label, href, expected) => {
    expect(resolveUrl(href, PAGE)).toBe(expected);
  });

  it("returns null rather than throwing on an unresolvable reference", () => {
    // A page may contain any string in an href; failure is ordinary.
    expect(resolveUrl("http://[malformed", PAGE)).toBeNull();
  });

  it("keeps non-navigational schemes intact", () => {
    expect(resolveUrl("mailto:hi@example.com", PAGE)).toBe("mailto:hi@example.com");
    expect(resolveUrl("tel:+15551234", PAGE)).toBe("tel:+15551234");
  });
});

describe("resolveBaseUrl", () => {
  it("uses the page URL when there is no base element", () => {
    expect(resolveBaseUrl(PAGE, null)).toBe(PAGE);
  });

  it("uses an absolute base href", () => {
    expect(resolveBaseUrl(PAGE, "https://cdn.example.com/assets/")).toBe(
      "https://cdn.example.com/assets/",
    );
  });

  it("resolves a relative base href against the page URL", () => {
    expect(resolveBaseUrl(PAGE, "/assets/")).toBe("https://example.com/assets/");
  });

  it("ignores an unresolvable base href, as browsers do", () => {
    expect(resolveBaseUrl(PAGE, "http://[bad")).toBe(PAGE);
  });
});

describe("classifyLink", () => {
  const host = "example.com";

  const classify = (href: string) => classifyLink(href, resolveUrl(href, PAGE), host);

  it.each([
    ["a same-host absolute link", "https://example.com/x", "internal"],
    ["a relative link", "/about", "internal"],
    ["an empty href", "", "internal"],
    ["a different host", "https://other.com/x", "external"],
    ["a subdomain, which is a different host", "https://blog.example.com/x", "external"],
    ["a fragment", "#section", "anchor"],
    ["an email link", "mailto:hi@example.com", "mailto"],
    ["a phone link", "tel:+15551234", "tel"],
    ["a javascript link", "javascript:void(0)", "other"],
    ["a data URI", "data:text/plain,hi", "other"],
  ])("classifies %s", (_label, href, expected) => {
    expect(classify(href)).toBe(expected);
  });

  it("treats a fragment as an anchor even though it resolves to a full URL", () => {
    // resolveUrl("#a") yields https://example.com/blog/post#a, which on its own
    // looks internal. The raw href is what distinguishes the two.
    expect(resolveUrl("#a", PAGE)).toContain("example.com");
    expect(classify("#a")).toBe("anchor");
  });

  it("classifies an unresolvable href as other", () => {
    expect(classifyLink("http://[bad", null, host)).toBe("other");
  });

  it("treats a differing port as external", () => {
    expect(
      classifyLink("https://example.com:8443/x", "https://example.com:8443/x", host),
    ).toBe("external");
  });
});

describe("hostOf", () => {
  it("reads the host", () => {
    expect(hostOf("https://example.com/a/b")).toBe("example.com");
  });

  it("returns an empty string for an unparseable URL", () => {
    expect(hostOf("nonsense")).toBe("");
  });
});
