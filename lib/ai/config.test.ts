import { describe, expect, it } from "vitest";

import {
  AI_PROVIDER_NAMES,
  DEFAULT_AI_TIMEOUT_MS,
  describeAiConfig,
  MAX_AI_TIMEOUT_MS,
  MIN_AI_TIMEOUT_MS,
  parseAiEnv,
} from "./config";

const KEY = "AIza-not-a-real-key-0123456789";

describe("when nothing is configured", () => {
  it("disables AI without complaining", () => {
    const config = parseAiEnv({});

    expect(config.status).toBe("disabled");
    if (config.status === "disabled") {
      expect(config.reason).toContain("AI_PROVIDER and AI_API_KEY are not set");
    }
  });

  it("treats empty strings and whitespace as unset", () => {
    expect(parseAiEnv({ AI_PROVIDER: "", AI_API_KEY: "   " }).status).toBe("disabled");
  });
});

describe("when the configuration is incomplete or wrong", () => {
  it("never throws, whatever it is given", () => {
    // The whole point: a broken AI variable must not be able to stop the
    // application from producing the deterministic report (ADR-016).
    const nonsense = [
      { AI_PROVIDER: "not-a-provider", AI_API_KEY: KEY },
      { AI_PROVIDER: "gemini" },
      { AI_API_KEY: KEY },
      { AI_PROVIDER: "gemini", AI_API_KEY: KEY, AI_TIMEOUT_MS: "banana" },
      { AI_PROVIDER: "GEMINI", AI_API_KEY: KEY },
    ];

    for (const source of nonsense) {
      expect(() => parseAiEnv(source)).not.toThrow();
    }
  });

  it("says specifically what is missing rather than just 'unavailable'", () => {
    const noKey = parseAiEnv({ AI_PROVIDER: "gemini" });

    expect(noKey.status).toBe("disabled");
    if (noKey.status === "disabled") {
      expect(noKey.reason).toContain("AI_API_KEY is not set");
      expect(noKey.reason).toContain("gemini");
    }
  });

  it("tells an operator which providers exist when the name is wrong", () => {
    const wrong = parseAiEnv({ AI_PROVIDER: "openai", AI_API_KEY: KEY });

    expect(wrong.status).toBe("disabled");
    if (wrong.status === "disabled") {
      expect(wrong.reason).toContain("openai");
      expect(wrong.reason).toContain("gemini");
    }
  });

  it("does not accept a provider name in the wrong case", () => {
    // Guessing at a near-match would make the supported set ambiguous.
    expect(parseAiEnv({ AI_PROVIDER: "Gemini", AI_API_KEY: KEY }).status).toBe(
      "disabled",
    );
  });

  it("explains a key with no provider", () => {
    const config = parseAiEnv({ AI_API_KEY: KEY });

    expect(config.status).toBe("disabled");
    if (config.status === "disabled") {
      expect(config.reason).toContain("AI_PROVIDER is not");
    }
  });
});

describe("when the configuration is complete", () => {
  it("reads the provider, key and model", () => {
    const config = parseAiEnv({
      AI_PROVIDER: "gemini",
      AI_API_KEY: KEY,
      AI_MODEL: "gemini-2.5-flash",
    });

    expect(config.status).toBe("configured");
    if (config.status !== "configured") return;

    expect(config.provider).toBe("gemini");
    expect(config.apiKey).toBe(KEY);
    expect(config.model).toBe("gemini-2.5-flash");
  });

  it("leaves the model null so the adapter's default applies", () => {
    const config = parseAiEnv({ AI_PROVIDER: "gemini", AI_API_KEY: KEY });

    if (config.status === "configured") expect(config.model).toBeNull();
  });

  it("makes a configured provider without a key unrepresentable", () => {
    // The type carries the key, so there is no state where AI is on and the
    // key is missing.
    const config = parseAiEnv({ AI_PROVIDER: "gemini", AI_API_KEY: KEY });

    if (config.status === "configured") expect(config.apiKey.length).toBeGreaterThan(0);
  });
});

describe("the timeout", () => {
  it("defaults when unset", () => {
    const config = parseAiEnv({ AI_PROVIDER: "gemini", AI_API_KEY: KEY });

    if (config.status === "configured") {
      expect(config.timeoutMs).toBe(DEFAULT_AI_TIMEOUT_MS);
    }
  });

  it("reads a value inside the allowed range", () => {
    const config = parseAiEnv({
      AI_PROVIDER: "gemini",
      AI_API_KEY: KEY,
      AI_TIMEOUT_MS: "5000",
    });

    if (config.status === "configured") expect(config.timeoutMs).toBe(5000);
  });

  it.each(["banana", "12.5", "", "-1", String(MAX_AI_TIMEOUT_MS + 1), "10"])(
    "falls back to the default for %s, and warns",
    (raw) => {
      const warnings: string[] = [];
      const config = parseAiEnv(
        { AI_PROVIDER: "gemini", AI_API_KEY: KEY, AI_TIMEOUT_MS: raw },
        warnings,
      );

      expect(config.status).toBe("configured");
      if (config.status === "configured") {
        expect(config.timeoutMs).toBe(DEFAULT_AI_TIMEOUT_MS);
      }

      // An empty value is "unset", which is not worth warning about.
      if (raw !== "") expect(warnings.length).toBe(1);
    },
  );

  it("accepts the exact boundaries", () => {
    for (const value of [MIN_AI_TIMEOUT_MS, MAX_AI_TIMEOUT_MS]) {
      const config = parseAiEnv({
        AI_PROVIDER: "gemini",
        AI_API_KEY: KEY,
        AI_TIMEOUT_MS: String(value),
      });

      if (config.status === "configured") expect(config.timeoutMs).toBe(value);
    }
  });

  it("does not warn when nothing is wrong", () => {
    const warnings: string[] = [];
    parseAiEnv({ AI_PROVIDER: "gemini", AI_API_KEY: KEY }, warnings);

    expect(warnings).toEqual([]);
  });
});

describe("describeAiConfig", () => {
  it("never includes the key, or any part of it", () => {
    // This string is designed to be pasted into a support thread.
    const description = describeAiConfig(
      parseAiEnv({ AI_PROVIDER: "gemini", AI_API_KEY: KEY, AI_MODEL: "m" }),
    );

    expect(description).not.toContain(KEY);
    expect(description).not.toContain(KEY.slice(0, 8));
    expect(description).toContain("provider=gemini");
    expect(description).toContain("model=m");
  });

  it("says why AI is off when it is", () => {
    expect(describeAiConfig(parseAiEnv({}))).toContain("AI disabled:");
  });

  it("names the adapter default when no model was chosen", () => {
    expect(
      describeAiConfig(parseAiEnv({ AI_PROVIDER: "gemini", AI_API_KEY: KEY })),
    ).toContain("adapter default");
  });
});

describe("the supported provider list", () => {
  it("names at least one provider", () => {
    expect(AI_PROVIDER_NAMES.length).toBeGreaterThan(0);
  });

  it("accepts every name it advertises", () => {
    for (const name of AI_PROVIDER_NAMES) {
      expect(parseAiEnv({ AI_PROVIDER: name, AI_API_KEY: KEY }).status).toBe(
        "configured",
      );
    }
  });
});
