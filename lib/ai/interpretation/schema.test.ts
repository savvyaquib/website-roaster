import { describe, expect, it } from "vitest";

import { parseStructuredOutput } from "@/lib/ai/json";

import {
  interpretationSchema,
  MAX_FIELD_LENGTH,
  MAX_PROBLEMS,
  MAX_STRENGTHS,
  MAX_SUMMARY_LENGTH,
} from "./schema";

const valid = {
  executiveSummary: "A short summary of where this page stands right now today.",
  strengths: [{ findingId: "seo.canonical.ok", whyItHelps: "Duplicates stay merged." }],
  problems: [
    {
      findingId: "seo.title.missing",
      whyItMatters: "Search results have nothing to show.",
      recommendation: "Add a descriptive title.",
    },
  ],
};

const parse = (value: unknown) => interpretationSchema.parse(value);

describe("a valid answer", () => {
  it("parses", () => {
    const result = parse(valid);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.problems).toHaveLength(1);
  });

  it("accepts empty strengths and problems", () => {
    expect(parse({ ...valid, strengths: [], problems: [] }).ok).toBe(true);
  });

  it("trims surrounding whitespace", () => {
    const result = parse({
      ...valid,
      executiveSummary: `   ${valid.executiveSummary}  `,
    });

    if (result.ok) expect(result.value.executiveSummary).toBe(valid.executiveSummary);
  });
});

describe("shapes it refuses", () => {
  it.each([
    ["a string", "just text"],
    ["a number", 42],
    ["null", null],
    ["an array", []],
  ])("refuses %s", (_name, value) => {
    expect(parse(value).ok).toBe(false);
  });

  it("refuses a missing summary", () => {
    const { executiveSummary: _dropped, ...rest } = valid;

    const result = parse(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toContain("executiveSummary");
  });

  it("refuses an empty summary", () => {
    const result = parse({ ...valid, executiveSummary: "   " });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toContain("must not be empty");
  });

  it("refuses a summary of the wrong type", () => {
    expect(parse({ ...valid, executiveSummary: 42 }).ok).toBe(false);
  });

  it("refuses strengths that are not an array", () => {
    const result = parse({ ...valid, strengths: "none" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toContain("strengths must be an array");
  });

  it("refuses a problem missing its recommendation", () => {
    const result = parse({
      ...valid,
      problems: [{ findingId: "a.b.c", whyItMatters: "Because." }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toContain("problems[0].recommendation");
  });

  it("refuses a problem entry that is not an object", () => {
    const result = parse({ ...valid, problems: ["a string"] });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toContain("problems[0] must be an object");
  });

  it("names every problem it found, not just the first", () => {
    const result = parse({
      executiveSummary: 42,
      strengths: "no",
      problems: [{ findingId: 1 }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.length).toBeGreaterThan(2);
  });

  it("locates a bad entry by index", () => {
    const result = parse({
      ...valid,
      strengths: [
        { findingId: "ok.id", whyItHelps: "Fine." },
        { findingId: "ok.id", whyItHelps: 5 },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toContain("strengths[1].whyItHelps");
  });
});

describe("bounds", () => {
  it("refuses a summary longer than the cap", () => {
    const result = parse({
      ...valid,
      executiveSummary: "x".repeat(MAX_SUMMARY_LENGTH + 1),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toContain("longer than");
  });

  it("refuses a field longer than the cap", () => {
    const result = parse({
      ...valid,
      problems: [
        {
          findingId: "a.b.c",
          whyItMatters: "x".repeat(MAX_FIELD_LENGTH + 1),
          recommendation: "Fix.",
        },
      ],
    });

    expect(result.ok).toBe(false);
  });

  it("refuses more problems than the cap", () => {
    const result = parse({
      ...valid,
      problems: Array.from({ length: MAX_PROBLEMS + 1 }, () => ({
        findingId: "a.b.c",
        whyItMatters: "Because.",
        recommendation: "Fix.",
      })),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toContain("the maximum is");
  });

  it("refuses more strengths than the cap", () => {
    const result = parse({
      ...valid,
      strengths: Array.from({ length: MAX_STRENGTHS + 1 }, () => ({
        findingId: "a.b.c",
        whyItHelps: "Good.",
      })),
    });

    expect(result.ok).toBe(false);
  });

  it("accepts exactly the cap", () => {
    const result = parse({
      ...valid,
      problems: Array.from({ length: MAX_PROBLEMS }, () => ({
        findingId: "a.b.c",
        whyItMatters: "Because.",
        recommendation: "Fix.",
      })),
    });

    expect(result.ok).toBe(true);
  });
});

describe("through the provider's output reader", () => {
  it("reads an answer wrapped in a markdown fence", () => {
    const fenced = `\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``;

    expect(parseStructuredOutput(fenced, interpretationSchema).ok).toBe(true);
  });

  it("reads an answer surrounded by prose", () => {
    const chatty = `Here is my review: ${JSON.stringify(valid)} Hope it helps!`;

    expect(parseStructuredOutput(chatty, interpretationSchema).ok).toBe(true);
  });

  it("refuses an answer that is only prose", () => {
    expect(
      parseStructuredOutput("The site looks fine to me.", interpretationSchema).ok,
    ).toBe(false);
  });

  it("refuses a truncated answer", () => {
    const cut = JSON.stringify(valid).slice(0, 60);

    expect(parseStructuredOutput(cut, interpretationSchema).ok).toBe(false);
  });
});

describe("the schema sent to the provider", () => {
  it("describes the object the parser expects", () => {
    expect(interpretationSchema.jsonSchema.type).toBe("object");
    expect(interpretationSchema.jsonSchema.required).toEqual([
      "executiveSummary",
      "strengths",
      "problems",
    ]);
  });

  it("declares the fields a caller reads", () => {
    const properties = interpretationSchema.jsonSchema.properties ?? {};

    expect(Object.keys(properties).sort()).toEqual([
      "executiveSummary",
      "problems",
      "strengths",
    ]);
    expect(properties.problems?.items?.required).toEqual([
      "findingId",
      "whyItMatters",
      "recommendation",
    ]);
  });
});
