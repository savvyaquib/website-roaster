import { describe, expect, it } from "vitest";

import { createLogger, type LogRecord } from "./logger";

function collect() {
  const records: LogRecord[] = [];
  return { records, sink: (record: LogRecord) => void records.push(record) };
}

const FIXED_NOW = () => new Date("2026-01-01T00:00:00.000Z");

describe("createLogger", () => {
  it("emits a structured record", () => {
    const { records, sink } = collect();
    const logger = createLogger("analysis", { level: "debug", sink, now: FIXED_NOW });

    logger.info("analysis.started", { analysisId: "abc123" });

    expect(records).toEqual([
      {
        timestamp: "2026-01-01T00:00:00.000Z",
        level: "info",
        scope: "analysis",
        event: "analysis.started",
        fields: { analysisId: "abc123" },
      },
    ]);
  });

  it("omits the fields key entirely when there is no context", () => {
    const { records, sink } = collect();
    const logger = createLogger("analysis", { level: "debug", sink, now: FIXED_NOW });

    logger.info("analysis.started");

    expect(records[0]).not.toHaveProperty("fields");
  });

  it("suppresses records below the configured level", () => {
    const { records, sink } = collect();
    const logger = createLogger("analysis", { level: "warn", sink });

    logger.debug("ignored");
    logger.info("ignored");
    logger.warn("kept");
    logger.error("kept");

    expect(records.map((r) => r.level)).toEqual(["warn", "error"]);
  });

  it("emits nothing at all when silenced", () => {
    const { records, sink } = collect();
    const logger = createLogger("analysis", { level: "silent", sink });

    logger.debug("nope");
    logger.info("nope");
    logger.warn("nope");
    logger.error("nope");

    expect(records).toEqual([]);
  });

  it("namespaces child scopes", () => {
    const { records, sink } = collect();
    const logger = createLogger("analysis", { level: "debug", sink, now: FIXED_NOW });

    const child = logger.child("seo");
    child.info("analyzer.completed");

    expect(child.scope).toBe("analysis.seo");
    expect(records[0]?.scope).toBe("analysis.seo");
  });

  it("keeps the parent level and sink in child loggers", () => {
    const { records, sink } = collect();
    const logger = createLogger("analysis", { level: "error", sink });

    logger.child("seo").warn("suppressed");
    logger.child("seo").error("kept");

    expect(records.map((r) => r.event)).toEqual(["kept"]);
  });

  it("produces one JSON line per record", () => {
    const { records, sink } = collect();
    const logger = createLogger("analysis", { level: "debug", sink, now: FIXED_NOW });

    logger.error("browser.launch.failed", { attempt: 2, fatal: true });

    const line = JSON.stringify(records[0]);
    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toMatchObject({
      level: "error",
      fields: { attempt: 2, fatal: true },
    });
  });
});
