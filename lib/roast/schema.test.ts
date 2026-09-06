import { describe, expect, it } from "vitest";

import { parseStructuredOutput } from "@/lib/ai/json";

import { MAX_LINES, MAX_PUNCHLINE_LENGTH, roastSchema } from "./schema";

const valid = {
  lines: [
    { findingId: "seo.title.missing", punchline: "A confident silence." },
    { findingId: "ux.navigation.busy", punchline: "Every link got an invitation." },
  ],
};

const parse = (value: unknown) => roastSchema.parse(value);

describe("a valid answer", () => {
  it("parses", () => {
    const result = parse(valid);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.lines).toHaveLength(2);
  });

  it("accepts an empty list", () => {
    // Structurally fine. Whether it is useful is generate-roast's call.
    expect(parse({ lines: [] }).ok).toBe(true);
  });

  it("trims surrounding whitespace", () => {
    const result = parse({
      lines: [{ findingId: "  a.b.c  ", punchline: "  A joke.  " }],
    });

    if (result.ok) {
      expect(result.value.lines[0]?.findingId).toBe("a.b.c");
      expect(result.value.lines[0]?.punchline).toBe("A joke.");
    }
  });
});

describe("shapes it refuses", () => {
  it.each([
    ["a string", "just text"],
    ["a number", 42],
    ["null", null],
    ["an array", []],
    ["an object with no lines", { nope: true }],
    ["lines that are not an array", { lines: "one" }],
  ])("refuses %s", (_name, value) => {
    expect(parse(value).ok).toBe(false);
  });

  it("refuses a line that is not an object", () => {
    const result = parse({ lines: ["a joke"] });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toContain("lines[0] must be an object");
  });

  it("refuses a missing finding id", () => {
    const result = parse({ lines: [{ punchline: "A joke." }] });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toContain("lines[0].findingId");
  });

  it("refuses an empty finding id", () => {
    expect(parse({ lines: [{ findingId: "   ", punchline: "A joke." }] }).ok).toBe(false);
  });

  it("refuses a missing punchline", () => {
    const result = parse({ lines: [{ findingId: "a.b.c" }] });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toContain("lines[0].punchline");
  });

  it("refuses an empty punchline", () => {
    const result = parse({ lines: [{ findingId: "a.b.c", punchline: "   " }] });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toContain("must not be empty");
  });

  it("refuses a punchline of the wrong type", () => {
    expect(parse({ lines: [{ findingId: "a.b.c", punchline: 42 }] }).ok).toBe(false);
  });

  it("locates every bad line by index", () => {
    const result = parse({
      lines: [
        { findingId: "a.b.c", punchline: "Fine." },
        { findingId: "d.e.f", punchline: 42 },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toContain("lines[1].punchline");
  });
});

describe("bounds", () => {
  it("refuses a punchline that is not a punchline any more", () => {
    const result = parse({
      lines: [{ findingId: "a.b.c", punchline: "x".repeat(MAX_PUNCHLINE_LENGTH + 1) }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toContain("the maximum is");
  });

  it("accepts a punchline at exactly the cap", () => {
    const result = parse({
      lines: [{ findingId: "a.b.c", punchline: "x".repeat(MAX_PUNCHLINE_LENGTH) }],
    });

    expect(result.ok).toBe(true);
  });

  it("refuses more lines than the cap", () => {
    const result = parse({
      lines: Array.from({ length: MAX_LINES + 1 }, () => ({
        findingId: "a.b.c",
        punchline: "A joke.",
      })),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toContain("the maximum is");
  });
});

describe("through the provider's output reader", () => {
  it("reads an answer wrapped in a markdown fence", () => {
    const fenced = `\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``;

    expect(parseStructuredOutput(fenced, roastSchema).ok).toBe(true);
  });

  it("reads an answer a model introduced with prose", () => {
    const chatty = `Happy to help! ${JSON.stringify(valid)} Enjoy.`;

    expect(parseStructuredOutput(chatty, roastSchema).ok).toBe(true);
  });

  it("refuses an answer that is only prose", () => {
    expect(parseStructuredOutput("Your site is fine, honestly.", roastSchema).ok).toBe(
      false,
    );
  });

  it("refuses a truncated answer", () => {
    expect(
      parseStructuredOutput(JSON.stringify(valid).slice(0, 40), roastSchema).ok,
    ).toBe(false);
  });
});

describe("the schema sent to the provider", () => {
  it("describes what the parser expects", () => {
    expect(roastSchema.name).toBe("roast");
    expect(roastSchema.jsonSchema.type).toBe("object");
    expect(roastSchema.jsonSchema.required).toEqual(["lines"]);
  });

  it("gives a model no field in which to state a fact", () => {
    // The whole safety property: a reference and a joke, nothing else.
    const item = roastSchema.jsonSchema.properties?.lines?.items;

    expect(Object.keys(item?.properties ?? {}).sort()).toEqual([
      "findingId",
      "punchline",
    ]);
  });
});
