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

# ADR-040 — HTTP Retrieval Model and Budgets

## Status

Accepted

## Decision

### The client is `node:http` / `node:https`, not `fetch`

Three Phase 2 requirements are not expressible through `fetch`:

- **pinning the connection to a pre-validated address**, which needs the
  `lookup` option (ADR-041);
- **following redirects manually**, so every hop can be re-validated (ADR-035);
- **aborting a response mid-stream** once it exceeds the size budget.

`node:http` supports all three and is already in the platform, so no dependency
is added (ADR-023).

Connection pooling is disabled (`agent: false`). Each analysis opens a fresh,
separately validated connection, and timings are not skewed by a reused socket.

### Only HTML bodies are downloaded

If the response is not `text/html` or `application/xhtml+xml`, the body is not
read: the analyzer has no use for the bytes of a PDF or a video, and streaming
one would consume the size budget for nothing.

Metadata is still reported — status, headers, content type, and the
`Content-Length` the server declared. Observed size is reported as `null`,
meaning "not measured" rather than "zero" (ADR-021).

### Compressed responses are decompressed

The analyzer advertises `gzip, deflate, br` and decodes the response, recording
**both** sizes:

- `transferredBytes` — what crossed the wire;
- `decodedBytes` — the size after decompression.

Keeping both matters. The pair is the raw evidence for the compression findings
in Phases 6 and 8, and discarding either would violate ADR-012. Requesting
`identity` instead was considered and rejected: many servers and CDNs compress
regardless, and the body would then be unreadable.

### Budgets

| Budget | Default | Applies to |
| --- | --- | --- |
| Total time | 15s | The whole chain, including every redirect |
| Response size | 5 MiB | Transferred **and** decoded bytes, separately |
| Redirects | 5 | Hops followed before giving up |

The time budget covers the whole chain rather than each request, so a site
cannot extend its own deadline by redirecting.

The size budget is applied to the decoded stream as well as the transferred one.
That second check is the decompression-bomb guard: a few kilobytes of gzip can
expand to gigabytes, and a transferred-bytes cap alone would not notice.

## Consequences

- A legitimate page larger than 5 MiB is refused. This is reported explicitly as
  `response_too_large`, not as a generic failure.
- An HTML page served with a wrong content type is treated as non-HTML and its
  body is not analyzed. Sniffing the body to second-guess the server is
  deliberately not done at this stage.

---

# ADR-041 — Every Resolved Address Must Pass

## Status

Accepted

## Context

Phase 1 can only judge the URL string. The address behind a hostname is unknown
until it is resolved, and an attacker controls the DNS for their own domain.

Two attacks follow: a public name with an `A` record pointing at
`169.254.169.254`, and DNS rebinding, where the name resolves to a public
address when checked and a private one when the socket connects.

## Decision

1. **Resolve once, then pin.** The analyzer resolves the hostname itself,
   validates the result, and hands the socket a single validated **address**.
   There is no second resolution for an attacker to poison. The `Host` header
   and TLS server name still carry the hostname, so virtual hosting and
   certificate verification are unaffected.

2. **All addresses must pass, not just the one we pick.** If a hostname resolves
   to several addresses and *any* of them is disallowed, the whole connection is
   refused.

The obvious alternative — filter the disallowed addresses out and connect to a
surviving public one — was rejected. It lets a hostile resolver decide which
address we eventually reach, and a name resolving to both a public and a private
address is either misconfigured or hostile. Neither deserves a request.

3. **Address validation reuses the Phase 1 classifier.** There is exactly one
   definition of "an address we refuse to contact" in the codebase, so a range
   added for the URL layer is automatically enforced for resolved addresses too.

## Consequences

- A name behind round-robin DNS that mixes public and private addresses cannot
  be analyzed. This is rare and the refusal is explicit.
- The security policy is an injectable interface, so tests can point the
  analyzer at a local server. The production default is strict and the shipped
  code contains no bypass; a test that needs loopback defines its own policy.

---

# ADR-042 — The Browser Request Guard, And What It Does Not Do

## Status

Accepted

## Context

ADR-035 assigns the largest part of the SSRF surface to Phase 3: a rendered page
issues its own requests, and it chooses them. An attacker's page can simply
contain `fetch('http://169.254.169.254/latest/meta-data/')`. Neither URL
validation nor the pinned HTTP client sees that request.

## Decision

Every request the browser makes is intercepted and checked against the same
policy the HTTP analyzer uses:

- non-network schemes (`data:`, `blob:`, `about:`) are allowed unchecked, since
  refusing them breaks ordinary pages while preventing nothing;
- `file:`, `ftp:` and anything else exotic are refused;
- `http:` and `https:` URLs go through the Phase 1 validator, then their
  hostname is resolved and every resolved address is checked with the Phase 1
  classifier.

Refused requests are aborted and recorded, so a blocked request is visible
evidence rather than a silent hole in the page.

Resolution results are cached per hostname. A page makes hundreds of requests to
a handful of hosts, and an uncached guard would issue a DNS lookup per
subresource and dominate the page load.

A hostname that fails to resolve is **allowed** rather than refused. It cannot
reach anything, and refusing it would report a security block for what is
actually a broken DNS record — which would mislead the user (ADR-021).

## What this does NOT do

**This is not isolation, and the browser must not be described as isolated
because of it.**

Chromium performs its own DNS resolution. A name that resolves to a public
address when the guard checks it can resolve to a private one when the browser
connects. That is the same rebinding window Phase 2 closes by pinning the
socket — and it cannot be closed here, because we do not own the socket.

Phase 3's constraint in `docs/IMPLEMENTATION.md` says "the browser is
network-isolated". This guard does not achieve that on its own. Real isolation
requires a boundary the process cannot cross:

- a container with no route to private ranges, or
- an egress firewall denying RFC 1918, link-local and metadata addresses.

That is a deployment control, not application code. It is tracked as a Phase 20
prerequisite and must be in place before the analyzer is exposed publicly.

## Known gaps

- **WebSockets are not intercepted.** Playwright's request routing does not
  cover them, so a page could open a `ws://` connection the guard never sees.
  The network boundary above is what closes this.
- **The guard runs in-process**, so a Chromium sandbox escape would bypass it
  entirely. The sandbox is deliberately left enabled (`--no-sandbox` is never
  passed) for that reason.

---

# ADR-043 — Rendering Model

## Status

Accepted

## Decision

### One browser, one context per viewport

The desktop and mobile renderings run in **separate browser contexts** inside a
**single browser process**.

Separate contexts because a shared one would carry cache, cookies and storage
from the first rendering into the second, so the mobile measurements would
describe a warm visit rather than a first one. A single process because
launching Chromium is the expensive part (ADR-033), and it is what lets Phase 8
attach Lighthouse to the same browser.

### Navigation waits for `load`, then a fixed settle allowance

`networkidle` never arrives on a page that polls or holds a long connection, so
it cannot be the wait condition. The analyzer waits for `load` and then allows a
fixed, small settle period (1.5s by default) for work that happens after it.

This is a deliberate approximation. It will under-measure pages that render
late, and Phase 8's Lighthouse run — which has its own, more rigorous wait — is
the authority on performance.

### Nothing observed here is interpreted here

Phase 3 returns the serialized post-JavaScript DOM. It does **not** parse it.

Structural extraction is Phase 4, layout judgement is Phase 9, and performance
scoring is Phase 8. Parsing here would create a second representation of the
page competing with Phase 4's, which is the situation ADR-029 exists to prevent.

The one exception is layout metrics (`scrollWidth`, `clientWidth`, and
friends), which are collected here because they cannot be recovered from HTML —
they only exist once the page has been laid out. They are raw measurements; what
they mean is Phase 9's decision.

### Screenshots are viewport-sized PNGs held in memory

Above-the-fold by default, at a device scale factor of 1. A full-page capture is
available behind an option.

Scale factor 1 rather than 2 because a retina capture is roughly four times the
bytes for no extra analytical value, and there is no artifact store before
Phase 16 (ADR-031) — every screenshot is carried in memory until then.

### Both viewports must succeed

If either rendering fails, the whole analysis fails. A partial result would
force every downstream consumer to handle a half-populated structure, and the
failure codes exist precisely so the reason can be reported accurately.

## Consequences

- The target site is loaded twice per browser analysis, plus once more by
  Lighthouse in Phase 8. This is the documented cost of ADR-033.
- Retained console and network entries are capped (200 and 500) so a chatty page
  cannot exhaust memory. The caps are recorded here so the truncation is not
  mistaken for a quiet page.

---

# ADR-044 — HTML Parsing And The Normalized Page Model

## Status

Accepted

## Context

Phase 4 must turn a page into one structured representation that every analyzer
from Phase 5 onwards reads. Two questions had to be answered: what parses the
HTML, and what the resulting model guarantees.

## Decision

### parse5, not a browser and not a DOM emulator

Node has no HTML parser, so a dependency is unavoidable — and hand-writing one
would be a correctness disaster, because real pages rely on the HTML5 recovery
rules for unclosed tags and implied elements.

**parse5** was chosen. It is the WHATWG-conformant parser that jsdom and cheerio
themselves use, and it brings one transitive dependency (`entities`).

Alternatives considered:

- **jsdom** — a full DOM plus a scripting environment. Far more surface than
  reading attributes needs, and a much larger dependency tree.
- **cheerio** — pleasant jQuery-style selectors, but a heavier tree and a
  querying idiom this codebase does not otherwise use. It wraps parse5 anyway.
- **node-html-parser** — small and fast, but not spec-compliant on malformed
  input, which is precisely the input that matters.
- **Re-using the Phase 3 browser** — rejected. It would make Phase 4 depend on
  Chromium, make its output non-deterministic, and duplicate work Phase 3 has
  already done.

A thin traversal adapter (`dom-tree.ts`) is the only module that knows what a
parse5 node looks like, so the parser could be replaced without touching the
extractors.

### The extractor is a pure function

`extractPageData(html, url)` launches no browser, makes no request and reads no
clock. That is what makes Phase 4's acceptance criterion — deterministic output
for the same page state — structurally true rather than merely asserted, and it
is why the phase is fully unit-testable.

It accepts either the raw HTML from Phase 2 or the post-JavaScript DOM from
Phase 3. The caller decides; on a JavaScript-rendered site the rendered form is
the honest one.

### `null` and `""` mean different things

Throughout `PageData`, `null` means "not present in the document" and `""` means
"present but empty".

`<title></title>` is a different fact from a page with no `<title>`, and
`<img alt="">` — the correct way to mark a decorative image — is a different
fact from an `<img>` with no `alt` at all, which is a defect. Collapsing either
pair would destroy exactly the distinction ADR-021 exists to preserve, and would
make a correctly-marked decorative image indistinguishable from a broken one.

### Extraction never judges

Nothing in Phase 4 decides whether a title is too long, whether an image needs
alt text, or whether a page has too many scripts. Those are Phases 5 to 11.

Two consequences of holding that line:

- image `width`/`height` are kept as **raw attribute strings**. They may read
  `100`, `100px` or nonsense, and normalising them here would silently discard
  the difference between "declared oddly" and "not declared".
- `<script type="application/ld+json">` blocks are listed in `scripts` *and*
  surfaced as raw `jsonLdBlocks`. They are scripts by element, data by content;
  reporting both lets a JavaScript-cost analyzer filter on `type` while an SEO
  analyzer reads the structured data. The JSON is deliberately left unparsed.

### `<base>` resolves, but does not redefine the site

A `<base href>` changes how relative URLs resolve. It does **not** change which
host counts as internal: that is a question about the page's own origin.

A page on `example.com` with `<base href="https://cdn.example.com/">` links
*away from its own site*, and reporting those links as internal would misdescribe
the site's structure. Resolution uses the base URL; classification uses the page
URL.

### Elements are matched in the HTML namespace only

`<a>` inside `<svg>` is an SVG link, not an HTML anchor. Counting it as one
would inflate the link list of every page using an inline icon set.

`<template>` contents are not read at all: they are inert until cloned, so they
are not part of the page as rendered.

## Consequences

- Phase 5 onwards reads `PageData` and never re-parses HTML, which is what keeps
  their findings consistent with one another.
- The model is plain data with no framework types, so it can cross the
  API boundary in Phase 16 unchanged.

## Deliberately not included

- **Body text and word counts.** Phase 10 extracts content, and holding the full
  text of every page here would add weight for a consumer that does not exist
  yet.
- **`<picture>` / `<source>` elements.** Only `<img>` is collected today.
- **Label-to-field association.** Phase 7 runs a real accessibility engine in the
  browser, which does this properly; approximating it here would produce a
  second, weaker answer to the same question.

---

# ADR-045 — SEO Checks, Thresholds And Site-File Retrieval

## Status

Accepted

## Decision

### Checks are pure; retrieval is separate

Every SEO check is a pure function of `PageData` (and, where relevant, already
retrieved site files). `analyzeSeo` performs no I/O at all.

The two checks that need the network — robots.txt and the sitemap — are fed by
`fetchSiteFiles`, which runs separately and hands its results in as data. That
split is what makes the whole phase deterministic and unit-testable, and it is
why the analyzer can be exercised without a server.

### Site files go through the Phase 2 client

`robots.txt` and `sitemap.xml` are retrieved with `fetchPage`, not a bare fetch.

They are not exempt from the SSRF controls for being "our own" requests: the
origin comes from a user-submitted URL, and a redirect from robots.txt is
exactly as dangerous as a redirect from the page (ADR-035).

This required a small extension to Phase 2: `downloadMediaTypes`. The client
previously downloaded HTML bodies only, which is right for a page and wrong for
a plain-text robots.txt. The response field was renamed `html` → `body` to match
what it now carries.

### Thresholds live apart from the checks

`thresholds.ts` holds every number — title length, description length, the
sitemap paths — for the same reason the scoring weights live in
`docs/SCORING.md`: so they can be reviewed without reading the logic, and so
nobody has to guess where a number came from.

They are **conventions, not measurements**: 60 characters for a title and 160
for a description are the widely published guidance for how search results
render, not laws. Every finding that applies one reports the measured value as
evidence, so a reader who disagrees with the threshold can still trust the
number.

### Severity reflects consequence, not effort

Two findings are `critical`, and only two:

- **`noindex` in the robots meta tag**, and
- **`Disallow: /` for `User-agent: *` in robots.txt.**

Both remove the site from search results entirely, and both are very commonly
left behind after a staging deployment. Everything else is at most `serious`,
because everything else degrades results rather than eliminating them.

Absence of something optional is a `warn`, never a `fail`. A missing sitemap or
missing structured data is worth mentioning; calling it a failure would
misrepresent how search works.

One case escalates: a sitemap **declared in robots.txt but not served** is a
`fail`, where simply having no sitemap is a `warn`. A broken promise is worse
than no promise.

### Every finding carries a recommendation

Stricter than the shared `Finding` type, which permits a `pass` to omit one.

A passing check still has something worth saying — what to keep doing as the
page changes — and a report where some rows have advice and others do not reads
as though the analyzer ran out of things to say. A `could_not_determine`
finding recommends how to establish the answer.

This is enforced by a test that drives every check down its failure, warning and
could-not-determine branches, so the rule is proven across the finding
vocabulary rather than on one happy path.

### An empty `alt` is not a defect

`alt=""` is the correct way to mark a decorative image. Phase 4 preserves the
difference between an absent and an empty `alt` specifically so this check does
not conflate them, and there is a test asserting a decorative image is not
reported.

Penalising `alt=""` would punish sites for doing the accessible thing.

### Not looking is never a pass

When site files were not retrieved, the checks emit `could_not_determine` — not
`pass`, and not silence. This is ADR-021 applied at the point it actually
matters: a report that quietly omits the robots.txt check reads as though
robots.txt were fine.

### Findings are ordered, not scored

`analyzeSeo` returns `Finding[]` in a fixed order — indexing directives first,
then metadata, structure, and resources. A page nobody can index has one problem
worth reading before the others.

It produces **no score**. Turning findings into numbers is Phase 12, and keeping
evidence collection apart from scoring is what makes a score explainable
(ADR-001, ADR-002).

## Deliberately limited

- **robots.txt parsing is minimal**: sitemap declarations and a site-wide
  wildcard block. Path matching, wildcards, `Allow` precedence and crawl-delay
  are not modelled, because nothing in V1 crawls (ADR-005) and a half-correct
  matcher would invite callers to trust it for decisions it cannot make.
- **The sitemap is checked for existence, not validity.** Its XML is not parsed
  and the URLs inside it are not verified.
- **Only the first heading-level skip is reported.** A page with a broken
  outline usually has many, and listing every one would bury the point.
- **No keyword, content-quality or backlink analysis.** Those are not technical
  SEO, and two of them are not observable from a single page at all.

---

# ADR-046 — Security Findings Report Configuration, Never Safety

## Status

Accepted

## Decision

### The analyzer never states that a site is secure

Everything Phase 6 reads is response metadata: the scheme, a handful of headers,
cookie attributes. That evidence can support *"this response does not set a
Content-Security-Policy"* — a fact. It cannot support *"this site is safe"*,
because nothing here tests the application, its dependencies, its
authentication, or anything behind it.

Passing findings therefore describe **configuration**, in those words. The HTTPS
pass says the transport was encrypted and "says nothing about the rest of the
site's configuration".

This is not modesty. A security section that reads as a clean bill of health is
worse than no security section, because it invites someone to stop looking. It
is enforced by a test that scans every explanation, recommendation and evidence
summary across every scenario for phrases like "is secure", "no
vulnerabilities" and "guarantee".

The analyzer also never claims a **vulnerability**. A missing header is a
missing header; whether it is exploitable here is not observable from a
response.

### Cookie values are never captured

`parseSetCookie` reads a cookie's name and attributes and discards the value.

A `Set-Cookie` on a real site frequently carries a live session token, and this
analyzer's output flows into logs, an API response, a stored report and
eventually an AI prompt (ADR-014). A value captured here would reach all of
them.

Nothing in the checks needs it — whether a cookie is `Secure` is a property of
its attributes. Keeping the value out of the data structure entirely is stronger
than remembering to redact it downstream, and there is a test asserting a
session value never appears in the serialized findings.

Cookie **names** are kept, because a finding that cannot say which cookie is
missing `Secure` is not actionable.

### Severity reflects consequence

- **`critical`** — no HTTPS. Everything else in the report is advisory when the
  connection can be read and rewritten in transit.
- **`serious`** — a cookie missing `Secure` on an HTTPS site, or `SameSite=None`
  without `Secure` (which current browsers reject outright, so the cookie simply
  does not work).
- **`moderate`** — a missing CSP, missing frame protection, missing HSTS.
- **`minor`** — disclosure, referrer policy, `nosniff`.

**Disclosure is deliberately minor.** Knowing a site runs nginx does not let
anyone in, and hiding it does not keep anyone out. A *version* is reported and a
bare product name is not, because a version turns "what is this running?" into
"which published vulnerabilities apply?".

### Frame protection is one finding, not two

`frame-ancestors` in a CSP supersedes `X-Frame-Options`. A site with a correct
CSP is protected, and reporting a missing legacy header alongside it would be
noise. The two mechanisms are assessed together and produce a single finding.

### Where a check cannot apply, it says so

HSTS delivered over plain HTTP is ignored by browsers, so on an HTTP page there
is nothing to assess — that check reports `could_not_determine`, not a failure
and not a pass (ADR-021). The HTTPS finding is the one that matters there.

## Deliberately limited

- **CSP parsing is structural.** It reads directives and source lists; it does
  not evaluate whether a policy is *correct* for an application, model nonce and
  hash fallback chains, or attempt bypass analysis.
- **Only the analyzed response is seen.** Cookies set later by JavaScript,
  headers on other routes, and per-endpoint policies are invisible.
- **No TLS inspection.** Certificate chain, protocol version and cipher suite
  are not examined; a failed handshake surfaces as a Phase 2 `tls_error`.
- **No active testing of any kind**, which is what keeps this analyzer safe to
  point at a site that did not ask to be scanned.

---

# ADR-047 — Accessibility Engine And Result Normalization

## Status

Accepted

## Decision

### axe-core, and the standard is not reimplemented

**axe-core** is the audit engine (ADR-007: do not rebuild mature auditing
logic). It is the engine behind most browser accessibility extensions and most
CI accessibility tooling, it has no dependencies of its own, and it ships the
entire engine as an injectable source string, so no file has to be resolved on
disk or served to the page.

Alternatives considered: **Lighthouse's accessibility category**, which runs
axe underneath and would arrive with a whole browser-audit harness this phase
does not need; and **pa11y**, which wraps engines rather than being one.

This phase's job is to carry the engine's verdicts across without losing the
trail back to them — not to have opinions about WCAG.

### Running and normalizing are separate

`runAxe` loads the page and produces an audit. `normalizeAxeResults` is pure and
turns an audit into findings.

The split matters because normalization is where an external tool's vocabulary
becomes ours, and a silent mismatch there would be invisible. Keeping it pure
means it is tested exhaustively with fixtures instead of a browser.

`runAxe` reuses Phase 3's session management and request guard rather than
building its own browser arrangement, so the security boundary and cleanup
behaviour are the ones already reviewed (ADR-042).

### The engine's types are re-declared, not imported

`types.ts` declares only the fields the normalizer reads, structurally satisfied
by axe's real output.

This keeps the normalizer free of any dependency on axe — so it can be tested
with plain objects, and swapping the engine later would touch the runner rather
than the normalizer. axe's own `Result` type carries a dozen fields this phase
never looks at, and satisfying it in a fixture would be noise.

### What is preserved

Phase 7's acceptance criterion is that findings trace back to actual audit
evidence, which is only true if the trail survives normalization. Every finding
keeps:

- the **rule identifier**, as `accessibility.axe.<rule-id>`;
- the **severity** — the engine's `critical`/`serious`/`moderate`/`minor` map
  onto ours one-to-one. That is not luck: the severity names in
  `lib/types/finding.ts` were chosen to match this vocabulary precisely so this
  phase needs no lossy translation table (ADR-029);
- the **affected elements**, as selectors plus their markup;
- the engine's **description** as the explanation, its **failure summary** as
  the recommendation, and a link to its **documentation**.

An unrecognised or absent impact becomes `moderate` rather than being dropped:
the engine found something worth reporting, and guessing low would quietly
demote a real problem.

### `incomplete` becomes `could_not_determine`

axe reports rules it could not decide. That maps onto ADR-021's
`could_not_determine` exactly.

Automation genuinely cannot settle some checks — whether alt text is
*meaningful*, for instance. Reporting those as passes would be the single most
misleading thing this phase could do, so they are reported as needing a human.

### Passes collapse into one finding

A typical page passes forty or more rules. One finding each would swamp the
report and bury the failures, so passes are summarised into a single finding
with the rule identifiers kept as evidence.

### Automated testing is a floor, not a ceiling

The analyzer never reports that a page **is accessible**. Automated tooling
reaches only a fraction of the success criteria: it cannot judge reading order,
whether a custom control works with a screen reader, or whether alt text says
anything useful.

The pass finding therefore says "these automated checks found no problem" and
states that this is not a claim of accessibility. Same reasoning as ADR-046 — a
section that reads as a clean bill of health invites someone to stop looking.

### A failed audit is a finding, not a missing section

When the audit cannot run, the analyzer returns a single `could_not_determine`
finding explaining why.

Dropping the section would let a reader assume accessibility was fine. Each
failure code has its own explanation, because a blocked URL and a crashed
browser are different events — and a strict Content-Security-Policy blocking the
engine's injection is called out by name, since that is the most likely cause on
a well-configured site and would otherwise look like a bug in this tool.

## Deliberately limited

- **One viewport, one page state.** The audit runs at the desktop viewport after
  load. Problems that appear only in a mobile layout, or behind an interaction,
  are not seen.
- **Element markup enters the report.** Snippets come from an untrusted page and
  are length-capped, but any UI rendering them must escape them.
- **No manual-check guidance.** The report does not enumerate what a human
  should test beyond the undecided rules the engine surfaces.

---

# ADR-048 — Performance Engine And The Raw/Derived Boundary

## Status

Accepted

## Decision

### Lighthouse, attached to the Phase 3 browser

**Lighthouse 13** is the performance engine (ADR-007, ADR-033). It supplies
every measurement this phase needs from one throttled load, and rebuilding that
harness would be exactly the mature auditing logic ADR-007 says not to rebuild.

ADR-033 requires it to attach to the same browser process while performing its
**own** page load — reusing a warmed page would silently corrupt every metric.
Playwright does not expose a raw DevTools port, so the browser is launched with
an explicit `--remote-debugging-port` and the engine connects to that. This is
why `launchSession` gained an `extraArgs` option; the hardening flags are
appended to, never replaced, and the sandbox is still never disabled.

### Audit identifiers were verified, not assumed

Lighthouse 13 replaced several long-standing opportunity audits with `*-insight`
audits. `render-blocking-resources`, `uses-optimized-images`,
`uses-long-cache-ttl` and `uses-text-compression` **no longer exist**; the
equivalents are `render-blocking-insight`, `image-delivery-insight`,
`cache-insight` and `document-latency-insight`.

The identifiers in `AUDIT_IDS` were read off a real report before being written
down. Had they been taken from older documentation, every one of those
measurements would have been silently `null` and the tests would still have
passed.

### Raw measurements and findings are separate return values

`analyzePerformance` returns `{ measurements, findings }`.

`measurements` holds what the engine observed, in its own units, unrounded and
uncombined. It contains **no score of any kind** — not ours, and not the
engine's — and there is a test asserting no score leaks into it.

That separation is ADR-012. Raw data must survive so the scoring weights can
change without re-running the audit, and so a wrong score can be debugged
against what was actually measured.

### The engine's score decides finding status, not the category score

Lighthouse scores each audit 0-1. That is used here exactly as axe's `impact` is
used in Phase 7: to decide whether a finding passes, warns or fails.

It is **not** the Website Roaster score. Phase 12 computes that from the raw
measurements under weights we control (ADR-002). Severity, when an audit fails,
is fixed per audit rather than derived from the score — how much a problem
matters depends on what it is, not on how far below a threshold it landed.

An audit with a `null` score is informational: the engine reported a number
without judging it. That becomes `could_not_determine`, not a pass.

### INP is collected as a field and is always null

The phase specification lists INP. It is present in `PerformanceMeasurements` as
a first-class field, and its value is always `null`, carrying
`inpUnavailableReason` alongside it.

INP is a **field metric**: it measures response to real user interactions, so it
requires real users. A synthetic load has nobody to interact with the page, and
any number produced here would be invented. ADR-030 established this; this phase
implements it by making the gap explicit rather than omitting the metric, and by
reporting Total Blocking Time as the established lab proxy in the same finding.

A `could_not_determine` finding says so in the report, so a reader cannot mistake
the silence for a good result (ADR-021).

### A failed audit yields empty measurements, never zeroed ones

Every field `null`, plus one `could_not_determine` finding. A page whose weight
was never measured must not look like a page that weighs nothing.

## Consequences

- This is a fourth page load per analysis, after Phase 3's two renderings and
  Phase 7's audit. ADR-033 accepts the cost; it is worth revisiting when the
  phases are orchestrated together in Phase 16.
- The engine's audit identifiers are a version-coupled surface. An end-to-end
  test runs the real engine and asserts the measurements still arrive, so an
  engine upgrade that renames an audit fails loudly rather than silently
  producing nulls.

## Deliberately limited

- **Lab data only.** No field data, no CrUX, no real-user monitoring.
- **One run.** Lighthouse metrics vary between runs on the same page; nothing
  here averages several, so a single result should not be read as precise.
- **Desktop, with the engine's default throttling.** No mobile performance run.
- **The performance category only.** Lighthouse's other categories are not run;
  accessibility is Phase 7's job with a lighter engine.

---

# ADR-049 — Mobile Signals, And Where The Heuristic Line Sits

## Status

Accepted

## Decision

### A browser probe plus a pure analyzer

`collectMobileSignals` renders at a phone viewport and measures element
geometry in the page, because geometry only exists once the browser has laid
the page out. `analyzeMobile` is pure and decides what any of it means.

The probe reuses Phase 3's session, request guard and mobile viewport profile,
so the security boundary, the device definition and the cleanup behaviour are
the ones already reviewed. The two phases therefore agree about what "mobile"
means rather than each having an opinion.

### Where the measured/heuristic line is drawn

This is the phase ADR-009 was written for, so the line is explicit.

**Measured** — facts about the rendered page, reported as such:

- horizontal overflow (`scrollWidth` exceeded the layout width);
- the viewport meta tag: absent, or present and restrictive;
- tap targets below the **WCAG 2.2 floor** of 24x24 CSS pixels;
- elements hiding their own content behind an `overflow: hidden` rule.

**Heuristic** — inferences, marked `heuristic` in their evidence *and* hedged in
their prose:

- tap targets between the WCAG floor and the ~44px platform comfort guideline,
  which break no standard;
- text below 12px, since there is no standard minimum and captions and legal
  copy are legitimately small;
- anything about navigation, since identifying a "menu button" means
  pattern-matching on labels and plenty of usable sites navigate differently;
- "the layout may be broken", which only fires when several independent signals
  agree, because it is the most inferential claim in the phase.

A test enforces both halves: purely measured findings must carry only
`measured` evidence, and every inferential finding must carry at least one
`heuristic` item **and** hedge its wording. That test caught a finding whose
evidence was correctly marked but whose explanation asserted "a workable number
of visible links" as fact.

### Automation does not determine mobile usability

A standing `could_not_determine` finding says so on every analysis, clean pages
included. A page can pass every check here and be miserable to use; it can fail
several and be perfectly fine.

The phase specification says not to pretend otherwise, so the report states the
limit rather than leaving a reader to infer it from a row of green ticks.

### The layout viewport is not the screen

A page with **no viewport meta tag** is not laid out at the device width.
Chromium falls back to a ~980px desktop width and scales the result down.

This was discovered by an end-to-end test failing, not by reasoning, and it has
a real consequence: overflow measured against that fallback **understates** the
problem, because a 900px element fits inside 980px and reports no overflow
while being far wider than the phone.

`ViewportGeometry` therefore records both the layout width the page chose and
the device width the browser was given, and the missing-viewport finding
reports the gap between them. On such a page the missing tag is the finding
that matters; the overflow number is close to meaningless and would have been
quietly misleading.

## Deliberately limited

- **One viewport, one page state.** No orientation change, no tablet width, and
  nothing behind an interaction.
- **The menu is never opened.** Whether a collapsed navigation actually works is
  reported as untested, not assumed.
- **Selectors are approximate.** They are built to help a person find an element
  in the DOM, not to be stable identifiers.
- **A fifth page load per analysis.** Worth revisiting when the phases are
  orchestrated in Phase 16; the signals could be collected during Phase 3's
  existing mobile rendering instead.

---

# ADR-050 — Content Extraction, And Which Parts Are Facts

## Status

Accepted

## Decision

### Extraction and analysis are separate, and both are pure

`extractContent(html, url)` produces a `ContentInventory`. `analyzeContent`
turns that into findings. Neither touches the network, a browser, a clock or a
model.

The extractor reuses Phase 4's parse5 adapter rather than introducing a second
way of reading HTML. Phase 4 deliberately does not extract body text — recorded
at the time as this phase's work — so the traversal lives here.

### Every extracted item records how it was found

This is the decision the phase turns on, and it is why `DetectionMethod` exists
on almost everything in the model.

**Structural** — markup that means what it says, and therefore a fact:

- an `<h1>` is the headline;
- a `<footer>` is the footer;
- a `mailto:` or `tel:` link is a contact route;
- an `<address>` is an address;
- a `<button>` or `role="button"` is a control;
- a `<details>` element is a disclosure, so a FAQ.

**Inferred** — wording, position or pattern matching, and therefore a guess:

- the paragraph after the headline is *usually* the supporting line;
- a heading saying "Pricing" *probably* introduces pricing;
- a link reading "Get started" is *likely* a call to action;
- an email address found in page text *may* be a contact route;
- "Trusted by 4,000 teams" *reads as* social proof.

The analyzer turns the first into `measured` evidence and the second into
`heuristic` evidence, so the distinction survives into the report and the UI can
present them differently (ADR-009).

Findings resting on a threshold are heuristic even when the number behind them
is exact: **250 words is a measurement, "thin" is an opinion.**

### Detection is English-only pattern matching, and says so

Every pattern lives in `patterns.ts` so the guesswork is visible in one place
and reviewable without reading the logic.

The consequence is stated in the findings themselves rather than buried: when
no sections are recognised, the finding says the result "says as much about the
analyzer as about the page". When no trust signals are found, the finding calls
its own evidence weak. A page in another language will look emptier to this
analyzer than it is, and pretending otherwise would be the failure mode worth
avoiding.

Pattern **order matters** for calls to action: the first match is the name
recorded, so specific patterns precede general ones. "Book a demo" is more
usefully reported as a demo than as a booking, and getting that wrong was caught
by a test.

### Navigation, header and footer are excluded from the word count

They repeat on every page, and counting them would make a page that says almost
nothing look substantial.

### No AI

Phase 14 interprets evidence this phase has already collected (ADR-003).
Reaching for a model here would make the content section non-deterministic and
unexplainable, and there is a test asserting the analyzer imports nothing of the
kind.

## Deliberately limited

- **English only.** Every pattern is English wording.
- **Sections are classified from headings.** A page whose sections are
  distinguished only visually will read as unstructured.
- **The phone pattern is the loosest thing here**, guarded only by a digit-count
  floor. A long reference number can still look like a phone number, which is
  why anything it finds is `inferred`.
- **Quality is not assessed.** Whether the copy is any good, whether the
  headline is compelling, whether a testimonial is convincing — none of that is
  attempted, and none of it should be inferred from a pass.

---

# ADR-051 — UX Signals Are Measured; Every UX Finding Is A Heuristic

## Status

Accepted

## Decision

### Counting and judging are separate modules

`collectUxSignals(html, url)` produces `UxSignals` — counts, depths and ratios,
all objectively countable from the document. `analyzeUx` turns those into
findings.

Both are pure. Neither touches the network, a browser, a clock or a model. The
collector reuses Phase 4's parse5 adapter rather than adding a third way of
reading HTML.

### Every finding pairs a measurement with the inference drawn from it

This is the phase's contract, and it is enforced by test:

- every finding carries at least one **`measured`** evidence item naming the
  signal and its value — and that item must contain a digit;
- every finding carries at least one **`heuristic`** evidence item stating the
  inference.

That pairing is what makes "the navigation looks complex" auditable. A reader
sees it came from `maxLinksInOneRegion = 14` against a threshold of 12, can
decide the threshold is wrong for a documentation site, and still use the count.

A heuristic that does not say what produced it cannot be checked, argued with,
or trusted — and this is the category where that failure would be easiest to
commit.

### Unlike Phase 9, nothing here is standards-backed

Phase 9 could point at WCAG 2.2 for a 24px tap target: a real floor, so failing
it is a fact. **Nothing in this phase has that.** Twelve navigation links,
eight competing actions, twenty levels of DOM nesting — all rules of thumb from
common practice, and a well-made page can sit the wrong side of any of them.

Every threshold lives in `thresholds.ts` with that stated plainly, and the
findings hedge in their own words: the busy-navigation finding says a
documentation site legitimately has more; the many-actions finding allows a
pricing page a button per plan; the repetition finding says a catalogue is
supposed to look like that.

### Severity is capped below `serious`

No UX finding is `critical` or `serious`, and there is a test asserting it.

An inference from counting elements must not weigh the same as an unencrypted
connection or a cookie missing `Secure`. Capping it here stops Phase 12 from
weighting guesswork like evidence — which matters especially given ADR-037's
open question about UX carrying 20% of the overall score.

### A standing finding states what counting cannot reach

`ux.assessment.limits` is emitted on every analysis, including a page that trips
nothing. It names what was not observed: visual hierarchy, clarity of language,
whether the layout guides the eye, whether the page achieves what it exists for.

A UX section that reads as a verdict would be the most misleading output this
product could produce, because UX is exactly the category a reader will assume
was judged holistically.

### Absence is reported with a count

"0 navigation regions were found" rather than "no navigation was found". A count
of zero is still the observable signal, and stating it keeps every finding
consistent about naming what was measured. A test requires a digit in the
measured evidence, which is what surfaced this.

## Overlaps with other phases, and why they stand

- **Heading structure** is also checked in Phase 5 (SEO) and this phase. They
  ask different questions of the same markup: Phase 5 asks whether search
  engines can read the outline, Phase 11 asks whether a person can skim it.
- **Actions** overlap with Phase 10's call-to-action extraction. Phase 10 asks
  *what* the actions say; this phase asks *how many* compete. Neither answer
  substitutes for the other.

Both were considered for consolidation and left separate: merging them would
couple the phases and make each answer worse.

## Deliberately limited

- **Repetition is matched by tag plus first class name.** A component using
  varied classes will not register; one reusing a class for unrelated things
  will over-register.
- **Emphasis detection is class-based** (`primary`, `main`, `hero`), which many
  design systems do not use. A page emphasising its action purely through CSS
  will read as having none.
- **Nothing is rendered.** Visual weight, colour, contrast, spacing and position
  — the things UX actually turns on — are entirely outside what this phase sees.

---

# ADR-052 — The Scoring Engine, And The Three Gaps It Had To Cross

## Status

Accepted

## Context

`docs/SCORING.md` defined the model but left three things unresolved, each of
which blocks Phase 12 in a different way. This ADR records what was decided
about each, because all three are judgement calls that a future reader will
otherwise have to reconstruct from the arithmetic.

## Decision

### 1. Severity is the per-check weight — no sub-weight tables are needed

`docs/SCORING.md` said "Phase 12 cannot be implemented until every category in
the overall table has one [a sub-weight table]." That line was **wrong**, and
contradicted by the same document's deduction table.

Six of the seven categories are scored by deduction from a starting 100. A
finding's `severity` is already a per-check weight: the analyzer that produced
it decided how much that check matters, and the deduction table converts the
judgement into points. A `critical` SEO failure costs 25; a `minor` one costs 3.
Adding a separate per-check weight table would be a second, competing statement
about the same thing, and the two would drift.

Performance is the exception, and the exception explains the rule: it is scored
from raw metrics, and a metric does not carry an opinion about its own
importance. That is why it — and only it — has a sub-weight table.

The blocker line in `docs/SCORING.md` was corrected rather than satisfied.

### 2. ADR-037's weights are implemented exactly as documented

ADR-037 records that Security at 5% and UX at 20% look unintentional: a site
served over plain HTTP with no security headers at all can lose at most five
points overall, while a fifth of the score rests on the least objective evidence
the system collects.

That ADR is still open, and Phase 12 does not close it. The weights are
implemented **as written**, because inventing different ones is forbidden
(CLAUDE.md) and a weight is a product judgement, not an engineering one.

Two tests pin the values so the question stays visible instead of quietly
becoming permanent, and `lib/scoring/score-analysis.test.ts` demonstrates the
asymmetry rather than describing it: a category scoring zero on security costs
five overall points; the same failure in UX costs twenty.

Changing the product's mind is a change to `CATEGORY_WEIGHTS`, this document,
`docs/SCORING.md` and the scoring version — nothing else.

### 3. Undefined thresholds redistribute one level down

Four of the seven Performance components — page weight, image optimization, JS
cost and "Other" — carry a declared weight but have no defined curve.
`docs/SCORING.md` deferred three of them to Phase 8, and Phase 8 collected their
raw measurements without defining thresholds. "Other" was never defined at all.

Three options were considered:

- **Invent thresholds.** Rejected: forbidden by CLAUDE.md, and a fabricated
  threshold produces a confident number nobody can defend.
- **Refuse to score Performance at all.** Rejected: 60% of the sub-weight table
  *is* defined, and discarding good measurements because others are missing
  serves nobody.
- **Exclude them and redistribute their weight proportionally.** Chosen. It is
  the rule `docs/SCORING.md` already applies to unassessable categories
  (ADR-036), applied one level down.

The gap is data, not logic: each component is declared with `curve: null` and an
`undefinedReason`, and the report names every excluded component and why. LCP,
TBT and CLS carry Performance at 41.67 / 33.33 / 25 until thresholds exist.

## The rest of the engine

### Every number reconstructs from the report

Each category records the deductions (finding id, severity, status, points) or
the metric contributions (raw value, unit, normalised score, effective weight)
that produced it. The overall score records each category's declared weight,
effective weight, score and contribution.

A test recomputes every category score from its own recorded parts and the
overall score from its weighting, so a score that could not be traced back to
evidence fails the build. This is what ADR-002's explainability requirement
means in practice.

### The overall score is computed from the numbers on screen

Contributions come from the **rounded** category scores and the **rounded**
effective weights the report displays, not from hidden precision. A reader who
adds up what they can see gets the number they were shown. The cost is a few
hundredths of drift in the weight total, which is the right trade.

### Not assessed is not zero, and has no grade

A category nobody could assess has `score: null`, `status: "not_assessed"`, a
stated reason, and **no grade** — grading it F would publish a verdict nobody
reached (ADR-021). Its weight is redistributed. A category whose every finding
is `could_not_determine` is treated the same way: the analyzer ran and
established nothing.

When no category at all could be assessed, the overall score is `null` and says
so in words, rather than being zero.

### A misconfigured curve refuses to answer

`normaliseMetric` returns `null` for a curve whose `poor` is not worse than its
`good`. An earlier version checked the value before the curve and returned 100 —
a perfect score derived from nonsense. Failing to score is the honest output.

### No AI, asserted by test

ADR-002 forbids a model influencing a number. `lib/scoring` is pure arithmetic:
no I/O, no clock, no randomness, no model. Tests assert the source contains
nothing model-shaped and no clock or filesystem access, and that the same input
always yields an identical report.

### Scoring version 1

`SCORING_VERSION` lives in `lib/scoring/version.ts` and is stamped on every
report (ADR-013). A test parses `docs/SCORING.md` and fails if the version it
declares and the constant disagree. Any change to a weight, a deduction, a
threshold or the arithmetic increments it.

## Consequences

- Scoring weights, scoring calculations, analyzer logic and UI stay in four
  separate places. `weights.ts` is the only file mirroring `docs/SCORING.md`,
  and a test holds the two together.
- Performance carries a visible caveat until four thresholds are defined.
- ADR-037 remains open, and the weights it questions are now load-bearing.
- The engine is pure, so a report can be recomputed from stored evidence
  without re-running an analysis.

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

## Phase 2 — Basic HTTP Analyzer

Added ADR-040 and ADR-041.

- ADR-040 recorded the retrieval model: `node:http` rather than `fetch` (three
  requirements `fetch` cannot express), HTML-only body downloads, decompression
  with both sizes retained, and the time/size/redirect budgets.
- ADR-041 recorded the DNS-rebinding defence: resolve once, pin the connection
  to a validated address, and refuse the connection if *any* resolved address
  is disallowed.

## Phase 3 — Browser Analyzer

Added ADR-042 and ADR-043.

- ADR-042 recorded the browser request guard, and states plainly that it is
  **not** isolation: Chromium resolves DNS itself, so the rebinding window
  Phase 2 closes by pinning cannot be closed in application code. Real
  isolation is a deployment control and is a Phase 20 prerequisite. WebSockets
  are a known gap.
- ADR-043 recorded the rendering model: one browser process, one context per
  viewport, `load` plus a fixed settle allowance, screenshots held in memory,
  and the rule that Phase 3 observes but never interprets.

## Phase 4 — DOM Analyzer

Added ADR-044.

It records the choice of parse5 over jsdom, cheerio and re-using the browser;
the rule that `extractPageData` is a pure function, which is what makes the
phase's determinism criterion structurally true; the `null` vs `""` convention
that keeps a missing `alt` distinguishable from a decorative one; and the
decision that `<base>` governs resolution but not which host counts as
internal.

## Phase 5 — SEO Analyzer

Added ADR-045.

It records that the checks are pure functions while retrieval is separate; that
robots.txt and the sitemap go through the Phase 2 client rather than a bare
fetch; that thresholds are conventions kept apart from the logic; that only the
two directives which remove a site from search entirely are `critical`; that
`alt=""` is not a defect; and that a file which was not retrieved reports
`could_not_determine`, never a pass.

Phase 2 was extended to support this: a `downloadMediaTypes` option, since the
client previously downloaded HTML bodies only, and the response field `html`
was renamed `body` to match what it now carries.

## Phase 6 — Security Analyzer

Added ADR-046.

It records the rule that keeps this section honest — the analyzer reports
configuration and never states that a site is secure or that a vulnerability
exists — enforced by a test scanning every finding's text for safety claims. It
also records that cookie **values** are never captured, because the report
reaches logs, an API response and eventually an AI prompt; that disclosure stays
`minor` because it is not itself a weakness; and that frame protection is one
finding rather than two, since `frame-ancestors` supersedes `X-Frame-Options`.

A shared finding builder was extracted to `lib/analysis/finding-builder.ts` so
Phase 6 did not duplicate Phase 5's helpers. Phase 5 was left untouched.

An SSRF review of the existing retrieval and browser layers was carried out
alongside this phase; see the Phase 6 section of `docs/IMPLEMENTATION.md` for
what it confirmed and the one weakness it found.

## Phase 7 — Accessibility Analyzer

Added ADR-047.

It records axe-core as the engine and the rule that the standard is not
reimplemented; the split between a browser-bound runner and a pure normalizer;
that the engine's severity vocabulary maps onto ours one-to-one **by design**,
not by luck (ADR-029); that axe's `incomplete` becomes `could_not_determine`,
because reporting an undecidable check as a pass would be the most misleading
thing this phase could do; that passes collapse into one finding; and that the
analyzer never claims a page is accessible, since automation reaches only a
fraction of the success criteria.

## Phase 8 — Performance Analyzer

Added ADR-048.

It records Lighthouse 13 attached to the Phase 3 browser over an explicit
DevTools port; that the audit identifiers were **verified against a real
report** rather than taken from documentation, because Lighthouse 13 replaced
four legacy audits with `*-insight` equivalents and using the old names would
have produced silent nulls; that raw measurements and findings are separate
return values with no score in either (ADR-012); that the engine's 0-1 score
decides finding status but never the category score (ADR-002); and that INP is
present as a field whose value is always `null`, with the reason attached and
TBT reported as the lab proxy (ADR-030).

`launchSession` gained an `extraArgs` option so the DevTools port could be
opened. The hardening flags are appended to, never replaced.

## Phase 9 — Mobile Analyzer

Added ADR-049.

It records the browser probe plus pure analyzer split; exactly where the
measured/heuristic line sits and the test that enforces both halves of it; the
standing finding stating that automation cannot determine mobile usability; and
a browser behaviour found by a failing end-to-end test — a page with no viewport
meta tag is laid out at Chromium's ~980px fallback, not the device width, so
overflow measured against it understates the problem. `ViewportGeometry` now
records both widths.

## Phase 10 — Content Analyzer

Added ADR-050.

It records that every extracted item carries a `DetectionMethod`, so structural
facts (`<h1>`, `<footer>`, `mailto:`, `<button>`) stay distinguishable from
inferences (the paragraph after the headline, a heading saying "Pricing", a
link reading "Get started"); that thresholds produce heuristic findings even
when the number is exact; that detection is English-only pattern matching and
the findings say so about themselves; and that no AI is used, with a test
asserting it.

## Phase 11 — UX Heuristics

Added ADR-051.

It records the split between a signal collector (all measured) and an analyzer
(all heuristic); the contract that **every** finding pairs a measured evidence
item naming the signal — containing a digit — with a heuristic item stating the
inference, enforced by test; that unlike Phase 9 nothing here is
standards-backed, so every threshold is a rule of thumb; that severity is capped
below `serious` so an inference cannot weigh like a measurement; and the
standing finding naming what counting cannot reach.

It also records why the heading and action overlaps with Phases 5 and 10 were
left in place rather than consolidated: the phases ask different questions of
the same markup.

The Phase 3 constraint in `docs/IMPLEMENTATION.md` was amended: it previously
read "the browser is network-isolated", which the implementation does not
achieve on its own.

Also fixed a Phase 1 defect found while implementing this phase:
`classifyIpLiteral` recognised IPv6 only in its bracketed form, so a bare
address from a DNS resolver was classified as "not an IP address". Left
unfixed it would have refused every IPv6-only site.

## Phase 12 — Deterministic Scoring Engine

Added ADR-052.

It records the three gaps `docs/SCORING.md` left and how each was crossed: that
a finding's severity *is* its per-check weight, so the document's claim that
Phase 12 needed sub-weight tables for six categories was wrong; that ADR-037's
questioned weights are implemented exactly as documented and pinned by test
rather than quietly adjusted; and that the four Performance components with a
declared weight but no defined curve are excluded with their weight
redistributed, applying ADR-036's rule one level down instead of inventing
thresholds.

It also records the engine's contract: every number reconstructs from the
report's own recorded parts (enforced by test), the overall score is computed
from the rounded figures the report displays, an unassessed category has a null
score and no grade rather than a zero and an F, a misconfigured curve refuses to
score, and no AI touches any of it.

Two corrections were made to `docs/SCORING.md`:

- the line "Phase 12 cannot be implemented until every category in the overall
  table has one" was replaced with why sub-weight tables are not needed;
- "Thresholds for page weight, image optimization and JS cost are defined in
  Phase 8" was replaced with what Phase 8 actually delivered — raw measurements
  and no thresholds — and what Phase 12 does about it.

Also fixed while implementing this phase: `normaliseMetric` checked the value
before validating the curve, so an inverted or degenerate curve returned 100
instead of refusing to score.

New decisions are appended immediately above this section, using the form:

```text
ADR-XXX
Status
Decision
Reason
Alternatives considered
Consequences
```