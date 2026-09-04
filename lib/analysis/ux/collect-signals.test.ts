import { describe, expect, it } from "vitest";

import { collectUxSignals } from "./collect-signals";

const PAGE_URL = "https://example.com/";

describe("navigation", () => {
  it("counts regions, links and nesting depth", () => {
    const signals = collectUxSignals(
      `<html><body><nav><ul>
        <li><a href="/a">A</a></li>
        <li><a href="/b">B</a><ul><li><a href="/c">C</a></li></ul></li>
      </ul></nav></body></html>`,
      PAGE_URL,
    );

    expect(signals.navigation.regionCount).toBe(1);
    expect(signals.navigation.totalLinks).toBe(3);
    expect(signals.navigation.maxNestingDepth).toBe(2);
  });

  it("recognises role=navigation as a region", () => {
    const signals = collectUxSignals(
      '<html><body><div role="navigation"><a href="/a">A</a></div></body></html>',
      PAGE_URL,
    );

    expect(signals.navigation.regionCount).toBe(1);
  });

  it("counts duplicate destinations", () => {
    const signals = collectUxSignals(
      '<html><body><nav><a href="/">Logo</a><a href="/">Home</a><a href="/x">X</a></nav></body></html>',
      PAGE_URL,
    );

    expect(signals.navigation.duplicateDestinations).toBe(1);
  });

  it("ignores anchors with no href", () => {
    const signals = collectUxSignals(
      '<html><body><nav><a name="x">Not a link</a><a href="/a">A</a></nav></body></html>',
      PAGE_URL,
    );

    expect(signals.navigation.totalLinks).toBe(1);
  });

  it("reports zeroes when there is no navigation", () => {
    const signals = collectUxSignals("<html><body><p>x</p></body></html>", PAGE_URL);

    expect(signals.navigation.regionCount).toBe(0);
    expect(signals.navigation.maxLinksInOneRegion).toBe(0);
  });
});

describe("actions", () => {
  it("counts buttons and button-styled links separately", () => {
    const signals = collectUxSignals(
      `<html><body>
        <button>One</button>
        <a href="/x" class="btn primary">Two</a>
        <a href="/y">Ordinary</a>
      </body></html>`,
      PAGE_URL,
    );

    expect(signals.actions.buttons).toBe(1);
    expect(signals.actions.buttonStyledLinks).toBe(1);
    expect(signals.actions.candidateActions).toBe(2);
    expect(signals.actions.primaryStyled).toBe(1);
  });

  it("counts submit controls", () => {
    const signals = collectUxSignals(
      '<html><body><form><button>Go</button><input type="submit"></form></body></html>',
      PAGE_URL,
    );

    expect(signals.actions.submitControls).toBe(2);
  });
});

describe("density", () => {
  it("counts interactive elements and words, and the ratio between them", () => {
    const signals = collectUxSignals(
      `<html><body><p>one two three four five six seven eight nine ten</p>
       <a href="/a">A</a><button>B</button></body></html>`,
      PAGE_URL,
    );

    expect(signals.density.interactiveElements).toBe(2);
    expect(signals.density.wordCount).toBe(12);
    expect(signals.density.interactivePer100Words).toBeCloseTo(16.7, 0);
  });

  it("ignores hidden inputs, which nobody interacts with", () => {
    const signals = collectUxSignals(
      '<html><body><p>words here</p><input type="hidden" name="csrf"><input name="q"></body></html>',
      PAGE_URL,
    );

    expect(signals.density.interactiveElements).toBe(1);
  });

  it("excludes script and style text from the word count", () => {
    const signals = collectUxSignals(
      "<html><body><p>three visible words</p><script>var a = 1;</script><style>body{color:red}</style></body></html>",
      PAGE_URL,
    );

    expect(signals.density.wordCount).toBe(3);
  });

  it("reports null ratios rather than dividing by zero", () => {
    const signals = collectUxSignals(
      '<html><body><a href="/a">A</a></body></html>',
      PAGE_URL,
    );

    expect(signals.density.wordCount).toBe(1);
    expect(signals.density.interactivePer100Words).not.toBeNull();

    const empty = collectUxSignals("<html><body></body></html>", PAGE_URL);
    expect(empty.density.interactivePer100Words).toBeNull();
  });
});

describe("headings", () => {
  it("counts each level and finds the deepest", () => {
    const signals = collectUxSignals(
      "<html><body><h1>A</h1><h2>B</h2><h2>C</h2><h3>D</h3></body></html>",
      PAGE_URL,
    );

    expect(signals.headings.countsByLevel).toEqual([1, 2, 1, 0, 0, 0]);
    expect(signals.headings.total).toBe(4);
    expect(signals.headings.deepestLevel).toBe(3);
    expect(signals.headings.firstLevel).toBe(1);
  });

  it("counts skipped levels", () => {
    const signals = collectUxSignals(
      "<html><body><h1>A</h1><h3>B</h3><h2>C</h2><h5>D</h5></body></html>",
      PAGE_URL,
    );

    // h1 to h3 is one skip; h2 to h5 is another. h3 to h2 going back up is not.
    expect(signals.headings.skippedLevels).toBe(2);
  });

  it("reports nulls for a page with no headings", () => {
    const signals = collectUxSignals("<html><body><p>x</p></body></html>", PAGE_URL);

    expect(signals.headings.total).toBe(0);
    expect(signals.headings.deepestLevel).toBeNull();
    expect(signals.headings.firstLevel).toBeNull();
  });
});

describe("hierarchy", () => {
  it("measures nesting depth", () => {
    const signals = collectUxSignals(
      "<html><body><div><div><div><p>deep</p></div></div></div></body></html>",
      PAGE_URL,
    );

    expect(signals.hierarchy.maxDomDepth).toBeGreaterThanOrEqual(4);
  });

  it("counts landmarks and notices a main element", () => {
    const signals = collectUxSignals(
      "<html><body><header>h</header><nav>n</nav><main>m</main><footer>f</footer></body></html>",
      PAGE_URL,
    );

    expect(signals.hierarchy.landmarkCount).toBe(4);
    expect(signals.hierarchy.hasMainLandmark).toBe(true);
  });

  it("reports no main landmark when there is none", () => {
    const signals = collectUxSignals("<html><body><div>x</div></body></html>", PAGE_URL);

    expect(signals.hierarchy.hasMainLandmark).toBe(false);
  });

  it("computes the heading to paragraph ratio, or null", () => {
    const withParagraphs = collectUxSignals(
      "<html><body><h1>A</h1><p>x</p><p>y</p></body></html>",
      PAGE_URL,
    );
    expect(withParagraphs.hierarchy.headingToParagraphRatio).toBe(0.5);

    const without = collectUxSignals("<html><body><h1>A</h1></body></html>", PAGE_URL);
    expect(without.hierarchy.headingToParagraphRatio).toBeNull();
  });
});

describe("forms", () => {
  it("counts fields, required fields and the longest form", () => {
    const signals = collectUxSignals(
      `<html><body>
        <form><input name="a" required><input name="b"><button type="submit">Go</button></form>
        <form><input name="c"><textarea name="d"></textarea><select name="e"></select><button>Send</button></form>
      </body></html>`,
      PAGE_URL,
    );

    expect(signals.forms.formCount).toBe(2);
    expect(signals.forms.totalFields).toBe(5);
    expect(signals.forms.maxFieldsInOneForm).toBe(3);
    expect(signals.forms.requiredFields).toBe(1);
    expect(signals.forms.formsWithoutSubmit).toBe(0);
  });

  it("ignores hidden fields in the count", () => {
    const signals = collectUxSignals(
      '<html><body><form><input type="hidden" name="t"><input name="q"><button>Go</button></form></body></html>',
      PAGE_URL,
    );

    expect(signals.forms.totalFields).toBe(1);
  });

  it("notices a form with no submit control", () => {
    const signals = collectUxSignals(
      '<html><body><form><input name="q"></form></body></html>',
      PAGE_URL,
    );

    expect(signals.forms.formsWithoutSubmit).toBe(1);
  });

  it("treats a button with no type as a submit, as HTML does", () => {
    const signals = collectUxSignals(
      '<html><body><form><input name="q"><button>Go</button></form></body></html>',
      PAGE_URL,
    );

    expect(signals.forms.formsWithoutSubmit).toBe(0);
  });
});

describe("repetition", () => {
  it("counts repeated blocks by tag and first class", () => {
    const card = '<div class="card"><span>a</span><span>b</span></div>';
    const signals = collectUxSignals(
      `<html><body>${card.repeat(4)}</body></html>`,
      PAGE_URL,
    );

    expect(signals.repetition.maxRepetition).toBe(4);
    expect(signals.repetition.repeatedBlocks[0]?.signature).toBe("div.card");
  });

  it("ignores elements with too few children to be a component", () => {
    // Otherwise a page full of one-child wrappers reads as heavy repetition.
    const signals = collectUxSignals(
      '<html><body><div class="w"><span>a</span></div><div class="w"><span>b</span></div></body></html>',
      PAGE_URL,
    );

    expect(signals.repetition.maxRepetition).toBe(0);
  });

  it("ignores elements with no class, since there is nothing to match on", () => {
    const signals = collectUxSignals(
      "<html><body><div><i>a</i><i>b</i></div><div><i>c</i><i>d</i></div></body></html>",
      PAGE_URL,
    );

    expect(signals.repetition.maxRepetition).toBe(0);
  });

  it("counts repeated link labels", () => {
    const signals = collectUxSignals(
      '<html><body><a href="/a">Read more</a><a href="/b">Read more</a><a href="/c">Other</a></body></html>',
      PAGE_URL,
    );

    expect(signals.repetition.repeatedLinkTexts[0]).toEqual({
      signature: "read more",
      count: 2,
    });
  });
});

describe("robustness", () => {
  it.each([
    ["an empty string", ""],
    ["plain text", "not markup at all"],
    ["unclosed tags", "<html><body><div><p>text"],
    ["no body", "<h1>Bare</h1>"],
  ])("handles %s without throwing", (_label, html) => {
    expect(() => collectUxSignals(html, PAGE_URL)).not.toThrow();
  });

  it("is deterministic", () => {
    const html =
      '<html><body><nav><a href="/a">A</a></nav><h1>T</h1><p>words</p></body></html>';

    expect(collectUxSignals(html, PAGE_URL)).toEqual(collectUxSignals(html, PAGE_URL));
  });

  it("records the url it was given", () => {
    expect(collectUxSignals("<html></html>", PAGE_URL).url).toBe(PAGE_URL);
  });
});
