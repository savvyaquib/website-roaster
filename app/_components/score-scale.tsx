/**
 * The score, on a scale that shows where the grades change.
 *
 * The deliberate choice here is *not* a ring gauge. A ring shows one number and
 * hides the model; this shows the number against the documented grade bands, so
 * a reader can see how far a point is from changing the letter. Every category
 * is drawn on the same scale, so two categories can be compared by eye.
 *
 * The numeral is set in the display face and given the largest type in the
 * product, with a wash behind it in the colour of the grade — so the first
 * impression of a report is the verdict, at a glance, from across the room.
 *
 * A category that was not assessed gets a hatched swatch and the words
 * "not assessed" beside its reason — never a zero, and never a bar that is
 * silently empty (ADR-021, ADR-036).
 */

import type { Grade } from "@/lib/scoring";
import {
  BAND_MARKS,
  TEXT_TONE,
  TONE_CLASS,
  TRACK_TONE,
  toneForScore,
} from "@/lib/ui/format";

function BandTicks() {
  return (
    <>
      {BAND_MARKS.map((band) => (
        <span
          key={band.grade}
          aria-hidden="true"
          className="absolute top-0 bottom-0 w-px bg-paper"
          style={{ left: `${band.at}%` }}
        />
      ))}
    </>
  );
}

/** The headline score. */
export function OverallScore({
  score,
  grade,
  explanation,
}: {
  score: number | null;
  grade: Grade | null;
  explanation: string;
}) {
  const tone = toneForScore(score);
  const assessed = score !== null;

  return (
    <div className={`relative ${TONE_CLASS[tone]}`}>
      {/* The light behind the number takes the colour of the grade. */}
      <div
        aria-hidden="true"
        className="tone-glow pointer-events-none absolute -top-28 -left-32 -z-10 h-[30rem] w-[42rem] blur-[70px]"
      />

      {/*
        Baseline alignment, not bottom alignment. A display face at 9rem with a
        crushed line-height overflows its own line box, so `items-end` hung the
        grade well above the numeral it belongs to and pushed the descenders
        into the scale below. Sitting all three on one baseline is both correct
        and what the line wants to say: eighty-seven, B, out of a hundred.
      */}
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 sm:gap-x-6">
        <p
          className={`tabular display text-[6.5rem] leading-[0.9] sm:text-[9rem] ${TEXT_TONE[tone]}`}
        >
          {assessed ? score : "--"}
        </p>
        <p className={`display text-5xl sm:text-6xl ${TEXT_TONE[tone]}`}>
          {grade ?? "—"}
        </p>
        <p className="text-sm text-ink-muted">out of 100</p>
      </div>

      <div className="mt-7">
        <div
          role="img"
          aria-label={
            assessed
              ? `Overall score ${score} out of 100, grade ${grade}.`
              : "No overall score: nothing could be assessed."
          }
          className="relative h-2.5 w-full overflow-hidden rounded-full bg-paper-deep inset-ring inset-ring-rule"
        >
          {assessed ? (
            <div
              className={`h-full rounded-full ${TRACK_TONE[tone]}`}
              style={{ width: `${Math.max(score, 1)}%` }}
            />
          ) : null}
          <BandTicks />
        </div>

        <div className="relative mt-2 h-4">
          {BAND_MARKS.map((band) => (
            <span
              key={band.grade}
              className="tabular absolute -translate-x-1/2 text-[11px] text-ink-muted"
              style={{ left: `${band.at}%` }}
            >
              {band.at}
            </span>
          ))}
        </div>
      </div>

      <p className="mt-6 max-w-[62ch] text-[0.95rem] leading-7 text-ink-muted">
        {explanation}
      </p>
    </div>
  );
}

/**
 * The chart's column template. One definition, used by the chart body, the
 * axis and the gridline overlay, so the three can never disagree about where
 * the track column starts and ends.
 */
const CHART_COLUMNS =
  "grid-cols-[6rem_1fr_3.25rem] gap-x-3 sm:grid-cols-[8.5rem_1fr_4.5rem] sm:gap-x-4";

/** Where the track column sits, for the overlay that draws through every row. */
const TRACK_INSET =
  "left-[calc(6rem+0.75rem)] right-[calc(3.25rem+0.75rem)] sm:left-[calc(8.5rem+1rem)] sm:right-[calc(4.5rem+1rem)]";

export interface CategoryRow {
  readonly label: string;
  readonly score: number | null;
  readonly grade: Grade | null;
  readonly notAssessedReason: string | null;
}

/**
 * Every category on one chart.
 *
 * Seven separate progress bars are a dashboard widget; one field with the
 * grade boundaries drawn through every row is a chart. The axis is labelled
 * once, the gridlines run behind every bar, and the bars are drawn on the
 * field rather than inside their own little tracks, so a reader compares
 * categories against the same four lines the overall score uses.
 *
 * Categories that were not scored are set apart below the chart rather than
 * interleaved with it. Interleaved, each one interrupted the comparison with a
 * two-line explanation; grouped, the explanations read as the footnote they
 * are, and the chart above is only what was measured (ADR-021, ADR-036).
 */
export function CategoryChart({ rows }: { rows: readonly CategoryRow[] }) {
  const scored = rows.filter((row) => row.score !== null);
  const unscored = rows.filter((row) => row.score === null);

  return (
    <div>
      {scored.length === 0 ? null : (
        <div className="relative isolate">
          {/* The field: the 0 and 100 edges, and the four grade boundaries. */}
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute inset-y-0 -z-10 border-x border-rule ${TRACK_INSET}`}
          >
            {BAND_MARKS.map((band) => (
              <span
                key={band.grade}
                className="absolute top-0 bottom-0 w-px bg-rule"
                style={{ left: `${band.at}%` }}
              />
            ))}
          </div>

          <div className={`grid items-center gap-y-5 ${CHART_COLUMNS}`}>
            {/* The axis, once. */}
            <span />
            <div className="relative h-4" aria-hidden="true">
              {BAND_MARKS.map((band) => (
                <span
                  key={band.grade}
                  className="tabular absolute -translate-x-1/2 text-[10px] text-ink-muted sm:text-[11px]"
                  style={{ left: `${band.at}%` }}
                >
                  {band.at}
                </span>
              ))}
            </div>
            <span />

            {scored.map((row) => (
              <CategoryBar key={row.label} {...row} />
            ))}
          </div>
        </div>
      )}

      {unscored.length === 0 ? null : (
        <div
          className={`${scored.length === 0 ? "" : "mt-8 border-t border-rule pt-6"} grid items-start gap-y-3 ${CHART_COLUMNS}`}
        >
          {unscored.map((row) => (
            <CategoryBar key={row.label} {...row} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One category, as a row of the chart.
 *
 * Renders its cells straight into the parent grid (`display: contents`), so
 * every row shares the chart's columns and the bars line up against the same
 * gridlines. It carries no layout of its own.
 */
export function CategoryBar({ label, score, grade, notAssessedReason }: CategoryRow) {
  if (score === null) {
    /*
     * Two layouts from one DOM.
     *
     * On a wide screen the wrapper is `display: contents` and the three cells
     * join the chart's columns in DOM order — label, reason, n/a — which is
     * also column order, so auto-placement keeps them on one row. (Placing
     * n/a before the reason looked harmless and was not: a definite column
     * *lower* than the cursor's moves the cursor down a row, so the reason
     * dropped below and the next label landed in column 3.)
     *
     * On a phone the wrapper is a small grid of its own spanning the chart:
     * label and n/a on one line, the reason on the next.
     */
    return (
      <div className="col-span-3 grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-1 sm:contents">
        <span className="order-1 text-[13px] leading-5 font-medium text-ink-muted sm:order-0 sm:text-sm">
          {label}
        </span>

        {/*
          There is no bar, because there is no measurement — a full-width empty
          track read as a chart with nothing in it. The hatch survives as a
          swatch, so "not scored" keeps the mark the scored rows never carry.
        */}
        <p className="order-3 col-span-2 max-w-[62ch] text-xs leading-5 text-ink-muted sm:order-0 sm:col-span-1 sm:col-start-2">
          <span
            aria-hidden="true"
            className="mr-2 inline-block h-2.5 w-7 align-[-1px] opacity-70"
            style={{
              backgroundImage:
                "repeating-linear-gradient(135deg, var(--rule-strong) 0 2px, transparent 2px 6px)",
            }}
          />
          Not assessed. {notAssessedReason}
        </p>

        <span className="tabular display order-2 text-right text-base leading-5 text-unknown sm:order-0 sm:col-start-3">
          n/a
        </span>
      </div>
    );
  }

  const tone = toneForScore(score);

  return (
    <div className="contents">
      <span className="text-[13px] leading-5 font-medium sm:text-sm">{label}</span>

      <div
        role="img"
        aria-label={`${label}: ${score} out of 100, grade ${grade}.`}
        className="relative h-3 w-full"
      >
        <div
          className={`h-full rounded-r-xs ${TRACK_TONE[tone]}`}
          style={{ width: `${Math.max(score, 1)}%` }}
        />
      </div>

      <span
        className={`tabular display text-right text-xl leading-none ${TEXT_TONE[tone]}`}
      >
        {`${score} ${grade}`}
      </span>
    </div>
  );
}
