import { describe, expect, it, vi } from "vitest";

import type { Finding } from "@/lib/types/finding";

import { analyzeMobile } from "./analyze-mobile";
import { collectMobileSignals } from "./collect-signals";
import { MIN_TAP_TARGET_PX, SEVERE_OVERFLOW_PX } from "./thresholds";
import {
  MOBILE_FAILURE_CODES,
  type MobileFailureCode,
  type MobileProbe,
  type MobileSignals,
} from "./types";

/** A page with no mobile problems, so a test can break one thing. */
function signals(overrides: Partial<MobileSignals> = {}): MobileSignals {
  return {
    url: "https://example.com/",
    viewport: {
      widthPx: 390,
      deviceWidthPx: 390,
      heightPx: 844,
      scrollWidthPx: 390,
      scrollHeightPx: 2000,
      devicePixelRatio: 1,
    },
    viewportMeta: "width=device-width, initial-scale=1",
    horizontalOverflowPx: 0,
    overflowingElementCount: 0,
    overflowingElements: [],
    interactiveElementCount: 12,
    smallTapTargetCount: 0,
    smallTapTargets: [],
    tightTapTargetCount: 0,
    textNodeCount: 40,
    smallTextCount: 0,
    smallTextSamples: [],
    clippedElementCount: 0,
    clippedElements: [],
    navigation: {
      navCount: 1,
      visibleNavLinks: 4,
      hiddenNavLinks: 0,
      hasMenuControl: true,
    },
    screenshot: { available: true, byteLength: 40_000, widthPx: 390, heightPx: 844 },
    ...overrides,
  };
}

function analyze(overrides: Partial<MobileSignals> = {}): Finding[] {
  return analyzeMobile({
    probe: { ok: true, signals: signals(overrides), elapsedMs: 100 },
  });
}

function byId(findings: readonly Finding[], id: string): Finding | undefined {
  return findings.find((finding) => finding.id === id);
}

describe("the analyzer contract", () => {
  const findings = analyze();

  it("emits only mobile findings", () => {
    expect(findings.every((finding) => finding.category === "mobile")).toBe(true);
  });

  it("gives every finding evidence, an explanation and a recommendation", () => {
    for (const finding of findings) {
      expect(finding.evidence.length, `${finding.id} has no evidence`).toBeGreaterThan(0);
      expect(finding.explanation.length).toBeGreaterThan(0);
      expect(
        (finding.recommendation ?? "").length,
        `${finding.id} has no recommendation`,
      ).toBeGreaterThan(0);
    }
  });

  it("uses unique ids", () => {
    const ids = findings.map((finding) => finding.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("produces no score", () => {
    for (const finding of findings) {
      expect(finding).not.toHaveProperty("score");
    }
  });

  it("is deterministic", () => {
    expect(analyze()).toEqual(analyze());
  });
});

describe("measured and heuristic stay apart", () => {
  // The rule this phase exists to respect (ADR-009). A UI showing an inference
  // as a measurement would misrepresent what was actually established.
  const measuredOnly = [
    "mobile.overflow.horizontal",
    "mobile.overflow.none",
    "mobile.viewport.missing",
    "mobile.viewport.restrictive",
    "mobile.viewport.ok",
    "mobile.tap_targets.below_minimum",
    "mobile.tap_targets.meet_minimum",
    "mobile.clipping.content_hidden",
    "mobile.clipping.none",
  ];

  const mustCarryHeuristic = [
    "mobile.tap_targets.tight",
    "mobile.text.small",
    "mobile.navigation.may_be_crowded",
    "mobile.navigation.present",
    "mobile.navigation.not_found",
    "mobile.layout.may_be_broken",
    "mobile.assessment.limits",
  ];

  const everyFinding = [
    ...analyze(),
    ...analyze({
      horizontalOverflowPx: 120,
      overflowingElementCount: 4,
      overflowingElements: [
        { selector: "div.wide", tagName: "div", overflowPx: 120, widthPx: 500 },
      ],
      clippedElementCount: 1,
      clippedElements: [{ selector: "div.box", tagName: "div", hiddenPx: 30 }],
    }),
    ...analyze({ viewportMeta: null }),
    ...analyze({
      smallTapTargetCount: 2,
      smallTapTargets: [
        { selector: "a.x", tagName: "a", widthPx: 18, heightPx: 18, text: "x" },
      ],
    }),
    ...analyze({ tightTapTargetCount: 3 }),
    ...analyze({
      smallTextCount: 5,
      smallTextSamples: [{ selector: "p.fine", fontSizePx: 10, sample: "legal" }],
    }),
    ...analyze({
      navigation: {
        navCount: 1,
        visibleNavLinks: 12,
        hiddenNavLinks: 0,
        hasMenuControl: false,
      },
    }),
    ...analyze({
      navigation: {
        navCount: 0,
        visibleNavLinks: 0,
        hiddenNavLinks: 0,
        hasMenuControl: false,
      },
    }),
  ];

  it("marks purely measured findings with measured evidence only", () => {
    for (const finding of everyFinding) {
      if (!measuredOnly.includes(finding.id)) continue;

      expect(
        finding.evidence.every((item) => item.kind === "measured"),
        `${finding.id} carries heuristic evidence`,
      ).toBe(true);
    }
  });

  it("gives every inferential finding at least one heuristic evidence item", () => {
    for (const id of mustCarryHeuristic) {
      const finding = everyFinding.find((candidate) => candidate.id === id);
      if (finding === undefined) continue;

      expect(
        finding.evidence.some((item) => item.kind === "heuristic"),
        `${id} claims to be measured`,
      ).toBe(true);
    }
  });

  it("hedges the wording of heuristic findings", () => {
    for (const id of mustCarryHeuristic) {
      const finding = everyFinding.find((candidate) => candidate.id === id);
      if (finding === undefined) continue;

      const text = `${finding.explanation} ${finding.recommendation ?? ""}`;
      const hedges =
        /often|usually|may|might|suggest|judgement|inference|not tested|not assessed|nothing is concluded|unclear|consider|check/i;

      expect(hedges.test(text), `${id} reads as a certainty`).toBe(true);
    }
  });
});

describe("horizontal overflow", () => {
  it("passes when the page fits", () => {
    expect(byId(analyze(), "mobile.overflow.none")?.status).toBe("pass");
  });

  it("tolerates sub-pixel overflow", () => {
    // Browsers routinely report a fraction of a pixel on a fine page.
    expect(
      byId(analyze({ horizontalOverflowPx: 1 }), "mobile.overflow.none"),
    ).toBeDefined();
  });

  it("fails on real overflow and names the widest element", () => {
    const findings = analyze({
      horizontalOverflowPx: 40,
      overflowingElementCount: 1,
      overflowingElements: [
        { selector: "div.banner", tagName: "div", overflowPx: 40, widthPx: 430 },
      ],
    });

    const finding = byId(findings, "mobile.overflow.horizontal");
    expect(finding?.status).toBe("fail");
    expect(finding?.severity).toBe("moderate");
    expect(finding?.recommendation).toContain("div.banner");
  });

  it("escalates severe overflow", () => {
    const finding = byId(
      analyze({ horizontalOverflowPx: SEVERE_OVERFLOW_PX + 10 }),
      "mobile.overflow.horizontal",
    );

    expect(finding?.severity).toBe("serious");
  });
});

describe("viewport configuration", () => {
  it("fails when the tag is missing", () => {
    expect(
      byId(analyze({ viewportMeta: null }), "mobile.viewport.missing")?.severity,
    ).toBe("serious");
  });

  it("fails when it does not adapt to device width", () => {
    const finding = byId(
      analyze({ viewportMeta: "width=1024" }),
      "mobile.viewport.restrictive",
    );

    expect(finding?.status).toBe("fail");
    expect(finding?.explanation).toContain("width=device-width");
  });

  it("fails when zooming is disabled", () => {
    // People with low vision rely on being able to zoom.
    const finding = byId(
      analyze({ viewportMeta: "width=device-width, user-scalable=no" }),
      "mobile.viewport.restrictive",
    );

    expect(finding?.explanation).toContain("zoom");
  });

  it("fails when zooming is capped by maximum-scale", () => {
    expect(
      byId(
        analyze({ viewportMeta: "width=device-width, maximum-scale=1" }),
        "mobile.viewport.restrictive",
      ),
    ).toBeDefined();
  });

  it("allows a maximum-scale that still permits zooming", () => {
    expect(
      byId(
        analyze({ viewportMeta: "width=device-width, maximum-scale=5" }),
        "mobile.viewport.ok",
      )?.status,
    ).toBe("pass");
  });
});

describe("tap targets", () => {
  it("fails controls below the WCAG floor", () => {
    const finding = byId(
      analyze({
        smallTapTargetCount: 3,
        smallTapTargets: [
          { selector: "a.icon", tagName: "a", widthPx: 16, heightPx: 16, text: "" },
        ],
      }),
      "mobile.tap_targets.below_minimum",
    );

    expect(finding?.status).toBe("fail");
    expect(finding?.evidence[0]?.summary).toContain(String(MIN_TAP_TARGET_PX));
    expect(finding?.evidence[0]?.detail).toContain("a.icon");
  });

  it("passes when every control meets the floor", () => {
    expect(byId(analyze(), "mobile.tap_targets.meet_minimum")?.status).toBe("pass");
  });

  it("separates the comfort guideline from the standard", () => {
    // Between 24 and 44px breaks no standard, so it warns rather than fails.
    const finding = byId(analyze({ tightTapTargetCount: 4 }), "mobile.tap_targets.tight");

    expect(finding?.status).toBe("warn");
    expect(finding?.severity).toBe("minor");
    expect(finding?.explanation).toContain("suggestion rather than a defect");
  });

  it("handles a page with no interactive elements", () => {
    expect(
      byId(analyze({ interactiveElementCount: 0 }), "mobile.tap_targets.none")?.status,
    ).toBe("pass");
  });
});

describe("clipping and layout", () => {
  it("reports elements hiding their own content", () => {
    const finding = byId(
      analyze({
        clippedElementCount: 2,
        clippedElements: [{ selector: "div.card", tagName: "div", hiddenPx: 40 }],
      }),
      "mobile.clipping.content_hidden",
    );

    expect(finding?.status).toBe("fail");
    expect(finding?.evidence[0]?.detail).toContain("div.card");
  });

  it("only calls a layout broken when several signals agree", () => {
    // One overflowing element is a bug; three plus clipping is a missing
    // mobile layout. The inference needs corroboration.
    expect(
      byId(analyze({ horizontalOverflowPx: 80 }), "mobile.layout.may_be_broken"),
    ).toBeUndefined();

    const findings = analyze({
      horizontalOverflowPx: 200,
      overflowingElementCount: 5,
      clippedElementCount: 2,
    });

    expect(byId(findings, "mobile.layout.may_be_broken")?.status).toBe("warn");
  });
});

describe("navigation", () => {
  it("reports nothing conclusive when no navigation region exists", () => {
    const finding = byId(
      analyze({
        navigation: {
          navCount: 0,
          visibleNavLinks: 0,
          hiddenNavLinks: 0,
          hasMenuControl: false,
        },
      }),
      "mobile.navigation.not_found",
    );

    expect(finding?.status).toBe("could_not_determine");
  });

  it("warns when many links are visible with no menu control", () => {
    const finding = byId(
      analyze({
        navigation: {
          navCount: 1,
          visibleNavLinks: 14,
          hiddenNavLinks: 0,
          hasMenuControl: false,
        },
      }),
      "mobile.navigation.may_be_crowded",
    );

    expect(finding?.status).toBe("warn");
    expect(finding?.explanation).toContain("inference");
  });

  it("recognises the collapsed-menu pattern without claiming it works", () => {
    const finding = byId(
      analyze({
        navigation: {
          navCount: 1,
          visibleNavLinks: 0,
          hiddenNavLinks: 8,
          hasMenuControl: true,
        },
      }),
      "mobile.navigation.hidden_behind_control",
    );

    expect(finding?.status).toBe("pass");
    expect(finding?.explanation).toContain("did not open it");
  });

  it("is unsure when links are hidden and no control was found", () => {
    const finding = byId(
      analyze({
        navigation: {
          navCount: 1,
          visibleNavLinks: 0,
          hiddenNavLinks: 8,
          hasMenuControl: false,
        },
      }),
      "mobile.navigation.hidden_behind_control",
    );

    expect(finding?.status).toBe("could_not_determine");
  });
});

describe("the limits of automated mobile checks", () => {
  it("always states what was not tested", () => {
    const finding = byId(analyze(), "mobile.assessment.limits");

    expect(finding?.status).toBe("could_not_determine");
    expect(finding?.explanation).toContain("cannot establish whether the page is");
  });

  it("mentions the screenshot when one was captured", () => {
    const finding = byId(analyze(), "mobile.assessment.limits");

    expect(finding?.evidence.map((item) => item.summary).join(" ")).toContain(
      "screenshot",
    );
  });

  it("omits the screenshot claim when none was captured", () => {
    const finding = byId(
      analyze({
        screenshot: { available: false, byteLength: null, widthPx: null, heightPx: null },
      }),
      "mobile.assessment.limits",
    );

    expect(finding?.evidence.map((item) => item.summary).join(" ")).not.toContain(
      "screenshot",
    );
  });

  it("never claims the page works on mobile", () => {
    const claims = [
      /\bis mobile[- ]friendly\b/i,
      /\bworks (?:well )?on mobile\b/i,
      /\bfully responsive\b/i,
      /\bguarantee/i,
    ];
    const text = analyze()
      .flatMap((finding) => [finding.explanation, finding.recommendation ?? ""])
      .join("\n");

    for (const claim of claims) {
      expect(text, `matched ${claim}`).not.toMatch(claim);
    }
  });
});

describe("failure handling", () => {
  it.each(MOBILE_FAILURE_CODES)("turns a %s failure into could_not_determine", (code) => {
    const probe: MobileProbe = { ok: false, failure: { code, message: "went wrong" } };
    const findings = analyzeMobile({ probe });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.status).toBe("could_not_determine");
    expect(findings[0]?.id).toBe(`mobile.probe.${code}`);
  });

  it("never reports a pass when the probe did not run", () => {
    for (const code of MOBILE_FAILURE_CODES) {
      const findings = analyzeMobile({
        probe: { ok: false, failure: { code, message: "x" } },
      });
      expect(findings.every((finding) => finding.status !== "pass")).toBe(true);
    }
  });

  it("reports could_not_determine when no probe was supplied", () => {
    expect(analyzeMobile()[0]?.status).toBe("could_not_determine");
  });

  it("explains each failure in its own terms", () => {
    const explanations = MOBILE_FAILURE_CODES.map(
      (code) =>
        analyzeMobile({ probe: { ok: false, failure: { code, message: "x" } } })[0]
          ?.explanation ?? "",
    );

    expect(explanations.every((text) => text.length > 0)).toBe(true);
    expect(new Set(explanations).size).toBeGreaterThan(1);
  });

  it("handles an unrecognised failure code", () => {
    const findings = analyzeMobile({
      probe: {
        ok: false,
        failure: { code: "new_code" as MobileFailureCode, message: "x" },
      },
    });

    expect(findings[0]?.explanation.length).toBeGreaterThan(0);
  });
});

describe("collectMobileSignals failure paths that need no browser", () => {
  it("refuses a malformed URL", async () => {
    const probe = await collectMobileSignals("not a url");

    expect(probe.ok).toBe(false);
    if (!probe.ok) expect(probe.failure.code).toBe("invalid_url");
  });

  it.each([
    ["a private address", "http://192.168.1.1/"],
    ["the metadata endpoint", "http://169.254.169.254/"],
  ])("refuses %s", async (_label, url) => {
    const probe = await collectMobileSignals(url);

    expect(probe.ok).toBe(false);
    if (!probe.ok) expect(probe.failure.code).toBe("blocked");
  });

  it("never launches a browser for a URL it will refuse", async () => {
    const launcher = vi.fn();

    await collectMobileSignals("http://localhost/", { launcher });

    expect(launcher).not.toHaveBeenCalled();
  });

  it("reports a missing browser binary", async () => {
    const probe = await collectMobileSignals("https://example.com/", {
      launcher: async () => {
        throw new Error("Executable doesn't exist");
      },
    });

    expect(probe.ok).toBe(false);
    if (!probe.ok) expect(probe.failure.code).toBe("browser_unavailable");
  });

  it("feeds a failure straight into the analyzer", async () => {
    const probe = await collectMobileSignals("http://192.168.1.1/");
    const findings = analyzeMobile({ probe });

    expect(findings[0]?.id).toBe("mobile.probe.blocked");
  });
});
