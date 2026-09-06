import { describe, expect, it } from "vitest";

import { buildInterpretationPrompt, CONSTRAINTS, PROHIBITIONS } from "./prompt";

const prompt = buildInterpretationPrompt({ url: "https://example.com/" });

describe("the prompt states every prohibition Phase 14 requires", () => {
  it.each([
    ["invented metrics", "Do not invent metrics"],
    ["invented technical findings", "Do not invent technical findings"],
    ["unsupported security claims", "Do not make unsupported security claims"],
    ["unsupported SEO claims", "Do not make unsupported SEO claims"],
    ["contradicting supplied evidence", "Do not contradict the supplied evidence"],
  ])("prohibits %s", (_name, text) => {
    expect(prompt).toContain(text);
  });

  it("includes every prohibition verbatim", () => {
    for (const prohibition of PROHIBITIONS) {
      expect(prompt).toContain(prohibition);
    }
  });

  it("includes every writing constraint", () => {
    for (const constraint of CONSTRAINTS) {
      expect(prompt).toContain(constraint);
    }
  });
});

describe("what the prohibitions actually say", () => {
  const all = PROHIBITIONS.join(" ");

  it("forbids claiming the site is secure, in those words", () => {
    // CLAUDE.md: the AI must never claim a website is "secure".
    expect(all).toContain("Never state or imply that this website is secure");
  });

  it("forbids naming a vulnerability class nothing established", () => {
    expect(all).toContain("SQL injection");
    expect(all).toContain("unless a supplied finding names it");
  });

  it("forbids promising a ranking", () => {
    expect(all).toContain("Never promise or predict a ranking");
  });

  it("requires every number to come from the evidence", () => {
    expect(all).toContain("Every number you write must appear in the evidence");
  });

  it("says an unknown finding id will be rejected", () => {
    // Telling the model the rule is enforced is cheaper than discarding answers.
    expect(all).toContain("will be rejected");
  });

  it("says the evidence wins when the model disagrees", () => {
    expect(all).toContain("the evidence is right");
  });
});

describe("the rest of the instruction", () => {
  it("names the page under review", () => {
    expect(prompt).toContain("https://example.com/");
  });

  it("asks for all five required outputs", () => {
    expect(prompt).toContain("executiveSummary");
    expect(prompt).toContain("strengths");
    expect(prompt).toContain("problems");
    // Explanations and recommendations live on each problem.
    expect(prompt).toContain("why it matters");
    expect(prompt).toContain("recommended action");
  });

  it("tells the model it is interpreting, not measuring", () => {
    // ADR-003: AI interprets evidence; it never produces measurements.
    expect(prompt).toContain("You are not measuring anything");
  });

  it("asks it to separate measured facts from judgements", () => {
    expect(prompt).toContain("marked `measured` or `heuristic`");
  });

  it("says an undetermined check is neither a problem nor a strength", () => {
    expect(prompt).toContain("has established nothing");
  });

  it("permits an empty strengths list rather than invented praise", () => {
    expect(prompt).toContain("rather than inventing praise");
  });

  it("says a discarded answer costs the whole section", () => {
    expect(prompt).toContain("discarded in full");
  });

  it("does not ask for a roast", () => {
    // Phase 15's job. docs/IMPLEMENTATION.md lists it under Phase 14, but the
    // phase brief for this work excludes it.
    expect(prompt.toLowerCase()).not.toContain("roast");
    expect(prompt.toLowerCase()).not.toContain("joke");
  });
});

describe("determinism", () => {
  it("produces identical text for identical options", () => {
    expect(buildInterpretationPrompt({ url: "https://a.test/" })).toBe(
      buildInterpretationPrompt({ url: "https://a.test/" }),
    );
  });

  it("differs only by the URL", () => {
    const a = buildInterpretationPrompt({ url: "https://a.test/" });
    const b = buildInterpretationPrompt({ url: "https://b.test/" });

    expect(a.replace("https://a.test/", "X")).toBe(b.replace("https://b.test/", "X"));
  });
});
