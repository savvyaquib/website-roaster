/**
 * Orchestration tests.
 *
 * The provider is a stub throughout: what is under test is what this layer does
 * with an answer, not how an answer is fetched.
 */

import { describe, expect, it, vi } from "vitest";

import { AiError } from "@/lib/ai/errors";
import type { AiAvailability } from "@/lib/ai/resolve-provider";
import type { AiProvider, AiRequest, AiResult } from "@/lib/ai/types";
import { analyzeContent, extractContent } from "@/lib/analysis/content";
import { analyzeUx, collectUxSignals } from "@/lib/analysis/ux";
import { buildRecommendations } from "@/lib/recommendations";
import { scoreAnalysis } from "@/lib/scoring";
import type { Finding } from "@/lib/types/finding";

import { interpretAnalysis } from "./interpret";
import type { InterpretationDraft } from "./types";

const HTML = `<!doctype html><html lang="en"><head><title>Ship faster</title></head><body>
<nav><a href="/a">A</a></nav><main><h1>Ship faster</h1><p>We help teams ship.</p>
<h4>Skipped</h4><a href="/signup">Get started</a></main></body></html>`;

const URL = "https://example.com/";

const findings: Finding[] = [
  ...analyzeUx({ signals: collectUxSignals(HTML, URL) }),
  ...analyzeContent({ inventory: extractContent(HTML, URL) }),
];
const score = scoreAnalysis({ findings });
const recommendations = buildRecommendations({ findings, score });

const request = { url: URL, findings, score, recommendations };

/** The first real problem and the first real pass, for valid draft answers. */
const firstProblem = findings.find(
  (finding) => finding.status === "fail" || finding.status === "warn",
)!;
const firstPass = findings.find((finding) => finding.status === "pass")!;

function goodDraft(overrides: Partial<InterpretationDraft> = {}): InterpretationDraft {
  return {
    executiveSummary:
      "The page states what it does but leaves several structural details unfinished.",
    strengths: [{ findingId: firstPass.id, whyItHelps: "It keeps the basics in order." }],
    problems: [
      {
        findingId: firstProblem.id,
        whyItMatters: "Visitors lose the thread of what the page is offering.",
        recommendation: "Give the section a heading that says what it contains.",
      },
    ],
    ...overrides,
  };
}

/** A provider that always answers with `draft`. */
function providerReturning(draft: unknown, task = vi.fn()): AiAvailability {
  const provider: AiProvider = {
    name: "stub",
    model: "stub-model",
    generate: (<T>(aiRequest: AiRequest<T>): Promise<AiResult<T>> => {
      task(aiRequest);
      const parsed = aiRequest.schema.parse(draft);

      if (!parsed.ok) {
        return Promise.resolve({
          ok: false,
          error: new AiError({
            code: "malformed_output",
            provider: "stub",
            message: "bad shape",
            issues: parsed.issues,
          }),
          meta: meta(aiRequest.task),
        });
      }

      return Promise.resolve({
        ok: true,
        data: parsed.value,
        meta: meta(aiRequest.task),
      });
    }) as AiProvider["generate"],
  };

  return { available: true, provider, description: "provider=stub model=stub-model" };
}

function meta(task: string) {
  return {
    provider: "stub",
    model: "stub-model",
    task,
    latencyMs: 5,
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    finishReason: "STOP",
  };
}

/** A provider that always fails with `error`. */
function providerFailing(error: AiError): AiAvailability {
  const provider: AiProvider = {
    name: "stub",
    model: "stub-model",
    generate: () => Promise.resolve({ ok: false, error, meta: meta("interpretation") }),
  };

  return { available: true, provider, description: "provider=stub" };
}

// ---------------------------------------------------------------------------

describe("a good answer", () => {
  it("is returned, joined to the findings that prove it", async () => {
    const result = await interpretAnalysis(providerReturning(goodDraft()), request);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.interpretation.problems[0]?.finding).toBe(firstProblem);
    expect(result.interpretation.strengths[0]?.finding).toBe(firstPass);
  });

  it("keeps the model's words and the analyzer's facts apart", () => {
    // The model contributes prose; severity, category and evidence are read
    // from the finding and were never in the answer (ADR-029, ADR-055).
    return interpretAnalysis(providerReturning(goodDraft()), request).then((result) => {
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const problem = result.interpretation.problems[0]!;

      expect(Object.keys(problem).sort()).toEqual([
        "deterministicRank",
        "finding",
        "recommendation",
        "whyItMatters",
      ]);
      expect(problem.finding.severity).toBe(firstProblem.severity);
    });
  });

  it("carries the deterministic rank alongside the model's ordering", async () => {
    const result = await interpretAnalysis(providerReturning(goodDraft()), request);

    if (result.ok) {
      expect(result.interpretation.problems[0]?.deterministicRank).toBeGreaterThan(0);
    }
  });

  it("reports null rank when no ranking was supplied", async () => {
    const result = await interpretAnalysis(providerReturning(goodDraft()), {
      url: URL,
      findings,
      score,
    });

    if (result.ok) {
      expect(result.interpretation.problems[0]?.deterministicRank).toBeNull();
    }
  });

  it("carries the call's metadata", async () => {
    const result = await interpretAnalysis(providerReturning(goodDraft()), request);

    if (result.ok) {
      expect(result.interpretation.meta.task).toBe("interpretation");
      expect(result.interpretation.meta.usage.totalTokens).toBe(30);
    }
  });
});

describe("what it sends", () => {
  it("sends the prohibitions and the assembled evidence", async () => {
    const spy = vi.fn();
    await interpretAnalysis(providerReturning(goodDraft(), spy), request);

    const sent = spy.mock.calls[0]![0] as AiRequest<unknown>;

    expect(sent.task).toBe("interpretation");
    expect(sent.instruction).toContain("Do not invent metrics");
    expect(JSON.stringify(sent.evidence)).toContain(firstProblem.id);
  });

  it("asks for a reproducible answer", async () => {
    const spy = vi.fn();
    await interpretAnalysis(providerReturning(goodDraft(), spy), request);

    const sent = spy.mock.calls[0]![0] as AiRequest<unknown>;
    expect(sent.temperature).toBe(0);
    expect(sent.maxOutputTokens).toBeGreaterThan(0);
  });

  it("passes screenshots through when supplied", async () => {
    const spy = vi.fn();
    await interpretAnalysis(providerReturning(goodDraft(), spy), {
      ...request,
      screenshots: [
        { mimeType: "image/png", dataBase64: "AAAA", label: "desktop viewport" },
      ],
    });

    const sent = spy.mock.calls[0]![0] as AiRequest<unknown>;
    expect(sent.images).toHaveLength(1);
    expect(sent.images?.[0]?.label).toBe("desktop viewport");
  });

  it("sends no images when there are none, rather than an empty list", async () => {
    const spy = vi.fn();
    await interpretAnalysis(providerReturning(goodDraft(), spy), request);

    expect((spy.mock.calls[0]![0] as AiRequest<unknown>).images).toBeUndefined();
  });
});

describe("an answer that breaks a rule is discarded whole", () => {
  it("refuses an invented finding", async () => {
    const result = await interpretAnalysis(
      providerReturning(
        goodDraft({
          problems: [
            {
              findingId: "seo.entirely.invented",
              whyItMatters: "It sounds serious.",
              recommendation: "Fix it.",
            },
          ],
        }),
      ),
      request,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.violations[0]?.kind).toBe("unknown_finding");
    expect(result.error.code).toBe("malformed_output");
  });

  it("refuses a security assurance", async () => {
    const result = await interpretAnalysis(
      providerReturning(
        goodDraft({
          executiveSummary: "This site is secure and the remaining issues are cosmetic.",
        }),
      ),
      request,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations[0]?.kind).toBe("unsupported_security_claim");
    }
  });

  it("refuses a ranking promise", async () => {
    const result = await interpretAnalysis(
      providerReturning(
        goodDraft({
          executiveSummary:
            "Fix the headings and you will rank for your main terms soon.",
        }),
      ),
      request,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violations[0]?.kind).toBe("unsupported_seo_claim");
  });

  it("refuses an invented measurement", async () => {
    const result = await interpretAnalysis(
      providerReturning(
        goodDraft({
          executiveSummary: "The page needs 8.4s to render, which loses most visitors.",
        }),
      ),
      request,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violations[0]?.kind).toBe("invented_measurement");
  });

  it("discards the good parts along with the bad", async () => {
    // Not repaired, not partially used: a model caught inventing one thing is
    // not a reliable source for the rest (ADR-055).
    const result = await interpretAnalysis(
      providerReturning(
        goodDraft({
          problems: [
            {
              findingId: firstProblem.id,
              whyItMatters: "A perfectly good explanation of a real problem.",
              recommendation: "A perfectly good recommendation.",
            },
            {
              findingId: "totally.made.up",
              whyItMatters: "Invented.",
              recommendation: "Invented.",
            },
          ],
        }),
      ),
      request,
    );

    expect(result.ok).toBe(false);
  });

  it("says what was wrong, precisely enough to debug", async () => {
    const result = await interpretAnalysis(
      providerReturning(
        goodDraft({
          problems: [
            { findingId: "made.up", whyItMatters: "Bad.", recommendation: "Fix." },
          ],
        }),
      ),
      request,
    );

    if (!result.ok) {
      expect(result.error.message).toContain("unknown_finding");
      expect(result.error.issues[0]).toContain("problems[0].findingId");
    }
  });
});

describe("when the AI fails, the analysis still stands", () => {
  it("returns not_configured when there is no provider", async () => {
    const unavailable: AiAvailability = {
      available: false,
      reason: "AI_API_KEY is not set.",
      error: new AiError({
        code: "not_configured",
        provider: "none",
        message: "AI_API_KEY is not set.",
      }),
    };

    const result = await interpretAnalysis(unavailable, request);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_configured");
      expect(result.violations).toEqual([]);
    }
  });

  it.each([
    "timeout",
    "rate_limited",
    "provider_unavailable",
    "authentication_failed",
    "content_filtered",
    "response_truncated",
  ] as const)("passes a %s failure through without throwing", async (code) => {
    const result = await interpretAnalysis(
      providerFailing(new AiError({ code, provider: "stub", message: "failed" })),
      request,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(code);
      expect(result.error.userMessage).toContain("measured results");
    }
  });

  it("never rejects, whatever the provider does", async () => {
    const exploding: AiAvailability = {
      available: true,
      description: "provider=stub",
      provider: {
        name: "stub",
        model: "stub-model",
        generate: () => Promise.reject(new Error("catastrophe")),
      },
    };

    // A provider is contractually required to return failures rather than
    // throw. This is the one path that would break ADR-016's guarantee if one
    // misbehaved, so it is caught rather than trusted.
    const result = await interpretAnalysis(exploding, request);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("unknown");
      expect(result.error.message).toContain("catastrophe");
      expect(result.error.userMessage).toContain("measured results");
    }
  });

  it("leaves the deterministic report untouched when it fails", async () => {
    const before = JSON.stringify({ findings, score, recommendations });

    await interpretAnalysis(
      providerFailing(
        new AiError({ code: "timeout", provider: "stub", message: "too slow" }),
      ),
      request,
    );

    expect(JSON.stringify({ findings, score, recommendations })).toBe(before);
  });

  it("does not mutate the findings it was given on the happy path", async () => {
    const before = JSON.stringify(findings);

    await interpretAnalysis(providerReturning(goodDraft()), request);

    expect(JSON.stringify(findings)).toBe(before);
  });
});

describe("a malformed answer", () => {
  it("is reported as malformed rather than crashing", async () => {
    const result = await interpretAnalysis(
      providerReturning({ nonsense: true }),
      request,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("malformed_output");
  });

  it("is reported for an answer of the wrong type entirely", async () => {
    const result = await interpretAnalysis(providerReturning("a sentence"), request);

    expect(result.ok).toBe(false);
  });
});
