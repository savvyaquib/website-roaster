import { describe, expect, it } from "vitest";

import type { Finding } from "@/lib/types/finding";

import { analyzeContent } from "./analyze-content";
import { extractContent } from "./extract-content";
import { THIN_CONTENT_WORDS } from "./patterns";

const PAGE_URL = "https://example.com/";

const filler = "Widgets are measured precisely and shipped quickly to order. ";

/** A page with nothing obviously wrong, so a test can break one thing. */
const GOOD = `<!doctype html><html lang="en">
<head><meta charset="utf-8"><title>Widgets that fit — Acme</title>
<meta name="description" content="Handmade widgets, shipped next day."></head>
<body>
  <main>
    <h1>Widgets that actually fit</h1>
    <p>Measured to your specification and shipped the next working day.</p>
    <a href="/signup" class="btn">Get started</a>
    <h2>Features</h2>
    <p>${filler.repeat(40)}</p>
    <h2>What our customers say</h2>
    <blockquote>It fitted perfectly.</blockquote>
  </main>
  <footer>
    <a href="mailto:hello@example.com">Email us</a>
    <p>© 2026 Acme</p>
  </footer>
</body></html>`;

function analyze(html: string): Finding[] {
  return analyzeContent({ inventory: extractContent(html, PAGE_URL) });
}

function byId(findings: readonly Finding[], id: string): Finding | undefined {
  return findings.find((finding) => finding.id === id);
}

describe("the analyzer contract", () => {
  const findings = analyze(GOOD);

  it("emits only content findings", () => {
    expect(findings.every((finding) => finding.category === "content")).toBe(true);
  });

  it("gives every finding evidence, an explanation and a recommendation", () => {
    for (const finding of findings) {
      expect(finding.evidence.length, `${finding.id} has no evidence`).toBeGreaterThan(0);
      expect(finding.explanation.length).toBeGreaterThan(0);
      expect(
        (finding.recommendation ?? "").length,
        `${finding.id} has no recommendation`,
      ).toBeGreaterThan(0);
    }
  });

  it("uses unique ids", () => {
    const ids = findings.map((finding) => finding.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("produces no score", () => {
    for (const finding of findings) {
      expect(finding).not.toHaveProperty("score");
    }
  });

  it("is deterministic", () => {
    expect(analyze(GOOD)).toEqual(analyze(GOOD));
  });

  it("uses no AI", async () => {
    // Phase 14's job. An analyzer that reached for a model here would make the
    // content section non-deterministic and unexplainable (ADR-003).
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./analyze-content.ts", import.meta.url), "utf8"),
    );

    expect(source).not.toMatch(/openai|anthropic|gemini|llm|fetch\(/i);
  });
});

describe("facts and interpretation stay apart", () => {
  // The requirement this phase turns on. A missing <h1> is a fact; "this looks
  // like pricing" is not, and the report must not present them alike.
  const pages = [
    GOOD,
    "<html><body><p>x</p></body></html>",
    "<html><head><title>Home</title></head><body><h1>Home</h1></body></html>",
    `<html><body><h1>H</h1><p>${filler.repeat(30)}</p><a href="/a">Buy now</a><a href="/b">Sign up</a><a href="/c">Get started</a><a href="/d">Download</a><a href="/e">Subscribe</a><a href="/f">Book a demo</a></body></html>`,
    '<html><body><h1>H</h1><div class="footer"><a href="/x">Terms</a></div></body></html>',
  ];

  const structuralFindings = [
    "content.headline.missing",
    "content.headline.no_h1",
    "content.headline.present",
    "content.contact.none_found",
    "content.footer.missing",
    "content.metadata.specific",
  ];

  const interpretiveFindings = [
    "content.supporting_copy.missing",
    "content.supporting_copy.present",
    "content.supporting_copy.meta_only",
    "content.cta.none",
    "content.cta.many_choices",
    "content.cta.repetitive",
    "content.depth.thin",
    "content.depth.light",
    "content.sections.identified",
    "content.sections.unrecognised",
    "content.trust.none_detected",
    "content.trust.detected",
    "content.metadata.generic",
  ];

  const all = pages.flatMap((page) => analyze(page));

  it("backs structural findings with measured evidence only", () => {
    for (const finding of all) {
      if (!structuralFindings.includes(finding.id)) continue;

      expect(
        finding.evidence.every((item) => item.kind === "measured"),
        `${finding.id} carries heuristic evidence`,
      ).toBe(true);
    }
  });

  it("gives every interpretive finding at least one heuristic evidence item", () => {
    for (const id of interpretiveFindings) {
      const finding = all.find((candidate) => candidate.id === id);
      if (finding === undefined) continue;

      expect(
        finding.evidence.some((item) => item.kind === "heuristic"),
        `${id} claims to be measured`,
      ).toBe(true);
    }
  });

  it("hedges the wording of interpretive findings", () => {
    // Scans everything a reader sees, evidence included — that is where the
    // limits of a pattern-matched detection are deliberately stated, and it is
    // as user-visible as the explanation.
    //
    // This is a lint on tone, not a proof: it catches a finding that asserts an
    // inference flatly, which is the mistake worth catching.
    const hedges =
      /often|usually|may|might|rarely|unless|though|appears?|suggest|judgement|inference|inferred|depends|missed|crude|weak|rule of thumb|about the analyzer/i;

    for (const id of interpretiveFindings) {
      const finding = all.find((candidate) => candidate.id === id);
      if (finding === undefined) continue;

      const text = [
        finding.explanation,
        finding.recommendation ?? "",
        ...finding.evidence.map((item) => `${item.summary} ${item.detail ?? ""}`),
      ].join(" ");

      expect(hedges.test(text), `${id} reads as a certainty`).toBe(true);
    }
  });
});

describe("headline", () => {
  it("fails when the page has neither headline nor title", () => {
    expect(
      byId(analyze("<html><body><p>x</p></body></html>"), "content.headline.missing")
        ?.severity,
    ).toBe("serious");
  });

  it("fails when only a title exists", () => {
    const findings = analyze(
      "<html><head><title>Real Title</title></head><body><p>x</p></body></html>",
    );

    expect(byId(findings, "content.headline.no_h1")?.status).toBe("fail");
  });

  it("passes with an h1", () => {
    expect(byId(analyze(GOOD), "content.headline.present")?.status).toBe("pass");
  });
});

describe("calls to action", () => {
  it("fails when there are none", () => {
    const findings = analyze("<html><body><h1>H</h1><p>Words here.</p></body></html>");

    expect(byId(findings, "content.cta.none")?.severity).toBe("serious");
  });

  it("passes when there is at least one", () => {
    expect(byId(analyze(GOOD), "content.cta.present")?.status).toBe("pass");
  });

  it("warns about many competing actions without calling it wrong", () => {
    const html = `<html><body><h1>H</h1>
      <a href="/a">Buy now</a><a href="/b">Sign up</a><a href="/c">Get started</a>
      <a href="/d">Download</a><a href="/e">Subscribe</a><a href="/f">Book a demo</a>
    </body></html>`;

    const finding = byId(analyze(html), "content.cta.many_choices");
    expect(finding?.status).toBe("warn");
    expect(finding?.explanation).toContain("may be right");
  });

  it("warns about a label repeated many times", () => {
    const repeated = '<a href="/x">Buy now</a>'.repeat(5);
    const findings = analyze(`<html><body><h1>H</h1>${repeated}</body></html>`);

    expect(byId(findings, "content.cta.repetitive")?.status).toBe("warn");
  });
});

describe("content depth", () => {
  it("fails a page with almost nothing to read", () => {
    const findings = analyze(
      "<html><body><h1>H</h1><p>Three words here.</p></body></html>",
    );
    const finding = byId(findings, "content.depth.thin");

    expect(finding?.status).toBe("fail");
    expect(finding?.evidence[0]?.summary).toContain("word(s)");
  });

  it("warns on a short but not empty page", () => {
    const words = "word ".repeat(THIN_CONTENT_WORDS + 50);
    const findings = analyze(`<html><body><h1>H</h1><p>${words}</p></body></html>`);

    expect(byId(findings, "content.depth.light")?.status).toBe("warn");
  });

  it("passes a substantial page without calling it good", () => {
    const finding = byId(analyze(GOOD), "content.depth.substantial");

    expect(finding?.status).toBe("pass");
    expect(finding?.recommendation).toContain("Length is not quality");
  });
});

describe("generic metadata", () => {
  it("fails placeholder wording", () => {
    const findings = analyze(
      "<html><head><title>Home</title></head><body><h1>Welcome</h1></body></html>",
    );

    const finding = byId(findings, "content.metadata.generic");
    expect(finding?.status).toBe("fail");
    expect(finding?.evidence[0]?.detail).toContain("title");
  });

  it("catches a framework default", () => {
    const findings = analyze(
      "<html><head><title>Create Next App</title></head><body><h1>Hi there</h1></body></html>",
    );

    expect(byId(findings, "content.metadata.generic")).toBeDefined();
  });

  it("catches lorem ipsum in the headline", () => {
    const findings = analyze(
      "<html><head><title>Real title here</title></head><body><h1>Lorem ipsum dolor</h1></body></html>",
    );

    expect(byId(findings, "content.metadata.generic")).toBeDefined();
  });

  it("passes specific wording", () => {
    expect(byId(analyze(GOOD), "content.metadata.specific")?.status).toBe("pass");
  });
});

describe("contact information", () => {
  it("fails when no route exists", () => {
    const findings = analyze("<html><body><h1>H</h1><p>Words.</p></body></html>");

    expect(byId(findings, "content.contact.none_found")?.severity).toBe("moderate");
  });

  it("passes on a mailto link and treats it as a fact", () => {
    const findings = analyze(GOOD);
    const finding = byId(findings, "content.contact.available");

    expect(finding?.status).toBe("pass");
    expect(finding?.evidence[0]?.kind).toBe("measured");
  });

  it("marks a text-matched phone number as heuristic", () => {
    const findings = analyze(
      "<html><body><h1>H</h1><p>Call us on +44 1234 567890 today.</p></body></html>",
    );

    const finding = byId(findings, "content.contact.available");
    expect(finding?.evidence.some((item) => item.kind === "heuristic")).toBe(true);
  });
});

describe("footer", () => {
  it("warns when there is none", () => {
    expect(
      byId(analyze("<html><body><h1>H</h1></body></html>"), "content.footer.missing")
        ?.status,
    ).toBe("warn");
  });

  it("treats a <footer> element as a fact", () => {
    const finding = byId(analyze(GOOD), "content.footer.present");

    expect(finding?.evidence[0]?.kind).toBe("measured");
  });

  it("treats a footer-classed div as an inference and says to use <footer>", () => {
    const findings = analyze(
      '<html><body><h1>H</h1><div class="site-footer"><a href="/x">Terms</a></div></body></html>',
    );

    const finding = byId(findings, "content.footer.present");
    expect(finding?.evidence[0]?.kind).toBe("heuristic");
    expect(finding?.recommendation).toContain("<footer>");
  });
});

describe("sections and trust", () => {
  it("reports identified sections as an inference", () => {
    const finding = byId(analyze(GOOD), "content.sections.identified");

    expect(finding?.evidence[0]?.kind).toBe("heuristic");
    expect(finding?.explanation).toContain("inferred");
  });

  it("says so plainly when nothing was recognised", () => {
    const findings = analyze("<html><body><h1>Zzz</h1><p>Words.</p></body></html>");
    const finding = byId(findings, "content.sections.unrecognised");

    expect(finding?.status).toBe("could_not_determine");
    expect(finding?.explanation).toContain("as much about the analyzer");
  });

  it("admits its trust detection is weak when it finds nothing", () => {
    const findings = analyze("<html><body><h1>H</h1><p>Words.</p></body></html>");
    const finding = byId(findings, "content.trust.none_detected");

    expect(finding?.status).toBe("warn");
    expect(finding?.explanation).toContain("weak evidence");
  });
});
