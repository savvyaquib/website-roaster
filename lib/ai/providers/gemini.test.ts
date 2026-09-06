/**
 * Adapter tests.
 *
 * Every case runs against a fake `fetch`. Nothing here contacts Google, and a
 * test that needed to would be the wrong test — the point of the adapter is
 * that its failure handling can be exercised exhaustively without a key.
 */

import { describe, expect, it, vi } from "vitest";

import type { AiRequest, FetchLike, ResponseSchema } from "../types";
import { createGeminiProvider, DEFAULT_GEMINI_MODEL, toGeminiSchema } from "./gemini";

const API_KEY = "test-key-abcdefghijklmnop";

interface Summary {
  readonly headline: string;
  readonly points: readonly string[];
}

const summarySchema: ResponseSchema<Summary> = {
  name: "summary",
  jsonSchema: {
    type: "object",
    properties: {
      headline: { type: "string" },
      points: { type: "array", items: { type: "string" } },
    },
    required: ["headline", "points"],
  },
  parse(value) {
    const issues: string[] = [];

    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { ok: false, issues: ["Expected an object."] };
    }

    const record = value as Record<string, unknown>;

    if (typeof record.headline !== "string") issues.push("headline must be a string.");
    if (
      !Array.isArray(record.points) ||
      !record.points.every((item) => typeof item === "string")
    ) {
      issues.push("points must be an array of strings.");
    }

    return issues.length > 0
      ? { ok: false, issues }
      : {
          ok: true,
          value: {
            headline: record.headline as string,
            points: record.points as string[],
          },
        };
  },
};

const request: AiRequest<Summary> = {
  task: "summary",
  instruction: "Summarise the evidence.",
  evidence: { score: 72, findings: [{ id: "seo.title.missing" }] },
  schema: summarySchema,
};

/** A fetch that returns one canned response. */
function respondWith(body: string, status = 200): FetchLike {
  return vi.fn(async () => new Response(body, { status }));
}

function geminiBody(text: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
    usageMetadata: {
      promptTokenCount: 100,
      candidatesTokenCount: 20,
      totalTokenCount: 120,
    },
    ...extra,
  });
}

function provider(fetchImpl: FetchLike, timeoutMs = 30_000) {
  let clock = 1000;
  return createGeminiProvider({
    apiKey: API_KEY,
    fetchImpl,
    timeoutMs,
    now: () => (clock += 5),
  });
}

// ---------------------------------------------------------------------------
// Success
// ---------------------------------------------------------------------------

describe("a successful call", () => {
  it("returns validated structured data", async () => {
    const result = await provider(
      respondWith(geminiBody('{"headline":"Solid","points":["a","b"]}')),
    ).generate(request);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toEqual({ headline: "Solid", points: ["a", "b"] });
  });

  it("reports usage, model, task and finish reason", async () => {
    const result = await provider(
      respondWith(geminiBody('{"headline":"Solid","points":[]}')),
    ).generate(request);

    expect(result.meta.provider).toBe("gemini");
    expect(result.meta.model).toBe(DEFAULT_GEMINI_MODEL);
    expect(result.meta.task).toBe("summary");
    expect(result.meta.finishReason).toBe("STOP");
    expect(result.meta.usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
    });
    expect(result.meta.latencyMs).toBeGreaterThan(0);
  });

  it("reports null usage when the provider omits it", async () => {
    const body = JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"headline":"x","points":[]}' }] } }],
    });

    const result = await provider(respondWith(body)).generate(request);

    expect(result.meta.usage).toEqual({
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    });
  });

  it("joins multi-part responses before parsing", async () => {
    const body = JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text: '{"headline":"Split' }, { text: '","points":[]}' }],
          },
          finishReason: "STOP",
        },
      ],
    });

    const result = await provider(respondWith(body)).generate(request);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.headline).toBe("Split");
  });
});

// ---------------------------------------------------------------------------
// The request it builds
// ---------------------------------------------------------------------------

describe("the request", () => {
  async function capture(withImages = false) {
    const fetchImpl = vi.fn(
      async () => new Response(geminiBody('{"headline":"x","points":[]}')),
    );

    await provider(fetchImpl as unknown as FetchLike).generate({
      ...request,
      ...(withImages
        ? {
            images: [
              { mimeType: "image/png", dataBase64: "AAAA", label: "desktop viewport" },
            ],
          }
        : {}),
    });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string>; body: string; method: string },
    ];

    return { url, init, body: JSON.parse(init.body) as Record<string, never> };
  }

  it("sends the key as a header, never in the URL", async () => {
    const { url, init } = await capture();

    // A key in a query string reaches error messages, proxy logs and anything
    // that records a request line (ADR-018).
    expect(url).not.toContain(API_KEY);
    expect(url).not.toContain("key=");
    expect(init.headers["x-goog-api-key"]).toBe(API_KEY);
  });

  it("posts to the configured model's generateContent endpoint", async () => {
    const { url, init } = await capture();

    expect(init.method).toBe("POST");
    expect(url).toContain(`/models/${DEFAULT_GEMINI_MODEL}:generateContent`);
  });

  it("sends the instruction as a system instruction", async () => {
    const { body } = await capture();

    expect(JSON.stringify(body)).toContain("Summarise the evidence.");
  });

  it("sends the evidence as JSON, with the reason-only-from-this framing", async () => {
    const { body } = await capture();
    const text = JSON.stringify(body);

    expect(text).toContain("Reason only from this evidence");
    expect(text).toContain("seo.title.missing");
  });

  it("asks for JSON output and passes the schema through", async () => {
    const { body } = await capture();
    const config = (body as Record<string, Record<string, unknown>>).generationConfig!;

    expect(config.responseMimeType).toBe("application/json");
    expect(config.temperature).toBe(0);
    expect(JSON.stringify(config.responseSchema)).toContain("OBJECT");
  });

  it("sends an image inline, by value", async () => {
    // ADR-034: no artifact store before Phase 16, so images cannot go by URL.
    const { body } = await capture(true);
    const text = JSON.stringify(body);

    expect(text).toContain("inlineData");
    expect(text).toContain("image/png");
    expect(text).toContain("desktop viewport");
  });
});

describe("schema translation", () => {
  it("upper-cases types for the vendor's OpenAPI subset", () => {
    expect(toGeminiSchema({ type: "string" })).toEqual({ type: "STRING" });
  });

  it("translates nested properties and array items", () => {
    const translated = toGeminiSchema({
      type: "object",
      properties: { items: { type: "array", items: { type: "integer" } } },
      required: ["items"],
    });

    expect(translated).toEqual({
      type: "OBJECT",
      required: ["items"],
      properties: { items: { type: "ARRAY", items: { type: "INTEGER" } } },
    });
  });

  it("carries enum, description and nullability", () => {
    expect(
      toGeminiSchema({
        type: "string",
        description: "A grade.",
        enum: ["A", "B"],
        nullable: true,
      }),
    ).toEqual({
      type: "STRING",
      description: "A grade.",
      enum: ["A", "B"],
      nullable: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Provider failure
// ---------------------------------------------------------------------------

describe("provider failure", () => {
  it.each([
    [401, "authentication_failed"],
    [403, "authentication_failed"],
    [429, "rate_limited"],
    [500, "provider_unavailable"],
    [503, "provider_unavailable"],
    [400, "invalid_request"],
    [404, "invalid_request"],
  ] as const)("maps HTTP %i to %s", async (status, code) => {
    const result = await provider(
      respondWith(JSON.stringify({ error: { message: "nope" } }), status),
    ).generate(request);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(code);
    expect(result.error.status).toBe(status);
  });

  it("marks transient failures retryable and permanent ones not", async () => {
    const rateLimited = await provider(respondWith("{}", 429)).generate(request);
    const unauthorised = await provider(respondWith("{}", 401)).generate(request);

    expect(rateLimited.ok).toBe(false);
    expect(unauthorised.ok).toBe(false);
    if (rateLimited.ok || unauthorised.ok) return;

    expect(rateLimited.error.retryable).toBe(true);
    expect(unauthorised.error.retryable).toBe(false);
  });

  it("treats a network error as the provider being unavailable", async () => {
    const failing: FetchLike = () => Promise.reject(new Error("ECONNREFUSED"));

    const result = await provider(failing).generate(request);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("provider_unavailable");
    expect(result.error.message).toContain("ECONNREFUSED");
  });

  it("times out rather than hanging", async () => {
    // The fetch never settles on its own; only the deadline ends it.
    const hanging: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "TimeoutError" }));
        });
      });

    const result = await provider(hanging, 20).generate(request);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("timeout");
    expect(result.error.message).toContain("20ms");
    expect(result.error.retryable).toBe(true);
  });

  it("honours a per-call timeout override", async () => {
    const hanging: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "TimeoutError" }));
        });
      });

    const result = await provider(hanging, 60_000).generate(request, { timeoutMs: 20 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("timeout");
  });

  it("distinguishes a caller's cancellation from a timeout", async () => {
    const controller = new AbortController();
    const hanging: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });

    const pending = provider(hanging, 60_000).generate(request, {
      signal: controller.signal,
    });
    controller.abort();

    const result = await pending;

    expect(result.ok).toBe(false);
    // "The user navigated away" is not "the model is slow".
    if (!result.ok) expect(result.error.code).toBe("aborted");
  });

  it("treats a non-JSON success body as the provider misbehaving", async () => {
    const result = await provider(respondWith("<html>502 Bad Gateway</html>")).generate(
      request,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("provider_unavailable");
  });

  it("reports a blocked prompt as filtered content", async () => {
    const body = JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } });

    const result = await provider(respondWith(body)).generate(request);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("content_filtered");
  });

  it("reports a safety-stopped generation as filtered content", async () => {
    const body = JSON.stringify({
      candidates: [{ content: { parts: [] }, finishReason: "SAFETY" }],
    });

    const result = await provider(respondWith(body)).generate(request);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("content_filtered");
  });

  it("reports hitting the output limit as truncation, not malformed output", async () => {
    // A different problem with a different fix: raise the limit, do not retry.
    const body = JSON.stringify({
      candidates: [
        {
          content: { parts: [{ text: '{"headline":"Cut off' }] },
          finishReason: "MAX_TOKENS",
        },
      ],
    });

    const result = await provider(respondWith(body)).generate(request);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("response_truncated");
  });

  it("never leaks the API key into an error message", async () => {
    const body = JSON.stringify({
      error: { message: `Request with key ${API_KEY} was rejected` },
    });

    const result = await provider(respondWith(body, 400)).generate(request);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.message).not.toContain(API_KEY);
    expect(result.error.message).toContain("[redacted]");
  });

  it("carries no secret in the fields meant for logging", async () => {
    const result = await provider(respondWith("{}", 401)).generate(request);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(JSON.stringify(result.error.toLogFields())).not.toContain(API_KEY);
  });

  it("still reports the task and model when it fails", async () => {
    const result = await provider(respondWith("{}", 500)).generate(request);

    expect(result.meta.task).toBe("summary");
    expect(result.meta.model).toBe(DEFAULT_GEMINI_MODEL);
  });
});

// ---------------------------------------------------------------------------
// Malformed model output
// ---------------------------------------------------------------------------

describe("malformed model output", () => {
  it("rejects text that is not JSON at all", async () => {
    const result = await provider(
      respondWith(geminiBody("I'm sorry, I can't help with that.")),
    ).generate(request);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("malformed_output");
    expect(result.error.issues.length).toBeGreaterThan(0);
  });

  it("rejects valid JSON that does not match the schema", async () => {
    const result = await provider(
      respondWith(geminiBody('{"headline":42,"points":"not an array"}')),
    ).generate(request);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    // The schema is the authority, whatever the provider claimed to enforce.
    expect(result.error.code).toBe("malformed_output");
    expect(result.error.issues).toContain("headline must be a string.");
    expect(result.error.issues).toContain("points must be an array of strings.");
  });

  it("rejects a JSON value of the wrong kind", async () => {
    const result = await provider(geminiFor('["a","b"]')).generate(request);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.issues).toContain("Expected an object.");
  });

  it("rejects an empty response", async () => {
    const body = JSON.stringify({
      candidates: [{ content: { parts: [{ text: "   " }] }, finishReason: "STOP" }],
    });

    const result = await provider(respondWith(body)).generate(request);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("malformed_output");
  });

  it("rejects a response with no candidates", async () => {
    const result = await provider(respondWith(JSON.stringify({}))).generate(request);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("malformed_output");
  });

  it("keeps a preview of what the model actually said", async () => {
    const result = await provider(
      respondWith(geminiBody("Sorry, here is some prose instead.")),
    ).generate(request);

    expect(result.ok).toBe(false);
    // Without this, diagnosing a misbehaving model means reproducing it.
    if (!result.ok) expect(result.error.rawPreview).toContain("Sorry");
  });

  it("truncates that preview rather than echoing the whole response", async () => {
    const result = await provider(geminiFor("x".repeat(5000))).generate(request);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error.rawPreview ?? "").length).toBeLessThan(400);
  });

  it("recovers JSON wrapped in a markdown fence", async () => {
    const fenced = '```json\n{"headline":"Fenced","points":[]}\n```';

    const result = await provider(geminiFor(fenced)).generate(request);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.headline).toBe("Fenced");
  });

  it("recovers JSON surrounded by prose", async () => {
    const chatty = 'Certainly! {"headline":"Chatty","points":["a"]} Hope that helps.';

    const result = await provider(geminiFor(chatty)).generate(request);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.headline).toBe("Chatty");
  });

  it("does not accept a half-written object", async () => {
    const result = await provider(geminiFor('{"headline":"Cut off","points":[')).generate(
      request,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("malformed_output");
  });
});

/** A canned response carrying `text` as the model's answer. */
function geminiFor(text: string): FetchLike {
  return respondWith(geminiBody(text));
}
