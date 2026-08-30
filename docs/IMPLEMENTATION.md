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

The browser is network-isolated so that a rendered page cannot reach private
addresses (ADR-035).

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
Phase 2 — ⏳ Not started
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