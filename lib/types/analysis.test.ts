import { describe, expect, it } from "vitest";

import {
  ANALYSIS_STATUSES,
  isAnalysisStatus,
  isFailedAnalysisStatus,
  isTerminalAnalysisStatus,
} from "./analysis";

describe("isAnalysisStatus", () => {
  it.each(ANALYSIS_STATUSES)("accepts the documented status %s", (status) => {
    expect(isAnalysisStatus(status)).toBe(true);
  });

  it.each([
    ["an unknown string", "cancelled"],
    ["a differently cased status", "QUEUED"],
    ["an empty string", ""],
    ["a non-string", 42],
    ["null", null],
    ["undefined", undefined],
  ])("rejects %s", (_label, value) => {
    expect(isAnalysisStatus(value)).toBe(false);
  });
});

describe("isTerminalAnalysisStatus", () => {
  it("treats queued and running as non-terminal", () => {
    expect(isTerminalAnalysisStatus("queued")).toBe(false);
    expect(isTerminalAnalysisStatus("running")).toBe(false);
  });

  it.each(["completed", "failed", "timeout", "blocked", "invalid_url"] as const)(
    "treats %s as terminal",
    (status) => {
      expect(isTerminalAnalysisStatus(status)).toBe(true);
    },
  );

  it("classifies every documented status exactly once", () => {
    const terminal = ANALYSIS_STATUSES.filter(isTerminalAnalysisStatus);
    const pending = ANALYSIS_STATUSES.filter((s) => !isTerminalAnalysisStatus(s));

    expect(terminal.length + pending.length).toBe(ANALYSIS_STATUSES.length);
  });
});

describe("isFailedAnalysisStatus", () => {
  it("does not treat a completed analysis as failed", () => {
    expect(isFailedAnalysisStatus("completed")).toBe(false);
  });

  it("does not treat an in-flight analysis as failed", () => {
    expect(isFailedAnalysisStatus("queued")).toBe(false);
    expect(isFailedAnalysisStatus("running")).toBe(false);
  });

  it.each(["failed", "timeout", "blocked", "invalid_url"] as const)(
    "treats %s as a failure",
    (status) => {
      expect(isFailedAnalysisStatus(status)).toBe(true);
    },
  );

  it("only reports failures that are already terminal", () => {
    for (const status of ANALYSIS_STATUSES) {
      if (isFailedAnalysisStatus(status)) {
        expect(isTerminalAnalysisStatus(status)).toBe(true);
      }
    }
  });
});
