/**
 * Values the security checks compare against.
 *
 * Kept apart from the checks so they can be reviewed without reading the logic,
 * the same way the SEO thresholds are.
 */

/**
 * Minimum HSTS lifetime before the header is considered properly configured.
 *
 * Six months. Shorter values are valid and still helpful; this is the point
 * below which the protection lapses often enough to be worth mentioning.
 */
export const HSTS_MIN_MAX_AGE_SECONDS = 15_768_000;

/**
 * CSP script sources that permit inline or dynamically evaluated code.
 *
 * A policy containing these blocks much less than its presence suggests, which
 * is why they are reported rather than treated as a configured policy.
 */
export const RISKY_CSP_SOURCES: readonly string[] = [
  "unsafe-inline",
  "unsafe-eval",
  "unsafe-hashes",
];

/**
 * Referrer policies that send the full URL to other origins.
 *
 * `no-referrer-when-downgrade` was the historical browser default and is
 * included because it still leaks the full path cross-origin over HTTPS.
 */
export const UNSAFE_REFERRER_POLICIES: readonly string[] = [
  "unsafe-url",
  "no-referrer-when-downgrade",
];

/** Headers that name the framework or runtime behind a site. */
export const TECHNOLOGY_HEADERS: readonly string[] = [
  "x-powered-by",
  "x-aspnet-version",
  "x-aspnetmvc-version",
  "x-generator",
  "x-drupal-cache",
];

/**
 * A version number in a header value, e.g. `nginx/1.24.0`.
 *
 * A bare product name is not reported; a version is, because it turns "what is
 * this running?" into "which published vulnerabilities apply?".
 */
export const VERSION_PATTERN = /\d+\.\d+/;
