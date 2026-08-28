# CLAUDE.md

## Project

# Website Roaster

Website Roaster is a web application that analyzes a user's website and produces a structured website-quality report.

The product evaluates a website across measurable technical and user-experience dimensions, produces actionable recommendations, and optionally generates a humorous "roast" based strictly on observed evidence.

The project is being built as a production-quality full-stack application, not as a throwaway prototype.

---

# PRIMARY OBJECTIVE

Build a reliable website analysis platform where:

1. A user submits a public HTTP/HTTPS URL.
2. The system safely loads and analyzes the target page.
3. Multiple analyzers collect objective evidence.
4. A deterministic scoring engine converts evidence into category scores.
5. An AI layer interprets the evidence and generates recommendations.
6. The application presents the results in a polished, shareable interface.

The system must prioritize:

* correctness
* explainability
* security
* maintainability
* reproducibility
* good user experience

Do not sacrifice these to make implementation faster.

---

# IMPORTANT BEHAVIOR FOR CLAUDE

## 1. Never invent requirements

If something is not defined:

* inspect the repository
* inspect existing documentation
* inspect the implementation
* infer only when the inference is obvious and low-risk
* otherwise explicitly state the ambiguity

Do NOT silently invent:

* APIs
* database fields
* product behavior
* scoring weights
* authentication requirements
* infrastructure
* dependencies
* business rules

When a decision is genuinely required, document the decision in `docs/DECISIONS.md`.

---

## 2. Follow IMPLEMENTATION.md

`docs/IMPLEMENTATION.md` is the implementation source of truth.

Work on ONE milestone at a time.

Do not implement future milestones unless the current milestone explicitly requires a prerequisite.

Never build the entire application in one pass.

---

## 3. Read before modifying

Before writing code:

1. Read `CLAUDE.md`.
2. Read the relevant section of `docs/IMPLEMENTATION.md`.
3. Inspect the repository structure.
4. Inspect files related to the requested change.
5. Identify existing abstractions and conventions.
6. Then implement.

Do not rewrite existing code merely because you prefer another style.

---

# DEVELOPMENT PRINCIPLES

## Small, composable modules

Prefer narrowly focused modules.

Examples:

```text
analyzePage()
analyzeSEO()
analyzeSecurity()
analyzeAccessibility()
analyzePerformance()
calculateScore()
generateRecommendations()
```

Avoid large files containing unrelated logic.

---

## Deterministic before AI

Objective technical checks MUST be deterministic wherever possible.

Examples:

* missing title
* missing meta description
* HTTP status
* HTTPS
* security headers
* heading structure
* image dimensions
* image alt attributes
* page size
* Lighthouse metrics

AI should primarily interpret evidence.

Never ask an LLM to invent objective measurements that the application can obtain directly.

---

# AI RULES

The AI layer must receive structured evidence.

Bad:

```text
"Is this website good?"
```

Good:

```json
{
  "performance": {...},
  "seo": {...},
  "accessibility": {...},
  "security": {...},
  "content": {...},
  "screenshots": {...}
}
```

The AI must:

* distinguish fact from opinion
* never invent evidence
* never claim a vulnerability without evidence
* never claim guaranteed SEO rankings
* never claim a website is "secure"
* explain recommendations
* prioritize high-impact problems

---

# SECURITY RULES

The application accepts user-controlled URLs.

Treat all submitted URLs as untrusted.

The crawler/analyzer must protect against SSRF.

At minimum, investigate and prevent requests to:

* localhost
* loopback addresses
* private IPv4 ranges
* private IPv6 ranges
* link-local addresses
* cloud metadata endpoints
* internal-only hostnames

Do not assume DNS hostname validation alone is sufficient.

Browser execution should be isolated as much as practical.

Never execute user-supplied JavaScript directly in the application process.

---

# CRAWLING RULES

Version 1 analyzes ONE URL only.

Do not implement full-site crawling unless explicitly requested by a later milestone.

The analyzer should have:

* request timeout
* maximum page size
* maximum analysis duration
* controlled redirects
* clear failure states
* logging
* resource cleanup

---

# ERROR HANDLING

Never hide failures.

Use explicit states such as:

```text
queued
running
completed
failed
timeout
blocked
invalid_url
```

Errors returned to users should be understandable.

Internal logs should contain enough technical context to debug failures.

---

# TESTING

Every meaningful module should have tests.

Prefer:

* unit tests for scoring and pure functions
* integration tests for analyzer orchestration
* browser tests for critical UI workflows
* security-focused tests for URL validation

Never change tests merely to make a failing implementation pass unless the test itself is objectively incorrect.

---

# TYPESCRIPT

Use strict TypeScript.

Avoid:

```ts
any
```

unless there is a documented reason.

Prefer explicit types and validated external inputs.

---

# DEPENDENCIES

Do not add a dependency simply because it is convenient.

Before adding one:

1. Check whether the repository already has an equivalent utility.
2. Check whether native/platform APIs are sufficient.
3. Consider maintenance and security implications.
4. Add the smallest reasonable dependency.

Do not upgrade unrelated dependencies during implementation.

---

# DATABASE

Database schema changes must be explicit.

Never silently modify the schema to accommodate code.

When changing the schema:

1. update the schema
2. create the appropriate migration
3. update types
4. update affected tests
5. document the change when architecturally significant

---

# API DESIGN

APIs should have:

* validated input
* typed output
* explicit errors
* predictable status codes
* clear boundaries

Never expose internal implementation details unnecessarily.

---

# UI PRINCIPLES

The product should feel like a polished developer tool.

Prefer:

* clear hierarchy
* strong typography
* restrained visual design
* useful data visualization
* responsive layouts
* accessible controls
* meaningful loading states
* meaningful error states

Do not build decorative UI that does not communicate useful information.

---

# OBSERVABILITY

Important analysis steps should be observable.

At minimum, make it possible to identify:

* analysis started
* URL accepted/rejected
* browser launched
* page loaded
* analyzer started/completed
* analyzer failed
* score calculated
* AI analysis started/completed
* analysis completed

Avoid logging secrets or sensitive content.

---

# IMPLEMENTATION WORKFLOW

For every requested milestone:

### STEP 1 — Understand

Summarize:

* current relevant architecture
* files involved
* intended change
* constraints

### STEP 2 — Plan

Create a concise implementation plan before coding.

### STEP 3 — Implement

Make the smallest coherent change that completes the milestone.

### STEP 4 — Validate

Run appropriate:

* type checks
* lint
* unit tests
* integration tests
* build

### STEP 5 — Review

Check:

* security
* edge cases
* error handling
* duplication
* unnecessary complexity

### STEP 6 — Update documentation

Update implementation status and architectural decisions when appropriate.

### STEP 7 — Report

Return:

```text
Implemented:
- ...

Files changed:
- ...

Validation:
- ...

Known limitations:
- ...

Next milestone:
- ...
```

Do not claim something was tested if it was not tested.

---

# DEFINITION OF DONE

A milestone is complete only when:

* implementation exists
* relevant tests exist
* validation passes
* documentation is updated
* no known blocker is silently ignored

"Code written" does not mean "milestone complete."

---

# CURRENT PRODUCT SCOPE

Version 1 focuses on:

* URL submission
* single-page analysis
* safe page loading
* screenshots
* technical audits
* deterministic scoring
* AI interpretation
* roast generation
* polished result page

Out of scope until explicitly requested:

* accounts
* billing
* subscriptions
* public leaderboards
* complete-site crawling
* browser extensions
* team collaboration
* enterprise features

Do not implement these proactively.

---

# SOURCE OF TRUTH PRIORITY

When sources conflict, use this priority:

1. Current code behavior
2. Explicit user instruction
3. `CLAUDE.md`
4. `docs/IMPLEMENTATION.md`
5. `docs/ARCHITECTURE.md`
6. `docs/SCORING.md`
7. `docs/DECISIONS.md`
8. Claude's assumptions

When an explicit user instruction conflicts with documentation, follow the user instruction and update the documentation.

---

# FINAL RULE

Do not optimize for writing lots of code.

Optimize for building a system we can understand, test, explain, and extend.
