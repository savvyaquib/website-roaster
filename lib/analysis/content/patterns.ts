/**
 * The patterns and thresholds the content extractor matches on.
 *
 * Source of truth: docs/DECISIONS.md ADR-050.
 *
 * Kept in one place so the guesswork is visible and reviewable. Everything here
 * is English-only and pattern-based, which is precisely why anything detected
 * through it is marked `inferred` rather than presented as a fact.
 */

/** Verbs and phrases that usually introduce an action. */
export const CTA_TEXT_PATTERNS: readonly {
  readonly name: string;
  readonly pattern: RegExp;
}[] = [
  { name: "get started", pattern: /\b(get|getting)\s+started\b/i },
  { name: "sign up", pattern: /\bsign\s*up\b/i },
  { name: "sign in", pattern: /\b(sign|log)\s*in\b/i },
  { name: "try", pattern: /\btry\s+(it|for|free|now)\b/i },
  { name: "free trial", pattern: /\bfree\s+trial\b/i },
  { name: "buy", pattern: /\b(buy|purchase|order)\b/i },
  { name: "demo", pattern: /\b(request|get|book)\s+a?\s*demo\b/i },
  { name: "book", pattern: /\b(book|schedule|reserve)\b/i },
  { name: "contact", pattern: /\bcontact\s+(us|sales|me)\b/i },
  { name: "download", pattern: /\bdownload\b/i },
  { name: "subscribe", pattern: /\bsubscribe\b/i },
  { name: "learn more", pattern: /\blearn\s+more\b/i },
  { name: "add to cart", pattern: /\badd\s+to\s+(cart|basket|bag)\b/i },
  { name: "join", pattern: /\bjoin\s+(us|now|free|today)\b/i },
  { name: "start free", pattern: /\bstart\s+(free|now|today)\b/i },
];

/** Class and attribute fragments that mark an element as a button visually. */
export const CTA_CLASS_PATTERN = /\b(btn|button|cta|call-to-action)\b/i;

/** Heading wording that classifies a section. */
export const SECTION_HEADING_PATTERNS: readonly {
  readonly kind: "features" | "pricing" | "testimonials" | "faq" | "contact" | "about";
  readonly pattern: RegExp;
}[] = [
  { kind: "pricing", pattern: /\b(pricing|plans?|packages?|subscriptions?|cost)\b/i },
  {
    kind: "testimonials",
    pattern:
      /\b(testimonials?|reviews?|what\s+.{0,20}\s*say|customers?\s+say|loved\s+by)\b/i,
  },
  {
    kind: "faq",
    pattern: /\b(faq|frequently\s+asked|common\s+questions?|questions?)\b/i,
  },
  {
    kind: "features",
    pattern:
      /\b(features?|what\s+you\s+get|benefits?|why\s+|how\s+it\s+works|capabilit)/i,
  },
  { kind: "contact", pattern: /\b(contact|get\s+in\s+touch|reach\s+us|support)\b/i },
  { kind: "about", pattern: /\b(about|our\s+story|who\s+we\s+are|team)\b/i },
];

/** A currency amount, which is the strongest non-heading signal for pricing. */
export const PRICE_PATTERN =
  /(?:[$£€¥]\s?\d[\d.,]*)|(?:\b\d[\d.,]*\s?(?:USD|GBP|EUR|usd|gbp|eur)\b)/;

/** Recurring-billing wording, which distinguishes pricing from a shop listing. */
export const BILLING_PERIOD_PATTERN =
  /\bper\s+(month|year|user|seat)\b|\/\s?(mo|month|yr|year|user)\b|\bmonthly\b|\bannually\b/i;

/** Wording used to vouch for something. */
export const TRUST_PATTERNS: readonly {
  readonly name: string;
  readonly pattern: RegExp;
}[] = [
  { name: "trusted by", pattern: /\btrusted\s+by\b/i },
  { name: "used by", pattern: /\b(used|loved)\s+by\s+\d/i },
  {
    name: "customer count",
    // An adjective between the number and the noun is ordinary English —
    // "4,000 engineering teams" — and a stricter pattern misses it.
    pattern:
      /\b\d[\d,.]*\+?\s+(?:\w+\s+)?(customers?|users?|companies|teams|businesses)\b/i,
  },
  { name: "rating", pattern: /\b\d(?:\.\d)?\s*(?:\/\s*5|out\s+of\s+5|stars?)\b/i },
  { name: "as seen in", pattern: /\bas\s+(seen|featured)\s+(in|on)\b/i },
  { name: "certification", pattern: /\b(iso\s?\d+|soc\s?2|gdpr\s+compliant|hipaa)\b/i },
  { name: "award", pattern: /\b(award[- ]winning|winner\s+of)\b/i },
];

/** Email address in page text. Deliberately conservative. */
export const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/**
 * Phone number in page text.
 *
 * The loosest pattern here by far, and the most likely to produce a false
 * positive on a long number. Anything it finds is `inferred`.
 */
export const PHONE_PATTERN =
  /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}(?:[\s.-]?\d{2,4})?/g;

/** Hosts recognised as social profiles. */
export const SOCIAL_HOSTS: readonly string[] = [
  "twitter.com",
  "x.com",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "youtube.com",
  "github.com",
  "tiktok.com",
  "mastodon.social",
  "bsky.app",
  "threads.net",
];

/** Link text or destination indicating a contact route. */
export const CONTACT_LINK_PATTERN = /\b(contact|support|help|get[- ]in[- ]touch)\b/i;

/** A copyright notice. */
export const COPYRIGHT_PATTERN = /(?:©|&copy;|\(c\)|\bcopyright\b)/i;

/** Titles and descriptions that say nothing about the page. */
export const GENERIC_METADATA_PATTERNS: readonly {
  readonly name: string;
  readonly pattern: RegExp;
}[] = [
  { name: "home", pattern: /^(home|homepage|index|main)\s*$/i },
  { name: "welcome", pattern: /^welcome(\s+to\s+(our\s+)?(website|site|page))?\s*$/i },
  { name: "untitled", pattern: /^(untitled|new page|document|page)\s*$/i },
  {
    name: "framework default",
    pattern: /^(create next app|react app|vite app|my app|next\.js)/i,
  },
  { name: "placeholder", pattern: /\b(lorem ipsum|coming soon|under construction)\b/i },
];

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/** Below this, a page has almost nothing to read. */
export const THIN_CONTENT_WORDS = 100;

/** Below this, a page is short but not empty. */
export const LIGHT_CONTENT_WORDS = 300;

/** Minimum words for a paragraph to count as supporting copy rather than a label. */
export const MIN_SUPPORTING_COPY_WORDS = 4;

/**
 * Distinct calls to action above which a page is offering a lot of choices.
 *
 * A guideline, not a rule: a pricing page legitimately has one button per plan.
 */
export const MANY_DISTINCT_CTAS = 5;

/** Repetitions of the same CTA label above which it looks duplicated. */
export const CTA_REPETITION_LIMIT = 4;

/** Upper bound on items listed inside one finding. */
export const MAX_REPORTED_ITEMS = 5;
