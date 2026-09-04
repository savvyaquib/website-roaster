/**
 * Phase 11 — UX heuristics.
 *
 * Source of truth: docs/IMPLEMENTATION.md Phase 11, docs/DECISIONS.md ADR-009,
 * ADR-051.
 *
 * Pure: signals in, `Finding[]` out. Deterministic, and **no AI**.
 *
 * ## Every finding here is a heuristic
 *
 * Unlike the security or accessibility phases, nothing this phase concludes is
 * a fact about quality. A page with fourteen navigation links has fourteen
 * navigation links — that is measured. Whether that is *too many* is a
 * judgement, and it is the only kind of judgement this phase makes.
 *
 * So every finding carries **both**:
 *
 * - a `measured` evidence item naming the signal and its value, and
 * - a `heuristic` evidence item stating the inference drawn from it.
 *
 * That pairing is the phase's contract, enforced by test. It is what makes
 * "navigation looks complex" auditable: a reader can see it came from
 * `maxLinksInOneRegion = 14` against a threshold of 12, disagree with the
 * threshold, and still use the number.
 *
 * ## Severity is capped
 *
 * No UX finding is `critical` or `serious`. An inference should not carry the
 * same weight as a missing security header or an unencrypted connection, and
 * capping it here stops Phase 12 weighting guesswork like evidence.
 */

import { findingFactory } from "@/lib/analysis/finding-builder";
import type { Evidence, Finding } from "@/lib/types/finding";

import {
  BUSY_NAVIGATION_LINKS,
  DEEP_DOM_NESTING,
  DEEP_NAVIGATION_NESTING,
  HIGH_INTERACTIVE_DENSITY,
  HIGH_REPETITION,
  LONG_FORM_FIELDS,
  LONG_PAGE_WITHOUT_SUBHEADINGS,
  MANY_PRIMARY_ACTIONS,
  MAX_REPORTED_ITEMS,
  MIN_WORDS_FOR_DENSITY,
} from "./thresholds";
import type { UxAnalysisInput, UxSignals } from "./types";

const uxFinding = findingFactory("ux");

/** The observable signal a finding rests on. */
function signal(summary: string, detail?: string): Evidence {
  return {
    kind: "measured",
    source: "dom",
    summary,
    ...(detail === undefined ? {} : { detail }),
  };
}

/** The inference drawn from that signal. */
function inference(summary: string, detail?: string): Evidence {
  return {
    kind: "heuristic",
    source: "derived",
    summary,
    ...(detail === undefined ? {} : { detail }),
  };
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function checkNavigation(signals: UxSignals): Finding[] {
  const nav = signals.navigation;

  if (nav.regionCount === 0) {
    return [
      uxFinding({
        id: "ux.navigation.none_identified",
        severity: "info",
        status: "could_not_determine",
        evidence: [
          signal(
            "0 navigation regions were found, searching for <nav> elements and role=navigation.",
          ),
          inference(
            "Navigation may exist without markup identifying it, so nothing is concluded about it.",
          ),
        ],
        explanation:
          "No navigation region could be identified, so its complexity was not assessed. This says as much about the markup as about the design.",
        recommendation:
          "Mark the primary navigation with a <nav> element so tools and assistive technology can find it.",
      }),
    ];
  }

  const findings: Finding[] = [];

  if (nav.maxLinksInOneRegion > BUSY_NAVIGATION_LINKS) {
    findings.push(
      uxFinding({
        id: "ux.navigation.busy",
        severity: "minor",
        status: "warn",
        evidence: [
          signal(
            `The busiest navigation region holds ${nav.maxLinksInOneRegion} links, across ${nav.regionCount} region(s) totalling ${nav.totalLinks}.`,
          ),
          inference(
            `More than ${BUSY_NAVIGATION_LINKS} links in one menu is often a sign the navigation has grown rather than been designed — but a documentation site or a large shop legitimately has more.`,
          ),
        ],
        explanation:
          "One navigation region carries a lot of links. That may be exactly right for this site, or it may mean every new page was appended to the menu.",
        recommendation:
          "Check whether the busiest links deserve their place, and whether the rest could be grouped or moved into the page.",
      }),
    );
  } else {
    findings.push(
      uxFinding({
        id: "ux.navigation.manageable",
        severity: "info",
        status: "pass",
        evidence: [
          signal(
            `The busiest navigation region holds ${nav.maxLinksInOneRegion} link(s), nested ${nav.maxNestingDepth} level(s) deep.`,
          ),
          inference(
            "Counts alone say nothing about whether the labels make sense or the ordering is sensible.",
          ),
        ],
        explanation:
          "The navigation is not obviously overloaded by count. Whether it is understandable is a different question, and not one this analyzer answers.",
        recommendation: "Keep the menu from accumulating links as pages are added.",
      }),
    );
  }

  if (nav.maxNestingDepth > DEEP_NAVIGATION_NESTING) {
    findings.push(
      uxFinding({
        id: "ux.navigation.deeply_nested",
        severity: "minor",
        status: "warn",
        evidence: [
          signal(`Navigation lists nest ${nav.maxNestingDepth} level(s) deep.`),
          inference(
            `Beyond ${DEEP_NAVIGATION_NESTING} levels a menu is hard to hold in your head, and harder still to operate on a touchscreen.`,
          ),
        ],
        explanation:
          "The navigation nests deeply. Deep menus tend to hide their lower levels from anyone not already sure what they are looking for.",
        recommendation:
          "Consider flattening the deepest levels, or surfacing them on a landing page instead.",
      }),
    );
  }

  if (nav.duplicateDestinations > 0) {
    findings.push(
      uxFinding({
        id: "ux.navigation.duplicate_destinations",
        severity: "minor",
        status: "warn",
        evidence: [
          signal(
            `${nav.duplicateDestinations} navigation link(s) point at a destination another already covers.`,
          ),
          inference(
            "Duplicates are often deliberate — a logo and a Home link both point at the root — so this is a prompt to look rather than a defect.",
          ),
        ],
        explanation:
          "Some navigation links lead to the same place. That is normal for a logo, and wasteful when it is two menu entries.",
        recommendation: "Check the duplicates are intentional rather than accumulated.",
      }),
    );
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Primary actions
// ---------------------------------------------------------------------------

function checkPrimaryActions(signals: UxSignals): Finding {
  const { actions } = signals;

  const measurement = signal(
    `${actions.candidateActions} candidate action(s): ${actions.buttons} button(s) and ${actions.buttonStyledLinks} button-styled link(s). ${actions.primaryStyled} are styled as primary.`,
  );

  if (actions.candidateActions === 0) {
    return uxFinding({
      id: "ux.actions.none_identified",
      severity: "minor",
      status: "warn",
      evidence: [
        signal("0 buttons and 0 button-styled links were found."),
        inference(
          "Actions are recognised from markup and class names, so a control styled another way would be missed entirely.",
        ),
      ],
      explanation:
        "Nothing was identified as an action a visitor could take. The page may genuinely offer none, or may present them in a way this detection does not recognise.",
      recommendation:
        "If the page has a primary action, make it a <button> or give it button styling so it reads as one.",
    });
  }

  if (actions.candidateActions > MANY_PRIMARY_ACTIONS) {
    return uxFinding({
      id: "ux.actions.many_competing",
      severity: "moderate",
      status: "warn",
      evidence: [
        measurement,
        inference(
          `Beyond ${MANY_PRIMARY_ACTIONS} candidate actions it is unlikely one is visually dominant — though a pricing page with a button per plan is a fair exception.`,
        ),
      ],
      explanation:
        "The page offers many things to click that all look like actions. When everything is emphasised, nothing is, and the visitor is left to choose their own path.",
      recommendation:
        "Decide which single action matters most and let the others recede visually.",
    });
  }

  if (actions.primaryStyled === 0) {
    return uxFinding({
      id: "ux.actions.none_emphasised",
      severity: "minor",
      status: "warn",
      evidence: [
        measurement,
        inference(
          "Emphasis is detected from class names containing 'primary', 'main' or 'hero', which many design systems do not use.",
        ),
      ],
      explanation:
        "Actions were found, but none is marked as the primary one in its class names. That may mean emphasis is applied some other way, or that no action is emphasised at all.",
      recommendation: "Check visually that one action stands out from the rest.",
    });
  }

  return uxFinding({
    id: "ux.actions.focused",
    severity: "info",
    status: "pass",
    evidence: [
      measurement,
      inference(
        "Counting actions says nothing about whether the right one is emphasised, or whether its label is clear.",
      ),
    ],
    explanation:
      "The page offers a manageable number of actions and marks at least one as primary.",
    recommendation: "Keep one action dominant as the page grows.",
  });
}

// ---------------------------------------------------------------------------
// Density
// ---------------------------------------------------------------------------

function checkDensity(signals: UxSignals): Finding {
  const { density } = signals;

  if (
    density.wordCount < MIN_WORDS_FOR_DENSITY ||
    density.interactivePer100Words === null
  ) {
    return uxFinding({
      id: "ux.density.not_meaningful",
      severity: "info",
      status: "could_not_determine",
      evidence: [
        signal(
          `The page has ${density.wordCount} word(s) and ${density.interactiveElements} interactive element(s).`,
        ),
        inference(
          `Below ${MIN_WORDS_FOR_DENSITY} words the ratio swings wildly on small changes, so it is not reported.`,
        ),
      ],
      explanation:
        "There is too little text for an interactive-density ratio to mean anything.",
      recommendation: "No action from this signal; judge the page's balance by eye.",
    });
  }

  const measurement = signal(
    `${density.interactivePer100Words} interactive element(s) per 100 words (${density.interactiveElements} elements, ${density.wordCount} words).`,
    `${density.linksPer100Words} link(s) per 100 words.`,
  );

  if (density.interactivePer100Words > HIGH_INTERACTIVE_DENSITY) {
    return uxFinding({
      id: "ux.density.high",
      severity: "minor",
      status: "warn",
      evidence: [
        measurement,
        inference(
          `Above about ${HIGH_INTERACTIVE_DENSITY} per 100 words a page reads more like an index than something to read — which is correct for a hub or category page and wrong for an article.`,
        ),
      ],
      explanation:
        "There is a lot to click relative to how much there is to read. Whether that is right depends entirely on what kind of page this is.",
      recommendation:
        "If this is meant to be read rather than navigated, consider moving some links out of the body.",
    });
  }

  return uxFinding({
    id: "ux.density.balanced",
    severity: "info",
    status: "pass",
    evidence: [
      measurement,
      inference("A ratio says nothing about whether the links are well placed."),
    ],
    explanation: "The balance of things to click and things to read is unremarkable.",
    recommendation: "No action from this signal.",
  });
}

// ---------------------------------------------------------------------------
// Hierarchy
// ---------------------------------------------------------------------------

function checkHeadingHierarchy(signals: UxSignals): Finding[] {
  const { headings, density } = signals;
  const findings: Finding[] = [];

  const outline = signal(
    `${headings.total} heading(s): ${headings.countsByLevel.map((count, index) => `h${index + 1}=${count}`).join(", ")}.`,
  );

  if (headings.total === 0) {
    return [
      uxFinding({
        id: "ux.hierarchy.no_headings",
        severity: "moderate",
        status: "warn",
        evidence: [
          signal(`The page has no headings and ${density.wordCount} word(s) of text.`),
          inference(
            "Without headings there is no outline to skim, which matters more the longer the page is.",
          ),
        ],
        explanation:
          "The page has no headings at all, so there is no structure for a reader to skim or for assistive technology to navigate by.",
        recommendation: "Break the content up with headings that name each part.",
      }),
    ];
  }

  if (headings.skippedLevels > 0) {
    findings.push(
      uxFinding({
        id: "ux.hierarchy.skipped_levels",
        severity: "minor",
        status: "warn",
        evidence: [
          outline,
          signal(`The outline jumps a level ${headings.skippedLevels} time(s).`),
          inference(
            "A jumped level usually means headings were chosen for their size rather than their place in the structure.",
          ),
        ],
        explanation:
          "The heading outline skips levels. That is often a styling decision rather than a structural one, and it leaves the document outline misleading.",
        recommendation: "Choose heading levels by structure and set their size with CSS.",
      }),
    );
  }

  const onlyTopLevel = headings.total > 0 && (headings.countsByLevel[1] ?? 0) === 0;

  if (onlyTopLevel && density.wordCount > LONG_PAGE_WITHOUT_SUBHEADINGS) {
    findings.push(
      uxFinding({
        id: "ux.hierarchy.flat",
        severity: "minor",
        status: "warn",
        evidence: [
          outline,
          signal(`The page has ${density.wordCount} words and no <h2>.`),
          inference(
            `Past roughly ${LONG_PAGE_WITHOUT_SUBHEADINGS} words, a page with no subheadings is hard to skim.`,
          ),
        ],
        explanation:
          "The page is reasonably long but has no second-level headings, so it reads as one undifferentiated block.",
        recommendation: "Add subheadings so a reader can find the part they want.",
      }),
    );
  }

  if (findings.length === 0) {
    findings.push(
      uxFinding({
        id: "ux.hierarchy.consistent",
        severity: "info",
        status: "pass",
        evidence: [
          outline,
          inference(
            "A well-formed outline says nothing about whether the headings are informative.",
          ),
        ],
        explanation: "The heading outline descends without skipping levels.",
        recommendation: "Keep the outline in order as sections are added.",
      }),
    );
  }

  return findings;
}

function checkContentHierarchy(signals: UxSignals): Finding[] {
  const { hierarchy } = signals;
  const findings: Finding[] = [];

  if (!hierarchy.hasMainLandmark) {
    findings.push(
      uxFinding({
        id: "ux.hierarchy.no_main_landmark",
        severity: "minor",
        status: "warn",
        evidence: [
          signal(
            `No <main> element. The page uses ${hierarchy.landmarkCount} landmark element(s) in total.`,
          ),
          inference(
            "A page can be perfectly clear to a sighted reader without one; the cost falls on people navigating by landmark.",
          ),
        ],
        explanation:
          "There is no <main> element marking the primary content, so anyone navigating by landmark has no way to skip straight to it.",
        recommendation: "Wrap the primary content in a <main> element.",
      }),
    );
  }

  if (hierarchy.maxDomDepth > DEEP_DOM_NESTING) {
    findings.push(
      uxFinding({
        id: "ux.hierarchy.deep_dom",
        severity: "minor",
        status: "warn",
        evidence: [
          signal(`The deepest element nesting is ${hierarchy.maxDomDepth} levels.`),
          inference(
            `Beyond about ${DEEP_DOM_NESTING} levels the markup is usually generated or heavily wrapped, which tends to cost rendering performance and make styling brittle.`,
          ),
        ],
        explanation:
          "The document nests deeply. This is a signal about how the page is built rather than how it looks, and deep trees are slower to lay out.",
        recommendation:
          "If the depth comes from wrapper elements, see whether some can be removed.",
      }),
    );
  }

  if (findings.length === 0) {
    findings.push(
      uxFinding({
        id: "ux.hierarchy.structured",
        severity: "info",
        status: "pass",
        evidence: [
          signal(
            `${hierarchy.landmarkCount} landmark(s), ${hierarchy.paragraphCount} paragraph(s), ${hierarchy.listCount} list(s), nesting ${hierarchy.maxDomDepth} deep.`,
          ),
          inference(
            "Structural markup being present says nothing about whether the reading order makes sense.",
          ),
        ],
        explanation: "The page uses landmark elements and is not deeply nested.",
        recommendation: "Keep using landmarks as the page grows.",
      }),
    );
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Forms and repetition
// ---------------------------------------------------------------------------

function checkForms(signals: UxSignals): Finding {
  const { forms } = signals;

  if (forms.formCount === 0) {
    return uxFinding({
      id: "ux.forms.none",
      severity: "info",
      status: "pass",
      evidence: [
        signal("The page has 0 forms."),
        inference("Nothing follows from this; many pages need none."),
      ],
      explanation: "There are no forms whose complexity could be assessed.",
      recommendation: "No action from this signal.",
    });
  }

  const measurement = signal(
    `${forms.formCount} form(s), ${forms.totalFields} field(s) in total, ${forms.maxFieldsInOneForm} in the longest, ${forms.requiredFields} required.`,
  );

  if (forms.formsWithoutSubmit > 0) {
    return uxFinding({
      id: "ux.forms.no_submit_control",
      severity: "moderate",
      status: "warn",
      evidence: [
        measurement,
        signal(`${forms.formsWithoutSubmit} form(s) have no submit control.`),
        inference(
          "A form can be submitted by script or by pressing Enter, so this is a prompt to check rather than proof it is broken.",
        ),
      ],
      explanation:
        "A form has no obvious way to submit it. That is sometimes handled by script, and sometimes simply missing.",
      recommendation:
        "Give every form a visible submit control, so it works without relying on script.",
    });
  }

  if (forms.maxFieldsInOneForm > LONG_FORM_FIELDS) {
    return uxFinding({
      id: "ux.forms.long",
      severity: "minor",
      status: "warn",
      evidence: [
        measurement,
        inference(
          `Beyond about ${LONG_FORM_FIELDS} fields, completion rates usually drop — though an application form has to ask what it has to ask.`,
        ),
      ],
      explanation:
        "One form asks for a lot. Every field is a reason to abandon it, which matters more the earlier in a relationship the form sits.",
      recommendation:
        "Check each field is needed now rather than later, and consider splitting the form into steps.",
    });
  }

  return uxFinding({
    id: "ux.forms.reasonable",
    severity: "info",
    status: "pass",
    evidence: [
      measurement,
      inference(
        "Field counts say nothing about whether the labels are clear or the errors are helpful.",
      ),
    ],
    explanation: "The forms on this page are not unusually long.",
    recommendation: "Keep asking only for what you need at this point.",
  });
}

function checkRepetition(signals: UxSignals): Finding {
  const { repetition } = signals;

  if (repetition.maxRepetition < HIGH_REPETITION) {
    return uxFinding({
      id: "ux.repetition.unremarkable",
      severity: "info",
      status: "pass",
      evidence: [
        signal(
          `The most repeated block appears ${repetition.maxRepetition} time(s).`,
          repetition.repeatedBlocks
            .slice(0, MAX_REPORTED_ITEMS)
            .map((block) => `${block.signature} x${block.count}`)
            .join(", "),
        ),
        inference(
          "Blocks are matched by tag and first class name, so a component using varied classes will not register as repeated.",
        ),
      ],
      explanation: "No single component dominates the page.",
      recommendation: "No action from this signal.",
    });
  }

  return uxFinding({
    id: "ux.repetition.dominant_component",
    severity: "minor",
    status: "warn",
    evidence: [
      signal(
        `One block appears ${repetition.maxRepetition} times.`,
        repetition.repeatedBlocks
          .slice(0, MAX_REPORTED_ITEMS)
          .map((block) => `${block.signature} x${block.count}`)
          .join(", "),
      ),
      ...(repetition.repeatedLinkTexts.length > 0
        ? [
            signal(
              "Link labels are reused.",
              repetition.repeatedLinkTexts
                .slice(0, MAX_REPORTED_ITEMS)
                .map((link) => `"${link.signature}" x${link.count}`)
                .join(", "),
            ),
          ]
        : []),
      inference(
        `Repeating one component more than ${HIGH_REPETITION} times usually means a listing page, which is fine — it only reads as a problem when the repetition is the whole page and nothing distinguishes the items.`,
      ),
    ],
    explanation:
      "The page is largely one component repeated. On a catalogue or a feed that is exactly right; elsewhere it can mean the page has length without substance.",
    recommendation:
      "If this is a listing, check the items are distinguishable at a glance.",
  });
}

/** The standing caveat about what counting can establish. */
function limitsFinding(signals: UxSignals): Finding {
  return uxFinding({
    id: "ux.assessment.limits",
    severity: "info",
    status: "could_not_determine",
    evidence: [
      signal(
        `Signals were counted from the document: ${signals.navigation.totalLinks} navigation link(s), ${signals.actions.candidateActions} action(s), ${signals.headings.total} heading(s), ${signals.forms.formCount} form(s).`,
      ),
      inference(
        "Nothing here observes a person using the page. Visual hierarchy, clarity of language, whether the layout guides the eye, and whether the page achieves what it is for are all outside what counting can reach.",
      ),
    ],
    explanation:
      "Every finding in this section is inferred from counting elements. None of it establishes whether the page is actually good to use — a well-designed page can trip several of these thresholds, and a poor one can trip none.",
    recommendation:
      "Treat this section as prompts for a human to look at, not as a verdict.",
  });
}

/**
 * Analyze the UX signals.
 *
 * Every finding carries the measurement it rests on and the inference drawn
 * from it. Produces no score: Phase 12 does that, and ADR-037 has already
 * flagged that this category's weight needs a product decision before it does.
 */
export function analyzeUx(input: UxAnalysisInput): Finding[] {
  const { signals } = input;

  return [
    ...checkNavigation(signals),
    checkPrimaryActions(signals),
    ...checkHeadingHierarchy(signals),
    ...checkContentHierarchy(signals),
    checkDensity(signals),
    checkForms(signals),
    checkRepetition(signals),
    limitsFinding(signals),
  ];
}
