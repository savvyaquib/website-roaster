import { describe, expect, it } from "vitest";

import path from "node:path";

import { parseAiEnv } from "@/lib/ai/config";

import { EnvValidationError, parseServerEnv } from "./env";

/**
 * The AI fields when nothing AI-related is set.
 *
 * Taken from parseAiEnv rather than restated, so these assertions stay total
 * without duplicating another module’s wording.
 */
const NO_AI = { ai: parseAiEnv({}), aiWarnings: [] };

/**
 * The default job-store directory.
 *
 * Derived the same way env.ts derives it, so this stays an assertion about the
 * default rather than a copy of a path that would differ per machine.
 */
const DEFAULT_STORE = {
  analysisDbPath: path.join(process.cwd(), ".data", "analyses.db"),
  analysisRetentionDays: 30,
};

describe("parseServerEnv", () => {
  it("applies documented defaults when nothing is set", () => {
    expect(parseServerEnv({})).toEqual({
      nodeEnv: "development",
      logLevel: "info",
      ...NO_AI,
      ...DEFAULT_STORE,
    });
  });

  it("reads valid values", () => {
    expect(parseServerEnv({ NODE_ENV: "production", LOG_LEVEL: "warn" })).toEqual({
      nodeEnv: "production",
      logLevel: "warn",
      ...NO_AI,
      ...DEFAULT_STORE,
    });
  });

  it("defaults to silent logging under test so suites stay readable", () => {
    expect(parseServerEnv({ NODE_ENV: "test" }).logLevel).toBe("silent");
  });

  it("lets an explicit LOG_LEVEL override the test default", () => {
    expect(parseServerEnv({ NODE_ENV: "test", LOG_LEVEL: "debug" }).logLevel).toBe(
      "debug",
    );
  });

  it("treats an empty string as unset", () => {
    expect(parseServerEnv({ NODE_ENV: "", LOG_LEVEL: "" })).toEqual({
      nodeEnv: "development",
      logLevel: "info",
      ...NO_AI,
      ...DEFAULT_STORE,
    });
  });

  it("rejects an unknown NODE_ENV rather than guessing", () => {
    expect(() => parseServerEnv({ NODE_ENV: "staging" })).toThrow(EnvValidationError);
  });

  it("rejects an unknown LOG_LEVEL", () => {
    expect(() => parseServerEnv({ LOG_LEVEL: "verbose" })).toThrow(EnvValidationError);
  });

  it("reports every problem at once instead of failing one at a time", () => {
    try {
      parseServerEnv({ NODE_ENV: "staging", LOG_LEVEL: "verbose" });
      expect.unreachable("expected parseServerEnv to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).issues).toHaveLength(2);
      expect((error as EnvValidationError).message).toContain("NODE_ENV");
      expect((error as EnvValidationError).message).toContain("LOG_LEVEL");
    }
  });

  it("names the offending value in the error so the fix is obvious", () => {
    try {
      parseServerEnv({ NODE_ENV: "staging" });
      expect.unreachable("expected parseServerEnv to throw");
    } catch (error) {
      expect((error as EnvValidationError).issues[0]).toContain("staging");
    }
  });

  it("returns a frozen object so configuration cannot drift at runtime", () => {
    const env = parseServerEnv({});
    expect(Object.isFrozen(env)).toBe(true);
  });
});

describe("the analysis database", () => {
  it("defaults under the working directory", () => {
    expect(parseServerEnv({}).analysisDbPath).toBe(
      path.join(process.cwd(), ".data", "analyses.db"),
    );
  });

  it("reads ANALYSIS_DB_PATH when set", () => {
    expect(parseServerEnv({ ANALYSIS_DB_PATH: "/var/roaster.db" }).analysisDbPath).toBe(
      "/var/roaster.db",
    );
  });

  it("treats an empty value as unset", () => {
    expect(parseServerEnv({ ANALYSIS_DB_PATH: "   " }).analysisDbPath).toBe(
      path.join(process.cwd(), ".data", "analyses.db"),
    );
  });
});

describe("the retention window", () => {
  it("defaults to thirty days", () => {
    expect(parseServerEnv({}).analysisRetentionDays).toBe(30);
  });

  it("reads ANALYSIS_RETENTION_DAYS when set", () => {
    expect(parseServerEnv({ ANALYSIS_RETENTION_DAYS: "7" }).analysisRetentionDays).toBe(
      7,
    );
  });

  it("accepts zero, which keeps everything", () => {
    expect(parseServerEnv({ ANALYSIS_RETENTION_DAYS: "0" }).analysisRetentionDays).toBe(
      0,
    );
  });

  it.each(["banana", "7.5", "", "   "])(
    "keeps the default for %s rather than stopping the server",
    (raw) => {
      // Retention is housekeeping. Housekeeping must not gate startup.
      expect(parseServerEnv({ ANALYSIS_RETENTION_DAYS: raw }).analysisRetentionDays).toBe(
        30,
      );
    },
  );
});
