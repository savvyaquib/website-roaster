/**
 * Grade bands.
 *
 * Source of truth: docs/SCORING.md.
 *
 * Grades are presentation only. Nothing downstream branches on one, which is
 * why this is a lookup and not a decision point.
 */

export const GRADES = ["A", "B", "C", "D", "F"] as const;

export type Grade = (typeof GRADES)[number];

/** Lower bound of each band, highest first. Mirrors docs/SCORING.md. */
export const GRADE_BANDS: readonly { readonly grade: Grade; readonly min: number }[] = [
  { grade: "A", min: 90 },
  { grade: "B", min: 80 },
  { grade: "C", min: 70 },
  { grade: "D", min: 60 },
  { grade: "F", min: 0 },
];

/**
 * The grade for a score.
 *
 * @param score an integer from 0 to 100, or null when nothing was assessed.
 * @returns the grade, or null when there is no score to grade. A category that
 *   could not be assessed has no grade — an F would read as a judgement the
 *   analyzer never made (ADR-021).
 */
export function gradeFor(score: number | null): Grade | null {
  if (score === null) return null;

  for (const band of GRADE_BANDS) {
    if (score >= band.min) return band.grade;
  }

  return "F";
}
