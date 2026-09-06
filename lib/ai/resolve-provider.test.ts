import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { parseAiEnv } from "./config";
import { resolveAiProvider, resolveAiProviderFromEnv } from "./resolve-provider";
import type { FetchLike } from "./types";

const KEY = "AIza-not-a-real-key-0123456789";

const configured = {
  AI_PROVIDER: "gemini",
  AI_API_KEY: KEY,
} as const;

describe("when AI is configured", () => {
  it("builds a provider", () => {
    const availability = resolveAiProviderFromEnv(configured);

    expect(availability.available).toBe(true);
    if (!availability.available) return;

    expect(availability.provider.name).toBe("gemini");
    expect(availability.provider.model.length).toBeGreaterThan(0);
  });

  it("applies a configured model", () => {
    const availability = resolveAiProviderFromEnv({
      ...configured,
      AI_MODEL: "some-other-model",
    });

    if (availability.available) {
      expect(availability.provider.model).toBe("some-other-model");
    }
  });

  it("performs no I/O while resolving", () => {
    // A bad key is discovered on the first call, not at construction. Resolving
    // must never block startup on a network round trip.
    const fetchImpl = vi.fn() as unknown as FetchLike;

    resolveAiProviderFromEnv(configured, { fetchImpl });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("passes the injected fetch through to the adapter", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "{}" }] }, finishReason: "STOP" }],
          }),
        ),
    ) as unknown as FetchLike;

    const availability = resolveAiProviderFromEnv(configured, { fetchImpl });
    expect(availability.available).toBe(true);
    if (!availability.available) return;

    await availability.provider.generate({
      task: "t",
      instruction: "i",
      evidence: {},
      schema: {
        name: "anything",
        jsonSchema: { type: "object" },
        parse: (value) => ({ ok: true, value }),
      },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("describes itself without the key", () => {
    const availability = resolveAiProviderFromEnv(configured);

    if (availability.available) {
      expect(availability.description).not.toContain(KEY);
      expect(availability.description).toContain("provider=gemini");
    }
  });
});

describe("when AI is not configured", () => {
  const availability = resolveAiProviderFromEnv({});

  it("reports unavailable rather than throwing", () => {
    expect(availability.available).toBe(false);
  });

  it("carries the specific reason", () => {
    if (!availability.available) {
      expect(availability.reason).toContain("AI_PROVIDER and AI_API_KEY are not set");
    }
  });

  it("offers the same fact as an error, for uniform reporting", () => {
    if (!availability.available) {
      expect(availability.error.code).toBe("not_configured");
      expect(availability.error.retryable).toBe(false);
      expect(availability.error.userMessage).toContain("not configured");
    }
  });

  it("never throws for any broken configuration", () => {
    const broken = [
      {},
      { AI_PROVIDER: "nope", AI_API_KEY: KEY },
      { AI_PROVIDER: "gemini" },
      { AI_API_KEY: KEY },
    ];

    for (const source of broken) {
      expect(() => resolveAiProviderFromEnv(source)).not.toThrow();
      expect(resolveAiProviderFromEnv(source).available).toBe(false);
    }
  });

  it("accepts a config object as well as an environment source", () => {
    expect(resolveAiProvider(parseAiEnv({})).available).toBe(false);
    expect(resolveAiProvider(parseAiEnv(configured)).available).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The vendor boundary
// ---------------------------------------------------------------------------

describe("no provider-specific code escapes lib/ai/providers", () => {
  const root = process.cwd();
  const thisFile = path.join(root, "lib", "ai", "resolve-provider.test.ts");

  /** Every TypeScript file under lib/ and app/, except the adapters. */
  function sourceFiles(): string[] {
    const found: string[] = [];

    function walk(directory: string): void {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          // The adapters are where vendor knowledge is allowed to live.
          if (entry.name === "providers" || entry.name === "node_modules") continue;
          walk(full);
        } else if (/\.tsx?$/.test(entry.name) && full !== thisFile) {
          found.push(full);
        }
      }
    }

    walk(path.join(root, "lib"));
    walk(path.join(root, "app"));

    return found;
  }

  /**
   * Vendor API surface. Not the vendor's *name*: the registry in
   * `resolve-provider.ts` and the supported-name list in `config.ts` have to
   * say "gemini", and an operator has to type it into AI_PROVIDER. What must
   * not escape is knowledge of how the vendor's API is shaped (ADR-004).
   */
  const VENDOR_API_TOKENS = [
    "generativelanguage",
    "x-goog",
    "generateContent",
    "inlineData",
    "promptFeedback",
    "usageMetadata",
    "candidatesTokenCount",
    "systemInstruction",
  ];

  it("finds files to check", () => {
    // Guards the glob: an empty list would make every assertion below vacuous.
    expect(sourceFiles().length).toBeGreaterThan(20);
  });

  it.each(VENDOR_API_TOKENS)("does not mention %s anywhere else", (token) => {
    const offenders = sourceFiles().filter((file) =>
      readFileSync(file, "utf8").includes(token),
    );

    expect(offenders.map((file) => path.relative(root, file))).toEqual([]);
  });

  it("is imported from by exactly one module", () => {
    const importers = sourceFiles().filter((file) =>
      /from\s+["'][^"']*providers\//.test(readFileSync(file, "utf8")),
    );

    // Swapping vendors is a change to this one file plus a new sibling adapter.
    expect(importers.map((file) => path.relative(root, file))).toEqual([
      path.join("lib", "ai", "resolve-provider.ts"),
    ]);
  });

  it("keeps the abstraction free of vendor imports", () => {
    for (const file of ["types.ts", "errors.ts", "json.ts", "config.ts"]) {
      const source = readFileSync(path.join(root, "lib", "ai", file), "utf8");

      expect(source, `${file} imports a provider`).not.toMatch(/from\s+["'].*providers/);
    }
  });
});
