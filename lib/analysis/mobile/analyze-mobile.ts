/**
 * Phase 9 — Mobile analyzer.
 *
 * Source of truth: docs/IMPLEMENTATION.md Phase 9, docs/DECISIONS.md ADR-009,
 * ADR-049.
 *
 * Pure: signals in, `Finding[]` out. No browser, no network.
 *
 * ## Measured and heuristic are kept apart
 *
 * Some of what this phase reports is a fact about the rendered page:
 * `scrollWidth` exceeded `clientWidth`, a control measured 18 CSS pixels, there
 * is no viewport meta tag. Those are `measured`.
 *
 * The rest is inference: a page with several overflowing elements *looks*
 * broken; a nav with twelve links and no menu control *may* be unusable on a
 * phone. Those are `heuristic`, and every one of them says so in its own words
 * as well as in its evidence (ADR-009).
 *
 * ## What automation cannot do
 *
 * None of this establishes whether the page is actually usable on a phone.
 * A page can pass every check here and still be miserable to use, and a page
 * can fail several and be perfectly fine. The analyzer emits a standing finding
 * saying so, because a mobile section that reads as a verdict would be a lie
 * about what was tested.
 */

import { findingFactory, preview } from "@/lib/analysis/finding-builder";
import type { Evidence, Finding } from "@/lib/types/finding";

import {
  COMFORTABLE_TAP_TARGET_PX,
  MAX_REPORTED_ELEMENTS,
  MIN_COMFORTABLE_FONT_PX,
  MIN_TAP_TARGET_PX,
  NAV_LINKS_EXPECTING_TOGGLE,
  OVERFLOW_TOLERANCE_PX,
  SEVERE_OVERFLOW_PX,
} from "./thresholds";
import type { MobileFailure, MobileAnalysisInput, MobileSignals } from "./types";

const mobileFinding = findingFactory("mobile");

/** Evidence for something the browser actually reported. */
function measured(summary: string, detail?: string): Evidence {
  return {
    kind: "measured",
    source: "browser",
    summary,
    ...(detail === undefined ? {} : { detail }),
  };
}

/**
 * Evidence for something inferred rather than observed.
 *
 * The `heuristic` kind is what stops the UI presenting these as fact.
 */
function heuristic(summary: string, detail?: string): Evidence {
  return {
    kind: "heuristic",
    source: "derived",
    summary,
    ...(detail === undefined ? {} : { detail }),
  };
}

function list(items: readonly { selector: string }[]): string {
  return items
    .slice(0, MAX_REPORTED_ELEMENTS)
    .map((item) => item.selector)
    .join(", ");
}

// ---------------------------------------------------------------------------
// Measured checks
// ---------------------------------------------------------------------------

/**
 * Horizontal overflow.
 *
 * The clearest measurable mobile defect there is: the page is wider than the
 * screen, so the reader has to scroll sideways to see it.
 */
function checkHorizontalOverflow(signals: MobileSignals): Finding {
  const { horizontalOverflowPx, viewport } = signals;

  if (horizontalOverflowPx <= OVERFLOW_TOLERANCE_PX) {
    return mobileFinding({
      id: "mobile.overflow.none",
      severity: "info",
      status: "pass",
      evidence: [
        measured(
          `The page content fits the ${viewport.widthPx}px viewport (scroll width ${Math.round(viewport.scrollWidthPx)}px).`,
        ),
      ],
      explanation: "The page does not scroll sideways at this viewport width.",
      recommendation:
        "Keep testing narrow viewports as layouts change; overflow usually arrives with a new component.",
    });
  }

  const severe = horizontalOverflowPx >= SEVERE_OVERFLOW_PX;

  return mobileFinding({
    id: "mobile.overflow.horizontal",
    severity: severe ? "serious" : "moderate",
    status: "fail",
    evidence: [
      measured(
        `The page is ${Math.round(horizontalOverflowPx)}px wider than the ${viewport.widthPx}px viewport.`,
        `scrollWidth ${Math.round(viewport.scrollWidthPx)}px vs clientWidth ${viewport.widthPx}px`,
      ),
      ...(signals.overflowingElements.length > 0
        ? [
            measured(
              `${signals.overflowingElementCount} element(s) extend past the right edge.`,
              list(signals.overflowingElements),
            ),
          ]
        : []),
    ],
    explanation:
      "The page is wider than the screen, so readers have to scroll sideways to see all of it. This is usually one fixed-width element rather than the whole layout.",
    recommendation:
      signals.overflowingElements.length > 0
        ? `Start with ${signals.overflowingElements[0]?.selector ?? "the widest element"}: give it a maximum width, or let it wrap.`
        : "Find the element wider than the viewport and give it a maximum width.",
  });
}

function checkViewportMeta(signals: MobileSignals): Finding {
  const meta = signals.viewportMeta;

  if (meta === null || meta.trim().length === 0) {
    return mobileFinding({
      id: "mobile.viewport.missing",
      severity: "serious",
      status: "fail",
      evidence: [
        measured("The page declares no viewport meta tag."),
        ...(signals.viewport.widthPx > signals.viewport.deviceWidthPx
          ? [
              measured(
                `The browser laid the page out at ${signals.viewport.widthPx}px on a ${signals.viewport.deviceWidthPx}px screen, then scaled it down.`,
              ),
            ]
          : []),
      ],
      explanation:
        "Without a viewport declaration, mobile browsers lay the page out at a desktop fallback width and shrink the result to fit, leaving text too small to read.",
      recommendation:
        'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
    });
  }

  const normalized = meta.toLowerCase();
  const problems: string[] = [];

  if (!normalized.includes("width=device-width")) {
    problems.push("it does not set width=device-width");
  }
  // Both of these stop a reader zooming in, which people with low vision rely
  // on. This is a measured property of the declaration, not an inference.
  if (/user-scalable\s*=\s*(no|0)/.test(normalized)) {
    problems.push("it disables zooming with user-scalable=no");
  }
  if (/maximum-scale\s*=\s*(1(\.0+)?|0?\.\d+)\b/.test(normalized)) {
    problems.push("it caps zooming with maximum-scale");
  }

  if (problems.length > 0) {
    return mobileFinding({
      id: "mobile.viewport.restrictive",
      severity: "moderate",
      status: "fail",
      evidence: [measured("The viewport declaration is restrictive.", meta)],
      explanation: `The viewport is declared, but ${problems.join(", and ")}. Preventing zoom makes the page unusable for readers who need to magnify it.`,
      recommendation:
        'Use content="width=device-width, initial-scale=1" and do not disable user scaling.',
    });
  }

  return mobileFinding({
    id: "mobile.viewport.ok",
    severity: "info",
    status: "pass",
    evidence: [measured("The viewport adapts to the device width.", meta)],
    explanation: "The page declares a responsive viewport and permits zooming.",
    recommendation: "Keep the declaration as it is; it is doing its job.",
  });
}

/**
 * Tap target size.
 *
 * Measured against the WCAG 2.2 floor of 24x24 CSS pixels. Controls above the
 * floor but below the platform comfort guidelines are reported separately, as a
 * heuristic, because they break no standard.
 */
function checkTapTargets(signals: MobileSignals): Finding[] {
  if (signals.interactiveElementCount === 0) {
    return [
      mobileFinding({
        id: "mobile.tap_targets.none",
        severity: "info",
        status: "pass",
        evidence: [measured("The page has no interactive elements to size.")],
        explanation: "There are no controls whose tap size could be a problem.",
        recommendation: `Size any control added later to at least ${MIN_TAP_TARGET_PX}x${MIN_TAP_TARGET_PX} CSS pixels.`,
      }),
    ];
  }

  const findings: Finding[] = [];

  if (signals.smallTapTargetCount > 0) {
    findings.push(
      mobileFinding({
        id: "mobile.tap_targets.below_minimum",
        severity: "moderate",
        status: "fail",
        evidence: [
          measured(
            `${signals.smallTapTargetCount} of ${signals.interactiveElementCount} control(s) are smaller than ${MIN_TAP_TARGET_PX}x${MIN_TAP_TARGET_PX} CSS pixels.`,
            signals.smallTapTargets
              .slice(0, MAX_REPORTED_ELEMENTS)
              .map(
                (target) =>
                  `${target.selector} (${Math.round(target.widthPx)}x${Math.round(target.heightPx)})`,
              )
              .join(", "),
          ),
        ],
        explanation: `WCAG 2.2 sets ${MIN_TAP_TARGET_PX}x${MIN_TAP_TARGET_PX} CSS pixels as the minimum target size. Controls below it are hard to hit accurately with a finger.`,
        recommendation:
          "Increase the size of these controls, or add padding around them so the tappable area grows.",
      }),
    );
  } else {
    findings.push(
      mobileFinding({
        id: "mobile.tap_targets.meet_minimum",
        severity: "info",
        status: "pass",
        evidence: [
          measured(
            `All ${signals.interactiveElementCount} control(s) meet the ${MIN_TAP_TARGET_PX}px minimum.`,
          ),
        ],
        explanation: "Every interactive element measured at or above the WCAG floor.",
        recommendation: "Keep new controls at or above the same size.",
      }),
    );
  }

  if (signals.tightTapTargetCount > 0) {
    findings.push(
      mobileFinding({
        id: "mobile.tap_targets.tight",
        severity: "minor",
        status: "warn",
        evidence: [
          measured(
            `${signals.tightTapTargetCount} control(s) are between ${MIN_TAP_TARGET_PX}px and ${COMFORTABLE_TAP_TARGET_PX}px.`,
          ),
          heuristic(
            "Platform guidance suggests larger targets are more comfortable, but this breaks no standard.",
          ),
        ],
        explanation: `These controls meet the accessibility minimum. Apple and Material guidance recommends around ${COMFORTABLE_TAP_TARGET_PX}px for comfortable tapping, so this is a suggestion rather than a defect.`,
        recommendation: `Consider enlarging frequently used controls towards ${COMFORTABLE_TAP_TARGET_PX}px.`,
      }),
    );
  }

  return findings;
}

function checkClipping(signals: MobileSignals): Finding {
  if (signals.clippedElementCount === 0) {
    return mobileFinding({
      id: "mobile.clipping.none",
      severity: "info",
      status: "pass",
      evidence: [measured("No element was found hiding its own content.")],
      explanation: "Nothing appears to be cut off by an overflow rule.",
      recommendation: "Keep checking narrow viewports when adding fixed-size containers.",
    });
  }

  return mobileFinding({
    id: "mobile.clipping.content_hidden",
    severity: "moderate",
    status: "fail",
    evidence: [
      measured(
        `${signals.clippedElementCount} element(s) hide part of their own content.`,
        signals.clippedElements
          .slice(0, MAX_REPORTED_ELEMENTS)
          .map((item) => `${item.selector} (${Math.round(item.hiddenPx)}px hidden)`)
          .join(", "),
      ),
    ],
    explanation:
      "These elements are narrower than the content inside them and hide the remainder, so some text or controls are unreachable at this width.",
    recommendation:
      "Let these containers grow or wrap at narrow widths instead of hiding the overflow.",
  });
}

// ---------------------------------------------------------------------------
// Heuristic checks
// ---------------------------------------------------------------------------

/**
 * Text size.
 *
 * Heuristic: there is no standard minimum font size, and small text is
 * legitimate for captions, footnotes and legal copy.
 */
function checkTextSize(signals: MobileSignals): Finding {
  if (signals.smallTextCount === 0) {
    return mobileFinding({
      id: "mobile.text.readable",
      severity: "info",
      status: "pass",
      evidence: [
        measured(
          `No text was rendered below ${MIN_COMFORTABLE_FONT_PX}px across ${signals.textNodeCount} run(s) of text.`,
        ),
      ],
      explanation: "Text is rendered at a size that is generally readable on a phone.",
      recommendation: "Keep body text at a comfortable size on small screens.",
    });
  }

  return mobileFinding({
    id: "mobile.text.small",
    severity: "minor",
    status: "warn",
    evidence: [
      measured(
        `${signals.smallTextCount} of ${signals.textNodeCount} run(s) of text render below ${MIN_COMFORTABLE_FONT_PX}px.`,
        signals.smallTextSamples
          .slice(0, MAX_REPORTED_ELEMENTS)
          .map((sample) => `${sample.selector} (${Math.round(sample.fontSizePx)}px)`)
          .join(", "),
      ),
      heuristic(
        "There is no standard minimum font size; captions and legal text are legitimately small.",
      ),
    ],
    explanation:
      "Some text renders small enough to be uncomfortable on a phone. This is a judgement, not a rule — check whether these runs are body copy or incidental text.",
    recommendation:
      "Review these elements and raise the size of anything a reader is expected to read properly.",
  });
}

/**
 * Mobile navigation.
 *
 * Entirely heuristic. Detecting a "menu button" means pattern-matching on
 * labels and attributes, and plenty of usable sites navigate differently.
 */
function checkNavigation(signals: MobileSignals): Finding {
  const { navigation } = signals;

  if (navigation.navCount === 0) {
    return mobileFinding({
      id: "mobile.navigation.not_found",
      severity: "info",
      status: "could_not_determine",
      evidence: [
        measured("No <nav> element or navigation role was found."),
        heuristic(
          "Navigation may be present without the markup that identifies it, so nothing is concluded.",
        ),
      ],
      explanation:
        "No navigation region could be identified, so whether the page navigates well on a phone was not assessed.",
      recommendation:
        "Mark the primary navigation with a <nav> element so it can be identified by tools and assistive technology.",
    });
  }

  const crowded =
    navigation.visibleNavLinks > NAV_LINKS_EXPECTING_TOGGLE && !navigation.hasMenuControl;

  if (crowded) {
    return mobileFinding({
      id: "mobile.navigation.may_be_crowded",
      severity: "minor",
      status: "warn",
      evidence: [
        measured(
          `${navigation.visibleNavLinks} navigation link(s) are visible at a ${signals.viewport.widthPx}px viewport.`,
        ),
        measured("No control resembling a menu toggle was found."),
        heuristic(
          `More than ${NAV_LINKS_EXPECTING_TOGGLE} visible links with no menu control often means the desktop navigation was left as-is.`,
        ),
      ],
      explanation:
        "The navigation shows many links at phone width with no menu control. That often indicates the desktop navigation was not adapted — but it is an inference from markup, not an observation of the page being hard to use.",
      recommendation:
        "Open the page on a phone and check the navigation is reachable and tappable. Consider a menu control if it is not.",
    });
  }

  if (navigation.visibleNavLinks === 0 && navigation.hiddenNavLinks > 0) {
    return mobileFinding({
      id: "mobile.navigation.hidden_behind_control",
      severity: "info",
      status: navigation.hasMenuControl ? "pass" : "could_not_determine",
      evidence: [
        measured(
          `${navigation.hiddenNavLinks} navigation link(s) are present but not visible at this width.`,
        ),
        measured(
          navigation.hasMenuControl
            ? "A control resembling a menu toggle was found."
            : "No control resembling a menu toggle was found.",
        ),
        heuristic("Whether the menu actually opens was not tested."),
      ],
      explanation: navigation.hasMenuControl
        ? "The navigation appears to collapse behind a menu control, which is the usual mobile pattern. This analyzer did not open it."
        : "Navigation links are hidden and no menu control was identified, so it is unclear how a reader would reach them.",
      recommendation: navigation.hasMenuControl
        ? "Confirm by hand that the menu opens and its links are tappable."
        : "Check that hidden navigation is reachable on a phone.",
    });
  }

  return mobileFinding({
    id: "mobile.navigation.present",
    severity: "info",
    status: "pass",
    evidence: [
      measured(
        `${navigation.visibleNavLinks} navigation link(s) are visible in ${navigation.navCount} navigation region(s).`,
      ),
      heuristic("Whether the navigation is comfortable to use was not tested."),
    ],
    explanation:
      "A navigation region was found, and the number of links visible at phone width is not obviously excessive. Whether it is actually comfortable to use was not tested — that is a judgement no automated check can make.",
    recommendation:
      "Open the page on a real device and check the navigation is reachable and tappable.",
  });
}

/**
 * Whether the layout looks broken overall.
 *
 * The most inferential check in the phase, and the one most likely to be wrong,
 * so it only fires when several independent signals agree.
 */
function checkLayoutIntegrity(signals: MobileSignals): Finding | null {
  const signalsAgreeing = [
    signals.horizontalOverflowPx >= SEVERE_OVERFLOW_PX,
    signals.overflowingElementCount >= 3,
    signals.clippedElementCount > 0,
  ].filter(Boolean).length;

  if (signalsAgreeing < 2) return null;

  return mobileFinding({
    id: "mobile.layout.may_be_broken",
    severity: "moderate",
    status: "warn",
    evidence: [
      measured(
        `Overflow of ${Math.round(signals.horizontalOverflowPx)}px, ${signals.overflowingElementCount} element(s) past the edge, ${signals.clippedElementCount} clipped.`,
      ),
      heuristic(
        "Several layout signals point the same way, which usually means the page was not designed for this width.",
      ),
    ],
    explanation:
      "More than one layout measurement is out of range at once, which usually means the page does not have a mobile layout rather than having one small defect. This is an inference — look at the screenshot to judge it.",
    recommendation:
      "Open the page at a phone width and compare it with the screenshot in this report.",
  });
}

/** The standing caveat about what automated mobile checks can establish. */
function limitsFinding(signals: MobileSignals): Finding {
  return mobileFinding({
    id: "mobile.assessment.limits",
    severity: "info",
    status: "could_not_determine",
    evidence: [
      measured(
        `The page was measured at ${signals.viewport.widthPx}x${signals.viewport.heightPx} CSS pixels.`,
      ),
      ...(signals.screenshot.available
        ? [measured("A screenshot of the page at this viewport was captured.")]
        : []),
      heuristic(
        "Usability on a real device depends on touch accuracy, network, gestures and context, none of which were tested.",
      ),
    ],
    explanation:
      "These checks measure layout and sizing at a phone-sized viewport. They cannot establish whether the page is pleasant or even workable to use on a real phone: a page can pass everything here and still be frustrating, and fail several checks while being perfectly usable.",
    recommendation:
      "Treat this section as a list of things worth looking at, then open the page on a real device.",
  });
}

/**
 * Analyze the mobile signals.
 *
 * A missing or failed probe yields one `could_not_determine` finding rather
 * than an empty section, so silence is never mistaken for a good result.
 */
export function analyzeMobile(input: MobileAnalysisInput = {}): Finding[] {
  const { probe } = input;

  if (probe === undefined) {
    return [
      notDetermined({
        code: "probe_failed",
        message: "No mobile measurements were supplied.",
      }),
    ];
  }

  if (!probe.ok) return [notDetermined(probe.failure)];

  const { signals } = probe;
  const layout = checkLayoutIntegrity(signals);

  return [
    checkViewportMeta(signals),
    checkHorizontalOverflow(signals),
    ...(layout === null ? [] : [layout]),
    checkClipping(signals),
    ...checkTapTargets(signals),
    checkTextSize(signals),
    checkNavigation(signals),
    limitsFinding(signals),
  ];
}

const FAILURE_EXPLANATIONS: Readonly<Record<string, string>> = {
  invalid_url: "The URL could not be analyzed, so the page was not measured on mobile.",
  blocked: "The address cannot be analyzed, so the page was not measured on mobile.",
  browser_unavailable:
    "No browser was available to render the page at a mobile viewport, so nothing is claimed about how it behaves on a phone.",
  navigation_failed:
    "The page could not be loaded at a mobile viewport, so no measurements were taken.",
  timeout:
    "The page did not finish loading within its budget, so its mobile layout is unknown.",
  probe_failed:
    "The mobile measurements could not be collected, so nothing is claimed about this page on a phone.",
  browser_error:
    "The mobile check could not run, so nothing is claimed about this page on a phone.",
};

function notDetermined(failure: MobileFailure): Finding {
  return mobileFinding({
    id: `mobile.probe.${failure.code}`,
    severity: "info",
    status: "could_not_determine",
    evidence: [
      measured("The mobile measurement did not run.", preview(failure.message, 200)),
    ],
    explanation:
      FAILURE_EXPLANATIONS[failure.code] ??
      "The mobile check could not run, so nothing is claimed about this page on a phone.",
    recommendation:
      "Re-run the analysis. If it keeps failing, open the page on a phone and check it by hand.",
  });
}
