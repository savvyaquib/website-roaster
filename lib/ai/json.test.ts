import { describe, expect, it } from "vitest";

import { extractJson, parseStructuredOutput, toJsonValue } from "./json";
import type { ResponseSchema } from "./types";

interface Point {
  readonly label: string;
}

const pointSchema: ResponseSchema<Point> = {
  name: "point",
  jsonSchema: { type: "object", properties: { label: { type: "string" } } },
  parse(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { ok: false, issues: ["Expected an object."] };
    }

    const label = (value as Record<string, unknown>).label;

    return typeof label === "string"
      ? { ok: true, value: { label } }
      : { ok: false, issues: ["label must be a string."] };
  },
};

describe("plain JSON", () => {
  it("parses an object", () => {
    expect(extractJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });

  it("parses an array", () => {
    expect(extractJson("[1,2,3]")).toEqual({ ok: true, value: [1, 2, 3] });
  });

  it("ignores surrounding whitespace", () => {
    expect(extractJson('\n\n  {"a":1}  \n')).toEqual({ ok: true, value: { a: 1 } });
  });
});

describe("markdown fences", () => {
  it("reads a ```json block", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ ok: true, value: { a: 1 } });
  });

  it("reads an unlabelled ``` block", () => {
    expect(extractJson('```\n{"a":1}\n```')).toEqual({ ok: true, value: { a: 1 } });
  });

  it("reads a fenced block introduced by prose", () => {
    const text = 'Here you go:\n\n```json\n{"a":1}\n```\n\nLet me know!';

    expect(extractJson(text)).toEqual({ ok: true, value: { a: 1 } });
  });

  it("reads a fence the model never closed", () => {
    // A truncated response often loses its closing fence but keeps valid JSON.
    expect(extractJson('```json\n{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });
});

describe("JSON buried in prose", () => {
  it("finds an object between sentences", () => {
    expect(extractJson('Certainly! {"a":1} Hope that helps.')).toEqual({
      ok: true,
      value: { a: 1 },
    });
  });

  it("finds an array between sentences", () => {
    expect(extractJson("Results: [1,2] — that is all.")).toEqual({
      ok: true,
      value: [1, 2],
    });
  });

  it("does not stop at a brace inside a string value", () => {
    const text = 'Note: {"note":"a } brace","ok":true} done';

    expect(extractJson(text)).toEqual({
      ok: true,
      value: { note: "a } brace", ok: true },
    });
  });

  it("handles an escaped quote before a closing brace", () => {
    const text = 'x {"quote":"she said \\"hi\\"","ok":true} y';

    expect(extractJson(text)).toEqual({
      ok: true,
      value: { quote: 'she said "hi"', ok: true },
    });
  });

  it("handles an escaped backslash at the end of a string", () => {
    const text = 'x {"path":"C:\\\\","ok":true} y';

    expect(extractJson(text)).toEqual({ ok: true, value: { path: "C:\\", ok: true } });
  });

  it("handles nested objects and arrays", () => {
    const text = 'Result: {"a":{"b":[1,{"c":2}]}} end';

    expect(extractJson(text)).toEqual({ ok: true, value: { a: { b: [1, { c: 2 }] } } });
  });

  it("takes the first value when the model offers two", () => {
    expect(extractJson('{"first":1} and also {"second":2}')).toEqual({
      ok: true,
      value: { first: 1 },
    });
  });
});

describe("what it refuses", () => {
  it("refuses an empty response", () => {
    const result = extractJson("   ");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("empty");
  });

  it("refuses prose with no JSON in it", () => {
    const result = extractJson("I'm sorry, I can't help with that.");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("could be parsed");
  });

  it("refuses an object that was never closed", () => {
    // What a response cut off at the token limit looks like.
    expect(extractJson('{"a":1,"b":').ok).toBe(false);
  });

  it("refuses an array that was never closed", () => {
    expect(extractJson('["a","b"').ok).toBe(false);
  });

  it("refuses almost-JSON", () => {
    expect(extractJson("{a: 1, b: 2}").ok).toBe(false);
    expect(extractJson("{'a': 1}").ok).toBe(false);
  });

  it("refuses a trailing comma", () => {
    expect(extractJson('{"a":1,}').ok).toBe(false);
  });
});

describe("scalars", () => {
  it.each([
    ["true", true],
    ["42", 42],
    ["null", null],
    ['"text"', "text"],
  ] as const)("parses a bare %s, which the schema then judges", (text, value) => {
    // Extraction is not validation; a scalar reaches the schema and is refused
    // there, with an issue a caller can read.
    expect(extractJson(text)).toEqual({ ok: true, value });
  });
});

describe("parseStructuredOutput", () => {
  it("returns the parsed value when it matches", () => {
    expect(parseStructuredOutput('{"label":"ok"}', pointSchema)).toEqual({
      ok: true,
      value: { label: "ok" },
    });
  });

  it("reports the extraction failure when there is no JSON", () => {
    const result = parseStructuredOutput("nothing here", pointSchema);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toHaveLength(1);
  });

  it("reports the schema's own issues when the shape is wrong", () => {
    const result = parseStructuredOutput('{"label":42}', pointSchema);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContain("label must be a string.");
  });

  it("refuses a scalar that parsed but is not the expected shape", () => {
    const result = parseStructuredOutput("42", pointSchema);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContain("Expected an object.");
  });

  it("runs the schema on fenced output too", () => {
    expect(parseStructuredOutput('```json\n{"label":"ok"}\n```', pointSchema)).toEqual({
      ok: true,
      value: { label: "ok" },
    });
  });
});

describe("toJsonValue", () => {
  it("passes plain data through unchanged", () => {
    expect(toJsonValue({ a: 1, b: ["x"], c: null })).toEqual({
      a: 1,
      b: ["x"],
      c: null,
    });
  });

  it("accepts an interface-typed value that JsonValue would reject", () => {
    // The reason this exists: TypeScript will not assign an interface to
    // JsonValue, so a ScoreReport cannot be passed as evidence directly.
    interface Report {
      readonly score: number;
      readonly grade: string;
    }
    const report: Report = { score: 72, grade: "C" };

    expect(toJsonValue(report)).toEqual({ score: 72, grade: "C" });
  });

  it("strips functions, so no behaviour can reach a model", () => {
    const withMethod = { keep: 1, drop: () => "secret" };

    expect(toJsonValue(withMethod)).toEqual({ keep: 1 });
  });

  it("flattens a class instance to its own data", () => {
    class Live {
      readonly name = "x";
      secret() {
        return "no";
      }
    }

    expect(toJsonValue(new Live())).toEqual({ name: "x" });
  });

  it("resolves a getter to its value rather than carrying the accessor", () => {
    const evidence = {
      get computed() {
        return 42;
      },
    };

    expect(toJsonValue(evidence)).toEqual({ computed: 42 });
  });

  it("turns undefined into null rather than dropping the value", () => {
    expect(toJsonValue(undefined)).toBeNull();
  });

  it("throws on a cycle instead of sending something unserialisable", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => toJsonValue(cyclic)).toThrow(TypeError);
  });
});
