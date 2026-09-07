/**
 * The score, on a scale that shows where the grades change.
 *
 * The deliberate choice here is *not* a ring gauge. A ring shows one number and
 * hides the model; this shows the number against the documented grade bands, so
 * a reader can see how far a point is from changing the letter. Every category
 * is drawn on the same scale, so two categories can be compared by eye.
 *
 * A category that was not assessed gets a visibly empty track and the words
 * "not assessed" — never a zero, and never a gap where a bar should be
 * (ADR-021, ADR-036).
 */

import type { Grade } from "@/lib/scoring";
import { BAND_MARKS, TEXT_TONE, TRACK_TONE, toneForScore } from "@/lib/ui/format";

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

/**
 * The headline score.
 *
 * The numeral is the largest thing on the page, and the only place in the
 * interface where type gets that big.
 */
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
    <div>
      <div className="flex items-end gap-5">
        <p
          className={`tabular font-mono text-[5.5rem] leading-[0.85] font-medium tracking-tighter sm:text-[7rem] ${TEXT_TONE[tone]}`}
        >
          {assessed ? score : "--"}
        </p>
        <div className="pb-2">
          <p className={`font-mono text-3xl leading-none font-medium ${TEXT_TONE[tone]}`}>
            {grade ?? "—"}
          </p>
          <p className="mt-1 text-sm text-ink-muted">out of 100</p>
        </div>
      </div>

      <div className="mt-6">
        <div
          role="img"
          aria-label={
            assessed
              ? `Overall score ${score} out of 100, grade ${grade}.`
              : "No overall score: nothing could be assessed."
          }
          className="relative h-3 w-full overflow-hidden rounded-[2px] bg-rule"
        >
          {assessed ? (
            <div
              className={`h-full ${TRACK_TONE[tone]}`}
              style={{ width: `${Math.max(score, 1)}%` }}
            />
          ) : null}
          <BandTicks />
        </div>

        <div className="relative mt-1.5 h-4">
          {BAND_MARKS.map((band) => (
            <span
              key={band.grade}
              className="tabular absolute -translate-x-1/2 font-mono text-[11px] text-ink-muted"
              style={{ left: `${band.at}%` }}
            >
              {band.at}
            </span>
          ))}
        </div>
      </div>

      <p className="mt-4 max-w-[68ch] text-sm text-ink-muted">{explanation}</p>
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
    <div className="grid grid-cols-[7.5rem_1fr_3.5rem] items-center gap-x-3 gap-y-1 sm:grid-cols-[9rem_1fr_4rem]">
      <span className="text-sm">{label}</span>

      <div
        role="img"
        aria-label={
          assessed
            ? `${label}: ${score} out of 100, grade ${grade}.`
            : `${label}: not assessed. ${notAssessedReason ?? ""}`
        }
        className="relative h-2 w-full overflow-hidden rounded-[2px] bg-rule"
      >
        {assessed ? (
          <div
            className={`h-full ${TRACK_TONE[tone]}`}
            style={{ width: `${Math.max(score, 1)}%` }}
          />
        ) : (
          // A hatched track, so "not assessed" is visibly different from zero.
          <div
            className="h-full w-full opacity-60"
            style={{
              backgroundImage:
                "repeating-linear-gradient(135deg, var(--rule-strong) 0 2px, transparent 2px 6px)",
            }}
          />
        )}
      </div>

      <span
        className={`tabular text-right font-mono text-sm ${assessed ? TEXT_TONE[tone] : "text-unknown"}`}
      >
        {assessed ? `${score} ${grade}` : "n/a"}
      </span>

      {assessed ? null : (
        // Full width on a phone: squeezed into the bar's column it becomes a
        // four-words-per-line ribbon, and this sentence is the whole point of
        // showing an unassessed category at all.
        <p className="col-span-3 max-w-[62ch] text-xs text-ink-muted sm:col-span-2 sm:col-start-2 sm:-mt-0.5">
          Not assessed. {notAssessedReason}
        </p>
      )}
    </div>
  );
}
