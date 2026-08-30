# Website Roaster — Architecture Decision Record

This file records important architectural and product decisions.

The purpose is to prevent architectural drift and repeated decision-making.

Claude Code must read this document before making a significant architectural decision.

When a new significant decision is required, add a new entry rather than silently changing an existing decision.

---

# Decision Status

Possible statuses:

- Proposed
- Accepted
- Superseded
- Rejected

---

# ADR-001 — Analysis Architecture

## Status

Accepted

## Decision

Website analysis is divided into independent analyzer modules.

Expected analyzers include:

- URL validation
- HTTP
- browser
- DOM
- SEO
- performance
- accessibility
- security
- mobile
- content
- UX

Each analyzer produces structured evidence.

Analyzers should not calculate the overall website score.

## Reason

Separating evidence collection from scoring makes the system:

- easier to test
- easier to extend
- easier to debug
- easier to explain to users

---

# ADR-002 — Deterministic Scoring

## Status

Accepted

## Decision

Website quality scores must be calculated deterministically from collected evidence.

The AI model must NOT directly determine the numerical website score.

Example architecture:

```text
Website
   ↓
Evidence
   ↓
Rules
   ↓
Category Scores
   ↓
Overall Score
```

The AI operates after scoring.

## Reason

A user should be able to understand why their website received a particular score.

A score based entirely on LLM opinion would be inconsistent and difficult to reproduce.

---

# ADR-003 — AI Role

## Status

Accepted

## Decision

AI is an interpretation layer rather than the source of objective measurements.

The AI may be used for:

- content interpretation
- UX interpretation
- screenshot analysis
- prioritizing findings
- recommendations
- executive summary
- roast generation

The AI must not invent measurements.

The AI must only reason from supplied evidence.

---

# ADR-004 — AI Provider Abstraction

## Status

Accepted

## Decision

The application must not be tightly coupled to one AI provider.

Create an abstraction similar to:

```text
AI Provider Interface
        │
        ├── Gemini
        │
        ├── OpenRouter
        │
        └── Other provider
```

The rest of the application communicates with the provider abstraction rather than directly with a specific vendor.

## Reason

AI pricing, model quality, availability and free-tier limits can change.

The provider should therefore be replaceable without redesigning the application.

---

# ADR-005 — Single-URL Analysis

## Status

Accepted

## Decision

Version 1 analyzes exactly one submitted URL.

It does not recursively crawl the entire website.

## Reason

Full-site crawling introduces significantly greater complexity:

- crawl scheduling
- deduplication
- robots handling
- URL discovery
- resource management
- concurrency
- rate limiting

Single-page analysis allows the core product to become reliable first.

---

# ADR-006 — Browser Automation

## Status

Accepted

## Decision

Use a real browser automation environment for rendered-page analysis.

The browser layer is responsible for:

- rendering pages
- screenshots
- viewport testing
- DOM inspection
- network observation
- console errors

Browser execution must be isolated from the main application as much as practical.

---

# ADR-007 — Lighthouse

## Status

Accepted

## Decision

Use Lighthouse or another established auditing engine where it provides reliable standard measurements.

Do not rebuild mature auditing logic unnecessarily.

The Website Roaster system normalizes external audit results into its own internal finding model.

## Reason

The project should add value through:

- normalization
- scoring
- UX interpretation
- recommendations
- visualization
- AI-assisted analysis

rather than reimplementing established browser auditing algorithms.

---

# ADR-008 — Evidence Model

## Status

Accepted

## Decision

Every important finding should contain evidence.

Conceptually:

```text
Finding
├── id
├── category
├── severity
├── status
├── evidence
├── explanation
└── recommendation
```

A finding must be traceable to something actually observed by the analyzer.

---

# ADR-009 — Fact vs Heuristic

## Status

Accepted

## Decision

The system distinguishes:

```text
Measured
```

from:

```text
Heuristic
```

Measured examples:

- HTTP status
- LCP
- CLS
- missing title
- missing security header

Heuristic examples:

- visual hierarchy
- clarity of copy
- perceived clutter
- CTA prominence

The UI should not present subjective heuristics as absolute facts.

---

# ADR-010 — Security Model

## Status

Accepted

## Decision

All user-provided URLs are untrusted.

The analysis system must defend against SSRF and related network abuse.

The system must validate URLs before network access and protect against access to:

- localhost
- loopback
- private networks
- link-local networks
- metadata endpoints
- internal hostnames

The browser process must also be treated as a security boundary.

---

# ADR-011 — One Analysis Job

## Status

Accepted

## Decision

An analysis is represented as a job with an explicit lifecycle.

Initial states:

```text
queued
running
completed
failed
timeout
blocked
invalid_url
```

The frontend should not assume that an analysis always succeeds.

---

# ADR-012 — Raw Data vs Derived Data

## Status

Accepted

## Decision

Raw measurements must remain separate from normalized scores.

Example:

```text
Raw:
LCP = 2.43s

Derived:
Performance contribution = 82
```

Never overwrite raw measurements with normalized scores.

## Reason

Raw data may be needed later to:

- change scoring weights
- debug incorrect scoring
- compare scoring versions
- improve the product

---

# ADR-013 — Scoring Versioning

## Status

Accepted

## Decision

The scoring system should support versioning.

Example:

```text
scoring_version: 1
```

When scoring logic changes significantly, increment the version.

## Reason

The meaning of an old score should remain understandable even after the scoring algorithm changes.

---

# ADR-014 — AI Evidence Boundary

## Status

Accepted

## Decision

The AI receives normalized evidence rather than unrestricted internal application state.

A conceptual AI input is:

```text
Website metadata
+
Page content
+
Performance metrics
+
SEO findings
+
Accessibility findings
+
Security findings
+
Mobile findings
+
UX signals
+
Screenshots
```

The AI should not have access to secrets, database credentials, internal network information or unrelated application state.

---

# ADR-015 — Roast Generation

## Status

Accepted

## Decision

Roasts are generated only from actual website findings.

A roast should be:

- humorous
- concise
- evidence-based
- relevant
- non-abusive

The system should avoid fabricating problems purely to make the roast funnier.

---

# ADR-016 — AI Failure Must Not Break Core Analysis

## Status

Accepted

## Decision

The application must still produce the deterministic technical report if the AI provider fails.

AI is an enhancement layer, not a hard dependency for basic analysis.

Example:

```text
Technical analysis
        ↓
Score
        ↓
AI available?
   ┌────┴────┐
  yes       no
   ↓         ↓
AI report   Basic report
```

---

# ADR-017 — V1 Product Scope

## Status

Accepted

## Included

- URL submission
- safe validation
- single-page HTTP analysis
- browser rendering
- screenshots
- SEO analysis
- performance analysis
- accessibility analysis
- security analysis
- mobile analysis
- content analysis
- UX heuristics
- deterministic scoring
- AI interpretation
- recommendations
- roast
- shareable result

## Excluded

- user accounts
- billing
- subscriptions
- teams
- public leaderboard
- full-site crawling
- browser extension
- mobile application

These features require an explicit future decision.

---

# ADR-018 — Provider Secrets

## Status

Accepted

## Decision

AI API keys and other secrets are server-side only.

Never expose secrets through public client-side environment variables.

Never commit secrets to source control.

---

# ADR-019 — Database Timing

## Status

Accepted

## Decision

Do not introduce persistent database infrastructure before the core analysis pipeline is useful and stable.

The first local development phases should avoid unnecessary persistence.

Persistence can be introduced when analysis history or asynchronous jobs actually require it.

---

# ADR-020 — Infrastructure Evolution

## Status

Accepted

## Decision

Start with the simplest architecture capable of supporting the current phase.

Do not introduce:

- Redis
- queues
- worker clusters
- distributed services
- Kubernetes
- complex observability infrastructure

until the project actually requires them.

The architecture should evolve based on demonstrated constraints.

---

# ADR-021 — Failure Transparency

## Status

Accepted

## Decision

The system must distinguish between:

```text
No problem found
```

and:

```text
Could not determine
```

An analyzer that fails to inspect something must not report that the website passed.

Example:

```text
Security header could not be inspected
```

is different from:

```text
Security header exists
```

---

# ADR-022 — Reproducibility

## Status

Accepted

## Decision

Where possible, an analysis should be reproducible.

Store:

- analysis timestamp
- scoring version
- analyzer version where practical
- important configuration

This helps explain differences between analysis runs.

---

# ADR-023 — Dependency Discipline

## Status

Accepted

## Decision

Dependencies should be added only when there is a clear reason.

Prefer existing project utilities or platform APIs when they are sufficient.

Do not introduce libraries simply because they reduce a few lines of code.

---

# ADR-024 — Architecture Changes

## Status

Accepted

## Decision

Claude Code must not make significant architecture changes silently.

When an architectural decision is required:

1. identify the decision
2. explain the alternatives
3. choose a practical option
4. document it here
5. implement it

Do not repeatedly revisit accepted decisions without new evidence.

---

# ADR-025 — Test Framework

## Status

Accepted

## Decision

Use **Vitest** as the unit and integration test runner.

Unit tests are colocated with the code they cover as `*.test.ts`.

Browser-level end-to-end tests are deferred until Phase 17, when a UI exists to test.

## Alternatives considered

- **Jest** — mature, but needs additional transform configuration for ESM and TypeScript in a Next.js project.
- **`node:test`** — zero dependencies, but weaker assertion ergonomics and no watch-mode UX.

## Reason

Vitest runs TypeScript and ESM without extra transform configuration, which matters because the analyzers will be plain TypeScript modules outside the Next.js build.

## Consequences

- `npm test` runs the suite once; `npm run test:watch` watches.
- Test files live beside their subject, so a module and its tests move together.
- A separate browser test runner is an open decision, deferred to Phase 17.

---

# ADR-026 — Code Formatting

## Status

Accepted

## Decision

Use **Prettier** for code formatting. Linting (ESLint) and formatting (Prettier) stay separate concerns.

Markdown is excluded from formatting via `.prettierignore`.

## Reason

The documentation is hand-authored prose containing hand-drawn diagrams. Reflowing it produces review churn and can damage the diagrams, with no benefit.

## Consequences

- `npm run format` writes; `npm run format:check` verifies and is part of `npm run verify`.
- A `.gitattributes` file normalises line endings to LF so the check behaves identically on Windows and CI.

---

# ADR-027 — Directory Layout

## Status

Accepted

## Decision

```text
app/                     Next.js App Router — UI and route handlers only
lib/                     All framework-independent application logic
  config/                Validated configuration
  observability/         Logging
  types/                 Shared domain types
docs/                    Specification and decisions
public/                  Static assets
```

Rules:

1. `lib/` must not import from `app/`. The dependency arrow points one way.
2. `lib/` must not import Next.js runtime APIs. Analyzers are plain TypeScript and must remain runnable outside the framework — this is what keeps them testable and what allows the analysis pipeline to move to a worker later without a rewrite.
3. `lib/types/` contains types, literal constants and type guards only. No I/O, no business logic.
4. Imports use the `@/` alias rather than deep relative paths.

Analyzer modules are added under `lib/analysis/` as their phases land. The directory is not created before something lives in it.

## Reason

The one boundary that matters is that the analysis pipeline does not become entangled with the web framework. Everything else is ordinary organisation.

---

# ADR-028 — Environment Variable Handling

## Status

Accepted

## Decision

All environment variables are declared, typed and validated in a single module: `lib/config/env.ts`.

Application code calls `getServerEnv()`; it does not read `process.env` directly.

`getServerEnv()` throws if called in the browser, which makes an accidental client-side import a loud failure rather than a silent secret leak.

Validation is hand-written. No schema library is added at this stage (ADR-023).

`.env.example` documents every variable and is committed; real `.env*` files are not.

## Reason

One validation site means one place to look for what the application actually needs, and one place that fails loudly at startup when a value is wrong.

## Consequences

- A variable is added only when something reads it.
- If the number of variables or the complexity of their constraints grows enough to make hand-written parsing error-prone, revisit and adopt a schema library.

---

# ADR-029 — Canonical Finding Model

## Status

Accepted

## Supersedes

The conflicting finding shapes previously described in `docs/IMPLEMENTATION.md` Phase 5 and Phase 13.

## Decision

There is exactly one finding type, defined in `lib/types/finding.ts` and specified by ADR-008:

```ts
interface Finding {
  id: string
  category: AnalysisCategory
  severity: "critical" | "serious" | "moderate" | "minor" | "info"
  status: "pass" | "warn" | "fail" | "could_not_determine"
  evidence: readonly Evidence[]
  explanation: string
  recommendation?: string
}
```

Notes:

- `explanation` is the canonical field name. Phase 5's `description` and Phase 13's `recommendedAction` were alternative names for the same two fields and are withdrawn.
- `status` includes `could_not_determine`, which ADR-021 requires and which must never be collapsed into `pass`.
- Each `Evidence` entry declares whether it is `measured` or `heuristic` (ADR-009).
- Severity names match the accessibility audit vocabulary so that Phase 7 results need no second mapping table.
- A Phase 13 recommendation is a **derived view** over findings, not a competing record. It adds ranking and presentation; it does not restate the evidence in a different shape.

## Reason

Three overlapping shapes for one concept would have forced a translation layer between every analyzer and the scoring engine.

---

# ADR-030 — INP Cannot Be Measured In A Lab Run

## Status

Accepted

## Supersedes

The INP entry in the Performance weighting of `docs/SCORING.md`.

## Decision

Replace INP with **Total Blocking Time (TBT)** in the Performance score, keeping the same 20% weight.

## Reason

Interaction to Next Paint is a *field* metric. It requires real user interactions to exist, and cannot be produced by a single synthetic page load. Lighthouse reports TBT as the established lab proxy for interaction readiness.

Scoring 20% of Performance on a metric the system cannot obtain would have violated ADR-021 and CLAUDE.md's rule against inventing measurements.

## Consequences

- The report must not display an INP number.
- If real-user monitoring is ever added, INP becomes available and this decision can be revisited.

---

# ADR-031 — Analysis Execution And When Persistence Arrives

## Status

Accepted

## Amends

ADR-019 (Database Timing).

## Context

ADR-011 requires `queued` and `running` states, and Phase 16 requires a `GET /api/analyze/:id` polling endpoint. Both imply that job state survives between HTTP requests.

ADR-019 deferred persistence to Phase 19, and ADR-020 forbids Redis and queues. That combination left no valid place for job state to live: route handlers are stateless, the dev server reloads modules, and a production deployment may run more than one worker. Module-level state would appear to work locally and fail everywhere else.

## Decision

1. **Phases 2–15 do not expose an HTTP job API.** Each analyzer is exercised directly through its own tests. There is no cross-request job state, so ADR-019 holds unchanged during these phases.
2. **The job store arrives with Phase 16, not Phase 19.** The moment an asynchronous API exists, its state must be durable. Persistence is a prerequisite of that API, not a later enhancement.
3. **Phase 19 is re-scoped** from "introduce persistence" to analysis history and retention policy.
4. The concrete store is chosen at Phase 16, once the deployment target (ADR-032) is settled. It must be the simplest thing that survives a process restart.

## Reason

Building the async API before it has anywhere to keep state would produce something that passes local testing and breaks on deployment.

## Consequences

- Phase 16 is larger than originally written, because it now includes the job store.
- Phase 19 is smaller.

---

# ADR-032 — Runtime And Deployment Target

## Status

Accepted

## Decision

Website Roaster runs as a **long-running Node.js server**, not on a short-lived serverless function runtime.

## Reason

This is forced by decisions already accepted, not a preference:

- ADR-006 requires real browser automation, which needs a Chromium binary and hundreds of megabytes of disk.
- ADR-007 requires Lighthouse, which drives that browser through a full throttled page load.
- A single analysis will routinely exceed the execution limits of default serverless runtimes.

## Consequences

- `README.md` no longer recommends the create-next-app default deployment path.
- Browser binaries are provisioned as part of the deployment image, not downloaded at request time.
- Concurrency becomes a real constraint: one browser per analysis is expensive. Limits are addressed in Phase 20.

## Revisit if

The browser-dependent phases are dropped, or a serverless-compatible browser runtime is adopted deliberately.

---

# ADR-033 — Browser Tool And Its Relationship To Lighthouse

## Status

Accepted

## Decision

Use **Playwright** for browser automation (Phase 3).

Lighthouse (Phase 8) connects to the **same browser instance** over the DevTools protocol but performs its **own page load** in a fresh context.

## Alternatives considered

- **Puppeteer** — closest to Lighthouse's own tooling, but a narrower feature set for the viewport and screenshot work in Phases 3 and 9.
- **One shared page load for everything** — cheaper, but invalid: Lighthouse requires a cold, throttled load to produce meaningful metrics. Reusing a warmed page would silently corrupt the performance numbers.

## Reason

Sharing the browser process avoids launching Chromium twice, which is the expensive part. Not sharing the page load keeps the performance measurements honest.

## Consequences

- Phase 3's browser module must expose a connection endpoint, not only a page handle. This shapes its public interface, which is why the decision is recorded before Phase 3 rather than at Phase 8.
- The target site is loaded more than once per analysis. This is a deliberate, documented cost.

---

# ADR-034 — Concrete AI Provider

## Status

Proposed

## Context

ADR-004 requires a provider abstraction but names no provider. Phase 14 additionally requires the model to interpret screenshots, which constrains the choice to a multimodal model.

## Proposal

Implement the provider interface with a single V1 adapter, chosen at Phase 14. Whichever provider is selected must:

- expose a multimodal model, because ADR-014 includes screenshots in the AI input;
- accept image input by value, because there is no artifact store before Phase 16 (ADR-031);
- be reachable behind a server-side key only (ADR-018).

## Status note

This must be moved to Accepted before Phase 14 begins. It is recorded now so the constraint on multimodality is not discovered late, but the choice itself needs no resolution until then and depends on pricing and availability at that time.

---

# ADR-035 — SSRF Threat Model Scope

## Status

Accepted

## Context

Phase 1 validates the submitted URL, and its acceptance criterion reads as though this closes the SSRF risk. It does not. Validating a hostname is only the first of several controls, and CLAUDE.md explicitly warns that hostname validation alone is insufficient.

## Decision

The SSRF defence is layered across phases, and each phase owns a named part of it:

**Phase 1 — submitted URL**

- protocol allowlist (`http`, `https` only)
- reject credentials in the URL
- reject hostnames that are IP literals in disallowed ranges
- reject `localhost` and internal-only hostname patterns

**Phase 2 — the request itself**

- resolve the hostname, validate **every** resolved address, and pin the connection to a validated address. Validating a name and then letting the HTTP client re-resolve it is a DNS-rebinding hole (TOCTOU).
- re-validate **every redirect hop** against the same rules. A public URL redirecting to `169.254.169.254` is the obvious bypass.
- enforce timeout, maximum response size and redirect limit.

**Phase 3 — the browser**

- the rendered page can request any URL it likes, including internal ones. This is the largest part of the surface and is **not** addressed by Phases 1 and 2.
- the browser must be network-isolated so that it cannot reach private ranges regardless of what the page requests.

**Phase 5 — secondary fetches**

- `robots.txt` and `sitemap.xml` are fetched through the same validated client as Phase 2. They are not exempt because they are "our own" requests.

## Reason

Writing this down now prevents Phase 1 from being marked complete under the false impression that SSRF is solved.

## Consequences

- Phase 1's acceptance criterion is narrowed to what it actually establishes.
- Phase 20's "SSRF testing" becomes verification of controls that already exist, rather than the first time the problem is considered.

---

# ADR-036 — Categories That Could Not Be Measured

## Status

Accepted

## Context

ADR-021 requires the system to distinguish "no problem found" from "could not determine". The scoring engine must therefore answer: what does a category score when its evidence could not be collected?

## Decision

A category whose evidence could not be collected is **excluded from the overall score**, and the remaining category weights are redistributed proportionally.

The report must show the category as *not assessed*, with the reason. It must not show a zero, and it must not show a pass.

## Reason

Scoring an unmeasurable category as zero would punish a site for our own failure to measure it. Scoring it as full marks would be a false pass. Excluding it is the only honest option.

## Consequences

- The overall score must be accompanied by which categories contributed to it.
- Two analyses of the same site are only directly comparable when the same categories were assessed. The set of assessed categories is stored alongside the score (ADR-022).

---

# ADR-037 — Category Weights Need Product Review

## Status

Proposed

## Context

The weights in `docs/SCORING.md` were recorded before any analyzer existed. Two of them look unintentional:

- **Security is 5%.** A site served over plain HTTP with no security headers can lose at most five points overall, while CLAUDE.md treats security as a first-order concern and dedicates a full phase and several ADRs to it.
- **UX is 20%**, tied for the highest weight, while Phase 11 describes UX signals as "heuristic signals, not objective truth". Combined with Content at 15%, roughly a third of the overall score rests on the least objective evidence the system collects — which is in tension with ADR-002's goal that a user can understand why they got their score.

## Proposal

Review the weights before Phase 12 implements them.

No change is made here, because weights are a product judgement and CLAUDE.md forbids inventing them. This entry exists so the question is answered deliberately rather than inherited by default.


---

# ADR-038 — URL Normalization Rules

## Status

Accepted

## Context

Phase 1 must return a single canonical form of an accepted URL. Without fixed
rules, the same page could be analyzed under several different identities, and
Phase 16 would later have no reliable key for an analysis.

## Decision

An accepted URL is normalized as follows.

Delegated to the WHATWG URL parser, which the platform already implements:

- the scheme and host are lowercased;
- an internationalised host is converted to punycode;
- an explicitly written default port is removed;
- a missing path becomes `/`.

Applied by us:

- **the fragment is dropped.** It is never transmitted to the server, so two
  URLs differing only by fragment are the same analysis.
- **a trailing root dot is removed from the host.** `example.com.` and
  `example.com` are the same host, and keeping the dot would also let
  `localhost.` slip past a suffix check.

Deliberately *not* applied:

- **the query string is preserved.** It routinely determines what the page
  renders; stripping or reordering it would analyze a different page.
- **the trailing slash of a path is preserved.** `/a` and `/a/` may serve
  different content.

## Schemeless input is refused, not repaired

Input such as `example.com` is refused with the dedicated code
`missing_scheme`, rather than being silently upgraded to `https://example.com`.

Guessing a scheme means deciding, on the user's behalf, which of two different
origins to contact. `http://` and `https://` can serve different content, and a
silent guess is the kind of implicit behaviour that is hard to reason about
later.

The dedicated code exists so the UI can still offer a one-click
"did you mean https://example.com?" — the affordance is preserved, but the
choice stays visible and belongs to the user.

## Consequences

- Normalization is idempotent, and there is a test asserting it.
- A URL that differs only by fragment will produce a cache or history hit once
  Phase 16 exists.

---

# ADR-039 — Only Default Ports Are Analyzed

## Status

Accepted

## Context

Phase 1 must decide what to do with an explicit port, e.g.
`http://example.com:8080/`.

Permitting arbitrary ports would let anyone use a public analysis tool to probe
which ports are open on a third-party host, and to distinguish "refused" from
"timed out" by the error we report back. That is a port scanner with someone
else's IP address on it.

Blocking private *addresses* does not address this: the abuse is against public
hosts, which pass every other check in this phase.

## Decision

Only the default port for the scheme is analyzed — 80 for `http`, 443 for
`https`. An explicit non-default port is refused with `disallowed_port`.

An explicitly written default port (`https://example.com:443/`) is accepted and
normalized away, because it denotes exactly the same endpoint.

## Alternatives considered

- **Allow any port.** Simplest, and matches what a browser does, but hands out
  the scanning capability described above.
- **Allow a small allowlist (80, 443, 8080, 8443).** Softer, but the extra
  ports are arbitrary: 8080 is no more "a website" than 8000 or 3000, and the
  scanning concern returns in reduced form.

## Reason

V1 analyzes public websites, and public websites are served on default ports.
The restriction costs little and removes a whole abuse category.

## Consequences

- A legitimate site on a non-standard port cannot be analyzed. This is a real
  limitation and is documented as such.
- Port checks run *after* address and hostname classification, so a private
  address on port 8080 is reported as a private address — the more important
  fact.

## Revisit if

Users report real sites they cannot analyze, or rate limiting and abuse
controls (Phase 20) make the scanning concern manageable by other means.

---

# CHANGE LOG

## Initial version

Defined the foundational architecture and product boundaries for Website Roaster.

## Phase 0 — Repository Foundation

Added ADR-025 to ADR-037.

Resolved the decisions that blocked implementation (test framework, formatter,
directory layout, environment handling, canonical finding model) and recorded
the contradictions found during the pre-implementation documentation review:

- ADR-029 replaced three competing finding shapes with one.
- ADR-030 removed INP, which a lab run cannot measure.
- ADR-031 amended ADR-019 so the job store arrives with the async API that needs it.
- ADR-035 documented that Phase 1 does not, by itself, close the SSRF risk.
- ADR-036 defined what happens to a category that could not be measured.
- ADR-034 and ADR-037 are Proposed and still need an answer before Phases 14 and 12 respectively.

## Phase 1 — URL Validation

Added ADR-038 and ADR-039.

Both were forced by implementing Phase 1 and are recorded rather than assumed:

- ADR-038 fixed the normalization rules and decided that schemeless input is
  refused with an actionable code instead of being silently upgraded to https.
- ADR-039 restricted analysis to the default ports, so the tool cannot be used
  to port-scan a third party.

New decisions are appended immediately above this section, using the form:

```text
ADR-XXX
Status
Decision
Reason
Alternatives considered
Consequences
```