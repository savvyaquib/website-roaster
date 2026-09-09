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
 * A category that was not assessed gets a visibly empty track and the words
 * "not assessed" — never a zero, and never a gap where a bar should be
 * (ADR-021, ADR-036).
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

/** One category, on the same scale as every other. */
export function CategoryBar({
  label,
  score,
  grade,
  notAssessedReason,
}: {
  label: string;
  score: number | null;
  grade: Grade | null;
  notAssessedReason: string | null;
}) {
  const tone = toneForScore(score);
  const assessed = score !== null;

  return (
    <div className="grid grid-cols-[7rem_1fr_3.5rem] items-center gap-x-4 gap-y-1.5 sm:grid-cols-[9rem_1fr_4.5rem]">
      <span className="text-sm font-medium">{label}</span>

      <div
        role="img"
        aria-label={
          assessed
            ? `${label}: ${score} out of 100, grade ${grade}.`
            : `${label}: not assessed. ${notAssessedReason ?? ""}`
        }
        className="relative h-1.5 w-full overflow-hidden rounded-full bg-paper-deep"
      >
        {assessed ? (
          <div
            className={`h-full rounded-full ${TRACK_TONE[tone]}`}
            style={{ width: `${Math.max(score, 1)}%` }}
          />
        ) : (
          // A hatched track, so "not assessed" is visibly different from zero.
          <div
            className="h-full w-full opacity-70"
            style={{
              backgroundImage:
                "repeating-linear-gradient(135deg, var(--rule-strong) 0 2px, transparent 2px 6px)",
            }}
          />
        )}
      </div>

      <span
        className={`tabular display text-right text-base ${assessed ? TEXT_TONE[tone] : "text-unknown"}`}
      >
        {assessed ? `${score} ${grade}` : "n/a"}
      </span>

      {assessed ? null : (
        // Full width on a phone: squeezed into the bar's column it becomes a
        // four-words-per-line ribbon, and this sentence is the whole point of
        // showing an unassessed category at all.
        <p className="col-span-3 max-w-[62ch] text-xs leading-5 text-ink-muted sm:col-span-2 sm:col-start-2 sm:-mt-1">
          Not assessed. {notAssessedReason}
        </p>
      )}
    </div>
  );
}
