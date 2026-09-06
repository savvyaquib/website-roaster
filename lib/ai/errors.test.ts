import { describe, expect, it } from "vitest";

import { AI_ERROR_CODES, AiError, previewText, redactSecrets } from "./errors";

const KEY = "AIza-not-a-real-key-0123456789";

function error(code: (typeof AI_ERROR_CODES)[number], message = "Something failed.") {
  return new AiError({ code, message, provider: "gemini" });
}

describe("AiError", () => {
  it("is an Error, so it survives anything that expects one", () => {
    const failure = error("timeout");

    expect(failure).toBeInstanceOf(Error);
    expect(failure.name).toBe("AiError");
  });

  it("keeps the cause for debugging", () => {
    const cause = new Error("socket hang up");
    const failure = new AiError({
      code: "provider_unavailable",
      message: "unreachable",
      provider: "gemini",
      cause,
    });

    expect(failure.cause).toBe(cause);
  });

  it.each([
    ["timeout", true],
    ["rate_limited", true],
    ["provider_unavailable", true],
    ["authentication_failed", false],
    ["invalid_request", false],
    ["malformed_output", false],
    ["content_filtered", false],
    ["not_configured", false],
    ["aborted", false],
    ["response_truncated", false],
    ["unknown", false],
  ] as const)("marks %s retryable=%s", (code, retryable) => {
    // Retrying a rejected key or a malformed answer just fails again slower.
    expect(error(code).retryable).toBe(retryable);
  });

  it.each(AI_ERROR_CODES)("gives %s a message fit to show a person", (code) => {
    const message = error(code).userMessage;

    expect(message.length).toBeGreaterThan(0);
    // Every one of these says what is missing, never that the report failed —
    // the deterministic report is always there (ADR-016).
    expect(message.toLowerCase()).not.toContain("error");
  });

  it("reassures the reader that the measured results survived", () => {
    for (const code of AI_ERROR_CODES) {
      if (code === "not_configured") continue;
      expect(error(code).userMessage).toContain("measured results");
    }
  });

  it("says something different when nothing was ever configured", () => {
    // Not a failure. Nobody asked for AI.
    expect(error("not_configured").userMessage).toContain("not configured");
  });

  it("defaults issues to an empty list rather than undefined", () => {
    expect(error("unknown").issues).toEqual([]);
  });
});

describe("fields meant for logging", () => {
  it("carries the code, provider and retryability", () => {
    const failure = new AiError({
      code: "rate_limited",
      message: "slow down",
      provider: "gemini",
      status: 429,
    });

    expect(failure.toLogFields()).toEqual({
      provider: "gemini",
      code: "rate_limited",
      retryable: true,
      status: 429,
    });
  });

  it("carries the issue count, not the issues themselves", () => {
    const failure = new AiError({
      code: "malformed_output",
      message: "bad shape",
      provider: "gemini",
      issues: ["a", "b"],
      rawPreview: "the model said something",
    });

    const fields = failure.toLogFields();

    expect(fields.issueCount).toBe(2);
    // Model output is page content. CLAUDE.md forbids logging it.
    expect(JSON.stringify(fields)).not.toContain("the model said");
  });

  it("never carries the message body", () => {
    const failure = new AiError({
      code: "invalid_request",
      message: `key ${KEY} rejected`,
      provider: "gemini",
    });

    expect(JSON.stringify(failure.toLogFields())).not.toContain(KEY);
  });

  it("omits a status it does not have", () => {
    expect(error("timeout").toLogFields()).not.toHaveProperty("status");
  });
});

describe("redactSecrets", () => {
  it("removes a secret wherever it appears", () => {
    expect(redactSecrets(`a ${KEY} b ${KEY}`, [KEY])).toBe("a [redacted] b [redacted]");
  });

  it("leaves text alone when the secret is absent", () => {
    expect(redactSecrets("nothing to see", [KEY])).toBe("nothing to see");
  });

  it("ignores undefined secrets", () => {
    expect(redactSecrets("text", [undefined])).toBe("text");
  });

  it("ignores a value too short to be a real secret", () => {
    // Redacting "abc" would blank out most of an ordinary sentence.
    expect(redactSecrets("abc appears in abcdef", ["abc"])).toBe("abc appears in abcdef");
  });

  it("removes several secrets at once", () => {
    expect(redactSecrets("aaaaaaaaaa and bbbbbbbbbb", ["aaaaaaaaaa", "bbbbbbbbbb"])).toBe(
      "[redacted] and [redacted]",
    );
  });
});

describe("previewText", () => {
  it("collapses whitespace so a preview is one readable line", () => {
    expect(previewText("a\n\n  b\tc")).toBe("a b c");
  });

  it("returns short text unchanged", () => {
    expect(previewText("short")).toBe("short");
  });

  it("truncates long text and marks the cut", () => {
    const preview = previewText("x".repeat(1000), 50);

    expect(preview).toHaveLength(50);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("handles empty input", () => {
    expect(previewText("")).toBe("");
  });
});
