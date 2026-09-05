# Website Roaster — Architecture

This document describes how the system is put together: what the pieces are,
where they live, and which way the dependencies point.

It describes the **target** architecture. Most of it does not exist yet —
`docs/IMPLEMENTATION.md` records what has actually been built.

---

# Runtime

Website Roaster is a Next.js application (App Router) running on a long-lived
Node.js server.

It is **not** deployed to a short-lived serverless runtime, because the analysis
pipeline drives a real browser and runs Lighthouse. See ADR-032.

---

# Pipeline

```text
                 ┌───────────────┐
                 │   Frontend    │
                 └───────┬───────┘
                         │
                         ▼
                 ┌───────────────┐
                 │ Analysis API  │
                 └───────┬───────┘
                         │
                         ▼
                 ┌───────────────┐
                 │ Analysis Job  │
                 └───────┬───────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
      HTTP Audit     Browser Audit   Lighthouse
          │              │              │
          └──────────────┼──────────────┘
                         ▼
                ┌─────────────────┐
                │ Normalized Data │
                └────────┬────────┘
                         ▼
                ┌─────────────────┐
                │ Scoring Engine  │
                └────────┬────────┘
                         ▼
                ┌─────────────────┐
                │ Recommendation  │
                └────────┬────────┘
                         ▼
                     AI Layer
                         │
                         ▼
                     Result
```

Two things this diagram does not show:

- **Lighthouse and the Browser Audit share one browser process** but perform
  separate page loads. Lighthouse needs a cold, throttled load; reusing a warmed
  page would corrupt the metrics. See ADR-033.
- **The AI Layer is optional.** If it fails, the pipeline still returns the
  deterministic report. See ADR-016.

---

# Data flow

```text
URL string
   ↓  Phase 1 — validation (no network access yet)
Validated URL
   ↓  Phase 2/3 — HTTP + browser retrieval
Raw observations          ← kept, never overwritten (ADR-012)
   ↓  Phase 4 — normalization
PageData
   ↓  Phases 5-11 — analyzers
Finding[]                 ← the single shared currency (ADR-029)
   ↓  Phase 12 — scoring
CategoryScore[] + overall
   ↓  Phase 13 — ranking
Recommendation[]          ← a derived view over findings, not a new record
   ↓  Phase 14/15 — interpretation
Summary, roast
```

`Finding` is the interface between evidence collection and everything
downstream. Analyzers produce findings and nothing else. They never compute
scores (ADR-001), and the scoring engine never re-reads the page.

---

# Directory layout

```text
app/                    Next.js App Router — UI and route handlers only
  layout.tsx
  page.tsx
lib/                    Framework-independent application logic
  config/               Validated configuration
    env.ts
  observability/        Structured logging
    logger.ts
  types/                Shared domain types
    analysis.ts         Job lifecycle
    finding.ts          Evidence and finding model
    index.ts
docs/                   Specification, scoring model, decisions
public/                 Static assets
```

Directories that appear in later phases:

```text
lib/analysis/           Analyzer modules (Phases 1-11)
lib/scoring/            Scoring engine and weights (Phase 12)
lib/recommendations/    Ranked, actionable findings (Phase 13)
lib/ai/                 Provider abstraction and prompts (Phase 14)
```

A directory is created when something goes in it, not before.

---

# Dependency rules

The rules exist to keep one thing true: **the analysis pipeline does not depend
on the web framework.**

1. `app/` may import from `lib/`. `lib/` must never import from `app/`.
2. `lib/` must not import Next.js runtime APIs. Analyzers are plain TypeScript,
   which is what makes them testable in isolation and what would allow the
   pipeline to move into a worker process without a rewrite.
3. `lib/types/` holds types, literal constants and type guards only. No I/O.
4. Configuration is read through `lib/config/env.ts`, never from `process.env`
   directly (ADR-028).
5. Imports use the `@/` alias rather than deep relative paths.

See ADR-027.

---

# Module boundaries

| Module | Owns | Must not |
| --- | --- | --- |
| `lib/config` | Environment parsing and validation | Reach the network; run in the browser |
| `lib/observability` | Structured log records | Log secrets or page content |
| `lib/types` | The shared vocabulary | Contain logic |
| `lib/analysis/*` | Collecting evidence | Compute scores |
| `lib/scoring` | Turning findings into numbers | Re-read the page or call the AI |
| `lib/recommendations` | Ranking findings by impact | Hold a second copy of the scoring model |
| `lib/ai` | Interpretation of supplied evidence | Produce measurements or scores |
| `app/` | HTTP surface and UI | Contain scoring or analysis logic |

---

# Job lifecycle

An analysis is a job with an explicit state (ADR-011):

```text
queued → running → completed
                 → failed
                 → timeout
                 → blocked
                 → invalid_url
```

`queued` and `running` are the only non-terminal states. The five terminal
states are distinct on purpose: the frontend must be able to tell a site that
failed to load from one that was refused for being a private address.

These states are defined in `lib/types/analysis.ts`.

**Until Phase 16 there is no job store**, because until then there is no
asynchronous API and therefore no state that must outlive a request. The store
arrives together with the API that needs it — see ADR-031, which amends ADR-019.

---

# Security boundaries

User-submitted URLs are untrusted, and so is everything the target page returns.

There are three boundaries:

1. **URL validation** (Phase 1) — before any network access.
2. **The HTTP client** (Phase 2) — address pinning and per-hop redirect
   validation, because hostname validation alone does not survive DNS rebinding.
3. **The browser** (Phase 3) — the rendered page can request whatever it wants,
   which makes this the largest part of the SSRF surface and the one the first
   two boundaries do not cover. The browser is network-isolated.

The full layered model, including which phase owns which control, is ADR-035.
It is worth reading before implementing Phase 1, because Phase 1 alone does not
close the risk.

---

# Observability

Analysis steps emit structured events through `lib/observability/logger.ts`.

At minimum the following must be observable: analysis started, URL accepted or
rejected, browser launched, page loaded, each analyzer started, completed or
failed, score calculated, AI analysis started and completed, analysis completed.

Log records carry primitive fields only. Secrets and page content are never
logged.

---

# Reproducibility

Raw measurements are stored separately from derived scores and are never
overwritten by them (ADR-012). Alongside each analysis the system records the
timestamp, the scoring version, and which categories were actually assessed
(ADR-022, ADR-036).

This is what makes it possible to change the scoring weights later without
losing the ability to explain an old score.
