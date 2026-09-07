/**
 * The parts a model wrote, and the parts it did not.
 *
 * Both sections are typographically distinct from the data around them, because
 * a reader should never be unsure which words came from a measurement and which
 * from an interpretation. Where AI is absent — no key, a refused answer — the
 * section says so plainly instead of disappearing, since a missing section that
 * silently vanishes is indistinguishable from one that had nothing to report.
 */

import type { AiInterpretation } from "@/lib/ai/interpretation";
import type { Roast } from "@/lib/roast";

import { Empty } from "./primitives";

export function Interpretation({
  interpretation,
  unavailableReason,
}: {
  interpretation: AiInterpretation | null;
  unavailableReason: string | null;
}) {
  if (interpretation === null) {
    return (
      <Empty>
        {unavailableReason ?? "No interpretation was produced for this analysis."}{" "}
        Everything above was measured, so the report is complete without it.
      </Empty>
    );
  }

  return (
    <div className="space-y-8">
      <p className="max-w-[62ch] text-base leading-7">
        {interpretation.executiveSummary}
      </p>

      {interpretation.problems.length === 0 ? null : (
        <div>
          <h3 className="text-sm font-semibold">What to deal with first</h3>
          <ol className="mt-3 space-y-4">
            {interpretation.problems.map((problem) => (
              <li key={problem.finding.id} className="max-w-[68ch]">
                <p className="text-sm leading-6">{problem.whyItMatters}</p>
                <p className="mt-1 border-l-2 border-rule-strong py-0.5 pl-4 text-sm leading-6">
                  {problem.recommendation}
                </p>
                <p className="mt-1 font-mono text-xs text-ink-muted">
                  {problem.finding.id}
                </p>
              </li>
            ))}
          </ol>
        </div>
      )}

      {interpretation.strengths.length === 0 ? null : (
        <div>
          <h3 className="text-sm font-semibold">What is working</h3>
          <ul className="mt-3 space-y-3">
            {interpretation.strengths.map((strength) => (
              <li key={strength.finding.id} className="max-w-[68ch]">
                <p className="text-sm leading-6">{strength.whyItHelps}</p>
                <p className="mt-1 font-mono text-xs text-ink-muted">
                  {strength.finding.id}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="font-mono text-xs text-ink-muted">
        Written by {interpretation.meta.provider}/{interpretation.meta.model} from the
        findings above. Every claim was checked against them before it was shown.
      </p>
    </div>
  );
}

/**
 * The roast.
 *
 * Phase 15 stores each line as an observation and a punchline with different
 * authors, and the typography says so: the fact in mono, the joke in sans at
 * reading size. It is the only place in the interface where prose is set larger
 * than the data.
 */
export function RoastPanel({ roast }: { roast: Roast }) {
  if (roast.lines.length === 0) {
    return <Empty>{roast.note ?? "There was nothing here to roast."}</Empty>;
  }

  return (
    <div>
      <ol className="space-y-8">
        {roast.lines.map((line) => (
          <li key={line.finding.id} className="max-w-[58ch]">
            <p className="font-mono text-xs leading-5 text-ink-muted">
              {line.observation}
            </p>
            <p className="mt-2 text-xl leading-8 font-medium tracking-tight">
              {line.punchline}
            </p>
          </li>
        ))}
      </ol>

      <p className="mt-8 font-mono text-xs text-ink-muted">
        {roast.source === "ai"
          ? "Written from the findings above."
          : `Written from the findings above, without AI. ${roast.fallbackReason ?? ""}`}
      </p>
    </div>
  );
}

/**
 * Screenshots.
 *
 * The pipeline does not capture them yet — the browser analyzers are not wired
 * into the API (ADR-057) — so this is an empty state that names the reason
 * rather than a section that quietly does not exist.
 */
export function Screenshots({ notRun }: { notRun: readonly string[] }) {
  const browserAnalyzers = notRun.length > 0;

  return (
    <Empty>
      No screenshots were captured for this analysis.{" "}
      {browserAnalyzers
        ? `Screenshots come from the browser pass, which also covers ${notRun.join(", ")}. It did not run.`
        : "The browser pass did not produce any."}
    </Empty>
  );
}
