/**
 * The guarantee that AI is optional.
 *
 * ADR-016 says the deterministic report must survive an absent or broken AI
 * provider. That is easy to claim in a comment and easy to lose the first time
 * something reaches for a provider without checking, so it is asserted here
 * against the real pipeline rather than a mock of it.
 */

import { describe, expect, it, vi } from "vitest";

import { analyzeContent, extractContent } from "@/lib/analysis/content";
import { analyzeUx, collectUxSignals } from "@/lib/analysis/ux";
import { getServerEnv, parseServerEnv } from "@/lib/config/env";
import { buildRecommendations } from "@/lib/recommendations";
import { scoreAnalysis } from "@/lib/scoring";

import { toJsonValue } from "./json";
import { resolveAiProviderFromEnv } from "./resolve-provider";
import type { FetchLike } from "./types";

const HTML = `<!doctype html><html><head><title>Home</title></head><body>
<nav><a href="/a">A</a></nav>
<main><h1>Welcome</h1><p>Short.</p><h4>Skipped</h4><a href="/x">Get started</a></main>
</body></html>`;

const URL = "https://example.com/";

/** The deterministic pipeline, end to end, with no AI anywhere in it. */
function deterministicReport() {
  const findings = [
    ...analyzeUx({ signals: collectUxSignals(HTML, URL) }),
    ...analyzeContent({ inventory: extractContent(HTML, URL) }),
  ];

  const score = scoreAnalysis({ findings });

  return { findings, score, recommendations: buildRecommendations({ findings, score }) };
}

describe("with no AI configured at all", () => {
  const availability = resolveAiProviderFromEnv({});
  const report = deterministicReport();

  it("still produces findings", () => {
    expect(report.findings.length).toBeGreaterThan(0);
  });

  it("still produces a score with a grade", () => {
    expect(report.score.overall.score).not.toBeNull();
    expect(report.score.overall.grade).not.toBeNull();
  });

  it("still produces ranked recommendations", () => {
    expect(report.recommendations.summary.total).toBeGreaterThan(0);
    expect(report.recommendations.recommendations[0]?.rank).toBe(1);
  });

  it("says why the AI section is missing, in words a person can act on", () => {
    expect(availability.available).toBe(false);
    if (availability.available) return;

    expect(availability.reason).toContain("AI_API_KEY");
    expect(availability.error.userMessage).toContain("measured results");
  });
});

describe("with a broken AI configuration", () => {
  it.each([
    ["an unknown provider", { AI_PROVIDER: "not-real", AI_API_KEY: "aaaaaaaaaaaa" }],
    ["a provider with no key", { AI_PROVIDER: "gemini" }],
    ["a key with no provider", { AI_API_KEY: "aaaaaaaaaaaa" }],
    ["a nonsense timeout", { AI_TIMEOUT_MS: "banana" }],
  ])("still produces the full deterministic report with %s", (_name, source) => {
    // The failure mode being guarded against is a misconfigured optional
    // feature taking down the part that never needed it.
    expect(() => parseServerEnv({ ...source, NODE_ENV: "test" })).not.toThrow();

    const report = deterministicReport();

    expect(report.score.overall.score).not.toBeNull();
    expect(report.recommendations.summary.total).toBeGreaterThan(0);
  });
});

describe("with a provider that fails at call time", () => {
  it("returns a failure instead of throwing", async () => {
    const exploding: FetchLike = () => Promise.reject(new Error("network is down"));

    const availability = resolveAiProviderFromEnv(
      { AI_PROVIDER: "gemini", AI_API_KEY: "AIza-not-a-real-key-0123456789" },
      { fetchImpl: exploding },
    );

    expect(availability.available).toBe(true);
    if (!availability.available) return;

    // No try/catch here on purpose: an unhandled rejection would fail this
    // test, which is the point. Callers cannot forget to handle failure,
    // because failure is a value.
    const result = await availability.provider.generate({
      task: "summary",
      instruction: "Summarise.",
      evidence: {},
      schema: {
        name: "anything",
        jsonSchema: { type: "object" },
        parse: (value) => ({ ok: true, value }),
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("provider_unavailable");
      expect(result.error.userMessage).toContain("measured results are unaffected");
    }
  });

  it("leaves the deterministic report untouched when it does", async () => {
    const before = deterministicReport();

    const availability = resolveAiProviderFromEnv(
      { AI_PROVIDER: "gemini", AI_API_KEY: "AIza-not-a-real-key-0123456789" },
      { fetchImpl: () => Promise.reject(new Error("down")) },
    );

    if (availability.available) {
      await availability.provider.generate({
        task: "summary",
        instruction: "Summarise.",
        evidence: toJsonValue(before.score),
        schema: {
          name: "anything",
          jsonSchema: { type: "object" },
          parse: (value) => ({ ok: true, value }),
        },
      });
    }

    expect(deterministicReport()).toEqual(before);
  });
});

describe("the environment", () => {
  it("carries the AI config without letting it break validation", () => {
    const env = parseServerEnv({ NODE_ENV: "test" });

    expect(env.ai.status).toBe("disabled");
    expect(env.aiWarnings).toEqual([]);
  });

  it("collects a non-fatal AI warning instead of throwing", () => {
    const env = parseServerEnv({
      NODE_ENV: "test",
      AI_PROVIDER: "gemini",
      AI_API_KEY: "AIza-not-a-real-key-0123456789",
      AI_TIMEOUT_MS: "0",
    });

    expect(env.ai.status).toBe("configured");
    expect(env.aiWarnings).toHaveLength(1);
  });

  it("still fails loudly for a non-AI variable", () => {
    // AI is the documented exception, not a new general policy.
    expect(() => parseServerEnv({ NODE_ENV: "banana" })).toThrow();
  });

  it("does not let AI configuration reach the browser", () => {
    // getServerEnv() throws in a browser context, and the AI config lives on
    // it rather than anywhere client code could read (ADR-018). The window
    // check runs before the memoised value is consulted, so a prior call in
    // this process cannot mask the guard.
    vi.stubGlobal("window", {});

    try {
      expect(() => getServerEnv()).toThrow(/browser/i);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
