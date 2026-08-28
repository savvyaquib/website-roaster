import { describe, expect, it } from "vitest";

import { EnvValidationError, parseServerEnv } from "./env";

describe("parseServerEnv", () => {
  it("applies documented defaults when nothing is set", () => {
    expect(parseServerEnv({})).toEqual({ nodeEnv: "development", logLevel: "info" });
  });

  it("reads valid values", () => {
    expect(parseServerEnv({ NODE_ENV: "production", LOG_LEVEL: "warn" })).toEqual({
      nodeEnv: "production",
      logLevel: "warn",
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
