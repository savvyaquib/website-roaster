import { describe, expect, it } from "vitest";

import { extractPageData } from "./extract-page-data";

const URL = "https://example.com/blog/post";

/** Wrap a fragment in a minimal document so fixtures stay readable. */
function page(body: string, head = ""): string {
  return `<!doctype html><html lang="en"><head><title>T</title>${head}</head><body>${body}</body></html>`;
}

describe("document metadata", () => {
  it("extracts the title", () => {
    expect(extractPageData(page(""), URL).title).toBe("T");
  });

  it("collapses whitespace in the title", () => {
    const data = extractPageData(
      "<html><head><title>  Spaced   out\n  title  </title></head><body></body></html>",
      URL,
    );

    expect(data.title).toBe("Spaced out title");
  });

  it("distinguishes a missing title from an empty one", () => {
    // These are different SEO facts and must not collapse into one.
    expect(
      extractPageData("<html><head></head><body></body></html>", URL).title,
    ).toBeNull();
    expect(
      extractPageData("<html><head><title></title></head><body></body></html>", URL)
        .title,
    ).toBe("");
  });

  it("takes the first title when there are several, as a browser does", () => {
    const data = extractPageData(
      "<html><head><title>First</title><title>Second</title></head><body></body></html>",
      URL,
    );

    expect(data.title).toBe("First");
  });

  it("extracts the meta description", () => {
    const data = extractPageData(
      page("", '<meta name="description" content="A page.">'),
      URL,
    );

    expect(data.description).toBe("A page.");
  });

  it("matches meta names case-insensitively", () => {
    const data = extractPageData(
      page("", '<meta name="Description" content="A page.">'),
      URL,
    );

    expect(data.description).toBe("A page.");
  });

  it("distinguishes a missing description from one with no content", () => {
    expect(extractPageData(page(""), URL).description).toBeNull();
    expect(extractPageData(page("", '<meta name="description">'), URL).description).toBe(
      "",
    );
  });

  it("extracts the document language", () => {
    expect(extractPageData(page(""), URL).htmlLanguage).toBe("en");
  });

  it("reports a missing language as null", () => {
    const data = extractPageData("<html><head></head><body></body></html>", URL);

    expect(data.htmlLanguage).toBeNull();
  });

  it("extracts the viewport and robots meta tags", () => {
    const data = extractPageData(
      page(
        "",
        '<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">',
      ),
      URL,
    );

    expect(data.viewport).toBe("width=device-width, initial-scale=1");
    expect(data.robots).toBe("noindex, nofollow");
  });

  it("extracts and resolves the canonical link", () => {
    const data = extractPageData(
      page("", '<link rel="canonical" href="/canonical-path">'),
      URL,
    );

    expect(data.canonical).toBe("https://example.com/canonical-path");
  });

  it("finds canonical in a multi-token rel attribute", () => {
    const data = extractPageData(
      page("", '<link rel="alternate canonical" href="/c">'),
      URL,
    );

    expect(data.canonical).toBe("https://example.com/c");
  });

  it("extracts the charset from a meta charset tag", () => {
    expect(extractPageData(page("", '<meta charset="UTF-8">'), URL).charset).toBe(
      "utf-8",
    );
  });

  it("falls back to the legacy http-equiv charset form", () => {
    const data = extractPageData(
      page(
        "",
        '<meta http-equiv="Content-Type" content="text/html; charset=ISO-8859-1">',
      ),
      URL,
    );

    expect(data.charset).toBe("iso-8859-1");
  });

  it("records the page URL it resolved against", () => {
    expect(extractPageData(page(""), URL).url).toBe(URL);
  });
});

describe("headings", () => {
  it("extracts headings in document order with levels", () => {
    const data = extractPageData(
      page("<h1>One</h1><h3>Three</h3><h2>Two</h2><h6>Six</h6>"),
      URL,
    );

    expect(data.headings).toEqual([
      { level: 1, text: "One", id: null },
      { level: 3, text: "Three", id: null },
      { level: 2, text: "Two", id: null },
      { level: 6, text: "Six", id: null },
    ]);
  });

  it("reads nested markup as text and collapses whitespace", () => {
    const data = extractPageData(page("<h1>Hello <em>brave</em>\n  world</h1>"), URL);

    expect(data.headings[0]?.text).toBe("Hello brave world");
  });

  it("captures heading ids", () => {
    const data = extractPageData(page('<h2 id="intro">Intro</h2>'), URL);

    expect(data.headings[0]?.id).toBe("intro");
  });

  it("returns an empty list when there are no headings", () => {
    expect(extractPageData(page("<p>text</p>"), URL).headings).toEqual([]);
  });
});

describe("links", () => {
  it("extracts href, text and resolved URL", () => {
    const data = extractPageData(page('<a href="/about">About us</a>'), URL);

    expect(data.links).toHaveLength(1);
    expect(data.links[0]).toMatchObject({
      href: "/about",
      resolvedUrl: "https://example.com/about",
      kind: "internal",
      text: "About us",
      nofollow: false,
    });
  });

  it("ignores anchors with no href, which are not links", () => {
    const data = extractPageData(
      page('<a name="legacy">x</a><a href="/real">y</a>'),
      URL,
    );

    expect(data.links).toHaveLength(1);
    expect(data.links[0]?.href).toBe("/real");
  });

  it("parses rel tokens and flags nofollow", () => {
    const data = extractPageData(
      page('<a href="https://other.com" rel="NOFOLLOW noopener">x</a>'),
      URL,
    );

    expect(data.links[0]?.rel).toEqual(["nofollow", "noopener"]);
    expect(data.links[0]?.nofollow).toBe(true);
  });

  it("captures the target attribute", () => {
    const data = extractPageData(page('<a href="/x" target="_blank">x</a>'), URL);

    expect(data.links[0]?.target).toBe("_blank");
  });

  it("reports empty text for an image-only link", () => {
    const data = extractPageData(
      page('<a href="/x"><img src="i.png" alt="Logo"></a>'),
      URL,
    );

    expect(data.links[0]?.text).toBe("");
  });

  it("does not treat an SVG anchor as an HTML link", () => {
    // <a> inside <svg> is an SVG link; counting it would inflate every page
    // that uses an inline icon set.
    const data = extractPageData(
      page('<svg><a href="/svg-link"><circle/></a></svg><a href="/real">real</a>'),
      URL,
    );

    expect(data.links.map((link) => link.href)).toEqual(["/real"]);
  });

  it("keeps an unresolvable href but reports no resolved URL", () => {
    const data = extractPageData(page('<a href="http://[bad">x</a>'), URL);

    expect(data.links[0]?.href).toBe("http://[bad");
    expect(data.links[0]?.resolvedUrl).toBeNull();
    expect(data.links[0]?.kind).toBe("other");
  });

  it("decodes entities in href and text", () => {
    const data = extractPageData(
      page('<a href="/a?x=1&amp;y=2">Tom &amp; Jerry</a>'),
      URL,
    );

    expect(data.links[0]?.href).toBe("/a?x=1&y=2");
    expect(data.links[0]?.text).toBe("Tom & Jerry");
  });
});

describe("images", () => {
  it("extracts src, resolved URL and attributes", () => {
    const data = extractPageData(
      page('<img src="pic.png" alt="A picture" width="100" height="50" loading="lazy">'),
      URL,
    );

    expect(data.images[0]).toEqual({
      src: "pic.png",
      resolvedUrl: "https://example.com/blog/pic.png",
      alt: "A picture",
      width: "100",
      height: "50",
      loading: "lazy",
      hasSrcset: false,
    });
  });

  it("distinguishes a missing alt from an explicitly empty one", () => {
    // alt="" marks a decorative image and is correct; a missing alt is a defect.
    const data = extractPageData(page('<img src="a.png"><img src="b.png" alt="">'), URL);

    expect(data.images[0]?.alt).toBeNull();
    expect(data.images[1]?.alt).toBe("");
  });

  it("handles an image with no src", () => {
    const data = extractPageData(page('<img srcset="a.png 1x, b.png 2x" alt="x">'), URL);

    expect(data.images[0]?.src).toBeNull();
    expect(data.images[0]?.resolvedUrl).toBeNull();
    expect(data.images[0]?.hasSrcset).toBe(true);
  });

  it("keeps dimension attributes raw rather than guessing", () => {
    const data = extractPageData(page('<img src="a.png" width="100px" alt="">'), URL);

    expect(data.images[0]?.width).toBe("100px");
  });
});

describe("scripts", () => {
  it("extracts external scripts with loading attributes", () => {
    const data = extractPageData(
      page('<script src="/app.js" async defer></script>'),
      URL,
    );

    expect(data.scripts[0]).toMatchObject({
      src: "/app.js",
      resolvedUrl: "https://example.com/app.js",
      async: true,
      defer: true,
      isInline: false,
      inlineLength: null,
    });
  });

  it("measures inline scripts", () => {
    const data = extractPageData(page("<script>const a = 1;</script>"), URL);

    expect(data.scripts[0]?.isInline).toBe(true);
    expect(data.scripts[0]?.inlineLength).toBe("const a = 1;".length);
    expect(data.scripts[0]?.src).toBeNull();
  });

  it("flags module scripts", () => {
    const data = extractPageData(
      page('<script type="module" src="/m.js"></script>'),
      URL,
    );

    expect(data.scripts[0]?.isModule).toBe(true);
    expect(data.scripts[0]?.type).toBe("module");
  });

  it("lists data blocks as scripts but records their type", () => {
    // Anything measuring JavaScript cost must filter on type; ld+json is data.
    const data = extractPageData(
      page('<script type="application/ld+json">{"@type":"Thing"}</script>'),
      URL,
    );

    expect(data.scripts).toHaveLength(1);
    expect(data.scripts[0]?.type).toBe("application/ld+json");
    expect(data.scripts[0]?.isModule).toBe(false);
  });

  it("collects JSON-LD blocks separately and unparsed", () => {
    const data = extractPageData(
      page(
        '<script type="application/ld+json">{"@type":"Organization"}</script>' +
          '<script type="application/ld+json">not valid json</script>',
      ),
      URL,
    );

    expect(data.jsonLdBlocks).toEqual(['{"@type":"Organization"}', "not valid json"]);
  });
});

describe("stylesheets", () => {
  it("extracts external stylesheets", () => {
    const data = extractPageData(
      page("", '<link rel="stylesheet" href="/site.css" media="screen">'),
      URL,
    );

    expect(data.stylesheets[0]).toEqual({
      href: "/site.css",
      resolvedUrl: "https://example.com/site.css",
      media: "screen",
      isInline: false,
      inlineLength: null,
    });
  });

  it("measures inline style blocks", () => {
    const data = extractPageData(page("", "<style>body{color:red}</style>"), URL);

    expect(data.stylesheets[0]?.isInline).toBe(true);
    expect(data.stylesheets[0]?.inlineLength).toBe("body{color:red}".length);
  });

  it("ignores link elements that are not stylesheets", () => {
    const data = extractPageData(
      page(
        "",
        '<link rel="icon" href="/favicon.ico"><link rel="preload" href="/f.woff">',
      ),
      URL,
    );

    expect(data.stylesheets).toEqual([]);
  });

  it("recognises a stylesheet in a multi-token rel", () => {
    const data = extractPageData(
      page("", '<link rel="alternate stylesheet" href="/alt.css">'),
      URL,
    );

    expect(data.stylesheets).toHaveLength(1);
  });
});

describe("forms", () => {
  it("extracts action, method and fields", () => {
    const data = extractPageData(
      page(`<form action="/subscribe" method="POST" id="signup">
        <input type="email" name="email" required>
        <textarea name="note"></textarea>
        <select name="plan"><option>a</option></select>
        <button type="submit">Go</button>
      </form>`),
      URL,
    );

    const form = data.forms[0];
    expect(form).toMatchObject({
      action: "/subscribe",
      resolvedAction: "https://example.com/subscribe",
      method: "post",
      id: "signup",
      hasSubmitControl: true,
    });
    expect(form?.fields.map((field) => field.tag)).toEqual([
      "input",
      "textarea",
      "select",
      "button",
    ]);
    expect(form?.fields[0]).toMatchObject({
      type: "email",
      name: "email",
      required: true,
    });
  });

  it("defaults the method to get, as HTML does", () => {
    const data = extractPageData(page("<form><input name=q></form>"), URL);

    expect(data.forms[0]?.method).toBe("get");
  });

  it("treats a button with no type as a submit control", () => {
    const data = extractPageData(page("<form><button>Send</button></form>"), URL);

    expect(data.forms[0]?.hasSubmitControl).toBe(true);
  });

  it("does not treat a plain input as a submit control", () => {
    const data = extractPageData(page('<form><input type="text" name="q"></form>'), URL);

    expect(data.forms[0]?.hasSubmitControl).toBe(false);
  });

  it("recognises input type=image as a submit control", () => {
    const data = extractPageData(
      page('<form><input type="image" src="go.png"></form>'),
      URL,
    );

    expect(data.forms[0]?.hasSubmitControl).toBe(true);
  });

  it("reports a form with no action", () => {
    const data = extractPageData(page("<form><input name=q></form>"), URL);

    expect(data.forms[0]?.action).toBeNull();
    expect(data.forms[0]?.resolvedAction).toBeNull();
  });
});

describe("base element", () => {
  it("resolves relative URLs against base href", () => {
    const data = extractPageData(
      page(
        '<a href="page">x</a><img src="i.png" alt="">',
        '<base href="https://cdn.example.com/assets/">',
      ),
      URL,
    );

    expect(data.baseHref).toBe("https://cdn.example.com/assets/");
    expect(data.links[0]?.resolvedUrl).toBe("https://cdn.example.com/assets/page");
    expect(data.images[0]?.resolvedUrl).toBe("https://cdn.example.com/assets/i.png");
  });

  it("does not change which host counts as internal", () => {
    // <base> governs resolution only. A relative link that now resolves to a
    // different host is leaving the site, and must be reported as external.
    const data = extractPageData(
      page('<a href="page">x</a>', '<base href="https://cdn.example.com/assets/">'),
      URL,
    );

    expect(data.links[0]?.resolvedUrl).toBe("https://cdn.example.com/assets/page");
    expect(data.links[0]?.kind).toBe("external");
  });

  it("still treats an absolute link to the page host as internal", () => {
    const data = extractPageData(
      page(
        '<a href="https://example.com/x">x</a>',
        '<base href="https://cdn.example.com/assets/">',
      ),
      URL,
    );

    expect(data.links[0]?.kind).toBe("internal");
  });

  it("reports no base href when there is no base element", () => {
    expect(extractPageData(page(""), URL).baseHref).toBeNull();
  });
});

describe("malformed and unusual input", () => {
  it("handles an empty string", () => {
    const data = extractPageData("", URL);

    expect(data.title).toBeNull();
    expect(data.headings).toEqual([]);
    expect(data.links).toEqual([]);
  });

  it("handles input that is not HTML at all", () => {
    const data = extractPageData("just some plain text", URL);

    expect(data.title).toBeNull();
    expect(data.links).toEqual([]);
  });

  it("recovers from unclosed tags", () => {
    // The parser is spec-compliant, so it repairs the tree the way a browser
    // would rather than giving up.
    const data = extractPageData("<html><body><p>one<p>two<div><h1>Title</body>", URL);

    expect(data.headings[0]?.text).toBe("Title");
  });

  it("handles a document with no head or body", () => {
    const data = extractPageData("<h1>Bare</h1>", URL);

    expect(data.headings[0]?.text).toBe("Bare");
  });

  it("normalises uppercase tag and attribute names", () => {
    const data = extractPageData(
      '<HTML LANG="EN"><HEAD><TITLE>Up</TITLE></HEAD><BODY><A HREF="/x">L</A></BODY></HTML>',
      URL,
    );

    expect(data.title).toBe("Up");
    expect(data.htmlLanguage).toBe("EN");
    expect(data.links[0]?.href).toBe("/x");
  });

  it("does not read inert template content as page content", () => {
    // Template contents are not rendered until cloned.
    const data = extractPageData(
      page("<template><h1>Hidden</h1><a href='/t'>t</a></template><h1>Real</h1>"),
      URL,
    );

    expect(data.headings.map((heading) => heading.text)).toEqual(["Real"]);
    expect(data.links).toEqual([]);
  });

  it("does not treat script contents as heading text", () => {
    const data = extractPageData(
      page("<h1>Real<script>var x='fake';</script></h1>"),
      URL,
    );

    expect(data.headings[0]?.text).toBe("Real");
  });

  it("works when the page URL itself is unparseable", () => {
    const data = extractPageData(page('<a href="/x">x</a>'), "not-a-url");

    expect(data.links[0]?.resolvedUrl).toBeNull();
    expect(data.links[0]?.kind).toBe("other");
  });
});

describe("determinism", () => {
  const fixture = page(
    `<h1>Title</h1><h2>Sub</h2>
     <a href="/a">A</a><a href="https://other.com/b">B</a>
     <img src="1.png" alt="one"><img src="2.png">
     <form action="/f" method="post"><input name="q"><button>Go</button></form>
     <script src="/a.js"></script><script>inline()</script>`,
    '<meta name="description" content="D"><link rel="stylesheet" href="/s.css">',
  );

  it("produces identical output for identical input", () => {
    // Phase 4's acceptance criterion.
    expect(extractPageData(fixture, URL)).toEqual(extractPageData(fixture, URL));
  });

  it("serializes to the same JSON across runs", () => {
    const once = JSON.stringify(extractPageData(fixture, URL));
    const twice = JSON.stringify(extractPageData(fixture, URL));

    expect(once).toBe(twice);
  });

  it("preserves document order across collections", () => {
    const data = extractPageData(fixture, URL);

    expect(data.headings.map((h) => h.level)).toEqual([1, 2]);
    expect(data.links.map((l) => l.text)).toEqual(["A", "B"]);
    expect(data.images.map((i) => i.src)).toEqual(["1.png", "2.png"]);
    expect(data.scripts.map((s) => s.isInline)).toEqual([false, true]);
  });
});

describe("a realistic page", () => {
  const html = `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="We sell excellent widgets.">
  <title>Widgets — Home</title>
  <link rel="canonical" href="https://example.com/">
  <link rel="stylesheet" href="/assets/site.css">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization"}</script>
</head>
<body>
  <header><a href="/"><img src="/logo.svg" alt="Widgets"></a></header>
  <main>
    <h1>Excellent widgets</h1>
    <p>Read <a href="/about" rel="nofollow">about us</a> or
       <a href="https://partner.example/deal" target="_blank" rel="noopener">our partner</a>.</p>
    <h2>Newsletter</h2>
    <form action="/subscribe" method="post">
      <input type="email" name="email" required>
      <button type="submit">Subscribe</button>
    </form>
    <img src="/hero.jpg" width="1200" height="600">
  </main>
  <script src="/assets/app.js" defer></script>
</body>
</html>`;

  const data = extractPageData(html, "https://example.com/");

  it("reads the document metadata", () => {
    expect(data.title).toBe("Widgets — Home");
    expect(data.description).toBe("We sell excellent widgets.");
    expect(data.htmlLanguage).toBe("en-GB");
    expect(data.charset).toBe("utf-8");
    expect(data.canonical).toBe("https://example.com/");
    expect(data.viewport).toContain("width=device-width");
    expect(data.jsonLdBlocks).toHaveLength(1);
  });

  it("reads the structure", () => {
    expect(data.headings).toEqual([
      { level: 1, text: "Excellent widgets", id: null },
      { level: 2, text: "Newsletter", id: null },
    ]);

    expect(data.links.map((link) => link.kind)).toEqual([
      "internal",
      "internal",
      "external",
    ]);
    expect(data.links[1]?.nofollow).toBe(true);

    // The hero image has no alt; the logo does. Both facts survive.
    expect(data.images.map((image) => image.alt)).toEqual(["Widgets", null]);

    expect(data.forms).toHaveLength(1);
    expect(data.forms[0]?.hasSubmitControl).toBe(true);
    expect(data.stylesheets).toHaveLength(1);
    expect(data.scripts).toHaveLength(2);
  });
});
