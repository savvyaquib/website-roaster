# Website Roaster — Implementation Plan

## Purpose

This document defines the implementation sequence for Website Roaster.

Claude Code must implement these milestones sequentially.

Do not skip ahead.

---

# PRODUCT VISION

A user enters a public website URL.

The application analyzes the page and produces:

```text
Overall Website Quality Score
├── Performance
├── SEO
├── Accessibility
├── Mobile
├── Security
├── Content
└── UX
```

The report also contains:

```text
Strengths
Problems
Evidence
Recommendations
AI interpretation
Humorous roast
```

---

# DEVELOPMENT PHASES

## Phase 0 — Repository Foundation

### Goal

Create the project skeleton and engineering foundation.

### Tasks

- initialize repository
- configure TypeScript
- configure linting
- configure formatting
- establish environment-variable handling
- establish application structure
- establish test framework
- create documentation structure
- establish shared types

### Must NOT build

- analyzer
- crawler
- AI
- scoring
- authentication
- payments

### Acceptance criteria

The repository:

- installs successfully
- starts locally
- passes type checking
- passes linting
- runs tests
- has clear folder boundaries

---

# Phase 1 — URL Validation

### Goal

Accept a URL safely and validate it before any network request occurs.

### Input

```ts
{
  url: string
}
```

### Validate

- protocol
- hostname
- malformed URLs
- unsupported protocols
- localhost
- loopback addresses
- private networks
- link-local addresses
- metadata endpoints
- dangerous hostname patterns

### Output

Either:

```ts
{
  valid: true,
  normalizedUrl: string
}
```

or:

```ts
{
  valid: false,
  reason: string
}
```

### Tests

Include malicious and unusual URLs.

Examples:

```text
https://example.com
http://example.com
localhost
http://127.0.0.1
http://169.254.169.254
http://192.168.1.1
http://10.0.0.1
```

### Acceptance criteria

No network request happens before validation succeeds.

### Scope limit

This phase does NOT close the SSRF risk on its own.

It covers only the submitted URL string. Address pinning, per-hop redirect
validation and browser network isolation belong to Phases 2 and 3.

Read ADR-035 before implementing this phase.

---

# Phase 2 — Basic HTTP Analyzer

### Goal

Retrieve a public website and collect fundamental information.

### Collect

- final URL
- HTTP status
- response headers
- content type
- response size
- redirect chain
- timing information
- HTML

### Must support

- timeout
- maximum response size
- redirect limits
- network failure
- non-HTML responses
- 4xx
- 5xx

### Acceptance criteria

A valid public HTML page can be analyzed.

Failure states are explicit and testable.

Per ADR-035, this phase also owns:

- resolving the hostname and validating every resolved address
- pinning the connection to a validated address (DNS rebinding defence)
- re-validating every redirect hop against the Phase 1 rules

---

# Phase 3 — Browser Analyzer

### Goal

Use a real browser to render the page.

### Collect

- screenshot
- page title
- viewport rendering
- console errors
- network requests
- navigation timing
- DOM information

Run at least:

```text
Desktop viewport
Mobile viewport
```

### Acceptance criteria

The analyzer can render a public website reliably and produce screenshots.

Browser resources are always cleaned up.

### Constraints

Use Playwright (ADR-033).

The browser module must expose a connection endpoint, not only a page handle,
because Phase 8 attaches Lighthouse to the same browser process.

Every request the rendered page makes is checked against the same policy the
HTTP analyzer uses, and refused if it points anywhere we would not go
ourselves (ADR-042).

That guard is defence in depth, NOT isolation: Chromium resolves DNS itself, so
the rebinding window Phase 2 closes by pinning cannot be closed in application
code. True isolation is a deployment control — a container with no route to
private ranges, or an egress firewall — and is a Phase 20 prerequisite before
the analyzer is exposed publicly.

---

# Phase 4 — DOM Analyzer

### Goal

Extract structured page information.

Create a normalized representation such as:

```ts
interface PageData {
  url: string
  title: string | null
  description: string | null
  headings: HeadingData[]
  links: LinkData[]
  images: ImageData[]
  forms: PageFormData[]
  scripts: ScriptData[]
  stylesheets: StylesheetData[]
  htmlLanguage: string | null
}
```

Do not couple this representation to the UI.

Note: the form type is `PageFormData`, not `FormData`. `FormData` is a DOM
global and declaring a local interface of that name shadows it.

### Acceptance criteria

Analyzer output is deterministic for the same page state.

---

# Phase 5 — SEO Analyzer

### Goal

Evaluate technical SEO fundamentals.

### Initial checks

- title exists
- title length
- meta description exists
- heading structure
- H1 presence
- canonical
- robots meta
- robots.txt
- sitemap availability
- language declaration
- viewport
- image alt attributes
- internal links
- structured data presence

### Output

Findings use the canonical `Finding` type from `lib/types/finding.ts`
(ADR-008, ADR-029):

```ts
{
  id,
  category,
  severity,
  status,
  evidence,
  explanation,
  recommendation?
}
```

Never output only a numeric score.

A check that could not run reports `status: "could_not_determine"`. It must
never report `pass` (ADR-021).

robots.txt and sitemap.xml are fetched through the validated Phase 2 client,
not a bare fetch (ADR-035).

---

# Phase 6 — Security Analyzer

### Goal

Evaluate observable web security configuration.

### Initial checks

- HTTPS
- HSTS
- Content-Security-Policy
- X-Content-Type-Options
- Referrer-Policy
- frame protection
- cookie security attributes where observable
- server disclosure where applicable

### Important

The analyzer reports configuration findings.

It does NOT claim:

```text
"This site is secure."
```

It should say things like:

```text
"Security configuration is missing HSTS."
```

---

# Phase 7 — Accessibility Analyzer

### Goal

Evaluate automated accessibility signals.

Start with an established automated accessibility auditing engine rather than implementing the complete accessibility standard manually.

Normalize results into our internal finding format.

### Categories

- critical
- serious
- moderate
- minor

### Acceptance criteria

Accessibility findings can be traced back to actual audit evidence.

---

# Phase 8 — Performance Analyzer

### Goal

Evaluate website performance.

Collect established browser performance metrics and audit results.

Initial focus:

- LCP
- TBT
- CLS
- total page size
- image optimization
- JavaScript cost
- request count
- render-blocking resources
- caching/compression findings where observable

### Acceptance criteria

Raw metrics are stored independently from calculated scores.

Never overwrite raw metrics with normalized scores.

### Constraints

INP is deliberately absent. It is a field metric requiring real user
interaction and cannot be produced by a synthetic load; TBT is the lab proxy
(ADR-030). The report must not display an INP number.

Lighthouse attaches to the Phase 3 browser but performs its own cold,
throttled page load (ADR-033).

---

# Phase 9 — Mobile Analyzer

### Goal

Determine whether the page works reasonably on a mobile viewport.

Check:

- horizontal overflow
- viewport configuration
- text readability indicators
- element clipping
- navigation behavior
- screenshot rendering
- major layout failures

Do not pretend automated checks can perfectly evaluate human mobile UX.

---

# Phase 10 — Content Analyzer

### Goal

Extract and evaluate communication quality.

Extract:

- hero heading
- hero supporting copy
- CTAs
- feature sections
- pricing
- testimonials
- FAQs
- footer
- contact information

Initial deterministic checks:

- missing headline
- unclear CTA patterns
- excessive CTA duplication
- extremely generic metadata
- content density
- missing trust signals where detectable

AI interpretation comes later.

---

# Phase 11 — UX Heuristics

### Goal

Create a deterministic foundation for UX analysis.

Potential signals:

- number of primary actions
- navigation complexity
- heading hierarchy
- interactive element density
- form complexity
- repeated components
- content hierarchy
- mobile navigation structure

Important:

These are heuristic signals, not objective truth.

The output must explicitly distinguish:

```text
Measured
```

from:

```text
Heuristic
```

---

# Phase 12 — Scoring Engine

### Goal

Convert findings into transparent category scores.

Initial categories:

```text
Performance
SEO
Accessibility
Mobile
Security
Content
UX
```

Each category produces:

```ts
interface CategoryScore {
  score: number
  grade: string
  findings: Finding[]
}
```

Overall score must be calculated from category scores.

Store the weighting separately from analyzer logic.

Do not hide scoring logic inside UI components.

---

# Phase 13 — Recommendation Engine

### Goal

Rank problems according to impact.

A recommendation is a derived view over `Finding` values, not a second record
type (ADR-029). It adds ranking and presentation on top of a finding:

```ts
{
  findingId,   // the Finding this came from
  title,
  impact,
  rank
}
```

Severity, evidence, explanation and the recommended action are read from the
referenced finding. They are not copied, so they cannot drift.

Prioritize:

1. severe technical problems
2. major usability problems
3. problems affecting conversion or discoverability
4. minor polish

---

# Phase 14 — AI Interpretation

### Goal

Use AI to interpret already-collected evidence.

The model receives:

- normalized page data
- category scores
- important findings
- screenshot references
- extracted page copy

The model produces:

```text
executive summary
top problems
strengths
recommendations
roast
```

### AI constraints

The prompt must explicitly tell the model:

- do not invent evidence
- do not invent metrics
- do not claim vulnerabilities without evidence
- distinguish measured facts from subjective opinions
- prioritize the most important problems
- keep recommendations actionable

---

# Phase 15 — Roast Engine

### Goal

Generate humorous, shareable criticism without becoming useless or insulting.

A roast should be:

- funny
- concise
- evidence-based
- relevant
- understandable

Example:

```text
Your homepage has four CTAs.

Apparently your design strategy is
"let the visitor choose their destiny."
```

The roast must reference actual findings.

Do not generate random jokes.

---

# Phase 16 — Analysis API

### Goal

Expose the analysis workflow to the frontend.

A conceptual API may be:

```text
POST /api/analyze
GET  /api/analyze/:id
```

Do not finalize API paths until the application framework structure has been implemented.

The analysis lifecycle should support:

```text
queued
running
completed
failed
timeout
blocked
invalid_url
```

These states are already defined in `lib/types/analysis.ts`.

### Includes the job store

An asynchronous API needs state that outlives a request. Route handlers are
stateless, the dev server reloads modules, and production may run multiple
workers, so module-level state is not an option.

This phase therefore introduces persistence for the job record. ADR-031 amends
ADR-019 accordingly. Choose the simplest store that survives a process restart.

---

# Phase 17 — Analysis UI

### Goal

Create the polished user experience.

Primary workflow:

```text
Landing page
    ↓
Enter URL
    ↓
Analyze
    ↓
Progress
    ↓
Result
```

Result page:

```text
Overall score

Category scores

Top issues

Strengths

Detailed findings

Recommendations

AI roast

Screenshots
```

---

# Phase 18 — Shareable Result

### Goal

Create a visually strong share card.

Card should communicate:

- website
- overall score
- key category scores
- one memorable roast
- product identity

Do not make the card information-dense.

---

# Phase 19 — History and Retention

The job store itself arrives in Phase 16 (ADR-031). This phase covers what is
kept, for how long, and what a user can look back at.

Store:

- analysis
- URL
- timestamps
- scoring version and assessed categories
- raw metrics
- normalized findings
- category scores
- AI result
- status

Define a retention policy. Never store unnecessary website data.

---

# Phase 20 — Hardening

Before public launch:

- SSRF testing
- rate limiting
- browser isolation review
- timeout review
- memory leak testing
- concurrency testing
- malicious HTML testing
- oversized page testing
- broken site testing
- AI prompt injection testing
- secret handling review
- dependency audit

---

# PHASE EXECUTION RULE

Claude must not implement more than one phase per request unless the user explicitly asks for multiple phases.

For each phase:

1. inspect
2. plan
3. implement
4. test
5. validate
6. document
7. report

---

# CURRENT STATUS

```text
Phase 0 — ✅ Complete
Phase 1 — ✅ Complete
Phase 2 — ✅ Complete
Phase 3 — ✅ Complete
Phase 4 — ✅ Complete
Phase 5 — ✅ Complete
Phase 6 — ✅ Complete
Phase 7 — ✅ Complete
Phase 8 — ✅ Complete
Phase 9 — ✅ Complete
Phase 10 — ✅ Complete
Phase 11 — ✅ Complete
Phase 12 — ✅ Complete
Phase 13 — ✅ Complete
Phase 14 — ✅ Complete
Phase 15 — ✅ Complete
Phase 16 — ✅ Complete
...
```

Update this section after each completed phase.

## Phase 0 — Complete

Delivered:

- Next.js 16 App Router scaffold (pre-existing), TypeScript strict, ESLint 9
- Vitest test framework, tests colocated as `*.test.ts` (ADR-025)
- Prettier formatting, markdown excluded (ADR-026)
- `lib/` structure and dependency rules (ADR-027)
- validated server environment in `lib/config/env.ts` (ADR-028)
- structured logger in `lib/observability/logger.ts`
- shared domain types: job lifecycle and the canonical finding model (ADR-029)
- scripts: `typecheck`, `lint`, `format`, `test`, `verify`

Not delivered, deliberately:

- no analyzer, crawler, scoring, AI or persistence code
- no CI pipeline (not in the Phase 0 task list)
- no browser test runner (deferred to Phase 17, ADR-025)

## Phase 1 — Complete

Delivered in `lib/analysis/url/`:

- `validateUrl(input)` — the entry point. Returns `{ valid: true, normalizedUrl }`
  or `{ valid: false, code, reason }`.
- `ip.ts` — IPv4 and IPv6 literal parsing and range classification, including
  addresses that embed IPv4 (IPv4-mapped, NAT64, 6to4).
- `hostname.ts` — hostname syntax checks and internal-name classification.
- `types.ts` — rejection codes, plus the mapping to the `invalid_url` and
  `blocked` job states from ADR-011.

Controls implemented, per the Phase 1 column of ADR-035:

- protocol allowlist (`http`, `https`)
- embedded credentials refused
- IP literals in loopback, private, link-local, metadata, carrier-grade NAT,
  multicast, unspecified and reserved ranges refused
- `localhost`, single-label names and internal suffixes refused
- default ports only (ADR-039)
- control characters refused before parsing, so the parser cannot silently
  strip them

Validation: 300 tests pass, including alternate encodings of 127.0.0.1
(decimal, hex, octal, short form, circled digits) and IPv6-wrapped private
addresses.

Not delivered, deliberately:

- no DNS resolution, no address pinning, no redirect following — Phase 2
- no HTTP client, no browser — Phases 2 and 3

## Phase 2 — Complete

Delivered in `lib/analysis/http/`:

- `fetchPage(url, options)` — retrieves one page and returns either
  `{ ok: true, response }` or `{ ok: false, failure }`. Never throws for an
  expected condition.
- `pinned-lookup.ts` — DNS resolution, address validation and connection
  pinning (ADR-041).
- `policy.ts` — the injectable security policy; the production default
  delegates to the Phase 1 validator and address classifier.
- `types.ts` — response and failure models, plus the mapping from a failure to
  the `failed` / `timeout` / `blocked` / `invalid_url` job states of ADR-011.

Collected: final URL, status and status text, headers (with `Set-Cookie` kept
separate), content type, charset, declared and observed sizes, content
encoding, redirect chain, per-phase timings, and the decoded HTML.

Handled explicitly: timeout, DNS failure, refused connection, connection reset,
TLS error, excessive redirects, redirect loop, redirect into blocked space,
oversized response, decompression bomb, 4xx, 5xx, and non-HTML content.

Controls implemented, per the Phase 2 column of ADR-035:

- hostname resolved once, every resolved address validated, connection pinned
  to a validated address (DNS-rebinding defence)
- every redirect hop re-validated through the Phase 1 validator
- timeout, maximum response size and redirect limit enforced

Validation: 362 tests pass, including a decompression bomb, a redirect to the
cloud metadata endpoint, and a public hostname resolving to a private address.
The HTTP tests run against a real local server rather than a mock.

Not delivered, deliberately:

- no HTML parsing — Phase 4
- no rendering, no JavaScript execution — Phase 3
- no Lighthouse — Phase 8
- no SEO or security interpretation of the headers — Phases 5 and 6

## Phase 3 — Complete

Delivered in `lib/analysis/browser/`:

- `renderPage(url, options)` — renders at a desktop and a mobile viewport and
  returns `{ ok: true, page }` or `{ ok: false, failure }`.
- `session.ts` — browser lifecycle, exposing the DevTools endpoint ADR-033
  requires so Phase 8 can attach Lighthouse to the same process.
- `navigation-guard.ts` — the request guard (ADR-042).
- `viewports.ts` — desktop 1440x900, mobile 390x844.

Collected per viewport: PNG screenshot, post-JavaScript DOM, title, `lang`,
viewport meta, HTTP status, final URL, layout metrics (scroll vs client width),
and navigation + paint timings. Aggregated across viewports: console errors and
warnings, uncaught page errors, network requests, and refused requests.

Explicit failure codes: `invalid_url`, `blocked`, `browser_unavailable`,
`timeout`, `navigation_failed`, `renderer_crashed`, `browser_error`.

Resource handling: the browser is closed in a `finally` on every path, each
viewport's context is closed after use, and console and network entries are
capped (200 and 500).

Validation: 408 tests pass. The browser tests run against real Chromium and a
local server, and are skipped with a clear message when Chromium is not
installed.

Not delivered, deliberately:

- no parsing of the rendered HTML — Phase 4
- no mobile or layout judgement — Phase 9
- no Lighthouse, no performance scoring — Phase 8
- no network isolation at the OS level — see ADR-042 and Phase 20

## Phase 4 — Complete

Delivered in `lib/analysis/dom/`:

- `extractPageData(html, url)` — a **pure function** returning `PageData`. No
  browser, no network, no clock, which is what makes this phase's determinism
  criterion structurally true rather than asserted.
- `dom-tree.ts` — the parse5 traversal adapter, and the only module that knows
  what a parse5 node looks like.
- `urls.ts` — URL resolution, `<base>` handling and link classification.
- `types.ts` — the `PageData` model.

Extracted: title, meta description, headings, links, images, forms, scripts,
stylesheets, language and viewport metadata, plus canonical, robots, charset,
`<base href>` and raw JSON-LD blocks that Phase 5 will need.

The representation is plain data with no framework types, so it crosses the API
boundary in Phase 16 unchanged.

Conventions worth knowing (ADR-044):

- `null` means "not in the document", `""` means "present but empty". A missing
  `alt` is a defect; `alt=""` marks a decorative image. They stay distinct.
- raw attribute values are kept raw — image `width` may be `100`, `100px` or
  nonsense, and normalising it here would hide the difference.
- `<base>` changes resolution but not which host counts as internal.
- elements are matched in the HTML namespace only, so an `<a>` inside `<svg>` is
  not counted as a link.

Validation: 499 tests pass, 90 of them for this phase, covering malformed HTML,
unclosed tags, uppercase markup, entity decoding, `<base>` resolution, inert
`<template>` content, and determinism across repeated runs.

Not delivered, deliberately:

- no SEO judgement of any kind — Phase 5
- no body text or word counts — Phase 10
- no `<picture>`/`<source>` collection; only `<img>`
- no label-to-field association — Phase 7 runs a real accessibility engine

## Phase 5 — Complete

Delivered in `lib/analysis/seo/`:

- `analyzeSeo({ page, siteFiles })` — returns `Finding[]` and **no score**.
  Performs no I/O; every check is a pure function of `PageData`.
- `fetchSiteFiles(url)` — retrieves robots.txt and the sitemap through the
  **Phase 2 client**, so they inherit its SSRF controls (ADR-035).
- `checks/` — content, metadata, resources and site-file checks.
- `robots-txt.ts` — minimal robots.txt parsing.
- `thresholds.ts` — every number in one reviewable place.

All fourteen checks from the phase specification are implemented: title exists,
title length, meta description, heading structure, H1 presence, canonical,
robots meta, robots.txt, sitemap availability, language, viewport, image alt,
internal links and structured data.

Rules worth knowing (ADR-045):

- only two findings are `critical` — a `noindex` robots meta tag and a
  site-wide `Disallow: /`. Both remove the site from search entirely.
- `alt=""` is **not** a defect. It is the correct marking for a decorative
  image, and there is a test asserting it is not reported.
- a sitemap declared in robots.txt but not served is a `fail`; simply having no
  sitemap is a `warn`. A broken promise is worse than no promise.
- site files that were not retrieved report `could_not_determine`, never a pass.

Every finding carries evidence **and** a recommendation, including passes and
`could_not_determine` — stricter than the shared `Finding` type, which permits a
pass to omit one. A test drives every check down its failure, warning and
could-not-determine branches and asserts the rule across all 47 findings by
name.

Validation: 603 tests pass, 110 of them for this phase. The site-file tests run
against a real local server.

Phase 2 was extended to support this: a `downloadMediaTypes` option, and the
response field `html` renamed to `body` to match what it now carries.

Not delivered, deliberately:

- no scoring — Phase 12
- no full robots.txt path matching; nothing in V1 crawls (ADR-005)
- no sitemap XML validation, only existence
- no keyword, content-quality or backlink analysis

## Phase 6 — Complete

Delivered in `lib/analysis/security/`:

- `analyzeSecurity({ response })` — returns `Finding[]` and no score. Reads the
  Phase 2 response; performs no I/O of its own.
- `checks/` — transport (HTTPS, HSTS), headers (CSP, frame protection,
  X-Content-Type-Options, Referrer-Policy), cookies, and disclosure.
- `cookies.ts` — `Set-Cookie` parsing that captures names and attributes and
  **never the value**.
- `directives.ts` — CSP and HSTS parsing.
- `thresholds.ts` — the values the checks compare against.

All eight areas from the specification are covered, across 34 findings.

Rules worth knowing (ADR-046):

- the analyzer **never states that a site is secure** and never claims a
  vulnerability. A test scans every explanation, recommendation and evidence
  summary across every scenario for phrases like "is secure", "no
  vulnerabilities" and "guarantee".
- cookie **values** are never captured, because this report reaches logs, an API
  response and eventually an AI prompt. Names are kept so findings stay
  actionable.
- disclosure findings are `minor`: knowing a site runs nginx does not let anyone
  in. A version is reported; a bare product name is not.
- HSTS on a plain HTTP page reports `could_not_determine`, since browsers ignore
  the header there and there is nothing to assess.

Validation: 713 tests pass, 110 of them for this phase.

### SSRF review of the existing architecture

Requested alongside this phase. Verified against the code and, where stated, by
test:

**Confirmed sound:**

- the pinned lookup is passed to **every** redirect hop, so DNS resolution and
  address validation run per request rather than only on the first. A new
  `lib/analysis/http/ssrf.test.ts` proves this: a redirect to a public hostname
  that resolves to `10.0.0.1` is refused at the address layer, which the URL
  layer cannot catch.
- redirect targets carrying credentials are refused.
- no cookie or authorization header is ever sent, so a redirect to another
  origin cannot leak credentials from an earlier hop. Now asserted by test.
- the production defaults are strict with no options supplied.

**Weakness found:**

- `fetchSiteFiles` spreads caller-supplied `fetchOptions` **after** its own
  defaults, so any caller can override `policy` and `lookup` — the security
  controls, not just the budgets. It exists as a test seam and nothing in
  production passes it, but the override is available to any caller rather than
  being confined to tests. Recorded here rather than changed, because
  tightening it changes a Phase 5 signature.

**Unchanged known gap:** the browser guard is not isolation (ADR-042). Chromium
resolves DNS itself and WebSockets are not intercepted. This remains a Phase 20
deployment prerequisite.

Not delivered, deliberately:

- no scoring — Phase 12
- no TLS certificate, protocol or cipher inspection
- no active testing of any kind, which is what keeps this safe to point at a
  site that did not ask to be scanned
- no assessment of routes other than the one analyzed

## Phase 7 — Complete

Delivered in `lib/analysis/accessibility/`:

- `runAxe(url, options)` — loads the page and runs **axe-core 4.13** in it.
  Reuses Phase 3's session and request guard, so the security boundary and
  cleanup are the ones already reviewed. Always closes the browser.
- `normalizeAxeResults(results)` — **pure**. Audit in, `Finding[]` out.
- `analyzeAccessibility({ audit })` — returns findings, and turns a failed or
  missing audit into a single `could_not_determine` finding rather than
  dropping the section.

Preserved through normalization: rule identifier, severity, affected elements
(selectors and markup), the engine's description, its failure summary, and a
link to its documentation.

Rules worth knowing (ADR-047):

- the engine's `critical`/`serious`/`moderate`/`minor` map onto ours
  one-to-one **by design** — those names were chosen in Phase 0 for this
  reason (ADR-029), so no lossy table is needed.
- axe's `incomplete` becomes `could_not_determine`. Automation cannot settle
  whether alt text is *meaningful*; reporting that as a pass would be the most
  misleading thing this phase could do.
- passes collapse into one finding. A page passes forty or more rules and one
  finding each would bury the failures.
- the analyzer **never states that a page is accessible**. Automated testing
  reaches only a fraction of the success criteria.

Validation: 786 tests pass, 73 of them for this phase. Normalization is covered
with fixtures; a separate end-to-end test runs the real engine in real Chromium
against a deliberately broken page and asserts the violations normalize
correctly.

Not delivered, deliberately:

- no scoring — Phase 12
- no mobile-viewport audit; the audit runs once, at the desktop viewport
- no manual-check guidance beyond the undecided rules the engine surfaces

## Phase 8 — Complete

Delivered in `lib/analysis/performance/`:

- `runLighthouse(url, options)` — runs **Lighthouse 13** against the page,
  attached to the Phase 3 browser over an explicit DevTools port. Always closes
  the browser.
- `extractMeasurements(report)` — **pure**. Raw numbers, in the engine's units.
- `normalizeLighthouseReport(...)` — **pure**. Findings.
- `analyzePerformance({ audit })` — returns `{ measurements, findings }`.

Collected raw: LCP, CLS, TBT, FCP, Speed Index, TTI, server response time,
total byte weight, request count, per-type resource breakdown, JavaScript
bootup time, main-thread work, unused JavaScript bytes, image savings,
render-blocking count and cost — plus engine name, version and measured URL so
any number can be traced to what produced it.

Rules worth knowing (ADR-048):

- **raw and derived are separate return values.** `measurements` contains no
  score of any kind, ours or the engine's, and a test asserts none leaks in
  (ADR-012).
- the engine's 0-1 score decides **finding status only**. The category score is
  Phase 12's, computed from the raw measurements under our weights (ADR-002).
- **INP is present as a field and is always `null`**, with the reason attached
  and TBT reported beside it as the lab proxy. INP needs real users; a
  synthetic load has none, so any number here would be invented (ADR-030).
- a failed audit yields **empty** measurements, never zeroed ones. A page whose
  weight was never measured must not look like a page that weighs nothing.
- audit identifiers were verified against a real report. Lighthouse 13 replaced
  `render-blocking-resources`, `uses-optimized-images`, `uses-long-cache-ttl`
  and `uses-text-compression` with `*-insight` audits; the old names would have
  produced silent nulls.

Validation: 862 tests pass, 76 of them for this phase. Extraction and
normalization are covered with fixtures; a gated end-to-end test runs the real
engine against a real page and asserts every named measurement arrives.

Not delivered, deliberately:

- no scoring — Phase 12
- lab data only; no field data or real-user monitoring
- one run, unaveraged — Lighthouse metrics vary between runs
- desktop only; no mobile performance run

## Phase 9 — Complete

Delivered in `lib/analysis/mobile/`:

- `collectMobileSignals(url, options)` — renders at the Phase 3 mobile viewport
  and measures element geometry in the page. Captures a screenshot. Always
  closes the browser.
- `analyzeMobile({ probe })` — **pure**. Signals in, `Finding[]` out.
- `thresholds.ts` — separates standards-backed floors from comfort guidelines.

Checked: horizontal overflow, viewport configuration (including zoom being
disabled), clipping, tap target sizing, text size, mobile navigation, and
overall layout integrity.

Rules worth knowing (ADR-049):

- **measured and heuristic are kept apart.** Overflow, viewport configuration,
  tap targets below the WCAG 2.2 24px floor and clipping are `measured`.
  Comfort-guideline sizing, small text, anything about navigation, and "the
  layout may be broken" are `heuristic` — marked in their evidence and hedged
  in their prose. A test enforces both halves.
- a standing `could_not_determine` finding states that **automation cannot
  determine mobile usability**, on every analysis including clean ones.
- **the layout viewport is not the screen.** A page with no viewport meta tag is
  laid out at Chromium's ~980px fallback, so overflow measured against it
  understates the problem. Both widths are recorded and the gap is reported.

Validation: 913 tests pass, 51 of them for this phase. The analyzer is covered
with fixtures; a gated end-to-end test measures a deliberately broken page in
real Chromium.

Not delivered, deliberately:

- no scoring — Phase 12
- one viewport, one page state; no orientation change or tablet width
- the navigation menu is never opened, only reported as untested

## Phase 10 — Complete

Delivered in `lib/analysis/content/`:

- `extractContent(html, url)` — **pure**. Produces a `ContentInventory`.
- `analyzeContent({ inventory })` — **pure**. Findings, no score, **no AI**.
- `patterns.ts` — every pattern and threshold in one reviewable place.

Extracted: hero headline and supporting copy, calls to action, feature/pricing/
testimonial/FAQ/contact/about sections, contact information, footer, trust
signals, and word counts.

Rules worth knowing (ADR-050):

- **every item records how it was found.** `<h1>`, `<footer>`, `mailto:`,
  `<button>` and `<details>` are `structural` and become `measured` evidence.
  Wording, position and pattern matches are `inferred` and become `heuristic`
  evidence.
- a threshold produces a heuristic finding even when the number is exact:
  250 words is a measurement, "thin" is an opinion.
- detection is **English-only pattern matching**, and the findings say so about
  themselves — the "no sections recognised" finding states it says as much about
  the analyzer as about the page.
- navigation, header and footer text is excluded from the word count, since it
  repeats on every page.
- **no AI**, with a test asserting the analyzer imports none.

Validation: 990 tests pass, 77 of them for this phase.

Not delivered, deliberately:

- no scoring — Phase 12
- no AI interpretation — Phase 14
- no judgement of copy quality; a pass means a thing was found, not that it is
  any good
- English only

## Phase 11 — Complete

Delivered in `lib/analysis/ux/`:

- `collectUxSignals(html, url)` — **pure**. Counts only; nothing judged.
- `analyzeUx({ signals })` — **pure**. Findings, no score, **no AI**.
- `thresholds.ts` — every rule of thumb in one place, labelled as such.

Signals collected: navigation complexity (regions, links, nesting, duplicate
destinations), primary actions, interactive density per 100 words, heading
outline and skipped levels, content hierarchy (landmarks, DOM depth, ratios),
form complexity, and repeated components.

Rules worth knowing (ADR-051):

- **every finding pairs a measurement with the inference drawn from it.** A
  `measured` evidence item names the signal and must contain a digit; a
  `heuristic` item states the inference. Both are enforced by test, which is
  what makes "navigation looks complex" auditable rather than an opinion.
- **nothing here is standards-backed.** Unlike Phase 9's WCAG tap-target floor,
  every threshold is a rule of thumb, and the findings say so — a documentation
  site legitimately has a large menu, a pricing page a button per plan.
- **severity is capped below `serious`**, with a test, so Phase 12 cannot weight
  guesswork like evidence. This matters given ADR-037's open question about UX
  carrying 20% of the score.
- a standing finding names what counting cannot reach: visual hierarchy, clarity
  of language, whether the layout guides the eye.
- absence is reported with a count — "0 navigation regions were found" — since a
  zero is still the observable signal.

Validation: 1054 tests pass, 64 of them for this phase.

Not delivered, deliberately:

- no scoring — Phase 12
- no AI — Phase 14
- nothing rendered: visual weight, colour, spacing and position are outside
  what this phase can see

---

## Phase 12 — Complete

Delivered in `lib/scoring/`:

- `weights.ts` — the **only** mirror of `docs/SCORING.md`: category weights, the
  deduction table, the metric curves, the Performance sub-weights.
- `score-category.ts` — findings to a score by deduction. Pure.
- `score-performance.ts` — raw metrics to a score by curve. Pure.
- `score-analysis.ts` — `scoreAnalysis(input)`, the entry point. Pure.
- `grade.ts`, `version.ts`, `types.ts`, `index.ts`.

The four layers stay apart: analyzers produce evidence in `lib/analysis`,
weights live in `weights.ts`, calculations in the `score-*` modules, and nothing
scoring-related is in the UI.

Rules worth knowing (ADR-052):

- **every number reconstructs from the report.** Each category records the
  deductions (finding id, severity, status, points) or metric contributions (raw
  value, unit, normalised score, effective weight) behind it; the overall score
  records each category's weight and contribution. A test recomputes all of it,
  so an untraceable score fails the build.
- **the overall score is computed from the rounded figures on screen**, not from
  hidden precision, so a reader adding up what they see gets what they were
  shown.
- **not assessed is not zero, and has no grade.** A category with no findings,
  or whose findings are all `could_not_determine`, is excluded and its weight
  redistributed (ADR-036). Grading it F would publish a verdict nobody reached.
  With nothing assessable at all, the overall score is `null` and says so.
- **severity is the per-check weight**, which is why six categories need no
  sub-weight table. `docs/SCORING.md` claimed otherwise and was corrected.
- **four Performance components have no thresholds** — page weight, image
  optimization, JS cost, "Other". They are excluded with their weight
  redistributed across LCP, TBT and CLS rather than given invented curves, and
  the report names each one and why.
- **no AI, asserted by test** (ADR-002), along with no clock, no I/O and no
  randomness. Same evidence in, identical report out.
- `SCORING_VERSION` is 1, stamped on every report; a test fails if the constant
  and `docs/SCORING.md` disagree.

Deviation from this document's Phase 12 sketch, deliberately: the sketch showed
`CategoryScore` as `{ score: number; grade: string; findings: Finding[] }`.
The delivered type uses `score: number | null` and `grade: Grade | null`,
because a category that could not be assessed must not be scored zero or graded
F (ADR-021, ADR-036) — the sketch's types cannot express that. It carries
`deductions` and `metrics` rather than `findings`, so the score's arithmetic
travels with it; the findings themselves are not copied and so cannot drift.

Validation: typecheck, lint, format check, 1189 tests (135 for this phase) and
`next build` all pass.

Not delivered, deliberately:

- no ranking of problems — Phase 13
- no AI — Phase 14
- no UI — Phase 17
- **ADR-037 is still open.** Security at 5% and UX at 20% are implemented as
  documented and pinned by test. They are now load-bearing and need a product
  decision.
- page weight, image optimization and JS cost are measured but unscored until
  thresholds are defined


---

## Phase 13 — Complete

Delivered in `lib/recommendations/`:

- `build-recommendations.ts` — `buildRecommendations({ findings, score? })`,
  the entry point. Pure.
- `rank.ts` — the comparator and the ranking. Pure.
- `impact.ts` — what a fix is worth, priced against `lib/scoring`. Pure.
- `title.ts` — deterministic title derivation.
- `tiers.ts` — the document's four priority tiers and the impact bands.
- `types.ts`, `index.ts`.

Rules worth knowing (ADR-053):

- **a recommendation holds no copy of its finding.** It carries `rank`, `title`,
  `impact` and `tier`; severity, evidence, explanation and the recommended
  action are read through `recommendation.finding`. A test pins the key set, so
  the two can never disagree.
- **impact is two numbers.** `level` is how bad it is, banded from severity and
  status; `points` is how far the overall score would move. They disagree — a
  critical security failure is high impact worth 1.25 points — and keeping them
  apart is what stops the report from hiding ADR-037's weighting question.
- **Performance impact is null, not zero**, because `docs/SCORING.md` scores that
  category from metric curves rather than from the deduction table. In the
  ranking a null is placed, not scored: after a priced finding of equal
  severity, ahead of every milder one.
- **the sort is impact level, severity, points, status, tier, finding id.** Total
  and deterministic; forward, reversed and shuffled inputs rank identically.
- **the document's four tiers are key 5, not key 1.** Ranking primarily by
  category would contradict the score shown beside it. The consequence — an
  accessibility problem outranking an equally severe security one at 15% against
  5% — is tested rather than hidden.
- **titles are derived from the first evidence summary**, since `Finding` has no
  title field and ADR-029 rules out adding one. `titleSource` records which of
  the three sources was used, so a derived label is never shown as authored.
- **undetermined checks are recommended as reviews**, ranked last with no points.
  Dropping them would hide what ADR-021 exists to surface. Passes are not
  recommendations; the count survives in the summary.
- **no AI, asserted by test.** Phase 14 interprets this list rather than
  producing it.

Checked against real analyzer output, not only fixtures: the suite runs Phase 10
and Phase 11 over an HTML page and asserts every resulting recommendation gets a
usable title from its own evidence.

Validation: typecheck, lint, format check, 1326 tests (137 for this phase) and
`next build` all pass.

Not delivered, deliberately:

- no AI and no roast — Phase 14 and Phase 15
- no UI — Phase 17
- no persistence — Phase 16
- **ADR-037 is still open**, and now affects the order of the report as well as
  the score


---

## Phase 14 — Foundation complete, interpretation not started

The provider abstraction only. No prompts, no evidence assembly, no summary, no
roast — those are the rest of Phase 14 and Phase 15.

Delivered in `lib/ai/`:

- `types.ts` — `AiProvider`, `AiRequest`, `AiResult`, `ResponseSchema`,
  `JsonSchema`, `AiImage`.
- `errors.ts` — the normalized failure vocabulary, redaction, log fields.
- `json.ts` — recovering structured output from what a model actually returns.
- `config.ts` — the AI environment variables. Total: never throws.
- `resolve-provider.ts` — the only name-to-adapter map in the application.
- `providers/gemini.ts` — **the only file that knows how Gemini works.**

Rules worth knowing (ADR-054, ADR-034):

- **failure is a value.** `generate` returns `AiResult<T>`, so a caller cannot
  read `.data` without narrowing on `.ok`. ADR-016's guarantee is structural
  rather than dependent on every caller remembering a try/catch.
- **the schema is the authority.** A request carries a JSON Schema for the
  provider's structured-output mode *and* a `parse` function that runs on every
  response regardless. A provider claiming to enforce a schema is not believed.
- **malformed output is expected.** Fenced blocks, prose either side and
  truncation are recovered where possible and refused with a preview where not.
  Hitting the token limit is `response_truncated`, not `malformed_output` — a
  different problem with a different fix.
- **AI misconfiguration cannot stop the application.** Unlike every other
  variable, a bad AI value disables AI with a specific reason instead of
  throwing. Asserted against the real pipeline in `degraded-mode.test.ts`.
- **the key travels in a header**, not `?key=`, so it cannot reach a URL, a log
  line or an error message (ADR-018).
- **the vendor boundary is tested.** A test scans every file outside
  `providers/` for vendor API surface and asserts exactly one module imports an
  adapter. Swapping vendors is a new file plus a `switch` arm plus `AI_PROVIDER`.

Validation: typecheck, lint, format check, 1504 tests (178 for this phase) and
`next build` all pass.

**Known gap, stated plainly:** the Gemini wire format is implemented from the
documented v1beta `generateContent` shape and exercised only against a fake
`fetch`. No call has been made to Google's servers, because that needs a key
this repository does not have. The `responseSchema` type casing, the exact
`finishReason` values and `systemInstruction` support are the parts most likely
to need adjustment on first real contact. Everything around them — error
classification, timeouts, JSON recovery, redaction — does not depend on those
details.

Not delivered, deliberately:

- no prompts and no evidence assembly — the rest of Phase 14
- no roast — Phase 15
- no retry loop; `retryable` is exposed for a later phase to act on
- no caching of AI responses


---

## Phase 14 — Complete

Delivered in `lib/ai/interpretation/`:

- `evidence.ts` — assembles what the model may see. Pure, bounded.
- `prompt.ts` — the instruction, with the prohibitions stated explicitly.
- `schema.ts` — the answer's shape, validated locally whatever the provider did.
- `verify.ts` — whether the answer's **claims** stand up. Pure.
- `interpret.ts` — `interpretAnalysis(availability, request)`. Never throws.

The model receives page content, technical findings, score information, UX
heuristics (findings like any other) and screenshots. It returns an executive
summary, strengths, and ranked problems each carrying an explanation and a
recommendation.

Rules worth knowing (ADR-055):

- **the model supplies prose; the application supplies facts.** An answer
  carries only `{ findingId, whyItMatters, recommendation }` — no severity, no
  category, no metric, no score. Every fact in the result is read back through
  `problem.finding`. This is what makes invention structurally hard rather than
  merely forbidden.
- **the prompt states all five prohibitions** — invented metrics, invented
  technical findings, unsupported security claims, unsupported SEO claims,
  contradicting the evidence — and a test asserts each is present. But the
  prompt is a request; `verify.ts` is the enforcement.
- **verification checks claims, not just shape.** Every reference resolves;
  no reference contradicts its finding's status; every measurement stated
  appears in the evidence; no security assurance or ranking promise.
- **an answer with any violation is discarded whole.** Not repaired, not
  partially used. The deterministic report always stands, so refusing costs a
  section rather than the report.
- **evidence is assembled by construction and bounded**, and reports what it
  dropped. Problems are ranked before truncation, so a cap drops the least
  important.
- **failure is ordinary.** `interpretAnalysis` never throws — including when a
  provider breaks its contract and throws — and every outcome carries a message
  fit to show a person.

Validation: typecheck, lint, format check, 1676 tests (172 for this phase) and
`next build` all pass.

Not delivered, deliberately:

- **no roast.** This document lists one among Phase 14's outputs; it belongs to
  Phase 15 and ADR-015. A test asserts the prompt asks for neither.
- no retry when an answer is discarded; the violations are returned so a later
  phase can decide
- no caching or persistence — Phase 16
- no UI — Phase 17

Known limitation: the prohibited-phrase lists are English-only, and a model
could express a banned claim in words none of them match. They are a floor, not
a proof. The reference and status checks are total; the phrase checks are not.


---

## Phase 15 — Complete

Delivered in `lib/roast/`:

- `select.ts` — which findings to roast, and the observation for each. Pure.
- `templates.ts` — the written punchlines. ~60 specific, plus category and
  severity fallbacks.
- `fallback.ts` — the roast that needs no model. Pure, deterministic.
- `prompt.ts` — the roast instruction and its tone rules.
- `schema.ts` — the answer's shape.
- `verify.ts` — subject, abuse and repetition checks, plus Phase 14's prose
  checks, reused.
- `generate-roast.ts` — `generateRoast(availability, request)`. Always returns
  a roast.

Rules worth knowing (ADR-056):

- **an observation plus a punchline, with different authors.** The observation
  comes from the finding's evidence; only the punchline is ever a model's. The
  model's answer is `{ findingId, punchline }` — no field in which to state a
  fact.
- **the subject is chosen before the model is asked.** Failures and warnings
  only, in Phase 13's ranked order. A line about a finding it was not given is
  refused, even a real one.
- **non-abusive means the website is the target.** Whole-word insult matching,
  plus patterns for lines aimed at the reader. The templates are held to the
  same standard by the same lists, in a test.
- **every failure road leads to the written roast.** No provider, timeout, rate
  limit, malformed output, rule violation, a provider that throws.
  `generateRoast` has no failure path; `source` and `fallbackReason` say what
  happened.
- **nothing to roast means no lines and no model call.** Asking a model to roast
  a clean page is inviting it to find something.
- **the roast never touches the score.** A test asserts `lib/scoring` imports
  nothing from `lib/roast`.
- temperature is 0.7 here and zero everywhere else, because a roast written at
  zero reads like a form letter. The deterministic path has no randomness at
  all.

Validation: typecheck, lint, format check, 1825 tests (149 for this phase) and
`next build` all pass. A real deterministic roast was rendered and read, which
is how the missing `ux.actions.none_identified` template was found.

Not delivered, deliberately:

- no per-line retry; one bad line discards the answer and the written roast is
  used
- no profanity filter — swearing at a layout is within ADR-015's brief; what is
  checked is whether a line attacks a person
- no UI — Phase 17

Known limitation: the abuse lists are English-only and are a floor, not a proof.
A new analyzer finding gets a category-level line until someone writes it a
specific one.


---

## Phase 16 — Complete

Delivered:

- `lib/jobs/` — the job store. `types.ts`, `id.ts`, `file-store.ts` (atomic,
  one file per job), `memory-store.ts` (tests only), `store.ts` (the singleton).
- `lib/pipeline/run-analysis.ts` — the analysis pipeline, end to end.
- `lib/api/` — `analysis-service.ts` (the whole API, without HTTP),
  `analysis-dto.ts`, `errors.ts`.
- `app/api/analyze/route.ts` — `POST`, three lines.
- `app/api/analyze/[id]/route.ts` — `GET`, three lines.
- `ANALYSIS_STORE_DIR` in `lib/config/env.ts` and `.env.example`; `.data/`
  gitignored.

Every state in ADR-011 is reachable: `queued` on acceptance, `running` once the
pipeline starts, `completed` with a report, `failed`/`timeout`/`blocked` from
the pipeline's outcome, and `invalid_url`/`blocked` from a refused submission.

Rules worth knowing (ADR-057):

- **a job id is a capability and a filename.** A v4 UUID, refused by the route
  and again by the store if it is anything else. A malformed id returns
  `not_found`, not a validation error.
- **a refused submission is still an analysis** — it gets a job and a
  retrievable record, and the POST also returns the structured error (400 for
  `invalid_url`, 403 for `blocked`).
- **validation cannot be bypassed.** The job stores the normalized URL and the
  runner is handed that; `submittedUrl` is kept only to explain a refusal and is
  never fetched or resolved.
- **route files contain no decisions.** `lib/api` takes a `Request` and returns
  a `Response`, knowing nothing about Next.js — which is why the integration
  tests drive the real request path.
- **the DTO is a whitelist**, built field by field. A filter fails open.
- **`internal_error` carries one fixed sentence.** Unexpected detail goes to the
  log, never to a client, and a test asserts a store failure mentioning a
  filesystem path produces a response that does not.

Validation: typecheck, lint, format check, 1941 tests (93 for this phase) and
`next build` all pass, with both routes registered dynamic. The pipeline tests
run the real analyzers against a real local HTTP server.

Not delivered, deliberately:

- **accessibility, performance and mobile are not wired into the pipeline.**
  They need a browser and Lighthouse, this environment has no Chromium, and
  shipping unexercised browser orchestration inside the API would be worse than
  an API that says which analyzers it ran. Their categories are *not assessed*
  with weights redistributed (ADR-036), and `notRun` names them in every report.
- no rate limiting or concurrency control — Phase 20
- no retention or history — Phase 19
- no UI — Phase 17

Known limitations: the stored report embeds findings more than once, because
recommendations and roast lines hold finding references that serialize by value.
Nothing expires, so the store grows until Phase 19. A deployment must point
`ANALYSIS_STORE_DIR` at a mounted volume or lose every report on each build.


---

# NON-GOALS

Do not implement prematurely:

- billing
- accounts
- subscriptions
- teams
- complete-site crawling
- browser extension
- mobile app
- public leaderboard
- enterprise architecture

Build the smallest useful system first.