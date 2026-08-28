# Website Roaster — Scoring Model

This document is the source of truth for how evidence becomes a number.

The scoring engine (Phase 12) implements it. Nothing else in the system is
allowed to contain scoring logic — in particular, not the UI (CLAUDE.md) and not
the AI layer (ADR-002).

**Scoring version: 1** — increment on any change to weights, bands or the
deduction table, and record the version with every analysis (ADR-013, ADR-022).

---

# Score range and grades

Every score, category and overall, is an integer from 0 to 100.

```text
90-100   A
80-89    B
70-79    C
60-69    D
 0-59    F
```

Grades are presentation only. Nothing downstream branches on a grade.

---

# Overall weights

```text
Performance       20%
UX                20%
SEO               15%
Accessibility     15%
Content           15%
Mobile            10%
Security           5%
                 ────
                 100%
```

> **Open question (ADR-037).** Security at 5% and UX at 20% both look
> unintentional — a site on plain HTTP with no security headers can lose at most
> five points, while a third of the score rests on the least objective evidence
> the system collects. These weights are recorded as written and must be
> reviewed before Phase 12 implements them.

---

# Performance sub-weights

```text
LCP                  25%
TBT                  20%
CLS                  15%
Page weight          10%
Image optimization   10%
JS cost              10%
Other                10%
                    ────
                    100%
```

**TBT replaces INP** (ADR-030). INP is a field metric that requires real user
interactions; a single synthetic page load cannot produce it. Total Blocking
Time is the established lab proxy. The report must not display an INP number.

---

# Sub-weights for the remaining categories

**Not yet defined.** SEO, Accessibility, Mobile, Security, Content and UX have
no sub-weights.

They are defined as each analyzer lands, because the weighting of a check can
only be decided once it is known what that check can actually observe. Each
phase from 5 to 11 adds its category's table here.

Phase 12 cannot be implemented until every category in the overall table has one.

---

# From findings to a score

Analyzers emit `Finding` values (ADR-029). They never emit scores.

A category starts at 100. Each finding whose `status` is `fail` or `warn`
deducts according to its severity:

```text
severity     status: fail     status: warn
critical         -25              -12
serious          -15              -8
moderate         -8               -4
minor            -3               -1
info              0                0
```

Rules:

1. A category score is clamped to the range 0-100. It cannot go negative.
2. `pass` and `info` findings deduct nothing. They are kept because the report
   shows what a site got right, not only what it got wrong.
3. `could_not_determine` deducts nothing — see below.
4. Metric-based findings (LCP, CLS, TBT, page weight) do not use this table.
   They are scored by the curves in the next section, then contribute through
   the Performance sub-weights.

The deduction table is stored with the scoring engine, separately from analyzer
logic (Phase 12), so that changing it never means editing an analyzer.

---

# Metric curves

Continuous metrics are normalised to 0-100 before weighting. Each is a
piecewise-linear curve between a "good" and a "poor" threshold: at or better
than `good` scores 100, at or worse than `poor` scores 0, and values in between
interpolate linearly.

```text
metric        good       poor
LCP           2.5s       4.0s
TBT           200ms      600ms
CLS           0.1        0.25
```

Thresholds for page weight, image optimization and JS cost are defined in
Phase 8, when it is known what the analyzer can measure.

Raw metric values are always retained alongside the normalised score and are
never overwritten by it (ADR-012).

---

# Categories that could not be measured

If a category's evidence could not be collected, the category is **excluded**
from the overall score and the remaining weights are redistributed
proportionally (ADR-036).

Worked example — accessibility could not be assessed:

```text
remaining weight = 100 - 15 = 85

Performance   20 / 85 = 23.5%
UX            20 / 85 = 23.5%
SEO           15 / 85 = 17.6%
Content       15 / 85 = 17.6%
Mobile        10 / 85 = 11.8%
Security       5 / 85 =  5.9%
```

The report shows the category as *not assessed*, with the reason. It must never
show a zero and must never show a pass — an analyzer that failed to inspect
something has not established that the site is fine (ADR-021).

The set of assessed categories is stored with the score, because two analyses
are only directly comparable when the same categories contributed (ADR-022).

---

# What scoring must never do

- Ask the AI for a score, or let AI output adjust one (ADR-002).
- Score a heuristic signal as though it were measured. Heuristic findings still
  carry deductions, but the UI must label them as heuristic (ADR-009).
- Treat a missing measurement as a pass (ADR-021).
- Overwrite a raw measurement with its normalised score (ADR-012).
- Hide any part of this model inside a UI component.
