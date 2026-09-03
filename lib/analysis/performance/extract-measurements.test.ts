import { describe, expect, it } from "vitest";

import {
  AUDIT_IDS,
  emptyMeasurements,
  extractMeasurements,
  INP_UNAVAILABLE_REASON,
} from "./extract-measurements";
import type { LighthouseAudit, LighthouseReport } from "./types";

function metric(numericValue: number, numericUnit = "millisecond"): LighthouseAudit {
  return { score: 1, numericValue, numericUnit };
}

function report(audits: Record<string, LighthouseAudit> = {}): LighthouseReport {
  return {
    audits: {
      [AUDIT_IDS.lcp]: metric(2400),
      [AUDIT_IDS.cls]: metric(0.05, "unitless"),
      [AUDIT_IDS.tbt]: metric(150),
      [AUDIT_IDS.fcp]: metric(900),
      [AUDIT_IDS.speedIndex]: metric(1800),
      [AUDIT_IDS.interactive]: metric(3200),
      [AUDIT_IDS.serverResponse]: metric(120),
      [AUDIT_IDS.totalByteWeight]: metric(1_500_000, "byte"),
      [AUDIT_IDS.bootupTime]: metric(850),
      [AUDIT_IDS.mainThread]: metric(2100),
      [AUDIT_IDS.networkRequests]: {
        details: { items: [{ url: "a" }, { url: "b" }, { url: "c" }] },
      },
      [AUDIT_IDS.resourceSummary]: {
        details: {
          items: [
            { resourceType: "total", requestCount: 3, transferSize: 1_500_000 },
            { resourceType: "script", requestCount: 2, transferSize: 900_000 },
            { resourceType: "image", requestCount: 1, transferSize: 600_000 },
          ],
        },
      },
      [AUDIT_IDS.unusedJavaScript]: {
        score: 0.4,
        details: { overallSavingsBytes: 240_000 },
      },
      [AUDIT_IDS.imageDelivery]: {
        score: 0.3,
        details: { overallSavingsBytes: 400_000 },
      },
      [AUDIT_IDS.renderBlocking]: {
        score: 0.2,
        details: { overallSavingsMs: 620, items: [{ url: "a.css" }, { url: "b.css" }] },
      },
      ...audits,
    },
    lighthouseVersion: "13.4.1",
    finalDisplayedUrl: "https://example.com/",
  };
}

describe("core metrics", () => {
  const measurements = extractMeasurements(report());

  it("copies values in the engine's own units, unrounded", () => {
    // ADR-012: raw data must survive so weights can change later.
    expect(measurements.lcpMs).toBe(2400);
    expect(measurements.clsScore).toBe(0.05);
    expect(measurements.tbtMs).toBe(150);
    expect(measurements.fcpMs).toBe(900);
    expect(measurements.speedIndexMs).toBe(1800);
    expect(measurements.timeToInteractiveMs).toBe(3200);
    expect(measurements.serverResponseMs).toBe(120);
  });

  it("keeps a fractional value exactly", () => {
    const measured = extractMeasurements(report({ [AUDIT_IDS.lcp]: metric(1651.279) }));

    expect(measured.lcpMs).toBe(1651.279);
  });

  it("records page size and request count", () => {
    expect(measurements.totalByteWeight).toBe(1_500_000);
    expect(measurements.requestCount).toBe(3);
  });

  it("records the JavaScript cost", () => {
    expect(measurements.javaScriptBootupMs).toBe(850);
    expect(measurements.mainThreadWorkMs).toBe(2100);
    expect(measurements.unusedJavaScriptBytes).toBe(240_000);
  });

  it("records image and render-blocking measurements", () => {
    expect(measurements.imagePotentialSavingsBytes).toBe(400_000);
    expect(measurements.renderBlockingWastedMs).toBe(620);
    expect(measurements.renderBlockingCount).toBe(2);
  });

  it("records the resource breakdown by type", () => {
    expect(measurements.resourceBreakdown).toEqual([
      { type: "total", requestCount: 3, transferBytes: 1_500_000 },
      { type: "script", requestCount: 2, transferBytes: 900_000 },
      { type: "image", requestCount: 1, transferBytes: 600_000 },
    ]);
  });

  it("records provenance so a number can be traced to what produced it", () => {
    expect(measurements.engineName).toBe("lighthouse");
    expect(measurements.engineVersion).toBe("13.4.1");
    expect(measurements.measuredUrl).toBe("https://example.com/");
  });

  it("contains no score of any kind", () => {
    // The engine's 0-1 scores are derived values and must not leak into the
    // raw record (ADR-012).
    const serialized = JSON.stringify(measurements);

    expect(serialized).not.toContain('"score"');
    expect(measurements).not.toHaveProperty("performanceScore");
  });
});

describe("INP", () => {
  it("is always null, because a lab run cannot measure it", () => {
    // ADR-030. Inventing a number here would be the worst option available.
    expect(extractMeasurements(report()).inpMs).toBeNull();
  });

  it("carries the reason it is null", () => {
    const measurements = extractMeasurements(report());

    expect(measurements.inpUnavailableReason).toBe(INP_UNAVAILABLE_REASON);
    expect(measurements.inpUnavailableReason).toContain("field metric");
  });

  it("stays null even when the engine reports an INP-related insight", () => {
    const measurements = extractMeasurements(
      report({ [AUDIT_IDS.inpBreakdown]: metric(200) }),
    );

    expect(measurements.inpMs).toBeNull();
  });

  it("reports TBT alongside, as the lab proxy", () => {
    expect(extractMeasurements(report()).tbtMs).toBe(150);
  });
});

describe("missing and malformed audits", () => {
  it("reports a missing audit as null, not zero", () => {
    // Zero would read as a perfect measurement of a page nobody measured.
    const measurements = extractMeasurements({ audits: {} });

    expect(measurements.lcpMs).toBeNull();
    expect(measurements.clsScore).toBeNull();
    expect(measurements.totalByteWeight).toBeNull();
    expect(measurements.requestCount).toBeNull();
  });

  it("keeps a genuine zero distinct from a missing measurement", () => {
    const measurements = extractMeasurements(
      report({ [AUDIT_IDS.cls]: metric(0, "unitless") }),
    );

    expect(measurements.clsScore).toBe(0);
  });

  it("survives one malformed audit without losing the rest", () => {
    const measurements = extractMeasurements(
      report({ [AUDIT_IDS.lcp]: { numericValue: Number.NaN } }),
    );

    expect(measurements.lcpMs).toBeNull();
    expect(measurements.tbtMs).toBe(150);
  });

  it("rejects a non-finite numeric value", () => {
    expect(
      extractMeasurements(report({ [AUDIT_IDS.tbt]: { numericValue: Infinity } })).tbtMs,
    ).toBeNull();
  });

  it("ignores a numericValue that is not a number", () => {
    expect(
      extractMeasurements(
        report({ [AUDIT_IDS.lcp]: { numericValue: "fast" as unknown as number } }),
      ).lcpMs,
    ).toBeNull();
  });

  it("handles an audit with no details", () => {
    const measurements = extractMeasurements(
      report({ [AUDIT_IDS.networkRequests]: { score: 1 } }),
    );

    expect(measurements.requestCount).toBeNull();
  });

  it("handles a resource summary with unusable rows", () => {
    const measurements = extractMeasurements(
      report({
        [AUDIT_IDS.resourceSummary]: {
          details: { items: [{ nope: true }, { resourceType: "font" }] },
        },
      }),
    );

    // The unusable row is dropped; the usable one keeps zeroes for absent
    // numbers, which is what the engine means by omitting them.
    expect(measurements.resourceBreakdown).toEqual([
      { type: "font", requestCount: 0, transferBytes: 0 },
    ]);
  });

  it("sums per-item wasted bytes when there is no overall total", () => {
    const measurements = extractMeasurements(
      report({
        [AUDIT_IDS.unusedJavaScript]: {
          details: { items: [{ wastedBytes: 100 }, { wastedBytes: 250 }] },
        },
      }),
    );

    expect(measurements.unusedJavaScriptBytes).toBe(350);
  });

  it("reports null savings when no item declares any", () => {
    const measurements = extractMeasurements(
      report({ [AUDIT_IDS.imageDelivery]: { details: { items: [{ url: "a.png" }] } } }),
    );

    expect(measurements.imagePotentialSavingsBytes).toBeNull();
  });

  it("falls back to the requested URL when there is no final URL", () => {
    const measurements = extractMeasurements({
      audits: {},
      requestedUrl: "https://example.com/start",
    });

    expect(measurements.measuredUrl).toBe("https://example.com/start");
  });

  it("is deterministic", () => {
    expect(extractMeasurements(report())).toEqual(extractMeasurements(report()));
  });
});

describe("emptyMeasurements", () => {
  it("has every measurement null", () => {
    const measurements = emptyMeasurements();

    for (const [key, value] of Object.entries(measurements)) {
      if (key === "inpUnavailableReason") continue;
      if (key === "resourceBreakdown") {
        expect(value).toEqual([]);
        continue;
      }
      expect(value, `${key} should be null`).toBeNull();
    }
  });

  it("still explains why INP is unavailable", () => {
    expect(emptyMeasurements().inpUnavailableReason).toBe(INP_UNAVAILABLE_REASON);
  });
});
