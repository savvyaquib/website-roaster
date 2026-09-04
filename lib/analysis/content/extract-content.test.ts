import { describe, expect, it } from "vitest";

import { extractContent } from "./extract-content";

const URL = "https://example.com/";

/** A realistic marketing page with one of everything. */
const LANDING = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Widgets that fit — Acme</title>
  <meta name="description" content="Handmade widgets, shipped next day.">
</head>
<body>
  <header><nav><a href="/">Home</a><a href="/pricing">Pricing</a></nav></header>
  <main>
    <h1>Widgets that actually fit</h1>
    <p>Measured to your specification and shipped the next working day.</p>
    <a href="/signup" class="btn btn-primary">Get started</a>
    <a href="/demo">Book a demo</a>

    <h2>Features</h2>
    <p>Everything you need to specify a widget correctly the first time.</p>

    <h2>Pricing</h2>
    <p>Plans from $29 per month, billed monthly.</p>
    <a href="/buy">Buy now</a>

    <h2>What our customers say</h2>
    <blockquote>It arrived the next day and fitted perfectly.</blockquote>

    <h2>Frequently asked questions</h2>
    <details><summary>Do you ship abroad?</summary><p>Yes.</p></details>

    <p>Trusted by 4,000 engineering teams.</p>
  </main>
  <footer>
    <a href="/terms">Terms</a>
    <a href="mailto:hello@example.com">hello@example.com</a>
    <a href="tel:+441234567890">+44 1234 567890</a>
    <a href="https://twitter.com/acme">Twitter</a>
    <address>1 Widget Lane, Sheffield</address>
    <p>© 2026 Acme Ltd</p>
  </footer>
</body>
</html>`;

describe("hero", () => {
  const inventory = extractContent(LANDING, URL);

  it("takes the headline from the h1 and marks it structural", () => {
    expect(inventory.hero.headline).toBe("Widgets that actually fit");
    expect(inventory.hero.headlineSource).toBe("h1");
    expect(inventory.hero.headlineDetection).toBe("structural");
  });

  it("takes supporting copy from the paragraph after the headline", () => {
    expect(inventory.hero.supportingCopy).toContain("Measured to your specification");
    expect(inventory.hero.supportingCopySource).toBe("paragraph");
  });

  it("marks supporting copy inferred, because position is a convention", () => {
    // The h1 is markup that declares itself. "The paragraph after it" is not.
    expect(inventory.hero.supportingCopyDetection).toBe("inferred");
  });

  it("falls back to the title when there is no h1, and says so", () => {
    const inventory = extractContent(
      "<html><head><title>Fallback</title></head><body><p>x</p></body></html>",
      URL,
    );

    expect(inventory.hero.headline).toBe("Fallback");
    expect(inventory.hero.headlineSource).toBe("title");
    expect(inventory.hero.headlineDetection).toBe("inferred");
  });

  it("falls back to the meta description for supporting copy", () => {
    const inventory = extractContent(
      '<html><head><meta name="description" content="A described page."></head><body><h1>H</h1></body></html>',
      URL,
    );

    expect(inventory.hero.supportingCopy).toBe("A described page.");
    expect(inventory.hero.supportingCopySource).toBe("meta_description");
  });

  it("ignores a paragraph too short to be supporting copy", () => {
    const inventory = extractContent(
      "<html><body><h1>H</h1><p>Hi</p><p>A properly written supporting sentence here.</p></body></html>",
      URL,
    );

    expect(inventory.hero.supportingCopy).toContain("properly written");
  });

  it("reports no headline when the page has neither", () => {
    const inventory = extractContent("<html><body><p>text</p></body></html>", URL);

    expect(inventory.hero.headline).toBeNull();
    expect(inventory.hero.headlineDetection).toBeNull();
  });
});

describe("calls to action", () => {
  const inventory = extractContent(LANDING, URL);

  it("finds action links and resolves their destinations", () => {
    const texts = inventory.ctas.map((cta) => cta.text);

    expect(texts).toContain("Get started");
    expect(texts).toContain("Book a demo");
    expect(inventory.ctas.find((cta) => cta.text === "Get started")?.href).toBe(
      "https://example.com/signup",
    );
  });

  it("marks a <button> structural and a matched link inferred", () => {
    const withButton = extractContent(
      "<html><body><h1>H</h1><button>Send</button><a href='/x'>Learn more</a></body></html>",
      URL,
    );

    expect(withButton.ctas.find((cta) => cta.text === "Send")?.detection).toBe(
      "structural",
    );
    expect(withButton.ctas.find((cta) => cta.text === "Learn more")?.detection).toBe(
      "inferred",
    );
  });

  it("records which pattern matched, so the guess is inspectable", () => {
    expect(inventory.ctas.find((cta) => cta.text === "Book a demo")?.matchedPattern).toBe(
      "demo",
    );
  });

  it("treats button styling as a signal", () => {
    const cta = inventory.ctas.find((candidate) => candidate.text === "Get started");

    expect(cta?.element).toBe("link");
    expect(cta).toBeDefined();
  });

  it("recognises role=button as structural", () => {
    const inventory = extractContent(
      '<html><body><h1>H</h1><a href="/x" role="button">Proceed</a></body></html>',
      URL,
    );

    expect(inventory.ctas[0]?.detection).toBe("structural");
  });

  it("places footer actions in the footer region", () => {
    const inventory = extractContent(
      '<html><body><h1>H</h1><footer><a href="/x">Contact us</a></footer></body></html>',
      URL,
    );

    expect(inventory.ctas[0]?.region).toBe("footer");
  });

  it("ignores ordinary links that match nothing", () => {
    const inventory = extractContent(
      '<html><body><h1>H</h1><a href="/about">Some unremarkable link</a></body></html>',
      URL,
    );

    expect(inventory.ctas).toEqual([]);
  });
});

describe("sections", () => {
  const inventory = extractContent(LANDING, URL);
  const kinds = inventory.sections.map((section) => section.kind);

  it.each(["features", "pricing", "testimonials", "faq"] as const)(
    "identifies a %s section",
    (kind) => {
      expect(kinds).toContain(kind);
    },
  );

  it("marks heading-based classification as inferred", () => {
    const pricing = inventory.sections.find((section) => section.kind === "pricing");

    expect(pricing?.detection).toBe("inferred");
    expect(pricing?.signals.join(" ")).toContain("heading");
  });

  it("marks a <details> FAQ as structural", () => {
    const inventory = extractContent(
      "<html><body><h1>H</h1><details><summary>Q</summary><p>A</p></details></body></html>",
      URL,
    );

    const faq = inventory.sections.find((section) => section.kind === "faq");
    expect(faq?.detection).toBe("structural");
  });

  it("detects pricing from a currency amount when no heading says so", () => {
    const inventory = extractContent(
      "<html><body><h1>H</h1><p>Only $19 per month.</p></body></html>",
      URL,
    );

    const pricing = inventory.sections.find((section) => section.kind === "pricing");
    expect(pricing?.signals).toContain("currency amount in page text");
    expect(pricing?.signals).toContain("recurring billing wording");
  });

  it("does not invent sections on a page with none", () => {
    const inventory = extractContent("<html><body><p>Just words.</p></body></html>", URL);

    expect(inventory.sections.filter((section) => section.kind !== "unknown")).toEqual(
      [],
    );
  });
});

describe("contact information", () => {
  const inventory = extractContent(LANDING, URL);

  it("reads mailto and tel links as structural facts", () => {
    expect(inventory.contact.mailtoAddresses).toEqual(["hello@example.com"]);
    expect(inventory.contact.telLinks).toEqual(["+441234567890"]);
  });

  it("reads an address block", () => {
    expect(inventory.contact.addressBlocks[0]).toContain("Widget Lane");
  });

  it("recognises social links by host", () => {
    expect(inventory.contact.socialLinks).toContain("twitter.com");
  });

  it("does not repeat a mailto address as a text match", () => {
    expect(inventory.contact.textEmails).not.toContain("hello@example.com");
  });

  it("finds an email in text when there is no mailto link", () => {
    const inventory = extractContent(
      "<html><body><p>Write to us at team@example.org please.</p></body></html>",
      URL,
    );

    expect(inventory.contact.textEmails).toEqual(["team@example.org"]);
  });

  it("ignores a number too short to be a phone number", () => {
    // The phone pattern is the loosest one here, so the length floor matters.
    const inventory = extractContent(
      "<html><body><p>Established 1994, order 12345.</p></body></html>",
      URL,
    );

    expect(inventory.contact.textPhones).toEqual([]);
  });

  it("recognises a contact link", () => {
    const inventory = extractContent(
      '<html><body><a href="/help">Get in touch</a></body></html>',
      URL,
    );

    expect(inventory.contact.contactLinks).toContain("Get in touch");
  });
});

describe("footer", () => {
  it("reads a <footer> element as structural", () => {
    const inventory = extractContent(LANDING, URL);

    expect(inventory.footer.present).toBe(true);
    expect(inventory.footer.detection).toBe("structural");
    expect(inventory.footer.linkCount).toBe(4);
    expect(inventory.footer.hasCopyrightNotice).toBe(true);
  });

  it("falls back to a footer-classed container, marked inferred", () => {
    const inventory = extractContent(
      '<html><body><div class="site-footer"><a href="/x">Terms</a></div></body></html>',
      URL,
    );

    expect(inventory.footer.present).toBe(true);
    expect(inventory.footer.detection).toBe("inferred");
  });

  it("reports no footer when there is none", () => {
    const inventory = extractContent("<html><body><p>x</p></body></html>", URL);

    expect(inventory.footer.present).toBe(false);
    expect(inventory.footer.detection).toBeNull();
  });
});

describe("trust signals", () => {
  const inventory = extractContent(LANDING, URL);

  it("recognises a blockquote as a possible testimonial", () => {
    expect(inventory.trustSignals.some((signal) => signal.kind === "testimonial")).toBe(
      true,
    );
  });

  it("recognises a customer count", () => {
    expect(
      inventory.trustSignals.some((signal) => signal.signal.includes("customer count")),
    ).toBe(true);
  });

  it("marks every trust signal inferred", () => {
    // None of these are declared by markup; all are pattern matches.
    expect(
      inventory.trustSignals.every((signal) => signal.detection === "inferred"),
    ).toBe(true);
  });

  it("finds none on a page with none", () => {
    const inventory = extractContent("<html><body><p>Plain text.</p></body></html>", URL);

    expect(inventory.trustSignals).toEqual([]);
  });
});

describe("word counts", () => {
  it("excludes navigation, header and footer from body text", () => {
    // Those repeat on every page and would inflate a page that says nothing.
    const inventory = extractContent(
      `<html><body>
        <header><nav><a href="/">One two three four five</a></nav></header>
        <main><p>Alpha beta gamma.</p></main>
        <footer><p>Six seven eight nine ten eleven twelve.</p></footer>
      </body></html>`,
      URL,
    );

    expect(inventory.wordCount).toBe(3);
  });

  it("counts paragraphs and headings", () => {
    const inventory = extractContent(LANDING, URL);

    expect(inventory.paragraphCount).toBeGreaterThan(3);
    expect(inventory.headingCount).toBeGreaterThan(3);
  });

  it("records the longest paragraph", () => {
    const inventory = extractContent(
      "<html><body><p>One two</p><p>One two three four five six</p></body></html>",
      URL,
    );

    expect(inventory.longestParagraphWords).toBe(6);
  });
});

describe("robustness", () => {
  it.each([
    ["an empty string", ""],
    ["plain text", "just words, no markup"],
    ["unclosed tags", "<html><body><h1>Title<p>text"],
    ["no body", "<h1>Bare</h1>"],
  ])("handles %s without throwing", (_label, html) => {
    expect(() => extractContent(html, URL)).not.toThrow();
  });

  it("is deterministic", () => {
    expect(extractContent(LANDING, URL)).toEqual(extractContent(LANDING, URL));
  });

  it("works when the page URL is unparseable", () => {
    const inventory = extractContent(
      '<html><body><a href="/x">Buy now</a></body></html>',
      "nope",
    );

    expect(inventory.ctas[0]?.href).toBeNull();
  });
});
