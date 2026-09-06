/**
 * Written punchlines, for when there is no model.
 *
 * Source of truth: ADR-015, ADR-056.
 *
 * ## These are jokes about a fact, never statements of one
 *
 * A template is paired with an observation taken from the finding itself, so
 * the template never has to say what happened — only what it thinks of it.
 * That is why none of them contain a number, a measurement or a claim: the
 * factual half of every line comes from the analyzer, and a template that
 * repeated it could be wrong about a page it has never seen.
 *
 * ## Tone
 *
 * ADR-015: humorous, concise, evidence-based, relevant, **non-abusive**. Every
 * line here is about the website. None is about the person who built it, and a
 * test asserts none of them contains an insult aimed at a person.
 *
 * ## Coverage is deliberately incomplete
 *
 * There is no template for most finding ids, and there does not need to be:
 * anything unmatched falls through to a category line, and anything with no
 * category line falls through to a severity line. A roast is a few lines, so
 * the specific templates only have to cover the problems that come up often.
 */

import type { AnalysisCategory, Finding, FindingSeverity } from "@/lib/types/finding";

/**
 * Punchlines for specific findings.
 *
 * Keyed by the exact finding id, so a wording change in an analyzer cannot
 * silently repoint one of these at a different problem.
 */
export const SPECIFIC_PUNCHLINES: Readonly<Record<string, string>> = {
  // SEO
  "seo.title.missing":
    "A bold choice: a page that declines to introduce itself, then waits to be found.",
  "seo.title.too_short": "Brevity is a virtue. This is closer to a shrug.",
  "seo.title.too_long":
    "Search results will read the first half and quietly lose interest, much like anyone else.",
  "seo.description.missing":
    "Search engines will now write your pitch for you, using whatever they find lying around.",
  "seo.description.too_short": "The elevator pitch ends before the doors close.",
  "seo.description.too_long":
    "Somewhere in there is a good sentence. It has been given roommates.",
  "seo.headings.none":
    "No headings at all — the reader is invited to discover the structure through faith.",
  "seo.headings.skipped_level":
    "The outline takes a running jump over a level, which is fine if nobody is following along.",
  "seo.canonical.missing":
    "Every URL variant is now equally official, which is the same as none of them being.",
  "seo.robots_meta.noindex":
    "A page carefully built, then asked to be invisible. Somebody's staging config lives on.",
  "seo.viewport.missing":
    "Phones will do their best impression of a desktop, and everyone will squint through it.",

  // Content
  "content.headline.missing":
    "The page opens with no clear statement of what it is. A confident silence.",
  "content.cta.none":
    "It makes its case, and then simply stops. No ask, no next step, no exit.",
  "content.cta.many_choices":
    "Apparently the design strategy is to let the visitor choose their own destiny.",
  "content.cta.repetitive":
    "The same button, repeatedly, in case the visitor forgot in the last four inches.",
  "content.depth.thin":
    "Not much to read here. Confidence is admirable; explanation is also nice.",
  "content.depth.light": "It says something, briefly, and hopes that will do.",
  "content.supporting_copy.missing":
    "The headline arrives alone, having invited nothing to back it up.",
  "content.supporting_copy.meta_only":
    "The only supporting copy is a meta tag, which is a lovely thing that nobody reads.",
  "content.contact.none_found":
    "There is no way to get in touch, which does simplify the inbox considerably.",
  "content.footer.missing":
    "The page ends the way it began: abruptly, and with no forwarding address.",
  "content.metadata.generic":
    "The placeholder text made it to production, where it is doing exactly as much as expected.",
  "content.trust.none_detected":
    "No testimonials, no logos, no proof — the visitor is asked to take it on trust alone.",

  // UX
  "ux.navigation.busy":
    "Every link received an invitation. Nobody checked the room's capacity.",
  "ux.navigation.deeply_nested":
    "The menu has a menu. Somewhere down there is the page someone actually wanted.",
  "ux.navigation.duplicate_destinations":
    "Several roads, one destination — a generous approach to the visitor's time.",
  "ux.navigation.none_identified":
    "There is no navigation to speak of. Every visitor is a pioneer.",
  "ux.actions.many_competing":
    "Everything is the most important thing, which is a strategy in the same way shouting is.",
  "ux.actions.none_emphasised": "Nothing stands out, so everything is equally ignorable.",
  "ux.actions.none_identified":
    "No buttons, no emphasis, no obvious next step — the page ends and the visitor is on their own.",
  "ux.hierarchy.no_headings":
    "One continuous wall of text. Skimming is not an option; neither, increasingly, is reading.",
  "ux.hierarchy.skipped_levels":
    "The outline jumps a level, which is fine as long as nobody relies on the outline.",
  "ux.forms.no_submit_control":
    "A form with no way to submit it. Truly the purest expression of a dead end.",
  "ux.hierarchy.flat":
    "One long undifferentiated stretch of page. The eye has nowhere to land.",
  "ux.hierarchy.deep_dom":
    "The markup nests like a set of Russian dolls, each one adding nothing.",
  "ux.hierarchy.no_main_landmark":
    "No main landmark, so assistive technology gets to guess where the page begins.",
  "ux.forms.long":
    "The form asks a great many questions before offering anything in return.",
  "ux.repetition.dominant_component":
    "One component, repeated with conviction, doing most of the page's talking.",
  "ux.density.high":
    "A great deal is happening per square inch, and all of it wants attention.",

  // Mobile
  "mobile.overflow.horizontal":
    "Sideways scrolling: the interaction absolutely nobody has ever asked for.",
  "mobile.viewport.missing":
    "No viewport tag, so phones will render this at desktop width and let the visitor pinch.",
  "mobile.viewport.restrictive":
    "Zooming has been disabled, which is a decision with victims.",
  "mobile.tap_targets.below_minimum":
    "Some targets are too small to hit reliably, turning the page into a dexterity test.",
  "mobile.tap_targets.tight":
    "The buttons are close enough together to make every tap a small gamble.",
  "mobile.text.small":
    "The text is small enough that reading it counts as an eye exercise.",
  "mobile.clipping.content_hidden":
    "Some of the page is off the edge, keeping its contents to itself.",
  "mobile.navigation.not_found":
    "No mobile navigation was found, so the phone visitor may simply live here now.",
  "mobile.layout.may_be_broken":
    "The mobile layout appears to have given up partway through.",

  // Security
  "security.https.absent": "Plain HTTP, in this decade, is period costume.",
  "security.hsts.absent": "No HSTS, so the first visit is an act of optimism.",
  "security.csp.absent":
    "No content security policy — every script is welcome, no questions at the door.",
  "security.csp.unsafe_script_sources":
    "The policy exists and then waves through the exact things it was written to stop.",
  "security.cookies.missing_secure":
    "The cookies are willing to travel in plain sight, which is generous of them.",
  "security.cookies.missing_httponly":
    "The cookies are readable by any script that asks nicely.",
  "security.content_type_options.absent":
    "Browsers are invited to guess what your files are. They will guess wrong eventually.",
  "security.frame_protection.absent":
    "Nothing stops another site framing this one, which is an interesting kind of hospitality.",
  "security.disclosure.server_version":
    "The server announces its exact version to anyone who asks, like a name badge at a conference.",
  "security.referrer_policy.permissive":
    "Every outbound link carries the full URL along for company.",

  // Accessibility
  "accessibility.axe.image-alt":
    "Images with nothing to say to anyone who cannot see them.",
  "accessibility.axe.color-contrast":
    "The colours are subtle. So subtle that reading them is optional.",
  "accessibility.axe.label":
    "Form fields with no labels, so screen readers get to improvise.",
  "accessibility.axe.link-name": "Links that go somewhere, without mentioning where.",
  "accessibility.axe.html-has-lang":
    "No declared language, so a screen reader will pick an accent and commit to it.",
};

/** Punchlines by category, when nothing more specific matched. */
export const CATEGORY_PUNCHLINES: Readonly<Record<AnalysisCategory, string>> = {
  seo: "Search engines will do their best with this, which is not the same as doing well.",
  content: "The page has something to say and has not quite got around to saying it.",
  ux: "The layout technically works. Working and helping are different jobs.",
  mobile: "On a phone, this asks rather more of the visitor than it needs to.",
  security: "The configuration leaves a door unlatched. Not open — unlatched.",
  accessibility:
    "Some visitors will find this harder than it needs to be, which is the whole problem.",
  performance: "The page gets there. It takes the scenic route.",
};

/** Last resort, by severity. Nothing gets no line for want of a template. */
export const SEVERITY_PUNCHLINES: Readonly<Record<FindingSeverity, string>> = {
  critical: "This one is not a nitpick. It is the sort of thing that costs visitors.",
  serious: "Worth fixing before it becomes the reason someone leaves.",
  moderate: "Not urgent, but it is quietly working against the page.",
  minor: "A small thing, mentioned only because everything else was covered.",
  info: "Noted, without enthusiasm.",
};

/**
 * The punchline for a finding.
 *
 * Specific first, then category, then severity. Always returns something: a
 * roast with a hole in it is worse than a roast with a general line in it.
 */
export function punchlineFor(finding: Finding): string {
  return (
    SPECIFIC_PUNCHLINES[finding.id] ??
    CATEGORY_PUNCHLINES[finding.category] ??
    SEVERITY_PUNCHLINES[finding.severity]
  );
}
