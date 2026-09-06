/**
 * The AI path, and every road that leads back to the written one.
 *
 * Phase 15's brief asks for tests around structured AI output and fallback
 * behaviour, so each failure mode is exercised separately rather than through
 * one "it falls back" case.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { AiError } from "@/lib/ai/errors";
import type { AiAvailability } from "@/lib/ai";
import type { AiProvider, AiRequest, AiResult } from "@/lib/ai/types";
import { analyzeContent, extractContent } from "@/lib/analysis/content";
import { analyzeUx, collectUxSignals } from "@/lib/analysis/ux";
import { buildRecommendations } from "@/lib/recommendations";
import { scoreAnalysis } from "@/lib/scoring";
import type { Finding } from "@/lib/types/finding";

import { generateRoast } from "./generate-roast";
import { NOTHING_TO_ROAST } from "./fallback";
import { selectRoastTargets } from "./select";
import { SPECIFIC_PUNCHLINES } from "./templates";

const HTML = `<!doctype html><html lang="en"><head><title>Home</title></head><body>
<nav><a href="/a">A</a><a href="/b">B</a></nav>
<main><h1>Welcome</h1><p>Short.</p><h4>Skipped</h4>
<a href="/x">Get started</a><a href="/y">Get started</a></main></body></html>`;
const URL = "https://example.com/";

const findings: Finding[] = [
  ...analyzeUx({ signals: collectUxSignals(HTML, URL) }),
  ...analyzeContent({ inventory: extractContent(HTML, URL) }),
];
const recommendations = buildRecommendations({
  findings,
  score: scoreAnalysis({ findings }),
});

const request = { url: URL, findings, recommendations };
const targets = selectRoastTargets(findings, recommendations);

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

/** A provider that answers with `draft`. */
function answering(draft: unknown, spy = vi.fn()): AiAvailability {
  const provider: AiProvider = {
    name: "stub",
    model: "stub-model",
    generate: (<T>(aiRequest: AiRequest<T>): Promise<AiResult<T>> => {
      spy(aiRequest);
      const parsed = aiRequest.schema.parse(draft);

      return Promise.resolve(
        parsed.ok
          ? { ok: true, data: parsed.value, meta: meta(aiRequest.task) }
          : {
              ok: false,
              error: new AiError({
                code: "malformed_output",
                provider: "stub",
                message: "bad shape",
                issues: parsed.issues,
              }),
              meta: meta(aiRequest.task),
            },
      );
    }) as AiProvider["generate"],
  };

  return { available: true, provider, description: "provider=stub" };
}

function failing(error: AiError): AiAvailability {
  return {
    available: true,
    description: "provider=stub",
    provider: {
      name: "stub",
      model: "stub-model",
      generate: () => Promise.resolve({ ok: false, error, meta: meta("roast") }),
    },
  };
}

const unavailable: AiAvailability = {
  available: false,
  reason: "AI_PROVIDER and AI_API_KEY are not set.",
  error: new AiError({
    code: "not_configured",
    provider: "none",
    message: "AI_PROVIDER and AI_API_KEY are not set.",
  }),
};

/** A well-formed model answer covering every selected finding. */
function goodDraft() {
  const jokes = [
    "A confident silence where the introduction should be.",
    "Every link received an invitation and nobody checked the capacity.",
    "The page makes its case and then simply stops, mid-thought.",
    "One component, repeated with real conviction.",
  ];

  return {
    lines: targets.map((finding, index) => ({
      findingId: finding.id,
      punchline: jokes[index % jokes.length]!,
    })),
  };
}

// ---------------------------------------------------------------------------

describe("the AI path", () => {
  it("uses the model's punchlines", async () => {
    const roast = await generateRoast(answering(goodDraft()), request);

    expect(roast.source).toBe("ai");
    expect(roast.fallbackReason).toBeNull();
    expect(roast.lines[0]?.punchline).toBe(
      "A confident silence where the introduction should be.",
    );
  });

  it("writes the observation itself, never taking it from the model", async () => {
    const roast = await generateRoast(answering(goodDraft()), request);

    for (const line of roast.lines) {
      // The fact half of every line comes from the finding's own evidence.
      expect(line.observation.length).toBeGreaterThan(0);
      expect(line.observation).toMatch(/[.!?]$/);
      expect(line.finding.evidence.length).toBeGreaterThan(0);
    }
  });

  it("attaches the real finding to every line", async () => {
    const roast = await generateRoast(answering(goodDraft()), request);
    const ids = new Set(findings.map((finding) => finding.id));

    for (const line of roast.lines) {
      expect(ids.has(line.finding.id)).toBe(true);
      expect(["fail", "warn"]).toContain(line.finding.status);
    }
  });

  it("carries the call metadata", async () => {
    const roast = await generateRoast(answering(goodDraft()), request);

    expect(roast.meta?.task).toBe("roast");
  });

  it("sends only the findings it is roasting", async () => {
    const spy = vi.fn();
    await generateRoast(answering(goodDraft(), spy), request);

    const sent = spy.mock.calls[0]![0] as AiRequest<unknown>;
    const evidence = sent.evidence as { findings: { id: string }[] };

    expect(evidence.findings).toHaveLength(targets.length);
    expect(sent.task).toBe("roast");
  });

  it("sends the observation, so the model need not state a fact", async () => {
    const spy = vi.fn();
    await generateRoast(answering(goodDraft(), spy), request);

    const sent = spy.mock.calls[0]![0] as AiRequest<unknown>;
    const evidence = sent.evidence as { findings: { observation: string }[] };

    expect(evidence.findings[0]?.observation.length).toBeGreaterThan(0);
  });

  it("sends the rules", async () => {
    const spy = vi.fn();
    await generateRoast(answering(goodDraft(), spy), request);

    const sent = spy.mock.calls[0]![0] as AiRequest<unknown>;

    expect(sent.instruction).toContain("Do not invent problems");
    expect(sent.instruction).toContain("Roast the website, never the person");
  });

  it("allows a little variation, unlike the rest of the codebase", async () => {
    const spy = vi.fn();
    await generateRoast(answering(goodDraft(), spy), request);

    const sent = spy.mock.calls[0]![0] as AiRequest<unknown>;

    // A roast written at temperature zero reads like a form letter.
    expect(sent.temperature).toBeGreaterThan(0);
    expect(sent.temperature).toBeLessThan(1);
  });

  it("keeps a shorter answer rather than discarding it", async () => {
    const roast = await generateRoast(
      answering({ lines: [goodDraft().lines[0]!] }),
      request,
    );

    expect(roast.source).toBe("ai");
    expect(roast.lines).toHaveLength(1);
  });
});

describe("fallback: when AI is unavailable", () => {
  it("writes a roast anyway", async () => {
    const roast = await generateRoast(unavailable, request);

    expect(roast.source).toBe("deterministic");
    expect(roast.lines.length).toBeGreaterThan(0);
  });

  it("says why, specifically", async () => {
    const roast = await generateRoast(unavailable, request);

    expect(roast.fallbackReason).toContain("AI_API_KEY");
  });

  it("uses the written punchline for the finding", async () => {
    const roast = await generateRoast(unavailable, request);
    const line = roast.lines.find(
      (candidate) => SPECIFIC_PUNCHLINES[candidate.finding.id] !== undefined,
    );

    expect(line).toBeDefined();
    expect(line?.punchline).toBe(SPECIFIC_PUNCHLINES[line!.finding.id]);
  });

  it("produces the same roast every time", async () => {
    const first = await generateRoast(unavailable, request);
    const second = await generateRoast(unavailable, request);

    expect(first).toEqual(second);
  });

  it("roasts the same findings the AI path would have", async () => {
    const withAi = await generateRoast(answering(goodDraft()), request);
    const without = await generateRoast(unavailable, request);

    expect(without.lines.map((line) => line.finding.id)).toEqual(
      withAi.lines.map((line) => line.finding.id),
    );
  });

  it("never calls a provider", async () => {
    const spy = vi.fn();
    await generateRoast(unavailable, request);

    expect(spy).not.toHaveBeenCalled();
  });
});

describe("fallback: when the AI fails", () => {
  it.each([
    "timeout",
    "rate_limited",
    "provider_unavailable",
    "authentication_failed",
    "content_filtered",
    "response_truncated",
    "malformed_output",
  ] as const)("falls back on %s", async (code) => {
    const roast = await generateRoast(
      failing(new AiError({ code, provider: "stub", message: `stub ${code}` })),
      request,
    );

    expect(roast.source).toBe("deterministic");
    expect(roast.lines.length).toBeGreaterThan(0);
    expect(roast.fallbackReason).toContain(code);
  });

  it("falls back when a provider throws instead of returning a failure", async () => {
    const exploding: AiAvailability = {
      available: true,
      description: "provider=stub",
      provider: {
        name: "stub",
        model: "stub-model",
        generate: () => Promise.reject(new Error("catastrophe")),
      },
    };

    const roast = await generateRoast(exploding, request);

    expect(roast.source).toBe("deterministic");
    expect(roast.fallbackReason).toContain("catastrophe");
  });

  it("falls back when the model returns no lines", async () => {
    const roast = await generateRoast(answering({ lines: [] }), request);

    expect(roast.source).toBe("deterministic");
    expect(roast.fallbackReason).toContain("no roast lines");
  });
});

describe("fallback: when the answer breaks a rule", () => {
  it.each([
    [
      "an invented finding",
      { lines: [{ findingId: "seo.entirely.invented", punchline: "A joke." }] },
    ],
    [
      "abuse",
      {
        lines: [
          {
            findingId: targets[0]?.id ?? "x",
            punchline: "You are clearly not a designer.",
          },
        ],
      },
    ],
    [
      "an invented measurement",
      {
        lines: [
          { findingId: targets[0]?.id ?? "x", punchline: "It loads in a brisk 9.4s." },
        ],
      },
    ],
    [
      "a security claim",
      {
        lines: [
          { findingId: targets[0]?.id ?? "x", punchline: "At least the site is secure." },
        ],
      },
    ],
  ])("discards %s and writes the roast itself", async (_name, draft) => {
    const roast = await generateRoast(answering(draft), request);

    expect(roast.source).toBe("deterministic");
    expect(roast.fallbackReason).toContain("discarded");
  });

  it("discards the good lines along with the bad", async () => {
    const draft = {
      lines: [
        {
          findingId: targets[0]!.id,
          punchline: "A genuinely fine joke about a real thing.",
        },
        { findingId: "made.up.entirely", punchline: "An invented one." },
      ],
    };

    const roast = await generateRoast(answering(draft), request);

    expect(roast.source).toBe("deterministic");
  });

  it("falls back on structurally invalid output", async () => {
    for (const bad of [{ lines: "not an array" }, "a sentence", 42, { nope: true }]) {
      const roast = await generateRoast(answering(bad), request);

      expect(roast.source).toBe("deterministic");
    }
  });
});

describe("nothing to roast", () => {
  const clean: Finding[] = [
    {
      id: "seo.title.ok",
      category: "seo",
      severity: "info",
      status: "pass",
      evidence: [{ kind: "measured", source: "dom", summary: "A title is present." }],
      explanation: "Fine.",
    },
    {
      id: "security.csp.unknown",
      category: "security",
      severity: "moderate",
      status: "could_not_determine",
      evidence: [{ kind: "measured", source: "http", summary: "No CSP header seen." }],
      explanation: "Undetermined.",
    },
  ];

  it("returns no lines rather than manufacturing a complaint", async () => {
    // Inventing a problem to have something to say is the one thing ADR-015
    // rules out.
    const roast = await generateRoast(answering(goodDraft()), {
      url: URL,
      findings: clean,
    });

    expect(roast.lines).toEqual([]);
    expect(roast.note).toBe(NOTHING_TO_ROAST);
  });

  it("does not call the model at all", async () => {
    const spy = vi.fn();
    await generateRoast(answering(goodDraft(), spy), { url: URL, findings: clean });

    // Asking a model for a roast of a clean page is inviting it to find
    // something.
    expect(spy).not.toHaveBeenCalled();
  });

  it("says so without calling it a compliment or a joke", async () => {
    const roast = await generateRoast(unavailable, { url: URL, findings: clean });

    expect(roast.note).toContain("not a joke and not a compliment");
    expect(roast.fallbackReason).toBeNull();
  });

  it("never roasts a passing or undetermined check", async () => {
    const mixed = [...clean, ...findings];
    const roast = await generateRoast(unavailable, { url: URL, findings: mixed });

    for (const line of roast.lines) {
      expect(["fail", "warn"]).toContain(line.finding.status);
    }
  });
});

describe("the roast is not the source of the score", () => {
  it("is imported by nothing in lib/scoring", () => {
    // Easy to agree with, easy to break later with one convenient import.
    const offenders: string[] = [];
    const root = path.join(process.cwd(), "lib", "scoring");

    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;

      const source = readFileSync(path.join(root, entry.name), "utf8");
      if (/from\s+["'][^"']*\/roast/.test(source)) offenders.push(entry.name);
    }

    expect(offenders).toEqual([]);
  });

  it("does not change the score it was built from", async () => {
    const before = scoreAnalysis({ findings });

    await generateRoast(answering(goodDraft()), request);

    expect(scoreAnalysis({ findings })).toEqual(before);
  });

  it("does not mutate the findings", async () => {
    const before = JSON.stringify(findings);

    await generateRoast(answering(goodDraft()), request);
    await generateRoast(unavailable, request);

    expect(JSON.stringify(findings)).toBe(before);
  });
});

describe("bounds", () => {
  it("writes at most the requested number of lines", async () => {
    const roast = await generateRoast(unavailable, { ...request, lineCount: 2 });

    expect(roast.lines).toHaveLength(2);
  });

  it("stays concise by default", async () => {
    const roast = await generateRoast(unavailable, request);

    expect(roast.lines.length).toBeLessThanOrEqual(4);
  });

  it("handles a request for no lines", async () => {
    const roast = await generateRoast(unavailable, { ...request, lineCount: 0 });

    expect(roast.lines).toEqual([]);
  });
});
